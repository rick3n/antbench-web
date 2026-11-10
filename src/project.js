// Project-tabblad: veel bestanden in één keer, gegroepeerd op naamvoorvoegsel,
// per modaliteit door de gekozen modellen, en als ZIP terug met de resultaten
// in de bestanden zelf (XMP-trefwoorden in foto's) en ernaast (transcripten,
// geredigeerde tekst, rapport.md, resultaten.json).
//
// Naamgeving: "<project>__<naam>.<ext>". Alles met hetzelfde voorvoegsel vóór de
// dubbele underscore hoort bij elkaar; zonder voorvoegsel → project "los".
import JSZip from "jszip";
import { $, run, setStatus, setProgress, showResult, table, VERSION } from "./ui.js";
import { modality, fileToText, decodeAudio, imageToPixels, actions, MODEL_LABELS } from "./engine.js";
import { xmpPacket, jpegWithXmp } from "./xmp.js";

const DEFAULTS = { tekst: ["redact", "gist", "tongue"], audio: ["voz"], beeld: ["eye"] };
const CHOICES  = { tekst: ["redact", "gist", "tongue", "emo"], audio: ["voz", "who", "ear", "clear"], beeld: ["eye", "moderator"] };

let projects = new Map();                 // naam → { files: [], results: Map(file → {model → result}) }
const list = $("project-list");

export function splitName(name) {
  const i = name.indexOf("__");
  const base = name.replace(/\.[^.]+$/, "");
  return i > 0 ? { project: name.slice(0, i), rest: base.slice(i + 2) } : { project: "los", rest: base };
}

function addFiles(files) {
  for (const f of files) {
    if (!modality(f)) continue;
    const { project } = splitName(f.name);
    if (!projects.has(project)) projects.set(project, { files: [], results: new Map(), models: structuredClone(DEFAULTS) });
    const p = projects.get(project);
    if (!p.files.some((x) => x.name === f.name && x.size === f.size)) p.files.push(f);
  }
  render();
}

function render() {
  list.replaceChildren();
  for (const [name, p] of projects) {
    const card = document.createElement("details"); card.open = true; card.className = "project";
    const sum = document.createElement("summary");
    const counts = ["tekst", "audio", "beeld"].map((m) => [m, p.files.filter((f) => modality(f) === m).length]).filter(([, n]) => n);
    sum.textContent = `${name} — ${p.files.length} bestanden (${counts.map(([m, n]) => `${n} ${m}`).join(", ")})`;
    card.append(sum);

    // modelkeuze per aanwezige modaliteit
    for (const [m] of counts) {
      const row = document.createElement("div"); row.className = "row small";
      row.append(`${m}: `);
      for (const id of CHOICES[m]) {
        const lab = document.createElement("label"); const cb = document.createElement("input"); cb.type = "checkbox";
        cb.checked = p.models[m].includes(id);
        cb.onchange = () => { p.models[m] = CHOICES[m].filter((x) => x === id ? cb.checked : p.models[m].includes(x)); };
        lab.append(cb, " ", MODEL_LABELS[id].split(" ")[0]); row.append(lab);
      }
      card.append(row);
    }

    const tbl = document.createElement("table");
    for (const f of p.files) {
      const tr = tbl.insertRow(); tr.insertCell().textContent = f.name;
      const r = p.results.get(f);
      tr.insertCell().textContent = r ? Object.entries(r).map(([k, v]) => `${k}: ${v.error ? "✗ " + v.error : v.summary}`).join(" · ") : "—";
    }
    card.append(tbl);

    const acts = document.createElement("div"); acts.className = "row";
    const go = document.createElement("button"); go.className = "primary run"; go.textContent = "Verwerk";
    go.onclick = () => run(`Project ${name}`, () => processProject(name));
    const dl = document.createElement("button"); dl.textContent = "Download ZIP"; dl.disabled = p.results.size === 0;
    dl.onclick = () => run(`ZIP ${name}`, () => downloadZip(name));
    const rm = document.createElement("button"); rm.textContent = "Verwijder"; rm.onclick = () => { projects.delete(name); render(); };
    acts.append(go, dl, rm); card.append(acts);
    list.append(card);
  }
  $("project-empty").style.display = projects.size ? "none" : "";
}

async function processProject(name) {
  const p = projects.get(name);
  let done = 0;
  for (const f of p.files) {
    const m = modality(f), out = p.results.get(f) ?? {};
    setStatus(`${name}: ${f.name} (${done + 1}/${p.files.length})…`);
    let input;
    try {
      input = m === "tekst" ? { text: await fileToText(f) }
            : m === "audio" ? { audio: await decodeAudio(f) }
            : { pixels: await imageToPixels(f) };
    } catch (e) { out._decode = { error: e.message, summary: "" }; p.results.set(f, out); done++; continue; }
    for (const id of p.models[m]) {
      try { out[id] = await actions[id](input); }
      catch (e) { console.error(id, f.name, e); out[id] = { error: e.message ?? String(e), summary: "" }; }
      p.results.set(f, out); render();
    }
    done++; setProgress(done / p.files.length);
  }
  const ok = [...p.results.values()].flatMap(Object.values).filter((r) => !r.error).length;
  showResult(`${name}: ${p.files.length} bestanden verwerkt, ${ok} resultaten. Download de ZIP om alles terug te krijgen.`);
}

