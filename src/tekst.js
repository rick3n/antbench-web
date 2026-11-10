// Tekst-tabblad: Redact, Tongue, Emo, Gist. Invoer via typen, bestand of Delen.
import { $, BASE, run, showResult, clearResult, highlightPlaceholders, table, setStatus } from "./ui.js";
import { model, fileToText } from "./engine.js";

const input = $("text-input");
const actions = {
  redact: async (text) => {
    const r = await (await model("redact")).redaction(text);
    const node = document.createDocumentFragment();
    node.append(highlightPlaceholders(r.redactedText));
    if (r.items.length) {
      node.append(document.createElement("hr"));
      node.append(table(r.items.map((i) => [i.placeholder, `${i.label} · ${(i.confidence * 100).toFixed(0)}%`])));
    }
    showResult(r.redactedText, node);
  },
  tongue: async (text) => {
    const d = (await model("tongue")).detect(text);
    const top = (d.candidates ?? []).slice(0, 3).map((c) => [c.language, c.probability]);
    showResult(`Taal: ${d.language}`, table([["Taal", d.language], ["Betrouwbaarheid", d.reliability ?? (d.isTooCloseToCall ? "tentative" : "confident")], ...top]));
  },
  emo: async (text) => {
    const s = await (await model("emo")).suggestions(text, { limit: 8 });
    showResult(s.map((x) => x.emoji).join(" "), table(s.map((x) => [x.emoji, x.confidence])));
  },
  gist: async (text) => {
    const t = await (await model("gist")).classify(text, { topK: 6 });
    showResult(t.map((x) => x.name).join(", "), table(t.map((x) => [x.name, x.score])));
  },
};

const labels = { redact: "Redact (PII)", tongue: "Tongue (taal)", emo: "Emo (emoji)", gist: "Gist (onderwerpen)" };
for (const b of document.querySelectorAll("#tab-tekst button.run"))
  b.onclick = () => { if (input.value.trim()) run(labels[b.dataset.model], () => actions[b.dataset.model](input.value)); };

$("text-pick").onclick = () => $("text-file").click();
$("text-file").onchange = async (ev) => {
  const file = ev.target.files?.[0]; if (!file) return;
  try { input.value = await fileToText(file); setStatus(`Bestand geladen: ${file.name} (${input.value.length} tekens)`); }
  catch (e) { setStatus(`Bestand lezen mislukt: ${e.message}`); }
  ev.target.value = "";
};
$("text-clear").onclick = () => { input.value = ""; clearResult(); };


// Tekst via het Delen-menu (PWA share_target, GET).
const q = new URLSearchParams(location.search);
const shared = [q.get("title"), q.get("text"), q.get("url")].filter(Boolean).join("\n");
if (shared) { input.value = shared; setStatus(`Tekst ontvangen via Delen (${shared.length} tekens).`); history.replaceState(null, "", BASE + location.hash); }
else if (!input.value)
  input.value = "Bel Anna Kovács op 06-12345678 of mail anna@example.nl. IBAN NL91ABNA0417164300, Prinses Beatrixlaan 2, Den Haag.";
