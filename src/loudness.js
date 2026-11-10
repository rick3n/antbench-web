// Integrated loudness (LUFS) volgens ITU-R BS.1770-4 / EBU R128 voor mono:
// K-weighting (shelving + hoogdoorlaat), 400 ms-blokken met 75 % overlap,
// absolute gate op −70 LUFS en relatieve gate op −10 LU. Om de output van
// Clear te kunnen meten — de SDK rapporteert alleen de loudness van de input.

function biquad(b0, b1, b2, a1, a2) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => { const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
}

/** K-weightingfilters voor een willekeurige samplerate (bilineaire herafleiding, zoals libebur128). */
function kWeighting(fs) {
  // Trap 1: high shelf (+4 dB boven ~1,5 kHz)
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan(Math.PI * f0 / fs), Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const s1 = biquad((Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0);
  // Trap 2: hoogdoorlaat (RLB) rond 38 Hz
  f0 = 38.13547087602444; Q = 0.5003270373238773; K = Math.tan(Math.PI * f0 / fs);
  a0 = 1 + K / Q + K * K;
  const s2 = biquad(1 / a0, -2 / a0, 1 / a0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0);
  return (x) => s2(s1(x));
}

/** Integrated loudness in LUFS, of null bij stilte. Geheugenarm: alleen hop-sommen. */
export function integratedLufs(samples, sampleRate) {
  const filt = kWeighting(sampleRate);
  const hop = Math.round(0.1 * sampleRate), block = 4 * hop;   // 400 ms, 75 % overlap
  if (samples.length < block) return null;
  // energie per hop van het gewogen signaal; een blok is de som van vier opeenvolgende hops
  const hops = new Float64Array(Math.floor(samples.length / hop));
  for (let h = 0; h < hops.length; h++) {
    let acc = 0; const end = (h + 1) * hop;
    for (let i = h * hop; i < end; i++) { const y = filt(samples[i]); acc += y * y; }
    hops[h] = acc;
  }
  const lk = (z) => -0.691 + 10 * Math.log10(z);
  const blocks = [];
  for (let h = 0; h + 4 <= hops.length; h++) blocks.push((hops[h] + hops[h + 1] + hops[h + 2] + hops[h + 3]) / block);
  const abs = blocks.filter((z) => lk(z) > -70);
  if (!abs.length) return null;
  const rel = lk(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const gated = abs.filter((z) => lk(z) > rel);
  if (!gated.length) return null;
  return lk(gated.reduce((a, b) => a + b, 0) / gated.length);
}
