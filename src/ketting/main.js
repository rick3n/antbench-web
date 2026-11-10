// Ketting: kralen uit de voorraad slepen in de volgorde die je wilt; elke kraal
// geeft zijn resultaat door aan de volgende. Alles lokaal in de browser.
import "./style.css";
import JSZip from "jszip";
import { $, BASE, VERSION, setStatus, setProgress, netSummary } from "../ui.js";
import { MODULES, GROEPEN, RECEPTEN, SLEUTELS, byId, startpakket, llmInstelling, LLM_KEUZE } from "./modules.js";
import { fmt } from "../engine.js";

const ICOON = { lezen: "📄", luisteren: "🎙️", kijken: "📷", begrijpen: "🔍", schrijven: "✍️", vertalen: "🌐", spreken: "🔊", samen: "🤝" };
const kleur = Object.fromEntries(GROEPEN.map(([id, , c]) => [id, c]));

let ketting = [];            // module-ids in volgorde
let invoer = { file: null, tekst: "" };
let uitkomsten = [];         // per kraal: { id, ok, samenvatting, pakket (kopie van de toegevoegde velden), ms }
let bezig = false, recorder = null, chunks = [];

// --- Voorraad ------------------------------------------------------------------------
function tekenVoorraad() {
  const v = $("voorraad"); v.replaceChildren();
  for (const [gid, gnaam, c] of GROEPEN) {
    const sec = document.createElement("section"); sec.className = "groep"; sec.style.setProperty("--c", c);
    sec.innerHTML = `<h3><span class="ic">${ICOON[gid]}</span>${gnaam}</h3>`;
    for (const m of MODULES.filter((x) => x.groep === gid)) {
      const k = document.createElement("div"); k.className = "kraal" + (m.komt ? " komt" : ""); k.draggable = true; k.dataset.id = m.id; k.title = m.uitleg;
      k.innerHTML = `<span class="bol">${ICOON[gid]}</span><span class="naam">${m.naam}</span><span class="lev">${m.lev}</span>${m.komt ? '<span class="chip">komt</span>' : ""}<span class="io">${m.in.map((s) => SLEUTELS[s]).join(" + ") || "–"} → ${m.out.map((s) => SLEUTELS[s]).join(", ") || "oordeel"}</span>`;
      k.ondragstart = (e) => { e.dataTransfer.setData("text/plain", "add:" + m.id); e.dataTransfer.effectAllowed = "copy"; };
      k.onclick = () => voegToe(m.id);
      sec.append(k);
    }
    v.append(sec);
  }
}

// --- Ketting -------------------------------------------------------------------------
function voegToe(id, index = ketting.length) { ketting.splice(index, 0, id); uitkomsten = []; tekenKetting(); bewaarHash(); }
function verwijder(i) { ketting.splice(i, 1); uitkomsten = []; tekenKetting(); bewaarHash(); }
function verplaats(van, naar) { if (naar < 0 || naar >= ketting.length) return; const [x] = ketting.splice(van, 1); ketting.splice(naar, 0, x); uitkomsten = []; tekenKetting(); bewaarHash(); }

/** Wat er op elk punt in de ketting beschikbaar is, en of elke kraal past. */
function analyse() {
  const start = new Set(invoer.tekst.trim() ? ["tekst"] : invoer.file ? [soort(invoer.file)] : []);
  const beschikbaar = new Set(start); const past = [];
  for (const id of ketting) { const m = byId[id]; past.push(m.in.every((s) => beschikbaar.has(s))); for (const s of m.out) beschikbaar.add(s); }
  return { start, past, eind: beschikbaar };
}
function soort(file) {
  const n = file.name.toLowerCase(), t = file.type || "";
  if (t.startsWith("audio/") || t.startsWith("video/") || /\.(wav|mp3|m4a|aac|ogg|opus|flac|mp4|mov|webm|3gp)$/.test(n)) return "audio";
  if (t.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/.test(n)) return "beeld";
  return "tekst";
}

