// Archief: sessies bewaren in IndexedDB op dit toestel, zodat je ze later terug kunt halen.
// Niets hiervan gaat naar een server. Browseropslag is geen back-up: de ZIP-export is dat wel.
import JSZip from "jszip";

const DB = "antbench-archief", STORE = "sessies";
const inst = (k, d) => { try { return localStorage.getItem(`antbench.archief.${k}`) ?? d; } catch { return d; } };
export const archiefInstelling = { aan: inst("aan", "1") === "1", audio: inst("audio", "1") === "1", dagen: Number(inst("dagen", "30")) };
export function zetArchief(k, v) { archiefInstelling[k] = v; try { localStorage.setItem(`antbench.archief.${k}`, typeof v === "boolean" ? (v ? "1" : "0") : String(v)); } catch {} }

let dbp = null;
const open = () => (dbp ??= new Promise((ok, fout) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" });
  r.onsuccess = () => ok(r.result); r.onerror = () => { dbp = null; fout(r.error); };
}));
const tx = async (mode, f) => { const db = await open(); return new Promise((ok, fout) => { const t = db.transaction(STORE, mode); const r = f(t.objectStore(STORE)); t.oncomplete = () => ok(r?.result); t.onerror = t.onabort = () => fout(t.error); }); };

/** Wat te groot of niet te bewaren is (gedecodeerde audio, pixels) gaat eruit; Blobs en gewone gegevens blijven. */
const ZWAAR = new Set(["audio", "beeld"]);
export function afslanken(v, diepte = 0) {
  if (v == null || typeof v !== "object") return typeof v === "function" ? undefined : v;
  if (v instanceof Blob) return v;
  if (ArrayBuffer.isView(v)) return v.length <= 50_000 ? Array.from(v) : undefined;
  if (Array.isArray(v)) return v.map((x) => afslanken(x, diepte + 1));
  if (diepte > 8) return undefined;
  const uit = {};
  for (const [k, w] of Object.entries(v)) { if (ZWAAR.has(k) || /Url$/.test(k)) continue; const a = afslanken(w, diepte + 1); if (a !== undefined) uit[k] = a; }
  return uit;
}
const omvang = (v) => { if (v == null) return 0; if (v instanceof Blob) return v.size; if (typeof v === "string") return v.length * 2; if (typeof v !== "object") return 8; return (Array.isArray(v) ? v : Object.values(v)).reduce((s, x) => s + omvang(x), 0); };

/** Bewaart één sessie; geeft het bewaarde record terug. */
export async function bewaarSessie({ titel, ketting, invoer, uitkomsten, eindpakket, claude, versie }) {
  const f = invoer.file, isAudio = f && (/^(audio|video)\//.test(f.type) || /\.(wav|mp3|m4a|aac|ogg|opus|flac|mp4|mov|webm|3gp)$/i.test(f.name));
  const houd = f && (!isAudio || archiefInstelling.audio);
  const s = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, datum: Date.now(), titel, ketting: [...ketting], versie,
    invoer: { tekst: invoer.tekst ?? "", vraag: invoer.vraag ?? "", naam: f?.name ?? null, type: f?.type ?? null, file: houd ? f : null, nietBewaard: !!f && !houd },
    uitkomsten: uitkomsten.map((u) => (u ? afslanken({ id: u.id, ok: u.ok, samenvatting: u.samenvatting, pakket: u.pakket, ms: u.ms, kreeg: u.kreeg, door: u.door, nieuw: u.nieuw, labels: u.labels }) : null)),
    eindpakket: afslanken(eindpakket ?? {}), claude: claude ?? null,
  };
  s.bytes = omvang(s);
  await tx("readwrite", (st) => st.put(s));
  navigator.storage?.persist?.().catch(() => {});
  return s;
}
export const haalSessie = (id) => tx("readonly", (st) => st.get(id));
export const wisSessie = (id) => tx("readwrite", (st) => st.delete(id));
export const wisAlles = () => tx("readwrite", (st) => st.clear());
/** Alle sessies, nieuwste eerst. */
export async function lijst() { return ((await tx("readonly", (st) => st.getAll())) ?? []).filter((s) => s.id !== VERVOLG).sort((a, b) => b.datum - a.datum); }
// --- Vervolg: de tussenstand van een lopende ketting, voor als de pagina herlaadt om geheugen vrij te maken ---
const VERVOLG = "__vervolg";
export async function bewaarVervolg({ ketting, invoer, uitkomsten, vanaf, reden = "geheugen" }) {
  const f = invoer.file;
  await tx("readwrite", (st) => st.put({ id: VERVOLG, datum: Date.now(), ketting: [...ketting], vanaf, reden,
    invoer: { tekst: invoer.tekst ?? "", vraag: invoer.vraag ?? "", naam: f?.name ?? null, type: f?.type ?? null, file: f ?? null },
    uitkomsten: uitkomsten.map((u) => (u ? afslanken({ id: u.id, ok: u.ok, samenvatting: u.samenvatting, pakket: u.pakket, ms: u.ms, kreeg: u.kreeg, door: u.door, nieuw: u.nieuw, labels: u.labels }) : null)) }));
}
/** Haalt de tussenstand op en wist hem meteen, zodat een tweede herlaadbeurt niet opnieuw begint. */
export async function haalVervolg() {
  const v = await tx("readonly", (st) => st.get(VERVOLG)).catch(() => null); if (!v) return null;
  await wisSessie(VERVOLG).catch(() => {});
  return Date.now() - v.datum < 10 * 60_000 ? v : null;
}
/** Ruimt op wat ouder is dan de bewaartermijn; 0 dagen = niet opruimen. */
export async function ruimOp() {
  if (!archiefInstelling.dagen) return 0;
  const grens = Date.now() - archiefInstelling.dagen * 864e5, oud = (await lijst()).filter((s) => s.datum < grens);
  for (const s of oud) await wisSessie(s.id);
  return oud.length;
}
export async function ruimte() { try { const e = await navigator.storage.estimate(); return { gebruikt: e.usage ?? 0, beschikbaar: e.quota ?? 0, blijvend: await navigator.storage.persisted?.() }; } catch { return null; } }

