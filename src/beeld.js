// Beeld-tabblad: foto uit camera of bestand → Eye (analyse) en Moderator (NSFW).
import { $, run, showResult, table, setStatus } from "./ui.js";
import { model, imageToPixels, moderation } from "./engine.js";

const canvas = $("image-canvas"), ctx = canvas.getContext("2d");
let pixels = null;          // { data, width, height } van de huidige foto

const actions = {
  eye: async () => {
    const a = await (await model("eye")).analyze(pixels);
    const tags = a.tags().slice(0, 12);
    const rows = [["Soort", a.kind ?? "–"], ["Tags", tags.join(", ") || "–"]];
    if (a.scores) rows.push(["Esthetiek", a.scores.aesthetic], ["Bewaarder", a.scores.keeper], ["Omslag", a.scores.cover]);
    rows.push(["Mensen", a.people?.length ?? 0], ["Gezichten", a.faces?.length ?? 0], ["Dieren", a.pets?.length ?? 0]);
    if (a.rotation) rows.push(["Draaien", `${a.rotation}°`]);
    drawBoxes(a.people ?? [], "#2a7", a.faces ?? [], "#f90");
    showResult(`${a.kind ?? "foto"}: ${tags.join(", ")}`, table(rows));
  },
  moderator: async () => {
    const m = await (await model("moderator")).analyze(pixels, moderation);
    // score = hoogste regio-score (SDK); isNSFW = score ≥ drempel
    const rows = [["NSFW", `${m.isNSFW ? "JA" : "nee"} (drempel ${moderation.threshold}${moderation.policy === "allowTopless" ? ", bloot bovenlijf toegestaan" : ""})`], ["Score (= hoogste regio)", m.score]];
    for (const [k, v] of Object.entries(m.regions ?? {})) rows.push([k, v]);
    showResult(`NSFW: ${m.isNSFW ? "ja" : "nee"} (${(m.score * 100).toFixed(0)}%, drempel ${moderation.threshold})`, table(rows));
  },
};
const labels = { eye: "Eye (analyse)", moderator: "Moderator (NSFW)" };
$("mod-threshold").onchange = (e) => { moderation.threshold = Number(e.target.value); };
$("mod-topless").onchange = (e) => { moderation.policy = e.target.checked ? "allowTopless" : "standard"; };
for (const b of document.querySelectorAll("#tab-beeld button.run"))
  b.onclick = () => { if (!pixels) return setStatus("Eerst een foto kiezen of maken."); run(labels[b.dataset.model], actions[b.dataset.model]); };

// --- Invoer: bestand of camera (op mobiel opent accept+capture de camera-app) -----

$("image-pick").onclick = () => { const f = $("image-file"); f.removeAttribute("capture"); f.click(); };
$("cam").onclick = () => { const f = $("image-file"); f.setAttribute("capture", "environment"); f.click(); };
$("image-file").onchange = async (ev) => {
  const f = ev.target.files?.[0]; if (!f) return;
  try { await setImage(f); setStatus(`Foto geladen: ${f.name || "camera"} (${pixels.width}×${pixels.height})`); }
  catch (e) { setStatus(`Foto lezen mislukt: ${e.message}`); }
  ev.target.value = "";
};

async function setImage(file) {
  const px = await imageToPixels(file);
  canvas.width = px.width; canvas.height = px.height; ctx.drawImage(px.canvas, 0, 0);
  pixels = { data: px.data, width: px.width, height: px.height };
  $("image-info").textContent = `${pixels.width}×${pixels.height}`;
}

function drawBoxes(a, colorA, b, colorB) {
  ctx.putImageData(new ImageData(pixels.data, pixels.width, pixels.height), 0, 0);
  const draw = (items, color) => {
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(2, canvas.width / 300);
    for (const d of items) { const { x, y, width, height } = norm(d.box); ctx.strokeRect(x, y, width, height); }
  };
  draw(a, colorA); draw(b, colorB);
}
// Box-coördinaten kunnen pixels of fracties zijn; schaal fracties naar het canvas.
function norm(box) {
  const f = box.width <= 1 && box.height <= 1 ? { x: canvas.width, y: canvas.height } : { x: 1, y: 1 };
  return { x: box.x * f.x, y: box.y * f.y, width: box.width * f.x, height: box.height * f.y };
}
