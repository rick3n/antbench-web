// Voz in een eigen worker: als die stopt, is ook de ±1,2 GB die het model vasthoudt weer vrij.
// Gebruikt op toestellen met weinig geheugen per tabblad (iPhone, iPad); zie geheugen.zuinig in engine.js.
import { Voz } from "@desert-ant-labs/voz";

self.onmessage = async ({ data }) => {
  const { samples, sampleRate, wasmDir } = data;
  const meld = (m) => self.postMessage({ t: "info", m });
  try {
    let gpu = "nee";
    try { const a = await self.navigator.gpu?.requestAdapter(); gpu = a ? `ja, shader-f16 ${a.features.has("shader-f16") ? "ja" : "nee"}` : self.navigator.gpu ? "geen adapter" : "nee"; } catch (e) { gpu = `fout: ${e.message}`; }
    meld(`worker draait; WebGPU in worker: ${gpu}`);
    const voz = await Voz.load({ wasmDir, ep: "auto", onProgress: (f) => self.postMessage({ t: "laden", f }) });
    meld("model geladen; transcriberen begint");
    const r = await voz.transcribe({ samples, sampleRate }, { onProgress: (f) => self.postMessage({ t: "voortgang", f }) });
    self.postMessage({ t: "klaar", text: r.text, words: r.words, samples }, [samples.buffer]);
  } catch (e) {
    const terug = samples.buffer.byteLength ? [samples.buffer] : [];
    self.postMessage({ t: "fout", m: String(e?.message ?? e), samples: terug.length ? samples : null }, terug);
  }
};
