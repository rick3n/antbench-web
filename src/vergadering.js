// Vergadering: één opname → notulen. Keten van vijf modellen achter één knop:
//   [Clear (optioneel)] → Voz (transcriptie) → Who (sprekers)
//   → Ear/Tongue/Gist/Redact (eigenschappen van de tekst, bovenaan).
// Alles lokaal in de browser.
import JSZip from "jszip";
import { $, run, setStatus, setProgress, showResult, table, VERSION } from "./ui.js";
import { model, decodeAudio, downsample, toWav, fmt } from "./engine.js";
import { integratedLufs } from "./loudness.js";

let file = null, recorder = null, chunks = [];

async function notulen(blob, naam) {
  const steps = 7; let step = 0;
  const tick = (t) => { setStatus(`${t} (${++step}/${steps})`); setProgress(step / steps); };

  tick("Audio decoderen");
  const orig = await decodeAudio(blob);

  // Clear staat standaard UIT: op een echte vergaderopname (nl, 2:35, −31 LUFS)
  // gaf Voz op het origineel een veel beter transcript dan op de Clear-output —
  // de ruisonderdrukking haalt spraakdetail weg. Clear blijft beschikbaar voor
  // een A/B en voor afspeelbare audio. Aan: ruime gain-cap (standaard 9 dB is te
  // weinig voor stille opnames); measuredLUFS is de ínput, de output meten we zelf.
  const useClear = $("verg-clear").checked;
  tick(useClear ? "Clear: ruis en galm weg, niveau naar −16 LUFS" : "Clear overgeslagen (schakelaar uit)");
  const clear = useClear
    ? await (await model("clear")).enhance(orig.samples, orig.sampleRate, { targetLUFS: -16, maxGainDB: 40 })
    : { samples: orig.samples, sampleRate: orig.sampleRate, measuredLUFS: null, measuredTruePeakDBFS: null };
  const safeLufs = (x, r) => { try { return integratedLufs(x, r); } catch (e) { console.warn("LUFS-meting mislukt", e); return null; } };
  const lufsIn = clear.measuredLUFS ?? safeLufs(orig.samples, orig.sampleRate);
  const lufsOut = safeLufs(clear.samples, clear.sampleRate);
  // Geheugen: Clear geeft 48 kHz Float32 (≈ 690 MB per uur). Terug naar 16 kHz — wat de
  // spraakmodellen intern toch gebruiken — en het origineel en de 48 kHz-buffer loslaten.
  const audio = downsample(clear.samples, clear.sampleRate, 16000);
  clear.samples = null; orig.samples = null;

  tick("Voz: transcriberen");
  const voz = await (await model("voz")).transcribe(audio, { onProgress: (f) => setProgress((2 + f) / steps) });

  tick("Who: sprekers onderscheiden");
  // Who op de Clear-output: op een stil origineel vindt hij niemand, ook niet na
  // alleen gain; op het schone signaal werkt het, al splitst hij een sterk opgetilde
  // opname soms in twee stemmen. Sprekers onder 8 % van de tijd vallen weg.
  const who = (await (await model("who")).diarize(audio)).keepingSpeakers({ minimumShare: 0.08 });

  tick("Ear: gesproken taal");
  const ear = await (await model("ear")).identify(audio.samples, audio.sampleRate);

  // De audio is nu klaar: eerst de WAV maken (16 kHz, 16-bit) en de Float32 loslaten,
  // vóór de tekstmodellen en het samenstellen — dat was het moment waarop de tab omviel.
  const wav = useClear ? toWav(audio.samples, audio.sampleRate) : null;
  audio.samples = null;

  tick("Gist, Tongue, Redact: eigenschappen van de tekst");
  const text = voz.text.trim();
  const [gist, tongue, redact] = text
    ? await Promise.all([
        (await model("gist")).classify(text, { topK: 5 }),
        Promise.resolve((await model("tongue")).detect(text)),
        (await model("redact")).redaction(text),
      ])
    : [[], null, null];

  tick("Notulen samenstellen");
  const turns = speakerTurns(voz.words, who.turns);
  const props = [
    ["Bestand", naam], ["Duur", fmt(orig.duration)], ["Sprekers", String(who.speakerCount)],
    ["Gesproken taal", `${ear.language ?? "onbekend"}${ear.isReliable ? "" : " (onzeker)"}`],
    ["Taal van de tekst", tongue ? `${tongue.language} (${tongue.reliability ?? ""})` : "–"],
    ["Onderwerpen", gist.map((t) => `${t.name} ${Math.round(t.score * 100)}%`).join(", ") || "–"],
    ["Woorden", String(voz.words.length)], ["Persoonsgegevens", redact ? (redact.items.length ? `${redact.items.length} (${[...new Set(redact.items.map((i) => i.label))].join(", ")})` : "geen gevonden") : "–"],
    ["Clear vooraf", useClear ? "aan (ter vergelijking)" : "uit"],
    [useClear ? "Loudness opname → na Clear" : "Loudness opname", useClear ? `${lufsIn == null ? "–" : lufsIn.toFixed(1)} → ${lufsOut == null ? "–" : lufsOut.toFixed(1)} LUFS (doel −16)` : `${lufsIn == null ? "–" : lufsIn.toFixed(1)} LUFS`],
    ...(useClear ? [["True peak na Clear", clear.measuredTruePeakDBFS == null ? "–" : `${clear.measuredTruePeakDBFS.toFixed(1)} dBTP`]] : []),
    ["Verwerking", `Voz ${voz.processingTime.toFixed(0)} s (${voz.realtimeFactor.toFixed(1)}× realtime), ${VERSION}, lokaal in de browser`],
  ];
  const md = [`# Notulen — ${naam.replace(/\.[^.]+$/, "")}`, "", `*${new Date().toLocaleString("nl-NL")} · ${VERSION}, Desert Ant SDK 4.3.0, alle modellen op dit toestel*`, "",
    "| | |", "|---|---|", ...props.map(([k, v]) => `| ${k} | ${v} |`), "", "## Transcript", ""];
  for (const t of turns) md.push(`**Spreker ${t.speaker + 1}** · ${fmt(t.start)}–${fmt(t.end)}`, "", t.text, "");
  const mdText = md.join("\n");
  const mdRedacted = redact ? redactTurns(mdText, redact.items) : null;
  return { props, turns, mdText, mdRedacted, srt: toSrt(turns), wav, text };
}

