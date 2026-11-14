// Sanity report for rendered audio: peak, RMS, DC offset, clipping, loop-seam jump.
import { SFX, renderSfx } from './sfx.ts';
import { AMBIENCE, MUSIC } from './music.ts';

function stats(x: Float32Array) {
  let peak = 0, sum = 0, dc = 0, clip = 0;
  for (const v of x) { peak = Math.max(peak, Math.abs(v)); sum += v * v; dc += v; if (Math.abs(v) >= 0.999) clip++; }
  return { peak, rms: Math.sqrt(sum / x.length), dc: dc / x.length, clip };
}
/** Jump from the last sample to the first, relative to the typical step around the seam (1 = invisible). */
function seam(x: Float32Array) {
  const n = x.length, w = 32;
  let local = 0;
  for (let i = 1; i <= w; i++) local += Math.abs(x[i] - x[i - 1]) + Math.abs(x[n - i] - x[n - i - 1]);
  local /= 2 * w;
  return Math.abs(x[0] - x[n - 1]) / (local || 1e-9);
}
const db = (v: number) => (20 * Math.log10(v || 1e-9)).toFixed(1);
for (const n of Object.keys(SFX)) {
  const s = stats(renderSfx(n));
  console.log(`${n.padEnd(18)} peak ${db(s.peak)}dB rms ${db(s.rms)}dB dc ${s.dc.toFixed(4)} clip ${s.clip}`);
}
for (const [n, fn] of [...Object.entries(MUSIC), ...Object.entries(AMBIENCE)]) {
  const r = fn();
  const s = stats(r.data.l);
  console.log(`${n.padEnd(18)} peak ${db(s.peak)}dB rms ${db(s.rms)}dB dc ${s.dc.toFixed(4)} clip ${s.clip} seam L ${seam(r.data.l).toFixed(2)} R ${seam(r.data.r).toFixed(2)}`);
}
