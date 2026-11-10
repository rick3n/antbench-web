// Gedeelde UI-staat: status, voortgang, resultaatvak, kopiëren/delen/downloaden.

export const BASE = import.meta.env.BASE_URL;   // "/antbench/"
export const VERSION = `AntBench v${__APP_VERSION__}`;
export const $ = (id) => document.getElementById(id);

const status = $("status"), progress = $("progress"), result = $("result"), actions = $("resultActions");
let busy = false, lastText = "", lastBlob = null, lastName = "";

export function setStatus(t) { if (status) status.textContent = t; }
export function setProgress(f) { if (progress) progress.value = f; }
export function isBusy() { return busy; }

export function setBusy(b) {
  busy = b;
  for (const el of document.querySelectorAll("button.run, #rec, #verg-rec")) el.disabled = b;
  const vg = document.getElementById("verg-go"); if (vg && !b) vg.disabled = !document.getElementById("verg-audio")?.src;
  progress?.classList.toggle("on", b);
  if (!b && progress) progress.value = 0;
}

/** Toon een resultaat. `text` is wat gekopieerd/gedeeld wordt; `node` (optioneel) de weergave. */
export function showResult(text, node = null, blob = null, name = "") {
  lastText = text; lastBlob = blob; lastName = name;
  result.replaceChildren(node ?? document.createTextNode(text));
  result.classList.add("on");
  actions.style.display = "flex";
  const dl = $("download");
  if (blob) { dl.href = URL.createObjectURL(blob); dl.download = name; dl.style.display = ""; }
  else dl.style.display = "none";
}
export function clearResult() {
  result.classList.remove("on"); actions.style.display = "none"; lastText = ""; lastBlob = null;
}

/** [LABEL_n]-placeholders gemarkeerd; verder letterlijke tekst, geen HTML. */
export function highlightPlaceholders(text) {
  const frag = document.createDocumentFragment(), re = /\[[A-Z_]+_\d+]/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    frag.append(text.slice(last, m.index));
    const mark = document.createElement("mark"); mark.textContent = m[0]; frag.append(mark);
    last = m.index + m[0].length;
  }
  frag.append(text.slice(last));
  return frag;
}

/** Tabel van label → waarde, met een balkje voor getallen 0..1. */
export function table(rows) {
  const t = document.createElement("table");
  for (const [k, v] of rows) {
    const tr = t.insertRow(); tr.insertCell().textContent = k;
    const td = tr.insertCell();
    if (typeof v === "number" && v >= 0 && v <= 1 && !Number.isInteger(v)) {
      const bar = document.createElement("span"); bar.className = "bar";
      bar.style.width = `${Math.round(v * 120)}px`;
      td.append(bar, ` ${(v * 100).toFixed(0)}%`);
    } else td.textContent = String(v);
  }
  return t;
}

// --- Netwerkbewijs ----------------------------------------------------------------
// De service worker meldt elk verzoek dat hij ziet (ook vanuit workers) als "net"
// of "cache". Zolang hij de pagina nog niet bestuurt (allereerste bezoek) valt
// Resource Timing in als bron. Per run tellen we wat erbij kwam: bij de eerste
// run het model van huggingface.co, daarna hoort het nul te zijn.
performance.setResourceTimingBufferSize?.(10000);
const swLog = [];   // { t, type, url } uit de service worker
navigator.serviceWorker?.addEventListener("message", (e) => {
  if (e.data?.type === "gewist") { setStatus("Modelcache gewist."); cacheInfo(); }
  else if (e.data?.type) swLog.push({ t: performance.now(), type: e.data.type, url: e.data.url, ok: e.data.ok !== false });
});
function hostList(urls) {
  const hosts = new Map();
  for (const u of urls) { try { const h = new URL(u).hostname; if (h !== location.hostname) hosts.set(h, (hosts.get(h) ?? 0) + 1); } catch {} }
  const own = urls.length - [...hosts.values()].reduce((a, b) => a + b, 0);
  const parts = [...hosts].map(([h, n]) => `${h} ×${n}`); if (own) parts.push(`eigen server ×${own}`);
  return parts.join(", ");
}
/** Netwerk sinds t0: geslaagde verzoeken, mislukte pogingen (offline) en cache-treffers. */
export function netSummary(t0) {
  let urls, failed = [], cached = 0;
  if (navigator.serviceWorker?.controller) {
    const l = swLog.filter((x) => x.t >= t0 - 1), net = l.filter((x) => x.type === "net");
    urls = net.filter((x) => x.ok).map((x) => x.url); failed = net.filter((x) => !x.ok).map((x) => x.url); cached = l.length - net.length;
  } else urls = performance.getEntriesByType("resource").filter((e) => e.startTime >= t0 - 1).map((e) => e.name);
  let text = urls.length ? `${urls.length} netwerkverzoeken (${hostList(urls)})` : "0 netwerkverzoeken";
  if (failed.length) text += `, ${failed.length} poging${failed.length > 1 ? "en" : ""} mislukt (${hostList(failed)})`;
  if (cached) text += `, ${cached} uit modelcache`;
  return { total: urls.length, failed: failed.length, failedHosts: hostList(failed), text };
}

