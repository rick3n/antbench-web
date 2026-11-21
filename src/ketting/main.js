// Ketting: kralen uit de voorraad slepen in de volgorde die je wilt; elke kraal
// geeft zijn resultaat door aan de volgende. Alles lokaal in de browser.
import "./style.css";
import JSZip from "jszip";
import { $, BASE, VERSION, setStatus, setProgress, netSummary } from "../ui.js";
import { MODULES, GROEPEN, RECEPTEN, SLEUTELS, byId, startpakket, llmInstelling, kiesLlm, LLM_KEUZE, claudeInstelling, zetClaude, CLAUDE_MODELLEN, VOORBEELD_SJABLOON } from "./modules.js";
import { fileToText } from "../engine.js";
import { fmt, grootte } from "../engine.js";
import { bewaar } from "../export.js";

const ICOON = { lezen: "📄", luisteren: "🎙️", kijken: "📷", begrijpen: "🔍", schrijven: "✍️", vertalen: "🌐", spreken: "🔊", samen: "🤝", buiten: "☁️" };
const kleur = Object.fromEntries(GROEPEN.map(([id, , c]) => [id, c]));

let ketting = [];            // module-ids in volgorde
let invoer = { file: null, tekst: "", vraag: "" };
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
  $("vraag").style.display = ketting.some((id) => byId[id].vraag) ? "" : "none";
  $("claude-paneel").style.display = ketting.some((id) => byId[id].extern) ? "" : "none";
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
  $("invoer-info").textContent = `${label} · ${grootte(f.size)} · ${SLEUTELS[soort(f)]}`;
  const a = $("preview-audio"), img = $("preview-beeld"); a.style.display = img.style.display = "none";
  if (soort(f) === "audio") { a.src = URL.createObjectURL(f); a.style.display = ""; }
  if (soort(f) === "beeld") { img.src = URL.createObjectURL(f); img.style.display = ""; }
  uitkomsten = []; tekenKetting();
}
$("vraag").oninput = () => { invoer.vraag = $("vraag").value; };

