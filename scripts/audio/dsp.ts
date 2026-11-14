// Tiny offline DSP toolkit used to synthesize every Slot Wars sound. No dependencies.
// All buffers are Float32Array at SR. Stereo is a pair of buffers.

export const SR = 44100;
export type Buf = Float32Array;
export interface Stereo {
  l: Buf;
  r: Buf;
}

export const secs = (s: number) => Math.round(s * SR);
export const buf = (sec: number): Buf => new Float32Array(secs(sec));
export const stereo = (sec: number): Stereo => ({ l: buf(sec), r: buf(sec) });
export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** Deterministic noise so every build renders identical files. */
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  };
}

export type Wave = 'sine' | 'square' | 'saw' | 'tri' | 'noise';
type Num = number | ((t: number) => number);
const val = (v: Num, t: number) => (typeof v === 'number' ? v : v(t));

/** Oscillator with time-varying frequency, amplitude envelope and optional duty / FM. */
export function osc(
  sec: number,
  o: { wave: Wave; freq: Num; amp?: Num; duty?: number; seed?: number; fm?: { ratio: number; index: Num } },
): Buf {
  const out = buf(sec);
  const noise = rng(o.seed ?? 7);
  let ph = 0, mph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const f = val(o.freq, t);
    let p = ph;
    if (o.fm) {
      mph += (f * o.fm.ratio) / SR;
      p += (val(o.fm.index, t) * Math.sin(2 * Math.PI * mph)) / (2 * Math.PI);
    }
    const x = p - Math.floor(p);
    let s = 0;
    switch (o.wave) {
      case 'sine': s = Math.sin(2 * Math.PI * x); break;
      case 'square': s = x < (o.duty ?? 0.5) ? 1 : -1; break;
      case 'saw': s = 2 * x - 1; break;
      case 'tri': s = 1 - 4 * Math.abs(x - 0.5); break;
      case 'noise': s = noise(); break;
    }
    out[i] = s * (o.amp === undefined ? 1 : val(o.amp, t));
    ph += f / SR;
  }
  return out;
}

// ---------- envelopes ----------
export const expDecay = (tau: number, delay = 0) => (t: number) => (t < delay ? 1 : Math.exp(-(t - delay) / tau));
export function adsr(a: number, d: number, s: number, r: number, hold: number) {
  return (t: number) => {
    if (t < a) return t / a;
    if (t < a + d) return 1 - ((t - a) / d) * (1 - s);
    if (t < hold) return s;
    return Math.max(0, s * (1 - (t - hold) / r));
  };
}
export const sweep = (from: number, to: number, dur: number, curve = 'exp') => (t: number) => {
  const k = Math.min(1, t / dur);
  return curve === 'exp' ? from * Math.pow(to / from, k) : from + (to - from) * k;
};
export const bell = (center: number, width: number) => (t: number) => Math.exp(-(((t - center) / width) ** 2));

// ---------- filters (RBJ biquads, coefficients refreshed every 16 samples) ----------
type FType = 'lp' | 'hp' | 'bp';
export function biquad(x: Buf, type: FType, cutoff: Num, q = 0.707): Buf {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
  for (let i = 0; i < x.length; i++) {
    if (i % 16 === 0) {
      const f = Math.min(Math.max(val(cutoff, i / SR), 20), SR * 0.45);
      const w = (2 * Math.PI * f) / SR, cs = Math.cos(w), al = Math.sin(w) / (2 * q);
      const a0 = 1 + al;
      if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; }
      else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; }
      else { b0 = al; b1 = 0; b2 = -al; }
      a1 = -2 * cs; a2 = 1 - al;
      b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
    }
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
    y[i] = v;
  }
  return y;
}
export const lp = (x: Buf, f: Num, q?: number) => biquad(x, 'lp', f, q);
export const hp = (x: Buf, f: Num, q?: number) => biquad(x, 'hp', f, q);
export const bp = (x: Buf, f: Num, q?: number) => biquad(x, 'bp', f, q);

// ---------- shaping ----------
export function gain(x: Buf, g: Num): Buf {
  for (let i = 0; i < x.length; i++) x[i] *= val(g, i / SR);
  return x;
}
export function drive(x: Buf, amount: number): Buf {
  const n = Math.tanh(amount);
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * amount) / n;
  return x;
}
/** Retro bit/sample-rate reduction for the pixel-era grit. */
export function crush(x: Buf, bits: number, hold = 1): Buf {
  const steps = Math.pow(2, bits - 1);
  let held = 0;
  for (let i = 0; i < x.length; i++) {
    if (i % hold === 0) held = Math.round(x[i] * steps) / steps;
    x[i] = held;
  }
  return x;
}
/** One-pole DC blocker (~20 Hz) so squares and asymmetric waves don't carry an offset. */
export function dcBlock(x: Buf): Buf {
  const R = 1 - (2 * Math.PI * 20) / SR;
  let px = 0, py = 0;
  for (let i = 0; i < x.length; i++) {
    const y = x[i] - px + R * py;
    px = x[i];
    py = y;
    x[i] = y;
  }
  return x;
}

