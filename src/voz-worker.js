// Voz in een eigen worker: als die stopt, is ook de ±1,2 GB die het model vasthoudt weer vrij.
// Gebruikt op toestellen met weinig geheugen per tabblad (iPhone, iPad); zie geheugen.zuinig in engine.js.
import { Voz } from "@desert-ant-labs/voz";

self.onmessage = async ({ data }) => {
  const { samples, sampleRate, wasmDir } = data;
  try {
    const voz = await Voz.load({ wasmDir, ep: "auto", onProgress: (f) => self.postMessage({ t: "laden", f }) });
    const r = await voz.transcribe({ samples, sampleRate }, { onProgress: (f) => self.postMessage({ t: "voortgang", f }) });
    self.postMessage({ t: "klaar", text: r.text, words: r.words, samples }, [samples.buffer]);
  } catch (e) {
    const terug = samples.buffer.byteLength ? [samples.buffer] : [];
    self.postMessage({ t: "fout", m: String(e?.message ?? e), samples: terug.length ? samples : null }, terug);
  }
};
