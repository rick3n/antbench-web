// Gedeelde motor: lazy modelregistratie en decoders voor tekst, audio en beeld.
// Zowel de tabbladen als de projectverwerking gebruiken dit, zodat elk model
// één keer geladen wordt.
import JSZip from "jszip";
import { BASE, setProgress, setStatus } from "./ui.js";
import { spoor } from "./spoor.js";

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
  uhm:       async () => (await import("@desert-ant-labs/uhm")).Uhm.load(litert()),
  toxic:     async () => (await import("@desert-ant-labs/toxic")).Toxic.load(litert()),
  // Alleen de detector (waar zit een gezicht), bewust niet het herkennen van wie het is.
  gezichten: async () => (await import("@desert-ant-labs/face")).FaceDetector.load(litert()),
};
const loaded = {};
/**
 * Twee aanpakken. Buiten Apple: Voz in een worker die daarna stopt (gemeten in Chrome: 1,8 → 0,7-1,0 GB tijdens
 * de volgende stap). Op iPhone en iPad past Voz niet samen met een ander model in één tabblad, in geen enkele
 * volgorde (iPhone, iOS 26.5):
 *   - Voz in de pagina, daarna Who laden: pagina valt weg;
 *   - Voz in een worker: pagina valt weg bij de eerste inferentie;
 *   - eerst Who en Redact laden, dan Voz: "[webgpu] RangeError: Out of memory".
 * Voz alleen werkt er wel. Daarom draait Voz daar in een pagina waar verder niets geladen is, en wordt de pagina
 * daarna herladen: de tussenstand staat in IndexedDB en de ketting gaat verder bij de volgende stap. Herladen is
 * de enige manier die het geheugen zeker teruggeeft. Zie draai() en het vervolg in ketting/main.js.
 *
 * Zuinig met geheugen: op een iPhone of iPad mag een tabblad veel minder geheugen gebruiken dan op Android of een
 * laptop, en gooit Safari de pagina zonder melding weg als het te veel wordt. Dan laden we geen tweede model
 * bovenop het eerste: kleine modellen geven we vrij zodra hun stap klaar is, en Voz (±1,2 GB, zonder eigen
 * dispose) draait in een aparte worker die na afloop wordt beëindigd. Alleen dat geeft het geheugen echt terug:
 * het sluiten van de ONNX-sessies doet dat gemeten niet, omdat WebAssembly-geheugen nooit krimpt.
 */
const apple = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const bewaardZuinig = (() => { try { return localStorage.getItem("antbench.zuinig"); } catch { return null; } })();
export const geheugen = { zuinig: bewaardZuinig != null ? bewaardZuinig === "1" : apple || (navigator.deviceMemory ?? 8) <= 4, apple };
export function zetZuinig(aan) { geheugen.zuinig = aan; try { localStorage.setItem("antbench.zuinig", aan ? "1" : "0"); } catch {} }
/** Eén model uit het geheugen halen; de volgende model(naam) laadt het opnieuw uit de modelcache. Voz kan dit niet. */
export async function geefVrij(name) {
  const m = loaded[name]; if (!m || typeof m.dispose !== "function") return false;
  delete loaded[name];
  try { await m.dispose(); spoor(`model ${name}: vrijgegeven`); } catch (e) { console.warn("vrijgeven", name, e); spoor(`model ${name}: vrijgeven mislukt (${e.message})`); }
  return true;
}
/**
 * Transcriberen in een eigen worker, die daarna stopt. De samples gaan zonder kopie heen en komen terug.
 * Geeft { text, words } en zet audio.samples terug.
 */
