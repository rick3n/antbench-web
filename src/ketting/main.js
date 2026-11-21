// Ketting: kralen uit de voorraad slepen in de volgorde die je wilt; elke kraal
// geeft zijn resultaat door aan de volgende. Alles lokaal in de browser.
import "./style.css";
import JSZip from "jszip";
import { $, BASE, VERSION, setStatus, setProgress, netSummary, verouderd, VEROUDERD_TEKST } from "../ui.js";
import { MODULES, GROEPEN, RECEPTEN, SLEUTELS, byId, startpakket, llmInstelling, kiesLlm, LLM_KEUZE, claudeInstelling, zetClaude, CLAUDE_MODELLEN, VOORBEELD_SJABLOON, stemInstelling, STEMMEN, kiesStem, ontgrendelToestelstem, toestelstem } from "./modules.js";
import { fileToText } from "../engine.js";
import { fmt, grootte, geheugen, zetZuinig, geefAllesVrij, imageToPixels } from "../engine.js";
// Kralen zonder model: die kosten geen geheugen en hoeven op een iPhone geen schone pagina.
const LICHT = new Set(["actiepunten", "claude", "terugzetten"]);
let vuil = false;   // heeft deze pagina al een model geladen? (begint na elke herlaadbeurt weer op nee)

import { bewaar } from "../export.js";
import { spoor, spoorStart, spoorVervolg, spoorKlaar, vorigeKeer, spoorWeg, spoorTekst } from "../spoor.js";
import { archiefInstelling, zetArchief, bewaarSessie, haalSessie, wisSessie, wisAlles, lijst, ruimOp, ruimte, alsZip, uitZip, bewaarVervolg, haalVervolg } from "./archief.js";

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
    b.innerHTML = `<span class="bol">${ICOON[m.groep]}</span><span class="naam">${m.naam}</span><span class="sub">${u ? u.samenvatting : gebruik ? "" : m.komt ? "bestaat nog niet" : past[i] ? m.out.map((x) => SLEUTELS[x]).join(", ") || "oordeel" : "mist " + m.in.map((x) => SLEUTELS[x]).join("+")}</span>
      <span class="knoppen"><button title="naar links" data-k="l">‹</button><button title="naar rechts" data-k="r">›</button><button title="weg" data-k="x">✕</button></span>`;
    b.ondragstart = (e) => { e.dataTransfer.setData("text/plain", "move:" + i); e.dataTransfer.effectAllowed = "move"; };
    b.onclick = (e) => { const k = e.target.dataset.k; if (k === "x") verwijder(i); else if (k === "l") verplaats(i, i - 1); else if (k === "r") verplaats(i, i + 1); else toonUitkomst(i); };
    lane.append(b);
  });
  const eind = document.createElement("div"); eind.className = "eindkraal"; eind.innerHTML = `<span class="bol">🎁</span><span class="naam">uitkomst</span>`; lane.append(eind);
  $("vraag").style.display = ketting.some((id) => byId[id].vraag) ? "" : "none";
  $("stem-rij").style.display = ketting.some((id) => byId[id].stem) ? "" : "none";
  // gebruikersscherm: alleen de invoer tonen die deze ketting nodig heeft
  const nodig = gebruik ? byId[ketting[0]]?.in.find((x) => ["audio", "beeld", "tekst"].includes(x)) : null;
  $("rec").style.display = $("opname-rij").style.display = !nodig || nodig === "audio" ? "" : "none"; $("cam").style.display = !nodig || nodig === "beeld" ? "" : "none"; $("tekst").style.display = !nodig || nodig === "tekst" ? "" : "none";
  $("proef").href = link(true);
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
const receptVan = () => RECEPTEN.find((r) => r.kralen.join() === ketting.join());
function bewaarHash(recept) { history.replaceState(null, "", `#k=${ketting.join(",")}${recept ? `&r=${recept}` : ""}`); }
/** Het gebruikersscherm: dezelfde ketting, zonder studio. Alleen invoer, start en resultaat, onder elkaar. */
let gebruik = false;
const link = (u) => `${location.origin}${location.pathname}#k=${ketting.join(",")}${u ? "&u=1" : ""}`;
function zetModus() {
  gebruik = new URLSearchParams(location.hash.slice(1)).has("u");
  document.body.classList.toggle("gebruik", gebruik);
  $("stappen").open = !gebruik; $("go").textContent = gebruik ? "Start" : "Rijg en ga";
  if (!gebruik) return;
  const extern = ketting.some((id) => byId[id].extern), titel = receptVan()?.naam ?? "Ketting";
  $("gebruik-titel").textContent = titel; document.title = titel;
  $("gebruik-uitleg").textContent = extern ? "Alles gebeurt op dit toestel, op één stap na: Verslag door Claude stuurt de tekst naar Anthropic. Je ziet eerst wat er verstuurd wordt." : "Alles gebeurt op dit toestel. Je opname, foto of tekst gaat niet naar een server.";
  $("naar-studio").href = link(false);
  const nodig = byId[ketting[0]]?.in.find((x) => ["audio", "beeld", "tekst"].includes(x));
  setStatus({ audio: "Neem op of kies een geluidsbestand, en tik dan op Start.", beeld: "Maak een foto of kies een afbeelding, en tik dan op Start.", tekst: "Typ of plak je tekst, of kies een bestand, en tik dan op Start." }[nodig] ?? "Kies de invoer en tik op Start.");
}
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
const claudeInfo = () => { const m = CLAUDE_MODELLEN[claudeInstelling.model]; $("claude-info").textContent = `${m.naam}: $${m.in} per miljoen tokens invoer, $${m.uit} uitvoer; ${m.bewaring} door Anthropic. ${claudeInstelling.sleutel ? "Sleutel staat op dit toestel." : "Nog geen sleutel ingevoerd."}`;
  $("claude-kort").textContent = claudeInstelling.sleutel ? `${m.naam} · sleutel ingesteld · ${claudeInstelling.context.trim() ? "met projectcontext" : "zonder projectcontext"} · tik om te wijzigen` : "nog instellen: voer je API-sleutel in"; };
