// Service worker van AntBench.
//
// 1. Maakt de app installeerbaar (en daarmee een Delen-doel op Android).
// 2. Modelcache: de SDK bewaart gedownloade modellen alleen in het geheugen van
//    de pagina. Hier zetten we de modelbestanden van huggingface.co en onze
//    eigen wasm/LiteRT/ONNX-bestanden in Cache Storage, zodat ze herladen en
//    vliegtuigmodus overleven. Cache-first: staat het erin, dan komt het daar
//    vandaan. De SDK controleert de bestanden zelf (hash), dus een gecachte kopie
//    is net zo goed als een verse.
// 3. Netwerkbewijs: elk verzoek dat deze worker ziet wordt aan de pagina gemeld
//    als "net" (echt netwerk) of "cache". Ook verzoeken vanuit web workers lopen
//    hierlangs — vollediger dan Resource Timing in de pagina.
const CACHE = "antbench-modellen-v1";
const MODEL_HOST = /(^|\.)huggingface\.co$|(^|\.)hf\.co$/;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

async function tell(msg) {
  for (const c of await self.clients.matchAll({ includeUncontrolled: true, type: "window" })) c.postMessage(msg);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") {
    e.respondWith(fetch(req).then((res) => { tell({ type: "net", url: req.url, ok: true }); return res; },
                                  (err) => { tell({ type: "net", url: req.url, ok: false }); throw err; }));
    return;
  }
  const u = new URL(req.url);
  const cacheable = !req.headers.has("range") && (MODEL_HOST.test(u.hostname)
    || (u.origin === self.location.origin && /\/(assets|litert|ort|models)\//.test(u.pathname)));
  // App-schil (index.html, manifest, iconen): network-first, zodat een nieuwe versie
  // meteen doorkomt, met de cache als vangnet voor offline herladen.
  if (!cacheable && u.origin === self.location.origin) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req); tell({ type: "net", url: req.url, ok: true });
        if (res.ok && req.mode === "navigate") e.waitUntil(cache.put(new URL(u.pathname, u.origin), res.clone()).catch(() => {}));
        else if (res.ok) e.waitUntil(cache.put(req, res.clone()).catch(() => {}));
        return res;
      } catch (err) {
        tell({ type: "net", url: req.url, ok: false });
        const hit = await cache.match(req, { ignoreSearch: true, ignoreVary: true }) ?? (req.mode === "navigate" ? await cache.match(new URL("./", self.registration.scope).href) : null);
        if (hit) { tell({ type: "cache", url: req.url }); return hit; }
        throw err;
      }
    })());
    return;
  }
  // Overige verzoeken (o.a. telemetrie naar events.desertant.com): doorlaten, maar
  // wel melden of ze slaagden — offline mislukken ze, en dat is precies het bewijs.
  if (!cacheable) {
    e.respondWith(fetch(req).then((res) => { tell({ type: "net", url: req.url, ok: true }); return res; },
                                  (err) => { tell({ type: "net", url: req.url, ok: false }); throw err; }));
    return;
  }
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreVary: true });
    if (hit) { tell({ type: "cache", url: req.url }); return hit; }
    let res;
    try { res = await fetch(req); tell({ type: "net", url: req.url, ok: true }); }
    catch (err) { tell({ type: "net", url: req.url, ok: false }); throw err; }
    if (res.ok && (res.type === "basic" || res.type === "cors")) {
      // Opslag kan vol zijn (Voz is 349 MB); dan gewoon zonder cache verder.
      e.waitUntil(cache.put(req, res.clone()).catch(() => {}));
    }
    return res;
  })());
});

self.addEventListener("message", async (e) => {
  if (e.data?.type === "wis") { await caches.delete(CACHE); tell({ type: "gewist" }); }
});