export function vozApart(audio) {
  return new Promise((ok, fout) => {
    spoor(`voz apart: worker starten (${(audio.samples.length / audio.sampleRate).toFixed(0)} s audio)`);
    const w = new Worker(new URL("./voz-worker.js", import.meta.url), { type: "module" });
    let stap = -1; const mijlpaal = (wat, f) => { const s = Math.floor(f * 4); if (s !== stap) { stap = s; spoor(`voz apart: ${wat} ${Math.round(f * 100)} %`); } };
    const heel = audio.samples.byteOffset === 0 && audio.samples.byteLength === audio.samples.buffer.byteLength;
    const samples = heel ? audio.samples : audio.samples.slice();
    const klaar = (f, v) => { w.terminate(); spoor("voz apart: worker beëindigd"); f(v); };
    w.onmessage = ({ data: d }) => {
      if (d.t === "info") spoor(`voz apart: ${d.m}`);
      else if (d.t === "laden") { setStatus("voz: model laden…"); setProgress(d.f); mijlpaal("model laden", d.f); }
      else if (d.t === "voortgang") { setStatus("Transcriberen…"); setProgress(d.f); mijlpaal("transcriberen", d.f); }
      else if (d.t === "klaar") { if (heel) audio.samples = d.samples; klaar(ok, { text: d.text, words: d.words }); }
      else if (d.t === "fout") { spoor(`voz apart: fout: ${d.m}`); if (heel && d.samples) audio.samples = d.samples; klaar(fout, new Error(d.m)); }
    };
    w.onerror = (e) => { spoor(`voz apart: worker-fout: ${e.message}`); klaar(fout, new Error(`transcriberen in de achtergrond mislukte: ${e.message || "onbekende fout"}`)) };
    w.postMessage({ samples, sampleRate: audio.sampleRate, wasmDir: new URL(`${BASE}ort/`, location.href).href }, [samples.buffer]);
  });
}
/** Welke modellen nu in het geheugen van de pagina staan. */
export const geladen = () => Object.keys(loaded);
/** Alle geladen modellen vrijgeven; geeft de namen terug. */
export async function geefAllesVrij() { const namen = Object.keys(loaded); for (const n of namen) await geefVrij(n); return namen; }
export async function model(name) {
  if (!loaded[name]) { setStatus(`${name}: model laden (eerste keer)…`); spoor(`model ${name}: laden`); loaded[name] = await loaders[name](); spoor(`model ${name}: geladen`); }
  return loaded[name];
}

export const MODEL_LABELS = {
  redact: "Redact (PII)", tongue: "Tongue (taal)", emo: "Emo (emoji)", gist: "Gist (onderwerpen)",
  voz: "Voz (transcriptie)", who: "Who (sprekers)", ear: "Ear (gesproken taal)", clear: "Clear (opschonen)",
  eye: "Eye (analyse)", moderator: "Moderator (NSFW)", shapes: "Shapes (vorm)",
  uhm: "Uhm (stopwoordjes)", toxic: "Toxic (haatdragend)", gezichten: "Face (gezichten vervagen)",
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

/**
 * Blob → { samples: Float32Array (mono), sampleRate, duration }, op de samplerate van de opname zelf.
 * Meteen terugbrengen naar 16 kHz zou op een telefoon geheugen schelen (een uur: 230 in plaats van 690 MB), maar
 * is twee keer geprobeerd en veranderde wat Who hoort: via AudioContext({ sampleRate }) vond Who geen sprekers
 * meer, via downsample() hieronder juist een spreker te veel. Pas doen na een vergelijking op echte opnames.
 */
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
/** Bestandsgrootte leesbaar: 38 kB, 2,4 MB. */
export function grootte(b) { return b < 1e6 ? `${Math.max(1, Math.round(b / 1e3))} kB` : `${(b / 1e6).toFixed(1).replace(".", ",")} MB`; }

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

/** Namen van de Toxic-koppen in gewoon Nederlands. */
export const TOXIC_NL = { HATEFUL: "haatdragend", ABUSIVE: "beledigend", THREAT: "bedreigend", RACE: "afkomst of huidskleur", RELIGION: "religie", NATIONAL_ETHNIC_ORIGIN: "nationaliteit of etniciteit", SEXUAL_ORIENTATION: "seksuele gerichtheid", GENDER: "gender", DISABILITY: "beperking", AGE: "leeftijd", OTHER: "andere groep" };

/**
 * Gezichten onherkenbaar maken: elk gevonden vlak wordt grof geblokt (niet vervaagd; blokken zijn
 * niet terug te rekenen). Geeft een nieuw canvas en een JPEG terug; het origineel blijft ongemoeid.
 */
export async function vervaagGezichten(bron, gezichten) {
  const c = document.createElement("canvas"); c.width = bron.width; c.height = bron.height;
  const ctx = c.getContext("2d"); ctx.drawImage(bron, 0, 0);
  const klein = document.createElement("canvas"), kctx = klein.getContext("2d");
  for (const g of gezichten) {
    const b = g.box, fr = b.x1 <= 1.5 && b.y1 <= 1.5;        // fracties of pixels
    let x0 = b.x0 * (fr ? c.width : 1), y0 = b.y0 * (fr ? c.height : 1), x1 = b.x1 * (fr ? c.width : 1), y1 = b.y1 * (fr ? c.height : 1);
    const mx = (x1 - x0) * 0.18, my = (y1 - y0) * 0.22;      // ook haarlijn en kin
    x0 = Math.max(0, Math.floor(x0 - mx)); y0 = Math.max(0, Math.floor(y0 - my)); x1 = Math.min(c.width, Math.ceil(x1 + mx)); y1 = Math.min(c.height, Math.ceil(y1 + my));
    const w = x1 - x0, h = y1 - y0; if (w < 2 || h < 2) continue;
    klein.width = 6; klein.height = Math.max(4, Math.round(6 * h / w));
    kctx.imageSmoothingEnabled = true; kctx.drawImage(c, x0, y0, w, h, 0, 0, klein.width, klein.height);
    ctx.imageSmoothingEnabled = false; ctx.drawImage(klein, 0, 0, klein.width, klein.height, x0, y0, w, h); ctx.imageSmoothingEnabled = true;
  }
  const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9));
  return { canvas: c, blob };
}