function tekenKetting() {
  const lane = $("ketting"); lane.replaceChildren();
  const { start, past } = analyse();
  const s = document.createElement("div"); s.className = "startkraal" + (start.size ? " on" : "");
  s.innerHTML = `<span class="bol">${start.has("audio") ? "🎙️" : start.has("beeld") ? "📷" : start.size ? "📄" : "＋"}</span><span class="naam">${start.size ? [...start].map((x) => SLEUTELS[x]).join(", ") : "invoer"}</span>`;
  lane.append(s);
  ketting.forEach((id, i) => {
    const m = byId[id], u = uitkomsten[i];
    const link = document.createElement("div"); link.className = "schakel " + (past[i] ? "ok" : "fout"); link.title = past[i] ? "past" : `mist: ${m.in.filter((x) => !analyse().eind.has(x)).map((x) => SLEUTELS[x]).join(", ") || "iets eerder in de ketting"}`; lane.append(link);
    const b = document.createElement("div"); b.className = "bead" + (m.komt ? " komt" : "") + (u ? (u.ok ? " klaar" : " mislukt") : "") + (past[i] ? "" : " past-niet"); b.style.setProperty("--c", kleur[m.groep]); b.dataset.i = i; b.draggable = true;
    b.innerHTML = `<span class="bol">${ICOON[m.groep]}</span><span class="naam">${m.naam}</span><span class="sub">${u ? u.samenvatting : m.komt ? "bestaat nog niet" : past[i] ? m.out.map((x) => SLEUTELS[x]).join(", ") || "oordeel" : "mist " + m.in.map((x) => SLEUTELS[x]).join("+")}</span>
      <span class="knoppen"><button title="naar links" data-k="l">‹</button><button title="naar rechts" data-k="r">›</button><button title="weg" data-k="x">✕</button></span>`;
    b.ondragstart = (e) => { e.dataTransfer.setData("text/plain", "move:" + i); e.dataTransfer.effectAllowed = "move"; };
    b.onclick = (e) => { const k = e.target.dataset.k; if (k === "x") verwijder(i); else if (k === "l") verplaats(i, i - 1); else if (k === "r") verplaats(i, i + 1); else toonUitkomst(i); };
    lane.append(b);
  });
  const eind = document.createElement("div"); eind.className = "eindkraal"; eind.innerHTML = `<span class="bol">🎁</span><span class="naam">uitkomst</span>`; lane.append(eind);
  $("go").disabled = !ketting.length || !start.size || bezig;
  $("leeg").style.display = ketting.length ? "none" : "";
  $("aantal").textContent = ketting.length ? `${ketting.length} ${ketting.length === 1 ? "kraal" : "kralen"}` : "";
}

// Slepen op de ketting: positie uit de muis-x ten opzichte van de kralen.
const lane = $("ketting");
lane.addEventListener("dragover", (e) => { e.preventDefault(); lane.classList.add("over"); });
lane.addEventListener("dragleave", () => lane.classList.remove("over"));
lane.addEventListener("drop", (e) => {
  e.preventDefault(); lane.classList.remove("over");
  const d = e.dataTransfer.getData("text/plain"); if (!d) return;
  const beads = [...lane.querySelectorAll(".bead")];
  let index = beads.findIndex((b) => e.clientX < b.getBoundingClientRect().left + b.offsetWidth / 2); if (index < 0) index = beads.length;
  const [soortD, waarde] = d.split(":");
  if (soortD === "add") voegToe(waarde, index);
  else if (soortD === "move") { const van = Number(waarde); verplaats(van, index > van ? index - 1 : index); }
});

// --- Verhalen (recepten) --------------------------------------------------------------
function tekenVerhalen() {
  const v = $("verhalen"); v.replaceChildren();
  for (const r of RECEPTEN) {
    const b = document.createElement("button"); b.className = "verhaal"; b.textContent = r.naam; b.title = r.kralen.map((k) => byId[k].naam).join(" → ");
    b.onclick = () => { ketting = [...r.kralen]; uitkomsten = []; tekenKetting(); bewaarHash(r.id); $("invoer-hint").textContent = `Dit verhaal begint met ${SLEUTELS[r.invoer]}.`; };
    v.append(b);
  }
}
function bewaarHash(recept) { history.replaceState(null, "", `#k=${ketting.join(",")}${recept ? `&r=${recept}` : ""}`); }
function laadHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  const r = RECEPTEN.find((x) => x.id === h.get("r"));
  if (h.get("k")) ketting = h.get("k").split(",").filter((id) => byId[id]);
  else if (r) ketting = [...r.kralen];
  if (r) $("invoer-hint").textContent = `Dit verhaal begint met ${SLEUTELS[r.invoer]}.`;
}

