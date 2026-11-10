// Audio-tabblad: opnemen of bestand → Voz, Who, Ear, Clear. Alles blijft in de browser.
import { $, run, showResult, table, setStatus, setProgress } from "./ui.js";
import { model, decodeAudio, toWav, fmt } from "./engine.js";
import { integratedLufs } from "./loudness.js";

let samples = null, sampleRate = 0;        // mono Float32Array + rate van de huidige invoer
let recorder = null, chunks = [];


const actions = {
  voz: async () => {
    const r = await (await model("voz")).transcribe({ samples, sampleRate }, { onProgress: setProgress });
    const node = document.createDocumentFragment();
    node.append(r.text || "(geen spraak gevonden)", document.createElement("hr"));
    node.append(table([["Duur", fmt(r.duration)], ["Verwerkt in", `${r.processingTime.toFixed(1)} s`], ["Realtime-factor", `${r.realtimeFactor.toFixed(0)}×`], ["Woorden", r.words.length]]));
    showResult(r.text, node);
  },
  who: async () => {
    const d = await (await model("who")).diarize({ samples, sampleRate });
    const lines = d.turns.map((t) => `Spreker ${t.speaker + 1}  ${fmt(t.start)}–${fmt(t.end)}`);
    showResult(lines.join("\n"), table([["Sprekers", d.speakerCount], ["Beurten", d.turns.length], ...d.turns.slice(0, 40).map((t) => [`${fmt(t.start)}–${fmt(t.end)}`, `Spreker ${t.speaker + 1}`])]));
  },
  ear: async () => {
    const d = await (await model("ear")).identify(samples, sampleRate);
    showResult(`Gesproken taal: ${d.language ?? "onbekend"}`, table([["Taal", d.language ?? "onbekend"], ["Betrouwbaar", d.isReliable ? "ja" : "nee"], ...d.candidates.slice(0, 4).map((c) => [c.language, c.probability])]));
  },
  clear: async () => {
    const r = await (await model("clear")).enhance(samples, sampleRate, { targetLUFS: -16, maxGainDB: 40 });
    const wav = toWav(r.samples, r.sampleRate);
    const out = $("audio-out"); out.src = URL.createObjectURL(wav); out.style.display = "";
    showResult("Opgeschoonde opname staat onder de knoppen.",
      table([["Duur", fmt(r.durationSec)], ["Verwerkt in", `${r.processingSec.toFixed(1)} s`],
             ["Loudness opname", r.measuredLUFS == null ? "–" : `${r.measuredLUFS.toFixed(1)} LUFS`],
             ["Loudness na Clear", (() => { const l = integratedLufs(r.samples, r.sampleRate); return l == null ? "–" : `${l.toFixed(1)} LUFS`; })()],
             ["Uit", `${r.sampleRate} Hz mono`]]),
      wav, "antbench-clear.wav");
  },
};
const labels = { voz: "Voz (transcriptie)", who: "Who (sprekers)", ear: "Ear (taal)", clear: "Clear (opschonen)" };
for (const b of document.querySelectorAll("#tab-audio button.run"))
  b.onclick = () => { if (!samples) return setStatus("Eerst opnemen of een bestand kiezen."); run(labels[b.dataset.model], actions[b.dataset.model]); };

// --- Invoer ---------------------------------------------------------------------

async function setAudio(blob, label) {
  const buf = await decodeAudio(blob);
  samples = buf.samples; sampleRate = buf.sampleRate;
  const a = $("audio-in"); a.src = URL.createObjectURL(blob); a.style.display = "";
  $("audio-info").textContent = `${label} · ${fmt(buf.duration)} · ${buf.sampleRate} Hz`;
  $("audio-out").style.display = "none";
}

$("audio-pick").onclick = () => $("audio-file").click();
$("audio-file").onchange = async (ev) => {
  const f = ev.target.files?.[0]; if (!f) return;
  try { await setAudio(f, f.name); setStatus("Audio geladen."); } catch (e) { setStatus(`Audio lezen mislukt: ${e.message}`); }
  ev.target.value = "";
};

$("rec").onclick = async () => {
  const btn = $("rec");
  if (recorder?.state === "recording") { recorder.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = []; recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      btn.textContent = "● Opnemen"; btn.classList.remove("rec");
      await setAudio(new Blob(chunks, { type: recorder.mimeType }), "opname");
      setStatus("Opname klaar. Kies een model.");
    };
    recorder.start(); btn.textContent = "■ Stop"; btn.classList.add("rec"); setStatus("Opnemen… tik op Stop als je klaar bent.");
  } catch (e) { setStatus(`Microfoon niet beschikbaar: ${e.message}`); }
};