// --- Verslag door Claude: instellingen (alles in localStorage op dit toestel) en de controle vóór versturen
for (const [id, m] of Object.entries(CLAUDE_MODELLEN)) $("claude-model").add(new Option(m.naam, id));
const claudeInfo = () => { const m = CLAUDE_MODELLEN[claudeInstelling.model]; $("claude-info").textContent = `${m.naam}: $${m.in} per miljoen tokens invoer, $${m.uit} uitvoer; ${m.bewaring} door Anthropic. ${claudeInstelling.sleutel ? "Sleutel staat op dit toestel." : "Nog geen sleutel ingevoerd."}`; };
$("claude-sleutel").value = claudeInstelling.sleutel; $("claude-model").value = claudeInstelling.model;
$("claude-context").value = claudeInstelling.context; $("claude-sjabloon").value = claudeInstelling.sjabloon; claudeInfo();
$("claude-sleutel").oninput = (e) => { zetClaude("sleutel", e.target.value.trim()); claudeInfo(); };
$("claude-wis").onclick = () => { zetClaude("sleutel", ""); $("claude-sleutel").value = ""; claudeInfo(); };
$("claude-model").onchange = (e) => { zetClaude("model", e.target.value); claudeInfo(); };
$("claude-context").oninput = (e) => zetClaude("context", e.target.value);
$("claude-sjabloon").oninput = (e) => zetClaude("sjabloon", e.target.value);
$("claude-sjabloon-bestand").onclick = () => $("claude-sjabloon-file").click();
$("claude-sjabloon-file").onchange = async (e) => { const f = e.target.files[0]; if (!f) return; const t = await fileToText(f); $("claude-sjabloon").value = t; zetClaude("sjabloon", t); e.target.value = ""; };
$("claude-sjabloon-voorbeeld").onclick = () => { $("claude-sjabloon").value = VOORBEELD_SJABLOON; zetClaude("sjabloon", VOORBEELD_SJABLOON); };
claudeInstelling.bevestig = ({ tekst, model, gemaskeerd, aantalPgg }) => new Promise((klaar) => {
  const d = $("claude-dialoog"), woorden = tekst.split(/\s+/).filter(Boolean).length;
  $("claude-dialoog-info").innerHTML = `${woorden} woorden naar <b>${model.naam}</b> (${model.bewaring}). ` + (gemaskeerd ? `Er zijn ${aantalPgg} persoonsgegevens gemaskeerd; kijk of er nog namen of nummers in staan die niet weg mogen.` : `<b class="waarschuwing">Let op: deze tekst is niet gemaskeerd.</b> Zet <i>Persoonsgegevens maskeren</i> vóór deze kraal als er namen in staan.`) + (claudeInstelling.context.trim() ? " De projectcontext en het sjabloon gaan ook mee." : " Het sjabloon gaat ook mee.");
  $("claude-dialoog-tekst").textContent = tekst;
  const sluit = (ja) => { d.close(); $("claude-stuur").onclick = $("claude-stop").onclick = d.oncancel = null; klaar(ja); };
  $("claude-stuur").onclick = () => sluit(true); $("claude-stop").onclick = () => sluit(false); d.oncancel = () => sluit(false);
  d.showModal();
});
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
const telWoorden = (t) => (t ?? "").split(/\s+/).filter(Boolean).length;
function samenvatting(m, d, pakket) {
  if (d.passages) return `${d.passages.length} passages gevonden`;
  if (d.claude) return `${telWoorden(d.tekst)} woorden · ${d.claude.model}`;
  if (d.teruggezet != null) return `${d.teruggezet} plaatshouders ingevuld`;
  if (d.actiepunten != null) return d.actiepunten ? `${d.actiepunten} ${d.actiepunten === 1 ? "actiepunt" : "actiepunten"}` : "geen actiepunten gevonden";
  if (d.zekerheid != null) return `${telWoorden(d.tekst)} woorden · ${d.zekerheid} % zeker`;
  if (d.overgeslagen) return `overgeslagen: ${d.overgeslagen}`;
  if (d.tekst != null && m.out.includes("tekst")) return `${d.tekst.split(/\s+/).filter(Boolean).length} woorden`;
  if (d.spraak) return `${grootte(d.spraak.size)} spraak`;
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
  bezig = true; uitkomsten = []; gekozenKraal = null; tekenKetting(); tekenLogboek(); $("go").disabled = true; $("progress").classList.add("on");
  const t0 = performance.now(); performance.clearResourceTimings();
  let pakket;
  try { setStatus("Invoer lezen…"); pakket = await startpakket(invoer); }
  catch (e) { setStatus(`Invoer mislukt: ${e.message}`); bezig = false; tekenKetting(); return; }
  for (let i = 0; i < ketting.length; i++) {
    const m = byId[ketting[i]]; const tb = performance.now();
    document.querySelectorAll(".bead")[i]?.classList.add("bezig");
    if (m.komt) { uitkomsten[i] = { id: m.id, ok: false, samenvatting: "bestaat nog niet — de ketting stopt hier", pakket: {} }; tekenKetting(); tekenLogboek(i); setStatus(`"${m.naam}" bestaat nog niet; tot hier gerijgd.`); break; }
    const mist = m.in.filter((s) => pakket[s] == null);
    if (mist.length) { uitkomsten[i] = { id: m.id, ok: false, samenvatting: `mist ${mist.map((s) => SLEUTELS[s]).join(", ")}`, pakket: {} }; tekenKetting(); tekenLogboek(i); setStatus(`"${m.naam}" mist ${mist.map((s) => SLEUTELS[s]).join(", ")}; de ketting stopt hier.`); break; }
    try {
      setStatus(`${i + 1}/${ketting.length} ${m.naam}…`); setProgress(0);
      const kreeg = m.in.map((k) => beschrijf(k, pakket)).join(" + "), tekstVoor = pakket.tekst;
      const d = await m.run(pakket);
      Object.assign(pakket, d);
      const nieuw = d.tekst != null && d.tekst !== tekstVoor;
      const door = pakket.tekst == null ? "" : nieuw ? `nieuwe tekst (${telWoorden(pakket.tekst)} woorden)` : `tekst ongewijzigd (${telWoorden(pakket.tekst)} woorden)`;
      uitkomsten[i] = { id: m.id, ok: true, samenvatting: samenvatting(m, d, pakket), pakket: d, ms: performance.now() - tb, kreeg, door, nieuw, labels: labels(pakket) };
      tekenKetting(); tekenLogboek(i);
    } catch (e) {
      console.error(m.id, e);
      uitkomsten[i] = { id: m.id, ok: false, samenvatting: `mislukt: ${e.message ?? e}`, pakket: {} }; tekenKetting(); tekenLogboek(i); setStatus(`${m.naam} mislukt: ${e.message ?? e}`); break;
    }
  }
  await new Promise((r) => setTimeout(r, 50));
  const net = netSummary(t0), geslaagd = uitkomsten.filter((u) => u?.ok).length;
  if (geslaagd === ketting.length) setStatus(`Ketting klaar in ${((performance.now() - t0) / 1000).toFixed(1)} s · ${net.text}${navigator.onLine ? "" : " · offline"}`);
  $("progress").classList.remove("on"); setProgress(0);
  bezig = false; tekenKetting();
  eindpakket = pakket; tekenLogboek();
  window.__pakket = pakket;
};