// --- Invoer ----------------------------------------------------------------------------
function zetBestand(f, label) {
  invoer.file = f; invoer.tekst = ""; $("tekst").value = "";
  $("invoer-info").textContent = `${label} · ${(f.size / 1e6).toFixed(1)} MB · ${SLEUTELS[soort(f)]}`;
  const a = $("preview-audio"), img = $("preview-beeld"); a.style.display = img.style.display = "none";
  if (soort(f) === "audio") { a.src = URL.createObjectURL(f); a.style.display = ""; }
  if (soort(f) === "beeld") { img.src = URL.createObjectURL(f); img.style.display = ""; }
  uitkomsten = []; tekenKetting();
}
$("pick").onclick = () => $("file").click();
$("file").onchange = (e) => { const f = e.target.files?.[0]; if (f) zetBestand(f, f.name); e.target.value = ""; };
$("tekst").oninput = () => { invoer.tekst = $("tekst").value; if (invoer.tekst.trim()) { invoer.file = null; $("invoer-info").textContent = `${invoer.tekst.trim().split(/\s+/).length} woorden getypt`; $("preview-audio").style.display = $("preview-beeld").style.display = "none"; } uitkomsten = []; tekenKetting(); };
$("rec").onclick = async () => {
  const btn = $("rec");
  if (recorder?.state === "recording") { recorder.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = []; recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = () => { stream.getTracks().forEach((t) => t.stop()); btn.textContent = "● Opnemen"; btn.classList.remove("rec"); const b = new Blob(chunks, { type: recorder.mimeType }); zetBestand(new File([b], `opname-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.webm`, { type: b.type }), "opname"); };
    recorder.start(); btn.textContent = "■ Stop"; btn.classList.add("rec"); setStatus("Opnemen…");
  } catch (e) { setStatus(`Microfoon niet beschikbaar: ${e.message}`); }
};
$("cam").onclick = () => $("camfile").click();
$("camfile").onchange = (e) => { const f = e.target.files?.[0]; if (f) zetBestand(f, "foto"); e.target.value = ""; };
window.addEventListener("dragover", (e) => { if (!lane.contains(e.target)) e.preventDefault(); });
window.addEventListener("drop", (e) => { if (lane.contains(e.target)) return; e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) zetBestand(f, f.name); });

// --- Draaien ---------------------------------------------------------------------------
function samenvatting(m, d, pakket) {
  if (d.tekst != null && m.out.includes("tekst")) return `${d.tekst.split(/\s+/).filter(Boolean).length} woorden`;
  if (d.spraak) return `${(d.spraak.size / 1e6).toFixed(1)} MB spraak`;
  if (d.sprekers) return `${d.sprekerAantal} sprekers`;
  if (d.taal) return `taal: ${d.taal}`;
  if (d.onderwerpen) return d.onderwerpen.slice(0, 2).map((t) => t.name).join(", ");
  if (d.pgg) return `${d.pgg.length} persoonsgegevens`;
  if (d.tags) return `${d.tags.length} trefwoorden`;
  if (d.nsfw != null) return d.nsfw ? `niet delen (${Math.round(d.nsfwScore * 100)} %)` : `ok (${Math.round(d.nsfwScore * 100)} %)`;
  if (d.beoordeling) return "beoordeeld";
  if (d.audio) return `${fmt(d.audio.duration)} audio`;
  return "klaar";
}