$("claude-sleutel").value = claudeInstelling.sleutel; $("claude-model").value = claudeInstelling.model;
$("claude-context").value = claudeInstelling.context; $("claude-sjabloon").value = claudeInstelling.sjabloon; claudeInfo();
$("claude-paneel").open = !claudeInstelling.sleutel;   // eenmaal ingesteld blijft het paneel dicht
$("claude-sleutel").oninput = (e) => { zetClaude("sleutel", e.target.value.trim()); claudeInfo(); };
$("claude-wis").onclick = () => { zetClaude("sleutel", ""); $("claude-sleutel").value = ""; claudeInfo(); };
$("claude-model").onchange = (e) => { zetClaude("model", e.target.value); claudeInfo(); };
$("claude-context").oninput = (e) => { zetClaude("context", e.target.value); claudeInfo(); };
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
let opnameNoot = "";
try { $("opname-soort").value = localStorage.getItem("antbench.opname") === "zaal" ? "zaal" : "dichtbij"; } catch {}
$("opname-soort").onchange = (e) => { try { localStorage.setItem("antbench.opname", e.target.value); } catch {} };
$("rec").onclick = async () => {
  const btn = $("rec");
  if (recorder?.state === "recording") { recorder.stop(); return; }
  try {
    // Dichtbij: de standaard van de browser, afgesteld op bellen (echo- en ruisonderdrukking, automatisch volume).
    // Zaal: die bewerkingen uit, want ze drukken verre stemmen weg en regelen het volume op wie het dichtst bij zit.
    const zaal = $("opname-soort").value === "zaal";
    const stream = await navigator.mediaDevices.getUserMedia({ audio: zaal ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } : true });
    const inst = stream.getAudioTracks()[0]?.getSettings?.() ?? {};
    const nog = ["echoCancellation", "noiseSuppression", "autoGainControl"].filter((k) => inst[k] === true).map((k) => ({ echoCancellation: "echo-onderdrukking", noiseSuppression: "ruisonderdrukking", autoGainControl: "automatisch volume" })[k]);
    opnameNoot = !zaal ? "dichtbij" : nog.length ? `zaal, maar dit toestel houdt ${nog.join(" en ")} aan` : "zaal, zonder bewerking";
    chunks = []; recorder = zaal ? new MediaRecorder(stream, { audioBitsPerSecond: 128000 }) : new MediaRecorder(stream);
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = () => { stream.getTracks().forEach((t) => t.stop()); btn.textContent = "● Opnemen"; btn.classList.remove("rec"); const b = new Blob(chunks, { type: recorder.mimeType }); zetBestand(new File([b], `opname-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.webm`, { type: b.type }), `opname (${opnameNoot})`); };
    recorder.start(); btn.textContent = "■ Stop"; btn.classList.add("rec"); setStatus(`Opnemen (${opnameNoot})…`);
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
  if (d.stopwoorden) return `${d.stopwoorden.length} stopwoordjes`;
  if (d.toon) return d.toon.letOp ? `let op: ${d.toon.soort.join(", ")}` : "geen haatdragende taal";
  if (d.gezichten != null) return d.gezichten ? `${d.gezichten} ${d.gezichten === 1 ? "gezicht" : "gezichten"} vervaagd` : "geen gezichten gevonden";
  if (d.claude) return `${telWoorden(d.tekst)} woorden · ${d.claude.model}`;
  if (d.teruggezet != null) return `${d.teruggezet} ${d.teruggezet === 1 ? "plaatshouder" : "plaatshouders"} ingevuld`;
  if (d.actiepunten != null) return d.actiepunten ? `${d.actiepunten} ${d.actiepunten === 1 ? "actiepunt" : "actiepunten"}` : "geen actiepunten gevonden";
  if (d.zekerheid != null) return `${telWoorden(d.tekst)} woorden · ${d.zekerheid} % zeker`;
  if (d.overgeslagen) return `overgeslagen: ${d.overgeslagen}`;
  if (d.tekst != null && m.out.includes("tekst")) return `${d.tekst.split(/\s+/).filter(Boolean).length} woorden`;
  if (d.geknipt) return d.geknipt.aantal ? `${d.geknipt.aantal} weggeknipt · ${d.geknipt.seconden.toFixed(1)} s korter` : "geen stopwoordjes gevonden";
  if (d.spraak) return `${grootte(d.spraak.size)} spraak`;
  if (d.voorgelezen) return `voorgelezen · ${d.voorgelezen.stem}`;
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

$("go").onclick = () => draai(0);
/** Rijgt de ketting. Met vanaf > 0 blijven de eerdere stappen staan en gaat het verder met wat die opleverden. */
async function draai(vanaf = 0, { vervolg = false } = {}) {
  if (bezig) return;
  if (ketting.some((id) => byId[id].extern) && !claudeInstelling.sleutel) { $("claude-paneel").open = true; $("claude-sleutel").focus(); setStatus("Voer eerst je eigen Anthropic API-sleutel in; hij blijft op dit toestel."); return; }
  if (claudeInstelling.sleutel) $("claude-paneel").open = false;
  if (ketting.some((id) => byId[id].stem)) ontgrendelToestelstem();
  if (uitkomsten.slice(0, vanaf).some((u) => !u?.ok)) vanaf = 0;
  const eerder = uitkomsten.slice(0, vanaf);
  bezig = true; uitkomsten = eerder; eindpakket = null; gekozenKraal = null; tekenKetting(); tekenLogboek(); $("go").disabled = true; $("progress").classList.add("on");
  const t0 = performance.now(); performance.clearResourceTimings();
  if (vervolg) spoorVervolg(`verder na herladen, bij stap ${vanaf + 1}`);
  else await spoorStart(`${VERSION} · ketting ${ketting.join(",")}${vanaf ? ` vanaf stap ${vanaf + 1}` : ""} · zuinig ${geheugen.zuinig ? "aan" : "uit"} · invoer ${invoer.file ? `${soort(invoer.file)} ${grootte(invoer.file.size)} ${invoer.file.type}` : "getypte tekst"}`);
  let pakket;
  try {
    setStatus("Invoer lezen…");
    const zwaar = ketting.slice(vanaf).some((id) => byId[id].in.some((x) => x === "audio" || x === "beeld"));
    if (!vanaf) pakket = await startpakket(invoer);
    else {
      if (zwaar && !invoer.file) throw new Error("de opname of foto van deze sessie is niet bewaard; begin opnieuw met nieuwe invoer");
      pakket = invoer.tekst.trim() || (invoer.file && (zwaar || soort(invoer.file) === "tekst")) ? await startpakket(invoer) : {};
      if (invoer.vraag?.trim()) pakket.vraag = invoer.vraag.trim();
      for (const u of eerder) Object.assign(pakket, u.pakket);
      // Een eerdere kraal kan de foto bewerkt hebben (gezichten vervaagd); ga daarmee verder, niet met het origineel.
      const bewerkt = [...eerder].reverse().find((u) => u.pakket.bewerktBeeld)?.pakket.bewerktBeeld;
      if (bewerkt && pakket.beeld) pakket.beeld = { blob: bewerkt, pixels: await imageToPixels(bewerkt) };
    }
  }
  catch (e) { setStatus(`Invoer mislukt: ${e.message}`); spoorKlaar(`invoer mislukt: ${e.message}`); bezig = false; tekenKetting(); return; }
  spoor(`invoer gelezen${pakket.audio ? `: ${fmt(pakket.audio.duration)} audio op ${pakket.audio.sampleRate} Hz` : ""}`);
  for (let i = vanaf; i < ketting.length; i++) {
    const m = byId[ketting[i]]; const tb = performance.now();
    // iPhone en iPad: één model per pagina. Op een iPhone (iOS 26.5) viel de pagina weg bij het laden van elk
    // tweede model, ook van een klein model na een klein model (Maskeren, 12 MB, na Sprekers). Heeft deze pagina al
    // een model geladen en heeft deze kraal er ook een nodig, dan bewaren we de tussenstand en herladen we de
    // pagina; de ketting gaat daarna vanzelf verder bij deze stap. Alleen herladen geeft het geheugen zeker terug.
    if (geheugen.zuinig && geheugen.apple && !LICHT.has(m.id) && !m.komt) {
      if (vuil) {
        spoor(`geheugen vrijmaken: pagina herladen, daarna verder bij stap ${i + 1} (${m.id})`);
        setStatus("Geheugen vrijmaken, de pagina herlaadt even…");
        try { await bewaarVervolg({ ketting, invoer, uitkomsten, vanaf: i }); location.reload(); await new Promise(() => {}); }
        catch (e) { spoor(`tussenstand bewaren mislukt: ${e.message ?? e}; verder zonder herladen`); }
      }
      vuil = true;
    }
    document.querySelectorAll(".bead")[i]?.classList.add("bezig");
    if (m.komt) { uitkomsten[i] = { id: m.id, ok: false, samenvatting: "bestaat nog niet — de ketting stopt hier", pakket: {} }; tekenKetting(); tekenLogboek(i); setStatus(`"${m.naam}" bestaat nog niet; tot hier gerijgd.`); break; }
    const mist = m.in.filter((s) => pakket[s] == null);
    if (mist.length) { uitkomsten[i] = { id: m.id, ok: false, samenvatting: `mist ${mist.map((s) => SLEUTELS[s]).join(", ")}`, pakket: {} }; tekenKetting(); tekenLogboek(i); setStatus(`"${m.naam}" mist ${mist.map((s) => SLEUTELS[s]).join(", ")}; de ketting stopt hier.`); break; }
    try {
      setStatus(`${i + 1}/${ketting.length} ${m.naam}…`); setProgress(0); spoor(`stap ${i + 1} ${m.id}: begin`);
      const kreeg = m.in.map((k) => beschrijf(k, pakket)).join(" + "), tekstVoor = pakket.tekst;
      const d = await m.run(pakket);
      Object.assign(pakket, d); spoor(`stap ${i + 1} ${m.id}: klaar`);
      // Wat hierna niemand meer nodig heeft, gaat het geheugen uit: de gedecodeerde opname, en op zuinige toestellen het model.
      if (pakket.audio && !ketting.slice(i + 1).some((id) => byId[id].in.includes("audio"))) delete pakket.audio;
      if (geheugen.zuinig && !geheugen.apple && i < ketting.length - 1) { await geefAllesVrij(); await new Promise((r) => setTimeout(r, 150)); }
      const nieuw = d.tekst != null && d.tekst !== tekstVoor;
      const door = pakket.tekst == null ? "" : nieuw ? `nieuwe tekst (${telWoorden(pakket.tekst)} woorden)` : `tekst ongewijzigd (${telWoorden(pakket.tekst)} woorden)`;
      uitkomsten[i] = { id: m.id, ok: true, samenvatting: samenvatting(m, d, pakket), pakket: d, ms: performance.now() - tb, kreeg, door, nieuw, labels: labels(pakket) };
      tekenKetting(); tekenLogboek(i);
    } catch (e) {
      console.error(m.id, e); spoor(`stap ${i + 1} ${m.id}: mislukt: ${e.message ?? e}`);
      // De pagina is van vóór een nieuwe uitrol: tussenstand bewaren, herladen (dat haalt de nieuwe versie op) en
      // verdergaan bij deze stap. Hooguit één keer per minuut, zodat een echte storing geen herlaadlus wordt.
      if (verouderd(e)) {
        let net = false; try { net = Date.now() - Number(sessionStorage.getItem("antbench.herstel") || 0) < 60_000; } catch {}
        if (!net) {
          try { sessionStorage.setItem("antbench.herstel", String(Date.now())); spoor("nieuwe versie op de server: pagina herladen en verder bij deze stap"); setStatus("Er staat een nieuwe versie klaar; de pagina herlaadt en gaat verder…"); await bewaarVervolg({ ketting, invoer, uitkomsten: uitkomsten.slice(0, i), vanaf: i }); location.reload(); await new Promise(() => {}); }
          catch (x) { spoor(`herstellen mislukt: ${x.message ?? x}`); }
        }
        uitkomsten[i] = { id: m.id, ok: false, samenvatting: "mislukt: de pagina is van een vorige versie", pakket: {} }; tekenKetting(); tekenLogboek(i); setStatus(VEROUDERD_TEKST); break;
      }
      uitkomsten[i] = { id: m.id, ok: false, samenvatting: `mislukt: ${e.message ?? e}`, pakket: {} }; tekenKetting(); tekenLogboek(i); setStatus(`${m.naam} mislukt: ${e.message ?? e}`); break;
    }
  }
  await new Promise((r) => setTimeout(r, 50));
  const net = netSummary(t0), geslaagd = uitkomsten.filter((u) => u?.ok).length;
  if (geslaagd === ketting.length && gebruik) setStatus(`Klaar in ${((performance.now() - t0) / 1000).toFixed(0)} s.${net.text.includes("api.anthropic.com") ? " De tekst is naar Anthropic gestuurd voor het verslag." : ""}`);
  else if (geslaagd === ketting.length) setStatus(`Ketting klaar in ${((performance.now() - t0) / 1000).toFixed(1)} s · ${net.text}${navigator.onLine ? "" : " · offline"}`);
  $("progress").classList.remove("on"); setProgress(0);
  spoorKlaar(`einde: ${geslaagd} van ${ketting.length} stappen gelukt`);
  bezig = false; tekenKetting();
  eindpakket = pakket; tekenLogboek();
  if (gebruik) $("eindresultaat").scrollIntoView({ block: "start", behavior: "smooth" });
  window.__pakket = pakket;
  if (archiefInstelling.aan && geslaagd) {
    try { const c = claudeInstelling; await bewaarSessie({ titel: `${receptVan()?.naam ?? ketting.map((k) => byId[k].naam).join(" → ")} · ${invoer.file ? basisnaam() : invoer.tekst.trim().slice(0, 40).replace(/\s+\S*$/, "").replace(/[.,;:!?]+$/, "") + "…"}`, ketting, invoer, uitkomsten, eindpakket: pakket, versie: VERSION, claude: ketting.some((id) => byId[id].extern) ? { model: c.model, context: c.context, sjabloon: c.sjabloon } : null }); tekenArchief(); }
    catch (e) { console.error("archief", e); setStatus(`${$("status").textContent} Bewaren in het archief lukte niet: ${e.message ?? e}`); }
  }
}

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
  if (p.stopwoorden) l.push(`${p.stopwoorden.length} stopwoordjes`);
  if (p.toon) l.push(p.toon.letOp ? "toon: let op" : "toon: in orde");
  if (p.gezichten) l.push(`${p.gezichten} gezichten vervaagd`);
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
  const ie = ketting.findIndex((id) => byId[id].extern);
  $("opnieuw-claude").style.display = !bezig && ie > 0 && uitkomsten.slice(0, ie).length === ie && uitkomsten.slice(0, ie).every((u) => u?.ok) ? "" : "none";
  $("opnieuw-claude").onclick = () => draai(ie);
  tekenEind();
  if (nieuwste != null && !gebruik) box.children[nieuwste]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}