// --- ZIP: één sessie als bestand, voor back-up of een ander toestel ---------------------
const EXT = { "audio/webm": "webm", "audio/wav": "wav", "audio/mpeg": "mp3", "audio/mp4": "m4a", "image/jpeg": "jpg", "image/png": "png", "video/webm": "webm" };
export async function alsZip(s) {
  const zip = new JSZip(); let n = 0;
  const uit = (v, hint) => {
    if (v instanceof Blob) { const naam = hint ?? `bijlage-${++n}.${EXT[v.type.split(";")[0]] ?? "bin"}`; zip.file(naam, v); return { __blob: naam, type: v.type }; }
    if (Array.isArray(v)) return v.map((x) => uit(x));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, w]) => [k, uit(w, k === "file" && s.invoer.naam ? `invoer-${s.invoer.naam.replace(/[^\w.-]+/g, "_")}` : undefined)]));
    return v;
  };
  zip.file("sessie.json", JSON.stringify({ soort: "antbench-sessie", formaat: 1, ...uit(s) }, null, 1));
  const eind = [...s.uitkomsten].reverse().find((u) => u?.ok && (u.pakket.beoordeling ?? u.pakket.tekst) != null);
  if (eind) zip.file("resultaat.md", eind.pakket.beoordeling ?? eind.pakket.tekst);
  return zip.generateAsync({ type: "blob" });
}
export async function uitZip(bestand) {
  const zip = await JSZip.loadAsync(bestand), j = zip.file("sessie.json");
  if (!j) throw new Error("dit is geen sessie-ZIP van AntBench (sessie.json ontbreekt)");
  const d = JSON.parse(await j.async("string"));
  if (d.soort !== "antbench-sessie") throw new Error("dit is geen sessie-ZIP van AntBench");
  const terug = async (v) => {
    if (Array.isArray(v)) return Promise.all(v.map(terug));
    if (v && typeof v === "object") {
      if (typeof v.__blob === "string") { const f = zip.file(v.__blob); return f ? new Blob([await f.async("arraybuffer")], { type: v.type || "" }) : null; }
      const o = {}; for (const [k, w] of Object.entries(v)) o[k] = await terug(w); return o;
    }
    return v;
  };
  const s = await terug(d); delete s.soort; delete s.formaat;
  if (!Array.isArray(s.ketting) || !Array.isArray(s.uitkomsten)) throw new Error("de sessie in deze ZIP is onvolledig");
  if (s.invoer?.file && s.invoer.naam) s.invoer.file = new File([s.invoer.file], s.invoer.naam, { type: s.invoer.type ?? "" });
  s.id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`; s.geimporteerd = Date.now();
  await tx("readwrite", (st) => st.put(s));
  return s;
}