$("go").onclick = async () => {
  if (bezig) return;
  bezig = true; uitkomsten = []; tekenKetting(); $("go").disabled = true; $("progress").classList.add("on");
  const t0 = performance.now(); performance.clearResourceTimings();
  let pakket;
  try { setStatus("Invoer lezen…"); pakket = await startpakket(invoer); }
  catch (e) { setStatus(`Invoer mislukt: ${e.message}`); bezig = false; tekenKetting(); return; }
  for (let i = 0; i < ketting.length; i++) {
    const m = byId[ketting[i]]; const tb = performance.now();
    document.querySelectorAll(".bead")[i]?.classList.add("bezig");
    if (m.komt) { uitkomsten[i] = { id: m.id, ok: false, samenvatting: "bestaat nog niet — de ketting stopt hier", pakket: {} }; tekenKetting(); setStatus(`"${m.naam}" bestaat nog niet; tot hier gerijgd.`); break; }
    const mist = m.in.filter((s) => pakket[s] == null);
    if (mist.length) { uitkomsten[i] = { id: m.id, ok: false, samenvatting: `mist ${mist.map((s) => SLEUTELS[s]).join(", ")}`, pakket: {} }; tekenKetting(); setStatus(`"${m.naam}" mist ${mist.map((s) => SLEUTELS[s]).join(", ")}; de ketting stopt hier.`); break; }
    try {
      setStatus(`${i + 1}/${ketting.length} ${m.naam}…`); setProgress(0);
      const d = await m.run(pakket);
      Object.assign(pakket, d);
      uitkomsten[i] = { id: m.id, ok: true, samenvatting: samenvatting(m, d, pakket), pakket: d, ms: performance.now() - tb };
      tekenKetting();
    } catch (e) {
      console.error(m.id, e);
      uitkomsten[i] = { id: m.id, ok: false, samenvatting: `mislukt: ${e.message ?? e}`, pakket: {} }; tekenKetting(); setStatus(`${m.naam} mislukt: ${e.message ?? e}`); break;
    }
  }
  await new Promise((r) => setTimeout(r, 50));
  const net = netSummary(t0), geslaagd = uitkomsten.filter((u) => u?.ok).length;
  if (geslaagd === ketting.length) setStatus(`Ketting klaar in ${((performance.now() - t0) / 1000).toFixed(1)} s · ${net.text}${navigator.onLine ? "" : " · offline"}`);
  $("progress").classList.remove("on"); setProgress(0);
  bezig = false; tekenKetting();
  const laatste = uitkomsten.map((u, i) => (u?.ok ? i : -1)).filter((i) => i >= 0).pop();
  if (laatste != null) toonUitkomst(laatste, pakket);
  window.__pakket = pakket;
};

// --- Uitkomst ----------------------------------------------------------------------------
function md(t) {
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  return esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\[([A-Z_]+_\d+)\]/g, "<mark>[$1]</mark>").replace(/\n/g, "<br>");
}
function toonUitkomst(i) {
  const u = uitkomsten[i]; if (!u) return;
  const m = byId[u.id], d = u.pakket, box = $("uitkomst"); box.replaceChildren();
  document.querySelectorAll(".bead").forEach((b, j) => b.classList.toggle("gekozen", j === i));
  const h = document.createElement("h3"); h.textContent = `${ICOON[m.groep]} ${m.naam} — ${u.samenvatting}${u.ms ? ` · ${(u.ms / 1000).toFixed(1)} s` : ""}`; box.append(h);
  const voeg = (titel, node) => { const d = document.createElement("div"); d.className = "deel"; if (titel) { const t = document.createElement("div"); t.className = "deeltitel"; t.textContent = titel; d.append(t); } d.append(node); box.append(d); };
  const tabel = (rijen) => { const t = document.createElement("table"); for (const [k, v] of rijen) { const r = t.insertRow(); r.insertCell().textContent = k; r.insertCell().textContent = v; } return t; };
  if (!u.ok) { const p = document.createElement("p"); p.textContent = u.samenvatting; voeg("", p); return; }
  if (d.beoordeling) { const p = document.createElement("div"); p.innerHTML = md(d.beoordeling); voeg("Beoordeling", p); }
  if (d.tekst != null && m.out.includes("tekst")) { const p = document.createElement("div"); p.className = "tekstblok"; p.innerHTML = md(d.tekst); voeg(m.id === "redact" ? "Gemaskeerde tekst (gaat door)" : "Tekst (gaat door)", p); }
  if (d.spraak) { const a = document.createElement("audio"); a.controls = true; a.src = URL.createObjectURL(d.spraak); voeg("Spraak", a); }
  if (d.pgg) voeg("Persoonsgegevens", tabel(d.pgg.map((x) => [x.label, x.placeholder ?? x.original ?? ""])));
  if (d.onderwerpen) voeg("Onderwerpen", tabel(d.onderwerpen.map((t) => [t.name, `${Math.round(t.score * 100)} %`])));
  if (d.tags) voeg("Trefwoorden", tabel([["", d.tags.join(", ")]]));
  if (d.sprekers) voeg("Sprekers", tabel([["Aantal", d.sprekerAantal], ["Beurten", d.sprekers.length]]));
  if (d.taal) voeg("Taal", tabel([["", d.taal]]));
  if (d.nsfw != null) voeg("Geschikt om te delen?", tabel([["Oordeel", d.nsfw ? "liever niet" : "ja"], ["Score", `${Math.round(d.nsfwScore * 100)} %`]]));
  if (d.origineel) { const det = document.createElement("details"); det.innerHTML = `<summary>Origineel (blijft bij deze kraal)</summary>`; const p = document.createElement("div"); p.className = "tekstblok"; p.innerHTML = md(d.origineel); det.append(p); voeg("", det); }
  $("acties").style.display = "";
}