// --- Modelcache ------------------------------------------------------------------
async function cacheInfo() {
  const el = $("cache-info"); if (!el) return;
  try {
    const n = (await (await caches.open("antbench-modellen-v1")).keys()).length;
    const est = await navigator.storage?.estimate?.();
    const persisted = await navigator.storage?.persisted?.();
    el.textContent = `Modelcache: ${n} bestanden, ${est ? `${(est.usage / 1e6).toFixed(0)} MB in gebruik van ${(est.quota / 1e9).toFixed(1)} GB` : "omvang onbekend"}${persisted ? " · beschermd tegen opruimen" : ""}`;
  } catch { el.textContent = "Modelcache: niet beschikbaar in deze browser."; }
}
if ($("cache-persist")) $("cache-persist").onclick = async () => { const ok = await navigator.storage?.persist?.(); setStatus(ok ? "Opslag beschermd: de browser ruimt de modelcache niet vanzelf op." : "Browser weigert bescherming (installeer de app of gebruik hem vaker)."); cacheInfo(); };
if ($("cache-clear")) $("cache-clear").onclick = async () => { await caches.delete("antbench-modellen-v1"); setStatus("Modelcache gewist."); cacheInfo(); };
cacheInfo(); navigator.serviceWorker?.ready.then(cacheInfo);
// Stap 1 overleeft herladen (modelcache!), dus onthouden in localStorage.
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const netEl = $("net"), vt = { loaded: lsGet("antbench.vt.loaded") === "1", offline: false };
if (vt.loaded) $("vt-1")?.classList.add("done");
function showOnline() { const on = navigator.onLine; if (netEl) { netEl.textContent = on ? "● online" : "✈ offline"; netEl.classList.toggle("off", !on); } if (!on && vt.loaded) { vt.offline = true; $("vt-2")?.classList.add("done"); } }
window.addEventListener("online", showOnline); window.addEventListener("offline", showOnline); showOnline();
function vliegtuigtest(label, net, ok) {
  if (!ok) return;
  if (navigator.onLine) { vt.loaded = true; lsSet("antbench.vt.loaded", "1"); $("vt-1")?.classList.add("done"); }
  else if (vt.loaded && net.total === 0 && $("vt-verdict")) { $("vt-3").classList.add("done"); const v = $("vt-verdict"); v.className = "small ok"; v.textContent = `✔ Bewezen: "${label}" verwerkt zonder netwerk, offline, ${new Date().toLocaleTimeString("nl-NL")}.${net.failed ? ` De SDK probeerde wel ${net.failedHosts} te bereiken; vliegtuigmodus hield dat tegen.` : ""}`; $("vliegtuig").open = true; }
}

/** Voer een model-actie uit met status, timing en netwerkteller. */
export async function run(label, fn) {
  if (busy) return;
  setBusy(true); setStatus(`${label} bezig…`);
  const t0 = performance.now(); performance.clearResourceTimings();
  let ok = false;
  try {
    await fn(); ok = true;
  } catch (e) {
    console.error(e);
    setStatus(`${label} mislukt: ${e?.message ?? e}`);
  } finally { setBusy(false); }
  await new Promise((r) => setTimeout(r, 50));   // late timing-entries binnen laten komen
  const net = netSummary(t0);
  if (ok) setStatus(`${label} klaar in ${((performance.now() - t0) / 1000).toFixed(1)} s · ${net.text}${navigator.onLine ? "" : " · offline"}`);
  vliegtuigtest(label, net, ok); cacheInfo();
}

/** Laadopties die elk LiteRT-model deelt: eigen wasm-map, voortgang naar de balk. */
export const loadOptions = () => ({
  litertWasmDir: `${BASE}litert/`,
  onProgress: (f) => setProgress(f),
});

if ($("copy")) $("copy").onclick = async () => { await navigator.clipboard.writeText(lastText); setStatus("Resultaat gekopieerd."); };
if ($("share")) $("share").onclick = async () => {
  const files = lastBlob && navigator.canShare?.({ files: [new File([lastBlob], lastName)] })
    ? [new File([lastBlob], lastName, { type: lastBlob.type })] : undefined;
  if (navigator.share) await navigator.share(files ? { files } : { text: lastText }).catch(() => {});
  else { await navigator.clipboard.writeText(lastText); setStatus("Delen niet beschikbaar; gekopieerd."); }
};

// Tabbladen
for (const b of document.querySelectorAll("#tabs button")) b.onclick = () => {
  document.querySelectorAll("#tabs button, .tab").forEach((el) => el.classList.remove("on"));
  b.classList.add("on"); $(`tab-${b.dataset.tab}`).classList.add("on"); clearResult();
  location.hash = b.dataset.tab;
};
if (location.hash) document.querySelector(`#tabs button[data-tab="${location.hash.slice(1)}"]`)?.click();