/**
 * Sprekers toekennen op zinsniveau en micro-beurten wegwerken. Who levert
 * nerveuze beurtgrenzen; per woord wisselen geeft alinea's van één woord.
 * 1. woorden → zinnen (op leesteken of >1 s stilte)
 * 2. per zin de spreker met de meeste spreektijd in die zin
 * 3. opeenvolgende zinnen van dezelfde spreker samenvoegen
 * 4. beurten korter dan 2,5 s of 4 woorden bij de buurman voegen
 */
function speakerTurns(words, turns) {
  if (!words.length) return [];
  const speakerAt = (a, b) => {
    const score = new Map();
    for (const t of turns) { const o = Math.min(b, t.end) - Math.max(a, t.start); if (o > 0) score.set(t.speaker, (score.get(t.speaker) ?? 0) + o); }
    if (!score.size) return null;
    return [...score.entries()].sort((x, y) => y[1] - x[1])[0][0];
  };
  // 1. zinnen
  const sentences = []; let cur = null;
  for (const w of words) {
    if (!cur || w.start - cur.end > 1.0) { cur = { start: w.start, end: w.end, words: [] }; sentences.push(cur); }
    cur.end = w.end; cur.words.push(w.text);
    if (/[.!?]$/.test(w.text)) cur = null;
  }
  // 2. spreker per zin (zinnen zonder overlap met een beurt erven de vorige)
  let last = turns[0]?.speaker ?? 0;
  for (const z of sentences) { z.speaker = speakerAt(z.start, z.end) ?? last; last = z.speaker; }
  // 3. samenvoegen
  const merged = [];
  for (const z of sentences) {
    const p = merged[merged.length - 1];
    if (p && p.speaker === z.speaker && z.start - p.end < 3) { p.end = z.end; p.words.push(...z.words); } else merged.push({ ...z, words: [...z.words] });
  }
  // 4. micro-beurten bij de buurman
  for (let i = 0; i < merged.length; i++) {
    const t = merged[i];
    if (merged.length > 1 && (t.end - t.start < 2.5 || t.words.length < 4)) {
      const nb = merged[i - 1] ?? merged[i + 1];
      if (nb === merged[i - 1]) { nb.end = t.end; nb.words.push(...t.words); } else { nb.start = t.start; nb.words.unshift(...t.words); }
      merged.splice(i, 1); i = Math.max(-1, i - 2);
    }
  }
  // na het samenvoegen kunnen buren dezelfde spreker hebben
  const out = [];
  for (const t of merged) { const p = out[out.length - 1]; if (p && p.speaker === t.speaker) { p.end = t.end; p.words.push(...t.words); } else out.push(t); }
  return out.map((t) => ({ ...t, text: t.words.join(" ").replace(/\s+([,.!?;:])/g, "$1").trim() }));
}