/**
 * Foto van papier → canvas dat OCR aankan. Een telefoonfoto heeft schaduw, grijs papier en ruis;
 * Tesseract kiest één drempel voor de hele foto en leest dan ruis als letters. Daarom:
 * rechtop zetten, verkleinen tot hooguit `max` px, grijs maken, de belichting vlak trekken
 * (elk punt delen door de plaatselijke papierkleur) en het contrast oprekken.
 */
export async function voorOcr(blob, max = 2600) {
  const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0, w, h);
  // plaatselijke papierkleur: sterk verkleinen (middelt letters weg) en weer glad uitrekken
  const kw = Math.max(8, Math.round(w / 40)), kh = Math.max(8, Math.round(h / 40));
  const klein = document.createElement("canvas"); klein.width = kw; klein.height = kh;
  const kctx = klein.getContext("2d"); kctx.imageSmoothingQuality = "high"; kctx.drawImage(c, 0, 0, kw, kh);
  const bg = document.createElement("canvas"); bg.width = w; bg.height = h;
  const bctx = bg.getContext("2d", { willReadFrequently: true }); bctx.imageSmoothingQuality = "high"; bctx.drawImage(klein, 0, 0, w, h);
  bmp.close?.();
  const img = ctx.getImageData(0, 0, w, h), d = img.data, b = bctx.getImageData(0, 0, w, h).data;
  const grijs = (a, i) => 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
  for (let i = 0; i < d.length; i += 4) {
    const v = grijs(d, i) / Math.max(1, grijs(b, i));          // 1 = papier, lager = inkt
    const u = Math.max(0, Math.min(1, (v - 0.62) / (0.93 - 0.62)));   // zwartpunt 0,62 · witpunt 0,93: papierruis wordt wit
    d[i] = d[i + 1] = d[i + 2] = Math.round(u * 255); d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
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
  uhm:    async ({ audio }) => { const r = await (await model("uhm")).detect(audio.samples, audio.sampleRate); return { summary: `${r.fillers.length} stopwoordjes in ${fmt(r.audioDuration)}`, fillers: r.fillers.map((f) => ({ start: f.start, end: f.end, confidence: f.confidence })), audioDuration: r.audioDuration }; },
  toxic:  async ({ text }) => { const r = await (await model("toxic")).analyze(text); return { summary: r.isToxic ? `let op: ${r.content.map((k) => TOXIC_NL[k] ?? k).join(", ")}` : "geen haatdragende taal gevonden", isToxic: r.isToxic, content: r.content, targets: r.targets, scores: r.scores }; },
  moderator: async ({ pixels }) => { const m = await (await model("moderator")).analyze(pixels, moderation); return { summary: `NSFW ${m.isNSFW ? "ja" : "nee"} (${Math.round(m.score * 100)}%, drempel ${moderation.threshold})`, isNSFW: m.isNSFW, score: m.score, regions: m.regions, threshold: moderation.threshold }; },
};
