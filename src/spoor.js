// Spoor: een vluchtrecorder voor als de pagina wegvalt. Op een iPhone gooit Safari een tabblad dat te veel
// geheugen gebruikt zonder melding weg; er is dan geen fout om af te vangen. Daarom schrijven we tijdens het
// rijgen elke stap meteen naar localStorage (dat overleeft de crash). Bij het volgende openen laat de pagina
// zien waar het stopte. Er staat geen inhoud in: geen tekst, geen namen, alleen stappen, tijden en toestelgegevens.
const K = "antbench.spoor", BEZIG = "antbench.spoor.bezig";
let t0 = 0;
const lees = () => { try { return JSON.parse(localStorage.getItem(K) || "[]"); } catch { return []; } };
export function spoor(wat) {
  try { const a = lees(); a.push([t0 ? ((performance.now() - t0) / 1000).toFixed(1) : "–", String(wat).slice(0, 220)]); localStorage.setItem(K, JSON.stringify(a.slice(-80))); } catch {}
}
export async function toestel() {
  const d = [navigator.userAgent.replace(/Mozilla\/5\.0 |AppleWebKit\/[\d.]+ \(KHTML, like Gecko\) /g, "")];
  d.push(`scherm ${screen.width}×${screen.height}@${devicePixelRatio}`, `deviceMemory ${navigator.deviceMemory ?? "onbekend"}`, `kernen ${navigator.hardwareConcurrency ?? "?"}`);
  try { const a = await navigator.gpu?.requestAdapter(); d.push(a ? `WebGPU ja, shader-f16 ${a.features.has("shader-f16") ? "ja" : "nee"}` : `WebGPU ${navigator.gpu ? "geen adapter" : "nee"}`); } catch (e) { d.push(`WebGPU fout: ${e.message}`); }
  try { const e = await navigator.storage.estimate(); d.push(`opslag ${Math.round((e.usage ?? 0) / 1e6)} van ${Math.round((e.quota ?? 0) / 1e6)} MB`); } catch {}
  d.push(`geïnstalleerd ${matchMedia("(display-mode: standalone)").matches || navigator.standalone ? "ja" : "nee"}`);
  return d.join(" · ");
}
/** Begin van een run: oud spoor weg, vlag zetten. */
export async function spoorStart(kop) {
  t0 = performance.now();
  try { localStorage.setItem(K, "[]"); localStorage.setItem(BEZIG, new Date().toISOString()); } catch {}
  spoor(kop); spoor(await toestel());
}
/** Verder na het herladen van de pagina: het spoor blijft staan, alleen de klok begint opnieuw. */
export function spoorVervolg(wat) { t0 = performance.now(); try { localStorage.setItem(BEZIG, localStorage.getItem(BEZIG) || new Date().toISOString()); } catch {} spoor(wat); }
/** De ketting wacht op een tik van de gebruiker (verder in een nieuw tabblad): dat is geen weggevallen pagina. */
export function spoorPauze(wat) { spoor(wat); try { localStorage.removeItem(BEZIG); } catch {} }
export function spoorKlaar(hoe) { spoor(hoe); try { localStorage.removeItem(BEZIG); } catch {} }
/** Staat er nog een run "bezig" van vóór het laden van deze pagina? Dan is de pagina toen weggevallen. */
export function vorigeKeer() {
  try { const sinds = localStorage.getItem(BEZIG); if (!sinds) return null; return { sinds, regels: lees() }; } catch { return null; }
}
export function spoorWeg() { try { localStorage.removeItem(BEZIG); } catch {} }
export const spoorTekst = (v) => [`AntBench-spoor, run gestart ${v.sinds}`, ...v.regels.map(([t, w]) => `${String(t).padStart(6)} s  ${w}`)].join("\n");

// Ook vastleggen: fouten die niemand ving, en of de pagina naar de achtergrond ging (iOS stopt die eerder).
addEventListener("error", (e) => { if (t0) spoor(`fout: ${e.message} (${(e.filename ?? "").split("/").pop()}:${e.lineno})`); });
addEventListener("unhandledrejection", (e) => { if (t0) spoor(`afgewezen: ${e.reason?.message ?? e.reason}`); });
document.addEventListener("visibilitychange", () => { if (t0 && localStorage.getItem(BEZIG)) spoor(`pagina ${document.visibilityState === "hidden" ? "naar achtergrond" : "weer zichtbaar"}`); });
addEventListener("pagehide", (e) => { if (t0 && localStorage.getItem(BEZIG)) spoor(`pagehide${e.persisted ? " (bewaard)" : ""}`); });
