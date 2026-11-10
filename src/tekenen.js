// Tekenen-tabblad: één haal op het canvas → Shapes maakt er een nette vorm van.
import { $, run, loadOptions, showResult, setStatus } from "./ui.js";

const canvas = $("draw-canvas"), ctx = canvas.getContext("2d");
let shapes = null, stroke = [], drawing = false;

function fit() {
  const r = canvas.getBoundingClientRect();
  if (r.width && (canvas.width !== Math.round(r.width) || canvas.height !== Math.round(r.height))) {
    canvas.width = Math.round(r.width); canvas.height = Math.round(r.height); clear();
  }
}
function clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); }
function pos(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
function style(color, width) { ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = "round"; ctx.lineJoin = "round"; }

canvas.addEventListener("pointerdown", (e) => {
  fit(); canvas.setPointerCapture(e.pointerId); drawing = true; stroke = [pos(e)]; clear();
  style("#8888", 3); ctx.beginPath(); ctx.moveTo(stroke[0].x, stroke[0].y);
});
canvas.addEventListener("pointermove", (e) => {
  if (!drawing) return; const p = pos(e); stroke.push(p); ctx.lineTo(p.x, p.y); ctx.stroke();
});
canvas.addEventListener("pointerup", async () => {
  if (!drawing) return; drawing = false;
  if (stroke.length < 8) return;
  await run("Shapes (vorm)", async () => {
    if (!shapes) { setStatus("Shapes: model laden (eerste keer)…"); shapes = (await (await import("@desert-ant-labs/shapes")).Shapes.load(loadOptions())); }
    const s = await shapes.recognize(stroke);
    if (!s) { showResult("Geen vorm herkend."); return; }
    drawShape(s);
    showResult(`${s.kind} (${(s.confidence * 100).toFixed(0)}%)`);
  });
});
$("draw-clear").onclick = () => { fit(); clear(); stroke = []; };
new ResizeObserver(fit).observe(canvas);

function drawShape(s) {
  style("#1f2a44", 4); ctx.beginPath();
  const poly = (pts, close = true) => { pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); if (close) ctx.closePath(); };
  switch (s.kind) {
    case "line": ctx.moveTo(s.from.x, s.from.y); ctx.lineTo(s.to.x, s.to.y); break;
    case "arrow": ctx.moveTo(s.from.x, s.from.y); ctx.lineTo(s.to.x, s.to.y); head(s.from, s.to, s.endHead); head(s.to, s.from, s.startHead); break;
    case "curve": ctx.moveTo(s.from.x, s.from.y); s.control ? ctx.quadraticCurveTo(s.control.x, s.control.y, s.to.x, s.to.y) : ctx.lineTo(s.to.x, s.to.y); break;
    case "rectangle": poly(s.corners); break;
    case "triangle": case "diamond": case "pentagon": case "hexagon": poly(s.vertices); break;
    case "ellipse": ctx.ellipse(s.center.x, s.center.y, s.semiMajor, s.semiMinor, s.rotation, 0, Math.PI * 2); break;
    case "star": { const pts = []; for (let i = 0; i < s.pointCount * 2; i++) { const r = i % 2 ? s.innerRadius : s.outerRadius, a = s.rotation + (i * Math.PI) / s.pointCount; pts.push({ x: s.center.x + r * Math.cos(a), y: s.center.y + r * Math.sin(a) }); } poly(pts); break; }
    case "heart": { const { x, y } = s.center, w = s.width / 2, h = s.height / 2; ctx.moveTo(x, y + h); ctx.bezierCurveTo(x - w * 1.4, y - h * .2, x - w * .6, y - h * 1.3, x, y - h * .4); ctx.bezierCurveTo(x + w * .6, y - h * 1.3, x + w * 1.4, y - h * .2, x, y + h); break; }
    default: if (s.outline) poly(s.outline); else if (s.hull) poly(s.hull);
  }
  ctx.stroke();
}
function head(from, to, on) {
  if (!on) return; const a = Math.atan2(to.y - from.y, to.x - from.x), L = 16;
  ctx.moveTo(to.x, to.y); ctx.lineTo(to.x - L * Math.cos(a - .5), to.y - L * Math.sin(a - .5));
  ctx.moveTo(to.x, to.y); ctx.lineTo(to.x - L * Math.cos(a + .5), to.y - L * Math.sin(a + .5));
}