function toSrt(turns) {
  const ts = (s) => { const d = new Date(s * 1000); return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")},${String(d.getUTCMilliseconds()).padStart(3, "0")}`; };
  return turns.map((t, i) => `${i + 1}\n${ts(t.start)} --> ${ts(t.end)}\n[Spreker ${t.speaker + 1}] ${t.text}\n`).join("\n");
}

/** Geredigeerde versie: elk gevonden origineel door zijn placeholder vervangen. */
function redactTurns(text, items) {
  let out = text;
  for (const i of [...items].sort((a, b) => b.original.length - a.original.length)) if (i.original) out = out.split(i.original).join(i.placeholder);
  return out;
}

window.addEventListener("unhandledrejection", (e) => setStatus(`Onverwachte fout: ${e.reason?.message ?? e.reason}`));
window.addEventListener("error", (e) => setStatus(`Onverwachte fout: ${e.message}`));

// --- UI ---------------------------------------------------------------------------

function setFile(f, label) {
  file = f; $("verg-info").textContent = `${label} · ${(f.size / 1e6).toFixed(1)} MB`; $("verg-go").disabled = false;
  const a = $("verg-audio"); a.src = URL.createObjectURL(f); a.style.display = "";
}
$("verg-pick").onclick = () => $("verg-file").click();
$("verg-file").onchange = (e) => { const f = e.target.files?.[0]; if (f) setFile(f, f.name); e.target.value = ""; };
$("verg-rec").onclick = async () => {
  const btn = $("verg-rec");
  if (recorder?.state === "recording") { recorder.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = []; recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = () => { stream.getTracks().forEach((t) => t.stop()); btn.textContent = "● Opnemen"; btn.classList.remove("rec");
      const b = new Blob(chunks, { type: recorder.mimeType }); setFile(new File([b], `opname-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.webm`, { type: b.type }), "opname"); };
    recorder.start(); btn.textContent = "■ Stop"; btn.classList.add("rec"); setStatus("Opnemen…");
  } catch (e) { setStatus(`Microfoon niet beschikbaar: ${e.message}`); }
};

$("verg-go").onclick = () => run("Vergadering → notulen", async () => {
  const r = await notulen(file, file.name);
  const base = file.name.replace(/\.[^.]+$/, "");
  const node = document.createDocumentFragment();
  node.append(table(r.props), document.createElement("hr"));
  for (const t of r.turns) {
    const p = document.createElement("p"); const b = document.createElement("b");
    b.textContent = `Spreker ${t.speaker + 1} · ${fmt(t.start)}  `; p.append(b, t.text); node.append(p);
  }
  if (!r.turns.length) node.append("(geen spraak gevonden)");
  // De WAV gaat niet in de ZIP: JSZip houdt de hele inhoud in het geheugen. Een losse
  // Blob mag Chrome naar schijf zetten; een eigen downloadknop ernaast.
  if (r.wav) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(r.wav); a.download = `${base}__clear.wav`;
    const b = document.createElement("button"); b.textContent = `Schone audio (.wav, ${(r.wav.size / 1e6).toFixed(0)} MB)`; a.append(b);
    const p = document.createElement("p"); p.className = "row"; p.append(a); node.prepend(p);
  }
  const zip = new JSZip();
  zip.file(`${base}__notulen.md`, r.mdText); zip.file(`${base}__notulen.srt`, r.srt);
  if (r.mdRedacted) zip.file(`${base}__notulen-geredigeerd.md`, r.mdRedacted);
  const blob = await zip.generateAsync({ type: "blob" });
  showResult(r.mdText, node, blob, `${base}__notulen.zip`);
});