export function fade(x: Buf, inSec: number, outSec: number): Buf {
  const a = secs(inSec), b = secs(outSec);
  for (let i = 0; i < a && i < x.length; i++) x[i] *= i / a;
  for (let i = 0; i < b && i < x.length; i++) x[x.length - 1 - i] *= i / b;
  return x;
}
export function normalize(x: Buf, peak = 0.9): Buf {
  let m = 0;
  for (const v of x) m = Math.max(m, Math.abs(v));
  return m ? gain(x, peak / m) : x;
}
export function normalizeStereo(s: Stereo, peak = 0.9): Stereo {
  let m = 0;
  for (const v of s.l) m = Math.max(m, Math.abs(v));
  for (const v of s.r) m = Math.max(m, Math.abs(v));
  if (m) { gain(s.l, peak / m); gain(s.r, peak / m); }
  return s;
}

// ---------- mixing ----------
export function mix(dst: Buf, src: Buf, at = 0, g = 1) {
  const o = secs(at);
  for (let i = 0; i < src.length && o + i < dst.length; i++) if (o + i >= 0) dst[o + i] += src[i] * g;
  return dst;
}
/** Equal-power pan, pan in [-1, 1]. */
export function mixPan(dst: Stereo, src: Buf, at = 0, g = 1, pan: Num = 0) {
  const o = secs(at);
  for (let i = 0; i < src.length && o + i < dst.l.length; i++) {
    if (o + i < 0) continue;
    const p = (val(pan, i / SR) + 1) * 0.25 * Math.PI;
    dst.l[o + i] += src[i] * g * Math.cos(p);
    dst.r[o + i] += src[i] * g * Math.sin(p);
  }
}
export function concat(...parts: Buf[]): Buf {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
export function add(...parts: Buf[]): Buf {
  const out = new Float32Array(Math.max(...parts.map((p) => p.length)));
  for (const p of parts) for (let i = 0; i < p.length; i++) out[i] += p[i];
  return out;
}

// ---------- time effects ----------
export function echo(x: Buf, time: number, fb: number, wet: number, tail = 0): Buf {
  const d = secs(time), n = x.length + secs(tail);
  const line = new Float32Array(n), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const inp = i < x.length ? x[i] : 0;
    const del = i >= d ? line[i - d] : 0;
    line[i] = inp + del * fb;
    out[i] = inp + del * wet;
  }
  return out;
}

/** Freeverb-style reverb (8 combs + 4 allpasses). `spread` offsets taps for a stereo pair. */
export function reverb(x: Buf, o: { room?: number; damp?: number; wet?: number; spread?: number; tail?: number } = {}): Buf {
  const room = o.room ?? 0.84, damp = o.damp ?? 0.3, wet = o.wet ?? 0.3, sp = o.spread ?? 0;
  const n = x.length + secs(o.tail ?? 2);
  const out = new Float32Array(n);
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((l) => ({ b: new Float32Array(l + sp), i: 0, s: 0 }));
  const aps = [556, 441, 341, 225].map((l) => ({ b: new Float32Array(l + sp), i: 0 }));
  for (let t = 0; t < n; t++) {
    const inp = (t < x.length ? x[t] : 0) * 0.015;
    let acc = 0;
    for (const c of combs) {
      const y = c.b[c.i];
      c.s = y * (1 - damp) + c.s * damp;
      c.b[c.i] = inp + c.s * room;
      c.i = (c.i + 1) % c.b.length;
      acc += y;
    }
    for (const a of aps) {
      const y = a.b[a.i];
      a.b[a.i] = acc + y * 0.5;
      a.i = (a.i + 1) % a.b.length;
      acc = y - acc;
    }
    out[t] = (t < x.length ? x[t] * (1 - wet * 0.5) : 0) + acc * wet * 3;
  }
  return out;
}

export function reverbStereo(s: Stereo, o: { room?: number; damp?: number; wet?: number; tail?: number } = {}): Stereo {
  return { l: reverb(s.l, { ...o, spread: 0 }), r: reverb(s.r, { ...o, spread: 23 }) };
}

/** Folds everything past `len` back onto the start so the loop point is seamless. */
export function wrapLoop(x: Buf, len: number): Buf {
  const out = x.slice(0, len);
  for (let i = len; i < x.length; i++) out[i % len] += x[i];
  return out;
}

// ---------- WAV output ----------
export function wav(channels: Buf[]): Uint8Array {
  const n = channels[0].length, ch = channels.length;
  const data = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o: number, s: string) => [...s].forEach((c, i) => data.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); data.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVEfmt ');
  data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, ch, true);
  data.setUint32(24, SR, true); data.setUint32(28, SR * ch * 2, true); data.setUint16(32, ch * 2, true); data.setUint16(34, 16, true);
  str(36, 'data'); data.setUint32(40, n * ch * 2, true);
  for (let i = 0; i < n; i++)
    for (let c = 0; c < ch; c++) data.setInt16(44 + (i * ch + c) * 2, Math.round(Math.max(-1, Math.min(1, channels[c][i])) * 32767), true);
  return new Uint8Array(data.buffer);
}
