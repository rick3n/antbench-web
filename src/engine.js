// Gedeelde motor: lazy modelregistratie en decoders voor tekst, audio en beeld.
// Zowel de tabbladen als de projectverwerking gebruiken dit, zodat elk model
// één keer geladen wordt.
import JSZip from "jszip";
import { BASE, setProgress, setStatus } from "./ui.js";

const litert = () => ({ litertWasmDir: `${BASE}litert/`, onProgress: setProgress });

const loaders = {
  redact:    async () => (await import("@desert-ant-labs/redact")).Redact.load(litert()),
  tongue:    async () => (await import("@desert-ant-labs/tongue")).Tongue.load({ from: `${BASE}models/tongue/` }),
  emo:       async () => (await import("@desert-ant-labs/emo")).Emo.load(litert()),
  gist:      async () => (await import("@desert-ant-labs/gist")).Gist.load(litert()),
  voz:       async () => (await import("@desert-ant-labs/voz")).Voz.load({ wasmDir: `${BASE}ort/`, onProgress: setProgress, ep: "auto" }),
  who:       async () => (await import("@desert-ant-labs/who")).Who.load(litert()),
  ear:       async () => (await import("@desert-ant-labs/ear")).Ear.load(litert()),
  clear:     async () => (await import("@desert-ant-labs/clear")).Clear.load(litert()),
  eye:       async () => (await import("@desert-ant-labs/eye")).Eye.load(litert()),
  moderator: async () => (await import("@desert-ant-labs/moderator")).Moderator.load(litert()),
  shapes:    async () => (await import("@desert-ant-labs/shapes")).Shapes.load(litert()),
};
const loaded = {};
export async function model(name) {
  if (!loaded[name]) { setStatus(`${name}: model laden (eerste keer)…`); loaded[name] = await loaders[name](); }
  return loaded[name];
}

export const MODEL_LABELS = {
  redact: "Redact (PII)", tongue: "Tongue (taal)", emo: "Emo (emoji)", gist: "Gist (onderwerpen)",
  voz: "Voz (transcriptie)", who: "Who (sprekers)", ear: "Ear (gesproken taal)", clear: "Clear (opschonen)",
  eye: "Eye (analyse)", moderator: "Moderator (NSFW)", shapes: "Shapes (vorm)",
};

// --- Modaliteit uit bestandsnaam/MIME -----------------------------------------

export function modality(file) {
  const n = file.name.toLowerCase(), t = file.type || "";
  if (t.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/.test(n)) return "beeld";
  if (t.startsWith("audio/") || t.startsWith("video/") || /\.(wav|mp3|m4a|aac|ogg|opus|flac|mp4|mov|webm|3gp)$/.test(n)) return "audio";
  if (t.startsWith("text/") || /\.(txt|md|html?|docx|csv|json)$/.test(n)) return "tekst";
  return null;
}

// --- Tekst ----------------------------------------------------------------------

export async function fileToText(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".docx")) return docxToText(await file.arrayBuffer());
  const text = await file.text();
  if (name.endsWith(".html") || name.endsWith(".htm") || file.type === "text/html")
    return new DOMParser().parseFromString(text, "text/html").body.innerText.trim();
  return text;
}

// word/document.xml uit de docx; <w:p> → alinea, <w:tab/> → tab, <w:br/> → regeleinde.
export async function docxToText(buf) {
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) throw new Error("geen word/document.xml; is dit wel een .docx?");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const out = [];
  for (const p of doc.getElementsByTagNameNS(W, "p")) {
    let line = "";
    const walker = doc.createTreeWalker(p, NodeFilter.SHOW_ELEMENT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.namespaceURI !== W) continue;
      if (n.localName === "t") line += n.textContent;
      else if (n.localName === "tab") line += "\t";
      else if (n.localName === "br") line += "\n";
    }
    out.push(line);
  }
  return out.join("\n").trim();
}

// --- Audio ----------------------------------------------------------------------

/** Blob → { samples: Float32Array (mono), sampleRate, duration }. */
export async function decodeAudio(blob) {
  const ctx = new AudioContext();
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const n = buf.length, mono = new Float32Array(n);
    for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / buf.numberOfChannels; }
    return { samples: mono, sampleRate: buf.sampleRate, duration: buf.duration };
  } finally { ctx.close(); }
}

/** Mono Float32 naar een lagere samplerate (blokgemiddelde + lineaire interpolatie).
 *  Clear levert 48 kHz; Voz, Who en Ear werken intern op 16 kHz. Terugbrengen scheelt
 *  2/3 geheugen — op een telefoon het verschil tussen klaar en een gecrashte tab. */
