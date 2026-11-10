// AntBench (web): alle browser-geschikte modellen van Desert Ant Labs, per
// modaliteit een tabblad. Inference draait lokaal (WebAssembly + LiteRT.js,
// Voz op ONNX Runtime Web); de server levert alleen statische bestanden.
import { $, BASE, VERSION } from "./ui.js";

$("rt").textContent = `${VERSION} · ${navigator.gpu ? "WebGPU beschikbaar" : "WASM (CPU)"}`;
import "./tekst.js";
import "./audio.js";
import "./beeld.js";
import "./tekenen.js";
import "./project.js";
import "./vergadering.js";


if ("serviceWorker" in navigator) navigator.serviceWorker.register(`${BASE}sw.js`).catch(() => {});