/** Gebruikersscherm: alleen wat de ketting uiteindelijk opleverde. */
function tekenEind() {
  const box = $("eindresultaat"); if (!gebruik) return;
  box.replaceChildren(); box.className = "alleen-gebruik";
  const mis = uitkomsten.find((u) => u && !u.ok);
  if (mis) { const p = document.createElement("p"); p.className = "let-op"; p.textContent = `Gestopt bij ${byId[mis.id].naam}: ${mis.samenvatting}`; box.append(p); }
  if (bezig || !eindpakket) { if (!mis) { box.textContent = bezig ? "Bezig…" : "Nog niets gemaakt."; box.classList.add("small"); } return; }
  const i = uitkomsten.map((u, j) => (u?.ok ? j : -1)).filter((j) => j >= 0).pop(); if (i == null) return;
  const u = uitkomsten[i], m = byId[u.id], t = u.pakket.beoordeling ?? (m.out.includes("tekst") ? u.pakket.tekst : null);
  if (t != null && !u.pakket.passages) { const p = document.createElement("div"); p.className = "tekstblok eind"; p.innerHTML = md(t); box.append(p); }
  else { const oud = gekozenKraal; gekozenKraal = i; box.append(kaart(i)); gekozenKraal = oud; }
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
  if (d.stopwoorden) voeg("Stopwoordjes", tabel([["Aantal", d.stopwoorden.length], ["Per minuut", d.stopDuur ? (d.stopwoorden.length / (d.stopDuur / 60)).toFixed(1) : "–"], ...(open ? d.stopwoorden : d.stopwoorden.slice(0, 5)).map((f) => [fmt(f.start), `${(f.end - f.start).toFixed(2)} s · ${Math.round(f.confidence * 100)} %`]), ...(!open && d.stopwoorden.length > 5 ? [["…", `en nog ${d.stopwoorden.length - 5}`]] : [])]));
  if (d.toon) voeg("Toon", tabel([["Oordeel", d.toon.letOp ? `let op: ${d.toon.soort.join(", ")}` : "in orde"], ...(d.toon.doelwit.length ? [["Gericht op", d.toon.doelwit.join(", ")]] : []), ...d.toon.scores.map(([k, v]) => [k, `${Math.round(v * 100)} %`])]));
  if (d.gezichten != null) { voeg("", tabel([["Gezichten", d.gezichten || "geen gevonden; de foto gaat ongewijzigd door"]])); if (d.bewerktBeeld) { u.beeldUrl ??= URL.createObjectURL(d.bewerktBeeld); const im = document.createElement("img"); im.src = u.beeldUrl; im.className = "kaartbeeld"; const a = document.createElement("a"); a.href = u.beeldUrl; a.download = "gezichten-vervaagd.jpg"; a.textContent = "Bewerkte foto opslaan"; a.className = "small"; const w = document.createElement("div"); w.append(im, a); voeg("Bewerkte foto", w); } }
  if (d.onderwerpen) voeg("Onderwerpen", tabel(d.onderwerpen.map((t) => [t.name, `${Math.round(t.score * 100)} %`])));
  if (d.pgg) voeg(`Persoonsgegevens (${d.pgg.length})`, tabel((open ? d.pgg : d.pgg.slice(0, 5)).map((x) => [x.label, x.placeholder ?? x.original ?? ""]).concat(!open && d.pgg.length > 5 ? [["…", `en nog ${d.pgg.length - 5}`]] : [])));
  if (d.tags) voeg("Trefwoorden", tabel([["", d.tags.join(", ")]]));
  if (d.sprekers) voeg("Sprekers", tabel([["Aantal", d.sprekerAantal], ["Beurten", d.sprekers.length]]));
  if (d.nsfw != null) voeg("Geschikt om te delen?", tabel([["Oordeel", d.nsfw ? "liever niet" : "ja"], ["Score", `${Math.round(d.nsfwScore * 100)} %`]]));
  if (d.zekerheid != null && d.zekerheid < 70) { const w = document.createElement("p"); w.className = "let-op"; w.textContent = `Let op: de herkenning is onzeker (${d.zekerheid} %). Fotografeer recht van boven, met het stuk beeldvullend en scherp, bij gelijkmatig licht.`; voeg("", w); }
  if (d.passages) { voeg(`Gevonden passages, beste eerst · ${d.zoekmodel}`, tabel(d.passages.map((x, j) => [`[${j + 1}] passage ${x.nr} van ${x.van} · ${Math.round(x.score * 100)} %`, open ? x.tekst : x.tekst.slice(0, 160).replace(/\s+\S*$/, "") + (x.tekst.length > 160 ? "…" : "")]))); }
  else if (d.tekst != null && m.out.includes("tekst")) tekstblok(d.tekst, `${m.id === "redact" ? "Gemaskeerde tekst" : "Nieuwe tekst"}${d.delen > 1 ? ` · gemaakt in ${d.delen} delen` : ""}`);
  if (d.geknipt) voeg("Stopwoordjes weggeknipt", tabel([["Aantal", d.geknipt.aantal], ["Korter", `${d.geknipt.seconden.toFixed(1)} s (van ${fmt(d.geknipt.was)} naar ${fmt(d.geknipt.was - d.geknipt.seconden)})`], ["Knipgrenzen", d.geknipt.metWoorden ? "langs de woorden uit het transcript" : "zonder transcript; zet Transcriberen ervoor om geen woorden te raken"], ...(open ? d.geknipt.waar : d.geknipt.waar.slice(0, 5)).map((x) => [fmt(x.start), `${(x.end - x.start).toFixed(2)} s`]), ...(!open && d.geknipt.waar.length > 5 ? [["…", `en nog ${d.geknipt.waar.length - 5}`]] : [])]));
  if (d.geknipt && d.tekst != null) tekstblok(d.tekst, "Tekst zonder stopwoordjes");
  if (d.voorgelezen) {
    const w = document.createElement("div"); w.className = "row";
    const lees = document.createElement("button"); lees.textContent = "▶ Lees voor"; lees.onclick = (e) => { e.stopPropagation(); toestelstem(d.voorleestekst ?? "").catch((x) => setStatus(`Voorlezen mislukt: ${x.message}`)); };
    const stop = document.createElement("button"); stop.textContent = "■ Stop"; stop.onclick = (e) => { e.stopPropagation(); speechSynthesis.cancel(); };
    w.append(lees, stop); voeg(`Voorgelezen met de stem van dit toestel: ${d.voorgelezen.stem}${d.voorgelezen.lokaal ? "" : " (deze stem gebruikt mogelijk een online dienst van de fabrikant)"}`, w);
    const n = document.createElement("div"); n.className = "kreeg"; n.textContent = "Hoor je niets? Tik op Lees voor. De toestelstem levert geen geluidsbestand; kies Nathalie als je een wav wilt bewaren."; k.append(n);
  }
  if (d.spraak) { u.spraakUrl ??= URL.createObjectURL(d.spraak); const a = document.createElement("audio"); a.controls = true; a.src = u.spraakUrl; voeg("Spraak", a); }
  if (d.claude) { const w = document.createElement("div"); w.className = "kreeg"; w.textContent = `${d.claude.model} · ${d.claude.tin.toLocaleString("nl")} tokens in, ${d.claude.tuit.toLocaleString("nl")} uit · ongeveer $${d.claude.dollar.toFixed(d.claude.dollar < 0.1 ? 3 : 2)} · ${d.claude.bewaring} door Anthropic${d.claude.afgekapt ? " · het antwoord is afgekapt" : ""}`; k.append(w); }
  if (d.claude && PLAATSHOUDER.test(d.tekst ?? "")) { const w = document.createElement("div"); w.className = "kreeg"; w.textContent = "De namen staan hier nog als plaatshouder, zo kwam het verslag terug. De kraal Namen terugzetten vult ze in: bewaar het verslag vanaf die kaart."; k.append(w); }
  if (d.teruggezet != null) { const w = document.createElement("div"); w.className = "kreeg"; w.textContent = `${d.teruggezet} plaatshouders weer ingevuld, op dit toestel.${d.nietTerug ? ` ${d.nietTerug} plaatshouders staan er nog: die kwamen niet uit de maskering.` : ""}`; k.append(w); }
  if (d.uitgesneden || d.weggelaten) { const w = document.createElement("div"); w.className = "kreeg"; w.textContent = [d.uitgesneden ? "Alleen het tekstblok gelezen; wat eromheen stond is weggelaten." : "", d.weggelaten ? `${d.weggelaten} losse tekens aan de rand weggelaten.` : ""].filter(Boolean).join(" "); k.append(w); }
  if (open && d.ruw && (d.uitgesneden || d.weggelaten)) { const det = document.createElement("details"); det.innerHTML = `<summary>Wat de OCR op de hele foto las</summary>`; const p = document.createElement("div"); p.className = "tekstblok"; p.innerHTML = md(d.ruw); det.append(p); voeg("", det); }
  if (open && d.origineel) { const det = document.createElement("details"); det.innerHTML = `<summary>Wat deze kraal binnenkreeg</summary>`; const p = document.createElement("div"); p.className = "tekstblok"; p.innerHTML = md(d.origineel); det.append(p); voeg("", det); }
  if (open && i > 0 && !bezig) { const b = document.createElement("button"); b.className = "meer"; b.textContent = `Opnieuw vanaf deze stap`; b.title = "De stappen hiervoor blijven staan; handig na het aanpassen van het sjabloon of de context"; b.onclick = (e) => { e.stopPropagation(); draai(i); }; voeg("", b); }
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
const PLAATSHOUDER = /\[[A-Z_]+_\d+\]/;
/** Voetregel van Word en PDF: eerlijk over wat het toestel uit is gegaan. */
const herkomst = (tot) => { const u = uitkomsten.slice(0, tot + 1).filter((x) => x?.ok && byId[x.id].extern).pop(); if (!u) return undefined; const gemaskeerd = uitkomsten.slice(0, uitkomsten.indexOf(u)).some((x) => x?.ok && x.id === "redact"); return `verslag gemaakt door ${u.pakket.claude?.model ?? "Claude"} (Anthropic); daarvoor is ${gemaskeerd ? "de gemaskeerde tekst" : "de tekst, niet gemaskeerd,"} verstuurd`; };
$("bewaar-kraal").onclick = () => {
  const i = gekozenKraal ?? uitkomsten.map((u, j) => (u?.ok ? j : -1)).filter((j) => j >= 0).pop(); const u = uitkomsten[i]; if (!u) return;
  const m = byId[u.id], d = u.pakket, tekst = d.beoordeling ?? d.tekst ?? "";
  const md = [`# ${m.naam} — ${basisnaam()}`, "", `${new Date().toLocaleString("nl-NL")} · ${u.samenvatting} · ${VERSION}`, "", tekst].join("\n");
  const later = uitkomsten.findIndex((x, j) => j > i && x?.ok && x.id === "terugzetten");
  bewaar($("fmt").value, md, `${basisnaam()}__${m.id}`, herkomst(i)).then(() => { if (PLAATSHOUDER.test(tekst) && later >= 0) setStatus("Opgeslagen met plaatshouders. Voor de versie met namen: tik op de kaart Namen terugzetten en bewaar opnieuw."); }).catch((e) => setStatus(`Opslaan mislukt: ${e.message}`));
};
$("bewaar-verslag").onclick = () => bewaar($("fmt").value, verslagMd(), `${basisnaam()}__ketting`, herkomst(uitkomsten.length - 1)).catch((e) => setStatus(`Opslaan mislukt: ${e.message}`));

$("download").onclick = async () => {
  const zip = new JSZip(), basis = basisnaam();
  zip.file("verslag.md", verslagMd(zip, true));
  const blob = await zip.generateAsync({ type: "blob" }), a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${basis}__ketting.zip`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
};
const deel = async (url, wat) => { if (navigator.share) await navigator.share({ title: receptVan()?.naam ?? "Ketting", url }).catch(() => {}); else { await navigator.clipboard.writeText(url); setStatus(`${wat} gekopieerd.`); } };
$("deel").onclick = () => deel(link(true), "Gebruikerslink");
$("deel-studio").onclick = () => deel(link(false), "Studiolink");
$("wis").onclick = () => { ketting = []; uitkomsten = []; eindpakket = null; tekenKetting(); tekenLogboek(); bewaarHash(); };

// --- Spoor: liet de pagina het de vorige keer afweten? ------------------------------------------
(async () => {
  // Eerst: herlaadde de pagina zelf om geheugen vrij te maken? Dan de tussenstand terugzetten en verdergaan.
  const verder = await haalVervolg().catch(() => null);
  if (verder) {
    ketting = verder.ketting.filter((k) => byId[k]); invoer = { file: verder.invoer.file ?? null, tekst: verder.invoer.tekst ?? "", vraag: verder.invoer.vraag ?? "" };
    $("tekst").value = invoer.tekst; $("vraag").value = invoer.vraag;
    if (invoer.file) $("invoer-info").textContent = `${invoer.file.name} · ${grootte(invoer.file.size)} · ${SLEUTELS[soort(invoer.file)]}`;
    uitkomsten = verder.uitkomsten.map((u) => u && { ...u }); eindpakket = null; zetModus(); tekenKetting(); tekenLogboek();
    draai(verder.vanaf, { vervolg: true });
    return;
  }
  const v = vorigeKeer();
  if (v) {
    const tekst = spoorTekst(v), box = $("spoor");
    box.style.display = ""; $("spoor-tekst").textContent = tekst;
    $("spoor-laatste").textContent = v.regels.length ? v.regels[v.regels.length - 1][1] : "onbekend";
    $("spoor-deel").onclick = async () => { if (navigator.share) await navigator.share({ title: "AntBench-spoor", text: tekst }).catch(() => {}); else { await navigator.clipboard.writeText(tekst); setStatus("Spoor gekopieerd."); } };
    $("spoor-kopie").onclick = async () => { await navigator.clipboard.writeText(tekst); $("spoor-kopie").textContent = "Gekopieerd"; };
    $("spoor-sluit").onclick = () => { spoorWeg(); box.style.display = "none"; };
  }
})();
// --- Archief: sessies op dit toestel -----------------------------------------------------------
const dag = (t) => new Date(t).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
/** Knop die pas bij de tweede tik iets doet; geen dialoogvenster nodig. */
function zeker(knop, doe) { const tekst = knop.textContent; let klaar = false; knop.onclick = () => { if (klaar) { klaar = false; knop.textContent = tekst; knop.classList.remove("rec"); doe(); return; } klaar = true; knop.textContent = "Zeker? Tik nog eens"; knop.classList.add("rec"); setTimeout(() => { if (klaar) { klaar = false; knop.textContent = tekst; knop.classList.remove("rec"); } }, 4000); }; }
async function tekenArchief() {
  const box = $("archief-lijst"); let alle;
  try { alle = await lijst(); } catch (e) { box.textContent = `Het archief is op dit toestel niet beschikbaar (${e.message ?? e}).`; return; }
  $("archief-aantal").textContent = alle.length ? `${alle.length} ${alle.length === 1 ? "sessie" : "sessies"} · ${grootte(alle.reduce((s, x) => s + (x.bytes ?? 0), 0))}` : "leeg";
  box.replaceChildren();
  if (!alle.length) { box.textContent = "Nog geen sessies. Na elke run komt hij hier te staan."; return; }
  for (const s of alle) {
    const r = document.createElement("div"); r.className = "sessie";
    const eind = [...s.uitkomsten].reverse().find((u) => u?.ok);
    const t = document.createElement("div"); t.className = "wat"; t.innerHTML = `<b></b><span class="small"></span>`;
    t.firstChild.textContent = s.titel; t.lastChild.textContent = `${dag(s.datum)} · ${eind?.samenvatting ?? "niet afgemaakt"} · ${grootte(s.bytes ?? 0)}${s.invoer.nietBewaard ? " · zonder opname" : ""}`;
    const k = document.createElement("div"); k.className = "row";
    const o = document.createElement("button"); o.textContent = "Open"; o.onclick = () => openSessie(s.id);
    const z = document.createElement("button"); z.textContent = "ZIP"; z.title = "Deze sessie als bestand bewaren, als back-up of voor een ander toestel"; z.onclick = async () => { const a = document.createElement("a"); a.href = URL.createObjectURL(await alsZip(await haalSessie(s.id))); a.download = `sessie-${new Date(s.datum).toISOString().slice(0, 16).replace(/[:T]/g, "-")}.zip`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 60_000); };
    const w = document.createElement("button"); w.textContent = "Wis"; zeker(w, async () => { await wisSessie(s.id); tekenArchief(); });
    k.append(o, z, w); r.append(t, k); box.append(r);
  }
  const e = await ruimte(); if (e) $("archief-ruimte").textContent = `Opslag van deze site: ${grootte(e.gebruikt)} gebruikt${e.blijvend ? "" : "; de browser mag dit bij ruimtegebrek wissen, dus bewaar wat belangrijk is ook als ZIP"}.`;
}
/** Een bewaarde sessie terugzetten: ketting, invoer, alle stappen en het resultaat. */
async function openSessie(id) {
  if (bezig) return; const s = await haalSessie(id); if (!s) return;
  ketting = s.ketting.filter((k) => byId[k]); invoer = { file: s.invoer.file ?? null, tekst: s.invoer.tekst ?? "", vraag: s.invoer.vraag ?? "" };
  $("tekst").value = invoer.tekst; $("vraag").value = invoer.vraag;
  const a = $("preview-audio"), img = $("preview-beeld"); a.style.display = img.style.display = "none";
  if (invoer.file && soort(invoer.file) === "audio") { a.src = URL.createObjectURL(invoer.file); a.style.display = ""; }
  if (invoer.file && soort(invoer.file) === "beeld") { img.src = URL.createObjectURL(invoer.file); img.style.display = ""; }
  $("invoer-info").textContent = `sessie van ${dag(s.datum)}${invoer.file ? ` · ${invoer.file.name}` : s.invoer.nietBewaard ? " · opname niet bewaard" : ""}`;
  uitkomsten = s.uitkomsten.map((u) => u && { ...u }); eindpakket = s.eindpakket; gekozenKraal = null;
  history.replaceState(null, "", `#k=${ketting.join(",")}${gebruik ? "&u=1" : ""}`); zetModus();
  tekenKetting(); tekenLogboek();
  setStatus(`Sessie van ${dag(s.datum)} teruggehaald${s.versie && s.versie !== VERSION ? ` (gemaakt met ${s.versie})` : ""}.`);
  (gebruik ? $("eindresultaat") : $("uitkomst")).scrollIntoView({ block: "start", behavior: "smooth" });
}
$("archief-aan").checked = archiefInstelling.aan; $("archief-aan").onchange = (e) => zetArchief("aan", e.target.checked);
$("archief-audio").checked = archiefInstelling.audio; $("archief-audio").onchange = (e) => zetArchief("audio", e.target.checked);
$("archief-dagen").value = String(archiefInstelling.dagen); $("archief-dagen").onchange = async (e) => { zetArchief("dagen", Number(e.target.value)); await ruimOp(); tekenArchief(); };
$("archief-import").onclick = () => $("archief-file").click();
$("archief-file").onchange = async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; try { const s = await uitZip(f); await tekenArchief(); setStatus(`Sessie "${s.titel}" toegevoegd aan het archief.`); } catch (x) { setStatus(`Importeren mislukt: ${x.message ?? x}`); } };
zeker($("archief-wis"), async () => { await wisAlles(); tekenArchief(); setStatus("Het archief op dit toestel is leeg."); });
ruimOp().catch(() => 0).then((n) => { tekenArchief(); if (n) setStatus(`${n} ${n === 1 ? "sessie" : "sessies"} ouder dan ${archiefInstelling.dagen} dagen uit het archief verwijderd.`); });