// --- Uitkomst ----------------------------------------------------------------------------
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inregel = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\[[A-Z_]+_\d+\]/g, "<mark>$&</mark>");
/** Onze lichte markdown als HTML: koppen, lijsten, tabellen, vet en gemarkeerde plaatshouders. */
function md(t) {
  const uit = []; let tabel = null, lijst = false;
  const sluit = () => { if (tabel) { uit.push(`<table class="mdtabel">${tabel.join("")}</table>`); tabel = null; } if (lijst) { uit.push("</ul>"); lijst = false; } };
  for (const raw of t.split("\n")) {
    const r = raw.trimEnd();
    if (/^\|.*\|$/.test(r)) { if (lijst) sluit(); if (/^\|\s*:?-{2,}/.test(r)) continue; const c = r.slice(1, -1).split("|").map((x) => inregel(x.trim())); (tabel ??= []).push(`<tr>${c.map((x) => (tabel?.length ? `<td>${x}</td>` : `<th>${x}</th>`)).join("")}</tr>`); continue; }
    if (/^[-*•] /.test(r)) { if (tabel) sluit(); if (!lijst) { uit.push("<ul>"); lijst = true; } uit.push(`<li>${inregel(r.slice(2))}</li>`); continue; }
    sluit();
    const k = /^(#{1,3}) (.+)$/.exec(r);
    if (k) uit.push(`<div class="mdkop k${k[1].length}">${inregel(k[2])}</div>`);
    else uit.push(r.trim() ? `<div>${inregel(r)}</div>` : `<div class="wit"></div>`);
  }
  sluit();
  return uit.join("");
}
/** Eén onderdeel van het pakket in woorden: "tekst (412 woorden)". */
function beschrijf(k, p) {
  if (k === "tekst") return `tekst (${telWoorden(p.tekst)} woorden)`;
  if (k === "audio") return `audio (${fmt(p.audio.duration)})`;
  if (k === "beeld") return "beeld";
  return SLEUTELS[k] ?? k;
}
/** De labels die op dit moment op het pakket zitten. */
function labels(p) {
  const l = [];
  if (p.taal) l.push(`taal: ${p.taal}`);
  if (p.onderwerpen?.length) l.push(`onderwerp: ${p.onderwerpen[0].name}`);
  if (p.pgg) l.push(`${p.pgg.length} persoonsgegevens gemaskeerd`);
  if (p.claude) l.push("verslag door Claude");
  if (p.teruggezet != null) l.push("namen teruggezet");
  if (p.sprekerAantal) l.push(`${p.sprekerAantal} sprekers`);
  if (p.tags?.length) l.push(`${p.tags.length} trefwoorden`);
  if (p.nsfw != null) l.push(p.nsfw ? "delen: liever niet" : "delen: ok");
  return l;
}
let eindpakket = null;
const KORT = 320;
/** Het logboek: per kraal een kaart met wat hij kreeg, wat hij opleverde en wat er doorgaat. Verschijnt tijdens het rijgen. */
function tekenLogboek(nieuwste = null) {
  const box = $("uitkomst"); box.replaceChildren();
  if (!uitkomsten.some(Boolean)) { box.textContent = bezig ? "Bezig…" : "Nog niets gerijgd."; $("acties").style.display = "none"; return; }
  uitkomsten.forEach((u, i) => { if (u) box.append(kaart(i)); });
  if (eindpakket && !bezig) {
    const e = document.createElement("div"); e.className = "stap eind";
    const l = labels(eindpakket);
    e.innerHTML = `<div class="kop"><span class="nr">🎁</span><b>Aan het eind in het pakket</b></div>`;
    const p = document.createElement("div"); p.className = "door"; p.textContent = [eindpakket.tekst != null ? `tekst (${telWoorden(eindpakket.tekst)} woorden)` : null, ...l, eindpakket.spraak ? "spraak (wav)" : null].filter(Boolean).join(" · ") || "niets"; e.append(p); box.append(e);
  }
  $("acties").style.display = uitkomsten.some((u) => u?.ok) ? "" : "none";
  if (nieuwste != null) box.children[nieuwste]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}
function kaart(i) {
  const u = uitkomsten[i], m = byId[u.id], d = u.pakket, open = gekozenKraal === i;
  const k = document.createElement("div"); k.className = "stap" + (u.ok ? "" : " mislukt") + (open ? " gekozen" : ""); k.style.setProperty("--c", kleur[m.groep]); k.dataset.i = i;
  const kop = document.createElement("div"); kop.className = "kop";
  kop.innerHTML = `<span class="nr">${i + 1}</span><b>${ICOON[m.groep]} ${m.naam}</b><span class="tijd">${u.ms ? `${(u.ms / 1000).toFixed(1)} s` : ""}</span>`;
  kop.onclick = () => toonUitkomst(open ? null : i); k.append(kop);
  const voeg = (titel, node) => { const el = document.createElement("div"); el.className = "deel"; if (titel) { const t = document.createElement("div"); t.className = "deeltitel"; t.textContent = titel; el.append(t); } el.append(node); k.append(el); };
  const tabel = (rijen) => { const t = document.createElement("table"); for (const [a, b] of rijen) { const r = t.insertRow(); r.insertCell().textContent = a; r.insertCell().textContent = b; } return t; };
  const tekstblok = (t, titel) => {
    const p = document.createElement("div"); p.className = "tekstblok";
    if (open || t.length <= KORT) p.innerHTML = md(t);
    else { p.innerHTML = md(t.slice(0, KORT).replace(/\s+\S*$/, "")) + "… "; const b = document.createElement("button"); b.className = "meer"; b.textContent = `toon alles (${telWoorden(t)} woorden)`; b.onclick = () => toonUitkomst(i); p.append(b); }
    voeg(titel, p);
  };
  if (!u.ok) { const p = document.createElement("p"); p.textContent = u.samenvatting; voeg("", p); return k; }
  if (u.kreeg) { const p = document.createElement("div"); p.className = "kreeg"; p.textContent = `Kreeg: ${u.kreeg}`; k.append(p); }
  if (d.overgeslagen) { const p = document.createElement("p"); p.textContent = `Overgeslagen: ${d.overgeslagen}.`; voeg("", p); }
  if (d.beoordeling) tekstblok(d.beoordeling, "Beoordeling");
  if (d.taal) voeg("", tabel([["Taal", d.taal]]));
  if (d.onderwerpen) voeg("Onderwerpen", tabel(d.onderwerpen.map((t) => [t.name, `${Math.round(t.score * 100)} %`])));
  if (d.pgg) voeg(`Persoonsgegevens (${d.pgg.length})`, tabel((open ? d.pgg : d.pgg.slice(0, 5)).map((x) => [x.label, x.placeholder ?? x.original ?? ""]).concat(!open && d.pgg.length > 5 ? [["…", `en nog ${d.pgg.length - 5}`]] : [])));
  if (d.tags) voeg("Trefwoorden", tabel([["", d.tags.join(", ")]]));
  if (d.sprekers) voeg("Sprekers", tabel([["Aantal", d.sprekerAantal], ["Beurten", d.sprekers.length]]));
  if (d.nsfw != null) voeg("Geschikt om te delen?", tabel([["Oordeel", d.nsfw ? "liever niet" : "ja"], ["Score", `${Math.round(d.nsfwScore * 100)} %`]]));
  if (d.zekerheid != null && d.zekerheid < 70) { const w = document.createElement("p"); w.className = "let-op"; w.textContent = `Let op: de herkenning is onzeker (${d.zekerheid} %). Fotografeer recht van boven, met het stuk beeldvullend en scherp, bij gelijkmatig licht.`; voeg("", w); }
  if (d.passages) { voeg(`Gevonden passages, beste eerst · ${d.zoekmodel}`, tabel(d.passages.map((x, j) => [`[${j + 1}] passage ${x.nr} van ${x.van} · ${Math.round(x.score * 100)} %`, open ? x.tekst : x.tekst.slice(0, 160).replace(/\s+\S*$/, "") + (x.tekst.length > 160 ? "…" : "")]))); }
  else if (d.tekst != null && m.out.includes("tekst")) tekstblok(d.tekst, `${m.id === "redact" ? "Gemaskeerde tekst" : "Nieuwe tekst"}${d.delen > 1 ? ` · gemaakt in ${d.delen} delen` : ""}`);
  if (d.spraak) { u.spraakUrl ??= URL.createObjectURL(d.spraak); const a = document.createElement("audio"); a.controls = true; a.src = u.spraakUrl; voeg("Spraak", a); }
  if (d.claude) { const w = document.createElement("div"); w.className = "kreeg"; w.textContent = `${d.claude.model} · ${d.claude.tin.toLocaleString("nl")} tokens in, ${d.claude.tuit.toLocaleString("nl")} uit · ongeveer $${d.claude.dollar.toFixed(d.claude.dollar < 0.1 ? 3 : 2)} · ${d.claude.bewaring} door Anthropic${d.claude.afgekapt ? " · het antwoord is afgekapt" : ""}`; k.append(w); }
  if (d.teruggezet != null) { const w = document.createElement("div"); w.className = "kreeg"; w.textContent = `${d.teruggezet} plaatshouders weer ingevuld, op dit toestel.${d.nietTerug ? ` ${d.nietTerug} plaatshouders staan er nog: die kwamen niet uit de maskering.` : ""}`; k.append(w); }
  if (d.uitgesneden || d.weggelaten) { const w = document.createElement("div"); w.className = "kreeg"; w.textContent = [d.uitgesneden ? "Alleen het tekstblok gelezen; wat eromheen stond is weggelaten." : "", d.weggelaten ? `${d.weggelaten} losse tekens aan de rand weggelaten.` : ""].filter(Boolean).join(" "); k.append(w); }
  if (open && d.ruw && (d.uitgesneden || d.weggelaten)) { const det = document.createElement("details"); det.innerHTML = `<summary>Wat de OCR op de hele foto las</summary>`; const p = document.createElement("div"); p.className = "tekstblok"; p.innerHTML = md(d.ruw); det.append(p); voeg("", det); }
  if (open && d.origineel) { const det = document.createElement("details"); det.innerHTML = `<summary>Wat deze kraal binnenkreeg</summary>`; const p = document.createElement("div"); p.className = "tekstblok"; p.innerHTML = md(d.origineel); det.append(p); voeg("", det); }
  if (u.door) { const p = document.createElement("div"); p.className = "door" + (u.nieuw ? " nieuw" : ""); p.textContent = `Geeft door: ${u.door}${u.labels?.length ? ` · labels: ${u.labels.join(", ")}` : ""}`; k.append(p); }
  return k;
}
/** Eén kraal uitklappen (of met null alles weer inklappen). */
function toonUitkomst(i) {
  if (i != null && !uitkomsten[i]) return;
  gekozenKraal = i;
  document.querySelectorAll(".bead").forEach((b, j) => b.classList.toggle("gekozen", j === i));
  tekenLogboek(i);
}

const basisnaam = () => (invoer.file?.name ?? "tekst").replace(/\.[^.]+$/, "");
/** Verslag van de hele ketting als lichte markdown; vult optioneel een ZIP met de losse delen. */
function verslagMd(zip = null, kort = false) {
  const basis = basisnaam();
  const verslag = [`# Ketting — ${basis}`, "", `${new Date().toLocaleString("nl-NL")} · ${VERSION} · alles op dit toestel`, "", `Kralen: ${ketting.map((k) => byId[k].naam).join(" → ")}`, ""];
  uitkomsten.forEach((u, i) => {
    if (!u) return; const m = byId[u.id], d = u.pakket, nr = String(i + 1).padStart(2, "0");
    verslag.push(`## ${nr} ${m.naam} — ${u.samenvatting}`, "");
    if (u.kreeg) verslag.push(`Kreeg: ${u.kreeg}`, "");
    if (d.tekst != null && m.out.includes("tekst")) { zip?.file(`${nr}-${m.id}.md`, d.tekst); verslag.push(kort && d.tekst.length > 1500 ? d.tekst.slice(0, 1500) + "…" : d.tekst, ""); }
    if (d.beoordeling) { zip?.file(`${nr}-${m.id}.md`, d.beoordeling); verslag.push(d.beoordeling, ""); }
    if (d.pgg?.length) verslag.push("| Persoonsgegeven | Vervangen door |", "|---|---|", ...d.pgg.map((x) => `| ${x.label} | ${x.placeholder ?? ""} |`), "");
    if (d.passages?.length) verslag.push(`Vraag: ${eindpakket?.vraag ?? invoer.vraag}`, "");
    if (d.onderwerpen?.length) verslag.push("| Onderwerp | Score |", "|---|---|", ...d.onderwerpen.map((t) => `| ${t.name} | ${Math.round(t.score * 100)} % |`), "");
    if (d.taal) verslag.push(`Taal: ${d.taal}`, "");
    if (d.spraak) zip?.file(`${nr}-${m.id}.wav`, d.spraak);
    if (u.door) verslag.push(`Geeft door: ${u.door}`, "");
    const rest = Object.fromEntries(Object.entries(d).filter(([k]) => !["tekst", "spraak", "audio", "origineel", "beoordeling"].includes(k)));
    if (zip && Object.keys(rest).length) zip.file(`${nr}-${m.id}.json`, JSON.stringify(rest, null, 2));
  });
  return verslag.join("\n");
}
let gekozenKraal = null;
$("bewaar-kraal").onclick = () => {
  const i = gekozenKraal ?? uitkomsten.map((u, j) => (u?.ok ? j : -1)).filter((j) => j >= 0).pop(); const u = uitkomsten[i]; if (!u) return;
  const m = byId[u.id], d = u.pakket, tekst = d.beoordeling ?? d.tekst ?? "";
  const md = [`# ${m.naam} — ${basisnaam()}`, "", `${new Date().toLocaleString("nl-NL")} · ${u.samenvatting} · ${VERSION}`, "", tekst].join("\n");
  bewaar($("fmt").value, md, `${basisnaam()}__${m.id}`).catch((e) => setStatus(`Opslaan mislukt: ${e.message}`));
};
$("bewaar-verslag").onclick = () => bewaar($("fmt").value, verslagMd(), `${basisnaam()}__ketting`).catch((e) => setStatus(`Opslaan mislukt: ${e.message}`));

$("download").onclick = async () => {
  const zip = new JSZip(), basis = basisnaam();
  zip.file("verslag.md", verslagMd(zip, true));
  const blob = await zip.generateAsync({ type: "blob" }), a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${basis}__ketting.zip`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
};
$("deel").onclick = async () => { const url = location.href; if (navigator.share) await navigator.share({ title: "Ketting", url }).catch(() => {}); else { await navigator.clipboard.writeText(url); setStatus("Link naar deze ketting gekopieerd."); } };
$("wis").onclick = () => { ketting = []; uitkomsten = []; eindpakket = null; tekenKetting(); tekenLogboek(); bewaarHash(); };

// --- Instellingen --------------------------------------------------------------------------
$("llm").value = llmInstelling.maat; $("llm").onchange = (e) => kiesLlm(e.target.value); llmInstelling.luister = (m) => { $("llm").value = m; };
$("llm-info").textContent = `(${Object.entries(LLM_KEUZE).map(([k, v]) => `${k}: ${v.replace("-q4f16_1-MLC", "")}`).join(", ")}; ${navigator.gpu ? "WebGPU beschikbaar; klein is de standaard, normaal vraagt veel grafisch geheugen" : "geen WebGPU: taalmodel werkt hier niet"})`;

// --- Start ------------------------------------------------------------------------------------
$("rt").textContent = `${VERSION} · ${navigator.gpu ? "WebGPU beschikbaar" : "WASM (CPU)"}`;
tekenVoorraad(); tekenVerhalen(); laadHash(); tekenKetting();
window.addEventListener("hashchange", () => { uitkomsten = []; laadHash(); tekenKetting(); });
if ("serviceWorker" in navigator) navigator.serviceWorker.register(`${BASE}sw.js`).catch(() => {});