$("download").onclick = async () => {
  const zip = new JSZip(), basis = (invoer.file?.name ?? "tekst").replace(/\.[^.]+$/, "");
  const verslag = [`# Ketting — ${basis}`, "", `${new Date().toLocaleString("nl-NL")} · ${VERSION} · alles op dit toestel`, "", `Kralen: ${ketting.map((k) => byId[k].naam).join(" → ")}`, ""];
  uitkomsten.forEach((u, i) => {
    if (!u) return; const m = byId[u.id], d = u.pakket, nr = String(i + 1).padStart(2, "0");
    verslag.push(`## ${nr} ${m.naam} — ${u.samenvatting}`, "");
    if (d.tekst != null && m.out.includes("tekst")) { zip.file(`${nr}-${m.id}.md`, d.tekst); verslag.push(d.tekst.slice(0, 1500) + (d.tekst.length > 1500 ? "…" : ""), ""); }
    if (d.beoordeling) { zip.file(`${nr}-${m.id}.md`, d.beoordeling); verslag.push(d.beoordeling, ""); }
    if (d.spraak) zip.file(`${nr}-${m.id}.wav`, d.spraak);
    const rest = Object.fromEntries(Object.entries(d).filter(([k]) => !["tekst", "spraak", "audio", "origineel", "beoordeling"].includes(k)));
    if (Object.keys(rest).length) zip.file(`${nr}-${m.id}.json`, JSON.stringify(rest, null, 2));
  });
  zip.file("verslag.md", verslag.join("\n"));
  const blob = await zip.generateAsync({ type: "blob" }), a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${basis}__ketting.zip`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
};
$("deel").onclick = async () => { const url = location.href; if (navigator.share) await navigator.share({ title: "Ketting", url }).catch(() => {}); else { await navigator.clipboard.writeText(url); setStatus("Link naar deze ketting gekopieerd."); } };
$("wis").onclick = () => { ketting = []; uitkomsten = []; $("uitkomst").replaceChildren(); $("acties").style.display = "none"; tekenKetting(); bewaarHash(); };

// --- Instellingen --------------------------------------------------------------------------
$("llm").value = llmInstelling.maat; $("llm").onchange = (e) => { llmInstelling.maat = e.target.value; };
$("llm-info").textContent = `(${Object.entries(LLM_KEUZE).map(([k, v]) => `${k}: ${v.replace("-q4f16_1-MLC", "")}`).join(", ")}; ${navigator.gpu ? "WebGPU beschikbaar" : "geen WebGPU: taalmodel werkt hier niet"})`;

// --- Start ------------------------------------------------------------------------------------
$("rt").textContent = `${VERSION} · ${navigator.gpu ? "WebGPU beschikbaar" : "WASM (CPU)"}`;
tekenVoorraad(); tekenVerhalen(); laadHash(); tekenKetting();
window.addEventListener("hashchange", () => { uitkomsten = []; laadHash(); tekenKetting(); });
if ("serviceWorker" in navigator) navigator.serviceWorker.register(`${BASE}sw.js`).catch(() => {});