export function downsample(f32, from, to) {
  if (from <= to) return { samples: f32, sampleRate: from };
  const ratio = from / to, n = Math.floor(f32.length / ratio), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = i * ratio, b = Math.min(f32.length, a + ratio); let acc = 0, cnt = 0;
    for (let j = Math.floor(a); j < b; j++) { acc += f32[j]; cnt++; }
    out[i] = cnt ? acc / cnt : 0;
  }
  return { samples: out, sampleRate: to };
}

/** Float32 mono → 16-bit PCM WAV. */
export function toWav(f32, rate) {
  const buf = new ArrayBuffer(44 + f32.length * 2), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + f32.length * 2, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, f32.length * 2, true);
  for (let i = 0; i < f32.length; i++) { const s = Math.max(-1, Math.min(1, f32[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return new Blob([buf], { type: "audio/wav" });
}

export function fmt(s) { return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`; }

// --- Beeld ----------------------------------------------------------------------

/** Blob → { data, width, height } (RGBA), verkleind tot max 1600 px, EXIF-oriëntatie toegepast. */
export async function imageToPixels(blob, max = 1600) {
  const bmp = await createImageBitmap(blob);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  const ctx = c.getContext("2d"); ctx.drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
  const img = ctx.getImageData(0, 0, c.width, c.height);
  return { data: img.data, width: img.width, height: img.height, canvas: c };
}

// --- Standaardacties per model (gebruikt door Project) ---------------------------

/** Moderator-instellingen (gedeeld door Beeld en Project). De SDK neemt de hoogste
 *  regio-score als totaalscore en vlagt bij ≥ threshold (standaard 0,5); een huidrijke
 *  close-up van een gezicht haalt zo al snel "nude 70 %". Hoger is strenger voor de vlag. */
export const moderation = { threshold: 0.5, policy: "standard" };

export const actions = {
  redact: async ({ text }) => { const r = await (await model("redact")).redaction(text); return { summary: `${r.items.length} items gemaskeerd`, redactedText: r.redactedText, items: r.items.map((i) => ({ label: i.label, placeholder: i.placeholder, confidence: i.confidence })) }; },
  tongue: async ({ text }) => { const d = (await model("tongue")).detect(text); return { summary: `taal ${d.language}`, language: d.language, reliability: d.reliability }; },
  emo:    async ({ text }) => { const s = await (await model("emo")).suggestions(text, { limit: 5 }); return { summary: s.map((x) => x.emoji).join(" "), emoji: s.map((x) => x.emoji) }; },
  gist:   async ({ text }) => { const t = await (await model("gist")).classify(text, { topK: 5 }); return { summary: t.map((x) => x.name).join(", "), topics: t.map((x) => ({ name: x.name, score: x.score })) }; },
  voz:    async ({ audio }) => { const r = await (await model("voz")).transcribe(audio); return { summary: `${r.words.length} woorden, ${fmt(r.duration)}`, text: r.text, words: r.words }; },
  who:    async ({ audio }) => { const d = await (await model("who")).diarize(audio); return { summary: `${d.speakerCount} sprekers, ${d.turns.length} beurten`, speakerCount: d.speakerCount, turns: d.turns }; },
  ear:    async ({ audio }) => { const d = await (await model("ear")).identify(audio.samples, audio.sampleRate); return { summary: `gesproken taal ${d.language ?? "?"}`, language: d.language, isReliable: d.isReliable }; },
  clear:  async ({ audio }) => { const r = await (await model("clear")).enhance(audio.samples, audio.sampleRate); return { summary: `opgeschoond, ${fmt(r.durationSec)}`, wav: toWav(r.samples, r.sampleRate), lufs: r.measuredLUFS }; },
  eye:    async ({ pixels }) => {
    const a = await (await model("eye")).analyze(pixels);
    return { summary: `${a.kind ?? "foto"}: ${a.tags().slice(0, 6).join(", ")}`, kind: a.kind, tags: a.tags(), scores: a.scores,
             people: a.people?.length ?? 0, faces: a.faces?.length ?? 0, pets: a.pets?.length ?? 0, rotation: a.rotation ?? 0 };
  },
  moderator: async ({ pixels }) => { const m = await (await model("moderator")).analyze(pixels, moderation); return { summary: `NSFW ${m.isNSFW ? "ja" : "nee"} (${Math.round(m.score * 100)}%, drempel ${moderation.threshold})`, isNSFW: m.isNSFW, score: m.score, regions: m.regions, threshold: moderation.threshold }; },
};
