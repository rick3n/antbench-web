// Ketting — de voorraad kralen. Elke kraal is een module met:
//   in:  welke onderdelen van het doorgeefpakket hij nodig heeft
//   out: welke onderdelen hij toevoegt of vervangt
//   run: (pakket, ctx) → gedeeltelijk pakket dat erin gemengd wordt
// Het doorgeefpakket is één object met tekst, audio, beeld en wat kralen eraan
// toevoegen (woorden, sprekers, taal, onderwerpen, persoonsgegevens, spraak…).
// Een kraal kleurt groen als alles wat hij nodig heeft op dat punt in de ketting
// al aanwezig is, anders rood. Kralen met status "komt" bestaan nog niet.
import { BASE, setProgress, setStatus } from "../ui.js";
import { model, actions, decodeAudio, downsample, toWav, imageToPixels, fileToText, fmt } from "../engine.js";

// --- Sleutels van het doorgeefpakket (voor uitleg en kleur) ---------------------
export const SLEUTELS = {
  tekst: "tekst", audio: "audio", beeld: "beeld", woorden: "woorden met tijd", sprekers: "sprekers",
  taal: "taal", onderwerpen: "onderwerpen", pgg: "persoonsgegevens", tags: "trefwoorden", spraak: "spraak (wav)",
};

export const GROEPEN = [
  ["lezen", "Lezen", "#3b82f6"], ["luisteren", "Luisteren", "#8b5cf6"], ["kijken", "Kijken", "#ec4899"],
  ["begrijpen", "Begrijpen", "#f59e0b"], ["schrijven", "Schrijven", "#10b981"], ["vertalen", "Vertalen", "#06b6d4"],
  ["spreken", "Spreken", "#ef4444"], ["samen", "Samen", "#64748b"],
];

// --- Hulpjes --------------------------------------------------------------------

/** Sprekers per zin (zelfde aanpak als Vergadering): woorden → zinnen → spreker met meeste tijd → samenvoegen. */
function sprekerTekst(words, turns) {
  if (!words?.length) return "";
  if (!turns?.length) return words.map((w) => w.text).join(" ");
  const speakerAt = (a, b) => { const s = new Map(); for (const t of turns) { const o = Math.min(b, t.end) - Math.max(a, t.start); if (o > 0) s.set(t.speaker, (s.get(t.speaker) ?? 0) + o); } return s.size ? [...s].sort((x, y) => y[1] - x[1])[0][0] : null; };
  const zinnen = []; let cur = null;
  for (const w of words) { if (!cur || w.start - cur.end > 1) { cur = { start: w.start, end: w.end, words: [] }; zinnen.push(cur); } cur.end = w.end; cur.words.push(w.text); if (/[.!?]$/.test(w.text)) cur = null; }
  let last = turns[0].speaker; for (const z of zinnen) { z.sp = speakerAt(z.start, z.end) ?? last; last = z.sp; }
  const uit = []; for (const z of zinnen) { const p = uit[uit.length - 1]; if (p && p.sp === z.sp) { p.end = z.end; p.words.push(...z.words); } else uit.push({ ...z, words: [...z.words] }); }
  return uit.map((t) => `**Spreker ${t.sp + 1}** · ${fmt(t.start)}\n${t.words.join(" ").replace(/\s+([,.!?;:])/g, "$1")}`).join("\n\n");
}