for (const [id, naam] of Object.entries(STEMMEN)) $("stem").add(new Option(naam, id));
$("stem").value = stemInstelling.stem; $("stem").onchange = (e) => kiesStem(e.target.value);
$("zuinig").checked = geheugen.zuinig; $("zuinig").onchange = (e) => zetZuinig(e.target.checked);
// --- Instellingen --------------------------------------------------------------------------
$("llm").value = llmInstelling.maat; $("llm").onchange = (e) => kiesLlm(e.target.value); llmInstelling.luister = (m) => { $("llm").value = m; };
$("llm-info").textContent = `(${Object.entries(LLM_KEUZE).map(([k, v]) => `${k}: ${v.replace("-q4f16_1-MLC", "")}`).join(", ")}; ${navigator.gpu ? "WebGPU beschikbaar; klein is de standaard, normaal vraagt veel grafisch geheugen" : "geen WebGPU: taalmodel werkt hier niet"})`;

// --- Start ------------------------------------------------------------------------------------
$("rt").textContent = `${VERSION} · ${navigator.gpu ? "WebGPU beschikbaar" : "WASM (CPU)"}`;
tekenVoorraad(); tekenVerhalen(); laadHash(); zetModus(); tekenKetting(); tekenLogboek();
window.addEventListener("hashchange", () => { uitkomsten = []; eindpakket = null; laadHash(); zetModus(); tekenKetting(); tekenLogboek(); });
if ("serviceWorker" in navigator) navigator.serviceWorker.register(`${BASE}sw.js`).catch(() => {});