async function downloadZip(name) {
  const p = projects.get(name), zip = new JSZip(), report = [`# AntBench — ${name}`, "", `Verwerkt op ${new Date().toLocaleString("nl-NL")} · ${VERSION}, Desert Ant SDK 4.3.0, alle modellen lokaal in de browser`, ""];
  const json = {};
  for (const f of p.files) {
    const r = p.results.get(f); if (!r) continue;
    const base = f.name.replace(/\.[^.]+$/, ""), ext = (f.name.match(/\.([^.]+)$/) || [, ""])[1].toLowerCase();
    json[f.name] = r;
    report.push(`## ${f.name}`, "");
    for (const [id, res] of Object.entries(r)) report.push(`- **${MODEL_LABELS[id] ?? id}**: ${res.error ? "mislukt: " + res.error : res.summary}`);
    report.push("");

    if (r.eye && !r.eye.error) {
      const keywords = [...new Set([...(r.eye.tags ?? []), r.eye.kind].filter(Boolean))];
      const description = `${r.eye.kind ?? "foto"} · ${r.eye.tags.slice(0, 8).join(", ")} · mensen ${r.eye.people}, gezichten ${r.eye.faces}` + (r.moderator?.isNSFW ? " · NSFW" : "");
      const rating = r.eye.scores ? Math.max(1, Math.min(5, Math.round(r.eye.scores.keeper * 5))) : null;
      const xmp = xmpPacket({ keywords, description, rating });
      if (ext === "jpg" || ext === "jpeg") {
        try { zip.file(`${base}__tagged.jpg`, jpegWithXmp(await f.arrayBuffer(), xmp)); }
        catch (e) { zip.file(`${base}.xmp`, xmp); }
      } else zip.file(`${base}.xmp`, xmp);
      report.push(`  trefwoorden: ${keywords.join(", ")}`, "");
    }
    if (r.voz && !r.voz.error) {
      zip.file(`${base}__transcript.txt`, r.voz.text);
      const srt = (r.voz.words ?? []).length ? wordsToSrt(r.voz.words, r.who?.turns) : null;
      if (srt) zip.file(`${base}__transcript.srt`, srt);
      report.push(`  transcript: ${r.voz.text.slice(0, 300)}${r.voz.text.length > 300 ? "…" : ""}`, "");
    }
    if (r.clear?.wav) zip.file(`${base}__clear.wav`, r.clear.wav);
    if (r.redact && !r.redact.error) { zip.file(`${base}__redacted.txt`, r.redact.redactedText); report.push(`  geredigeerd: ${r.redact.items.map((i) => i.label).join(", ")}`, ""); }
  }
  zip.file("rapport.md", report.join("\n"));
  zip.file("resultaten.json", JSON.stringify({ versie: VERSION, verwerkt: new Date().toISOString(), bestanden: json }, (k, v) => (v instanceof Blob || k === "words" ? undefined : v), 2));
  const blob = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${name}__antbench.zip`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  showResult(`${name}__antbench.zip staat in je downloads.`, table([["Bestanden", Object.keys(zip.files).length], ["Grootte", `${(blob.size / 1e6).toFixed(1)} MB`]]));
}

/** Woorden met tijdstempels → SRT in blokken van ~8 s, met spreker als Who meedraaide. */
function wordsToSrt(words, turns) {
  const t = (s) => { const d = new Date(s * 1000); return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")},${String(d.getUTCMilliseconds()).padStart(3, "0")}`; };
  const speaker = (s) => turns?.find((x) => s >= x.start && s < x.end)?.speaker;
  const blocks = []; let cur = null;
  for (const w of words) {
    const sp = speaker(w.start);
    if (!cur || w.start - cur.start > 8 || sp !== cur.speaker) { cur = { start: w.start, end: w.end, speaker: sp, text: [] }; blocks.push(cur); }
    cur.end = w.end; cur.text.push(w.text);
  }
  return blocks.map((b, i) => `${i + 1}\n${t(b.start)} --> ${t(b.end)}\n${b.speaker != null ? `[Spreker ${b.speaker + 1}] ` : ""}${b.text.join(" ").trim()}\n`).join("\n");
}

// --- Invoer -----------------------------------------------------------------------

$("project-pick").onclick = () => $("project-files").click();
$("project-files").onchange = (e) => { addFiles([...e.target.files]); e.target.value = ""; };
if (window.showDirectoryPicker) {
  const b = $("project-dir"); b.style.display = "";
  b.onclick = async () => {
    try {
      const dir = await window.showDirectoryPicker({ mode: "read" });
      const files = []; for await (const h of dir.values()) if (h.kind === "file") files.push(await h.getFile());
      addFiles(files);
    } catch (e) { if (e.name !== "AbortError") setStatus(`Map openen mislukt: ${e.message}`); }
  };
}
// slepen op desktop
list.parentElement.addEventListener("dragover", (e) => e.preventDefault());
list.parentElement.addEventListener("drop", (e) => { e.preventDefault(); addFiles([...e.dataTransfer.files]); });
render();