// --- Taalmodel (WebLLM) -----------------------------------------------------------
// Qwen3 via WebLLM, vereist WebGPU. Klein (0.6B) op telefoons, 1.7B op laptops.
let llm = null, llmId = null;
export const LLM_KEUZE = { klein: "Qwen3-0.6B-q4f16_1-MLC", normaal: "Qwen3-1.7B-q4f16_1-MLC" };
export const llmInstelling = { maat: (navigator.deviceMemory ?? 4) >= 8 ? "normaal" : "klein" };
async function taalmodel() {
  if (!navigator.gpu) throw new Error("Het taalmodel heeft WebGPU nodig (Chrome op Android/desktop, Safari 26+).");
  const id = LLM_KEUZE[llmInstelling.maat];
  if (llm && llmId === id) return llm;
  setStatus(`Taalmodel laden (${id.replace("-q4f16_1-MLC", "")}, eerste keer duurt even)…`);
  const { CreateMLCEngine } = await import("@mlc-ai/web-llm");
  if (llm) { await llm.unload(); llm = null; }
  try { llm = await CreateMLCEngine(id, { initProgressCallback: (p) => { setProgress(p.progress ?? 0); setStatus(p.text); } }); }
  catch (e) { throw new Error(/GPU/i.test(e.message) ? "Geen bruikbare WebGPU in deze browser; het taalmodel werkt op Chrome (Android/desktop) en Safari 26+." : e.message); }
  llmId = id; return llm;
}
async function vraag(systeem, gebruiker, maxTokens = 700) {
  const e = await taalmodel();
  const r = await e.chat.completions.create({
    messages: [{ role: "system", content: systeem }, { role: "user", content: gebruiker }],
    temperature: 0.2, max_tokens: maxTokens, extra_body: { enable_thinking: false },
  });
  return (r.choices[0].message.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}
const NL = "Je bent een nauwkeurige assistent van een Nederlandse overheidsorganisatie. Antwoord in het Nederlands. Verzin niets dat niet in de tekst staat.";

// --- Vertalen (Transformers.js, Opus-MT) ------------------------------------------
const vertalers = {};
async function vertaler(paar) {
  if (!vertalers[paar]) {
    setStatus(`Vertaalmodel ${paar} laden…`);
    const tf = await import("@huggingface/transformers");
    tf.env.allowLocalModels = false;
    tf.env.backends.onnx.wasm.wasmPaths = `${BASE}ort-tf/`;
    vertalers[paar] = await tf.pipeline("translation", `Xenova/opus-mt-${paar}`, { progress_callback: (p) => { if (p.progress) setProgress(p.progress / 100); } });
  }
  return vertalers[paar];
}
async function vertaal(tekst, paar) {
  const t = await vertaler(paar);
  // per alinea, en lange alinea's in stukken van ~600 tekens
  const stukken = tekst.split(/\n+/).flatMap((a) => a.match(/[\s\S]{1,600}(?:[.!?]\s|$)/g) ?? [a]);
  const uit = [];
  for (let i = 0; i < stukken.length; i++) { setProgress((i + 1) / stukken.length); if (!stukken[i].trim()) { uit.push(""); continue; } const r = await t(stukken[i], { max_new_tokens: 400 }); uit.push(r[0].translation_text); }
  return uit.join("\n");
}

// --- OCR (Tesseract.js, Nederlands) -----------------------------------------------
let ocrWorker = null;
async function ocr(blob) {
  if (!ocrWorker) {
    setStatus("OCR laden (Tesseract, Nederlands)…");
    const { createWorker } = await import("tesseract.js");
    ocrWorker = await createWorker("nld", 1, { workerPath: `${BASE}tess/worker.min.js`, corePath: `${BASE}tess/`, langPath: `${BASE}tess/lang/`, gzip: true,
      logger: (m) => { if (m.status === "recognizing text") setProgress(m.progress); } });
  }
  const { data } = await ocrWorker.recognize(blob);
  return data.text.trim();
}

// --- Voorlezen (Piper) --------------------------------------------------------------
export const stemInstelling = { stem: "nl_NL-mls-medium" };
let piperSessie = null;
async function voorlezen(tekst) {
  setStatus("Stem laden (Piper, Nederlands)…");
  const piper = await import("@mintplex-labs/piper-tts-web");
  // Eigen wasm-bestanden i.p.v. de CDN's van het pakket: ort uit onze eigen kopie (zelfde
  // versie als de gebundelde onnxruntime-web) en piper_phonemize uit het npm-pakket.
  if (!piperSessie || piperSessie.voiceId !== stemInstelling.stem) {
    piperSessie = await piper.TtsSession.create({ voiceId: stemInstelling.stem, progress: (p) => { if (p.total) setProgress(p.loaded / p.total); },
      wasmPaths: { onnxWasm: `${BASE}ort/`, piperData: `${BASE}piper/piper_phonemize.data`, piperWasm: `${BASE}piper/piper_phonemize.wasm` } });
  }
  const kort = tekst.replace(/[*#_`>|]/g, "").slice(0, 3000);
  return piperSessie.predict(kort);
}

// --- De kralen ---------------------------------------------------------------------
export const MODULES = [
  // Lezen
  { id: "ocr", groep: "lezen", naam: "Scan lezen", lev: "Tesseract (open)", in: ["beeld"], out: ["tekst"],
    uitleg: "Haalt de tekst uit een foto of scan van een brief of document. Nederlands getraind.",
    run: async (p) => ({ tekst: await ocr(p.beeld.blob) }) },
  // Luisteren
  { id: "voz", groep: "luisteren", naam: "Transcriberen", lev: "Desert Ant Voz", in: ["audio"], out: ["tekst", "woorden"],
    uitleg: "Spraak naar tekst, met per woord het tijdstip. 25 talen, raadt de taal zelf.",
    run: async (p) => { const r = await (await model("voz")).transcribe(p.audio, { onProgress: setProgress }); return { tekst: r.text.trim(), woorden: r.words }; } },
  { id: "who", groep: "luisteren", naam: "Sprekers", lev: "Desert Ant Who", in: ["audio"], out: ["sprekers", "tekst"],
    uitleg: "Wie sprak wanneer. Staat er al een transcript, dan wordt het per spreker ingedeeld.",
    run: async (p) => { const w = (await (await model("who")).diarize(p.audio)).keepingSpeakers({ minimumShare: 0.08 }); const out = { sprekers: w.turns, sprekerAantal: w.speakerCount }; if (p.woorden) out.tekst = sprekerTekst(p.woorden, w.turns); return out; } },
  { id: "ear", groep: "luisteren", naam: "Gesproken taal", lev: "Desert Ant Ear", in: ["audio"], out: ["taal"],
    uitleg: "Welke taal er gesproken wordt, uit de eerste halve minuut.",
    run: async (p) => { const r = await (await model("ear")).identify(p.audio.samples, p.audio.sampleRate); return { taal: r.language ?? "onbekend" }; } },
  { id: "clear", groep: "luisteren", naam: "Opschonen", lev: "Desert Ant Clear", in: ["audio"], out: ["audio", "spraak"],
    uitleg: "Ruis en galm weg, niveau naar −16 LUFS. Voor mensen, niet vóór transcriberen (dat wordt er slechter van).",
    run: async (p) => { const r = await (await model("clear")).enhance(p.audio.samples, p.audio.sampleRate, { targetLUFS: -16, maxGainDB: 40 }); const a = downsample(r.samples, r.sampleRate, 16000); return { audio: { ...a, duration: p.audio.duration }, spraak: toWav(a.samples, a.sampleRate) }; } },
  // Kijken
  { id: "eye", groep: "kijken", naam: "Foto beschrijven", lev: "Desert Ant Eye", in: ["beeld"], out: ["tags", "tekst"],
    uitleg: "Scène, trefwoorden, mensen, gezichten, dieren, kwaliteit. Levert een korte beschrijving als tekst door.",
    run: async (p) => { const r = await actions.eye({ pixels: p.beeld.pixels }); return { tags: r.tags ?? [], tekst: `Foto: ${r.kind ?? "onbekend"}; trefwoorden: ${(r.tags ?? []).slice(0, 10).join(", ")}; mensen: ${r.people ?? 0}, gezichten: ${r.faces ?? 0}.` }; } },
  { id: "moderator", groep: "kijken", naam: "Geschikt om te delen?", lev: "Desert Ant Moderator", in: ["beeld"], out: [],
    uitleg: "NSFW-score per regio. Let op: een huidrijke close-up scoort al snel hoog.",
    run: async (p) => { const r = await actions.moderator({ pixels: p.beeld.pixels }); return { nsfw: r.isNSFW, nsfwScore: r.score }; } },
  // Begrijpen
  { id: "tongue", groep: "begrijpen", naam: "Taal van de tekst", lev: "Desert Ant Tongue", in: ["tekst"], out: ["taal"],
    uitleg: "Taal uit een paar woorden.",
    run: async (p) => { const d = (await model("tongue")).detect(p.tekst); return { taal: d.language }; } },
  { id: "gist", groep: "begrijpen", naam: "Onderwerpen", lev: "Desert Ant Gist", in: ["tekst"], out: ["onderwerpen"],
    uitleg: "Waar de tekst over gaat, uit 36 onderwerpen.",
    run: async (p) => ({ onderwerpen: await (await model("gist")).classify(p.tekst, { topK: 5 }) }) },
  { id: "redact", groep: "begrijpen", naam: "Persoonsgegevens maskeren", lev: "Desert Ant Redact", in: ["tekst"], out: ["pgg", "tekst"],
    uitleg: "Namen, adressen, nummers worden [PLACEHOLDERS]. De gemaskeerde tekst gaat door naar de volgende kraal.",
    run: async (p) => { const r = await (await model("redact")).redaction(p.tekst); return { pgg: r.items.map((i) => ({ label: i.label, placeholder: i.placeholder, original: i.original })), tekst: r.redactedText, origineel: p.tekst }; } },
  { id: "pgg-eigen", groep: "begrijpen", naam: "Eigen labels zoeken", lev: "GLiNER (open)", in: ["tekst"], out: ["pgg"], komt: true,
    uitleg: "Zoeken op labels in gewone taal: BSN, kenteken, zaaknummer. Komt." },
  // Schrijven (taalmodel)
  { id: "samenvatten", groep: "schrijven", naam: "Samenvatten", lev: "Qwen3 (open)", in: ["tekst"], out: ["tekst"],
    uitleg: "Korte samenvatting in het Nederlands. De samenvatting gaat door als tekst; het origineel blijft bij deze kraal.",
    run: async (p) => ({ tekst: await vraag(NL, `Vat de volgende tekst samen in hooguit 8 zinnen. Alleen wat erin staat.\n\n${p.tekst.slice(0, 12000)}`), origineel: p.tekst }) },
  { id: "actiepunten", groep: "schrijven", naam: "Actiepunten", lev: "Qwen3 (open)", in: ["tekst"], out: ["tekst"],
    uitleg: "Besluiten en actiepunten, per persoon als er sprekers zijn.",
    run: async (p) => ({ tekst: await vraag(NL, `Haal uit dit verslag de besluiten en actiepunten. Geef een lijst: wat, wie (als bekend), wanneer (als bekend). Niets verzinnen.\n\n${p.tekst.slice(0, 12000)}`), origineel: p.tekst }) },
  { id: "b1", groep: "schrijven", naam: "Herschrijven naar B1", lev: "Qwen3 (open)", in: ["tekst"], out: ["tekst"],
    uitleg: "Dezelfde inhoud in eenvoudig Nederlands: korte zinnen, gewone woorden, u-vorm.",
    run: async (p) => ({ tekst: await vraag(NL, `Herschrijf deze tekst op taalniveau B1: korte zinnen, gewone woorden, actieve vorm, u-vorm. Zelfde inhoud, niets erbij, niets weg.\n\n${p.tekst.slice(0, 8000)}`, 1200), origineel: p.tekst }) },
  { id: "checklist", groep: "schrijven", naam: "Checklist", lev: "Qwen3 · idee Michiel Buisman", in: ["tekst"], out: [],
    uitleg: "Het stuk langs een checklist: doel duidelijk, besluit expliciet, structuur, jargon, leesniveau. Per punt sterren en één verbetering.",
    run: async (p) => ({ beoordeling: await vraag(NL, `Beoordeel dit stuk op vijf punten: (1) doel in de eerste alinea, (2) besluit of vraag expliciet, (3) logische structuur, (4) jargon en afkortingen uitgelegd, (5) leesniveau. Geef per punt 1–5 sterren en één concrete verbetering met een citaat. Sluit af met het belangrijkste wat eerst moet.\n\n${p.tekst.slice(0, 10000)}`, 900) }) },
  // Vertalen
  { id: "nl-en", groep: "vertalen", naam: "Naar Engels", lev: "Opus-MT (open)", in: ["tekst"], out: ["tekst"],
    uitleg: "Nederlands → Engels, zin voor zin, op het toestel.",
    run: async (p) => ({ tekst: await vertaal(p.tekst, "nl-en"), origineel: p.tekst }) },
  { id: "en-nl", groep: "vertalen", naam: "Naar Nederlands", lev: "Opus-MT (open)", in: ["tekst"], out: ["tekst"],
    uitleg: "Engels → Nederlands, zin voor zin, op het toestel.",
    run: async (p) => ({ tekst: await vertaal(p.tekst, "en-nl"), origineel: p.tekst }) },
  // Spreken
  { id: "voorlezen", groep: "spreken", naam: "Voorlezen", lev: "Piper (open)", in: ["tekst"], out: ["spraak"],
    uitleg: "Nederlandse stem leest de tekst voor (eerste 3000 tekens). Levert een wav-bestand.",
    run: async (p) => ({ spraak: await voorlezen(p.tekst) }) },
  // Samen
  { id: "vragenlijst", groep: "samen", naam: "Willen / mogen / kunnen", lev: "idee Michiel Buisman (AIUE)", in: ["tekst"], out: ["tekst"], komt: true,
    uitleg: "Een AI-idee langs de vragenlijst: wat willen we, mag het, kunnen we het. Komt." },
  { id: "zoeken", groep: "samen", naam: "Zoeken met bronvermelding", lev: "idee Michiel Buisman (AIbaarAI)", in: ["tekst"], out: ["tekst"], komt: true,
    uitleg: "Vraag aan je eigen documenten, antwoord met de zin waar het staat. Komt." },
];
export const byId = Object.fromEntries(MODULES.map((m) => [m.id, m]));

// --- Kant-en-klare kettingen (het verhaal) ---------------------------------------
export const RECEPTEN = [
  { id: "notulen", naam: "Overleg → notulen", kralen: ["voz", "who", "gist", "redact", "actiepunten"], invoer: "audio" },
  { id: "brief", naam: "Gescande brief", kralen: ["ocr", "redact", "gist", "samenvatten", "b1"], invoer: "beeld" },
  { id: "woo", naam: "Woo-stuk lakken", kralen: ["redact", "pgg-eigen", "gist"], invoer: "tekst" },
  { id: "inspraak", naam: "Inspraakreacties", kralen: ["redact", "gist", "samenvatten"], invoer: "tekst" },
  { id: "inspectie", naam: "Inspectiefoto", kralen: ["eye", "moderator", "samenvatten"], invoer: "beeld" },
  { id: "hoorzitting", naam: "Hoorzitting", kralen: ["voz", "who", "redact", "samenvatten"], invoer: "audio" },
  { id: "idee", naam: "AI-idee toetsen", kralen: ["vragenlijst", "checklist"], invoer: "tekst" },
  { id: "memo", naam: "Memo klaar?", kralen: ["checklist", "b1"], invoer: "tekst" },
  { id: "burgerbrief", naam: "Burgerbrief in B1", kralen: ["b1", "nl-en", "voorlezen"], invoer: "tekst" },
  { id: "anderstalig", naam: "Anderstalige brief", kralen: ["ocr", "tongue", "en-nl", "samenvatten"], invoer: "beeld" },
  { id: "teamgeheugen", naam: "Teamgeheugen", kralen: ["zoeken"], invoer: "tekst" },
  { id: "voorlezen", naam: "Besluit voorlezen", kralen: ["b1", "voorlezen"], invoer: "tekst" },
];

// --- Invoer → startpakket ----------------------------------------------------------
export async function startpakket({ file, tekst }) {
  if (tekst?.trim()) return { tekst: tekst.trim(), bron: "tekst" };
  if (!file) throw new Error("Geen invoer.");
  const n = file.name.toLowerCase(), t = file.type || "";
  if (t.startsWith("audio/") || t.startsWith("video/") || /\.(wav|mp3|m4a|aac|ogg|opus|flac|mp4|mov|webm|3gp)$/.test(n)) return { audio: await decodeAudio(file), bron: file.name };
  if (t.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/.test(n)) return { beeld: { blob: file, pixels: await imageToPixels(file) }, bron: file.name };
  return { tekst: await fileToText(file), bron: file.name };
}
