// Tekenen-tabblad: een of meer halen op het canvas → Shapes maakt er een nette vorm van.
// Shapes 2 (SDK 5.0) leest ook vormen uit meerdere halen en zes tekens (vinkje, kruis, plus, haak, zigzag, krabbel).
import { $, run, loadOptions, showResult, setStatus } from "./ui.js";

const canvas = $("draw-canvas"), ctx = canvas.getContext("2d");
let shapes = null, halen = [], haal = null, wacht = null;
const PAUZE = 800;   // ms stil na de laatste haal voordat er herkend wordt
const NAAM = { line: "lijn", curve: "boog", arrow: "pijl", rectangle: "rechthoek", ellipse: "ellips", triangle: "driehoek", diamond: "ruit", pentagon: "vijfhoek", hexagon: "zeshoek",
  star: "ster", heart: "hart", cloud: "wolk", check: "vinkje", cross: "kruis", plus: "plus", bracket: "haak", zigzag: "zigzag", scribble: "krabbel" };

function fit() {
  const r = canvas.getBoundingClientRect();
  if (r.width && (canvas.width !== Math.round(r.width) || canvas.height !== Math.round(r.height))) {
    canvas.width = Math.round(r.width); canvas.height = Math.round(r.height); wis();
  }
}
function wis() { ctx.clearRect(0, 0, canvas.width, canvas.height); }
function pos(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
function stijl(kleur, breedte) { ctx.strokeStyle = kleur; ctx.lineWidth = breedte; ctx.lineCap = "round"; ctx.lineJoin = "round"; }
function lijn(pts, dicht = false) { if (!pts?.length) return; ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); if (dicht) ctx.closePath(); ctx.stroke(); }

canvas.addEventListener("pointerdown", (e) => {
  fit(); clearTimeout(wacht); canvas.setPointerCapture(e.pointerId);
  if (!halen.length) wis();                       // nieuwe tekening: vorige vorm weg
  haal = [pos(e)]; stijl("#8888", 3); ctx.beginPath(); ctx.moveTo(haal[0].x, haal[0].y);
});
canvas.addEventListener("pointermove", (e) => {
  if (!haal) return; const p = pos(e); haal.push(p); ctx.lineTo(p.x, p.y); ctx.stroke();
});
const klaar = () => {
  if (!haal) return;
  if (haal.length >= 3) halen.push({ points: haal });
  haal = null; clearTimeout(wacht);
  if (halen.length) wacht = setTimeout(herken, PAUZE);
};
canvas.addEventListener("pointerup", klaar); canvas.addEventListener("pointercancel", klaar);

async function herken() {
  const invoer = halen; halen = [];
  if (invoer.reduce((n, h) => n + h.points.length, 0) < 8) return;
  await run("Shapes (vorm)", async () => {
    if (!shapes) { setStatus("Shapes: model laden (eerste keer)…"); shapes = await (await import("@desert-ant-labs/shapes")).Shapes.load(loadOptions()); }
    const s = await shapes.recognize(invoer);
    if (!s) { showResult(`Geen vorm herkend (${invoer.length} ${invoer.length === 1 ? "haal" : "halen"}); de tekening blijft staan.`); return; }
    wis(); stijl("#1f2a44", 4);
    // Elke vorm brengt zijn eigen tekenpaden mee; een krabbel tekenen we als zijn omhullende.
    if (s.kind === "scribble") { stijl("#b3261e", 3); lijn(s.hull, true); }
    else for (const pad of s.paths ?? [s.outline]) lijn(pad);
    if (s.kind === "arrow") pijlpunten(s);
    showResult(`${NAAM[s.kind] ?? s.kind} · uit ${invoer.length} ${invoer.length === 1 ? "haal" : "halen"}`);
  });
}
function pijlpunten(s) {
  const punt = (naar, vanaf) => { const a = Math.atan2(naar.y - vanaf.y, naar.x - vanaf.x), L = 16; ctx.beginPath();
    ctx.moveTo(naar.x - L * Math.cos(a - .5), naar.y - L * Math.sin(a - .5)); ctx.lineTo(naar.x, naar.y); ctx.lineTo(naar.x - L * Math.cos(a + .5), naar.y - L * Math.sin(a + .5)); ctx.stroke(); };
  if (s.endHead) punt(s.to, s.control2 ?? s.from);
  if (s.startHead) punt(s.from, s.control1 ?? s.to);
}
$("draw-clear").onclick = () => { fit(); clearTimeout(wacht); wis(); halen = []; haal = null; };
new ResizeObserver(fit).observe(canvas);
