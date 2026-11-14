// Music loops and ambience beds. Each track is sequenced in bars, rendered with a reverb tail,
// then the tail is folded back onto the start so the loop restarts without a seam.
import {
  add, adsr, bell, bp, buf, dcBlock, drive, echo, expDecay, gain, hp, lp, mixPan, mtof, normalizeStereo, osc, reverbStereo, rng, secs,
  stereo, sweep, wrapLoop, type Buf, type Stereo,
} from './dsp.ts';

// ---------- instruments ----------
const kick = (punch = 1, dist = 1.2): Buf =>
  drive(add(osc(0.45, { wave: 'sine', freq: sweep(160, 44, 0.09), amp: expDecay(0.16) }), gain(hp(osc(0.01, { wave: 'noise', freq: 0, amp: expDecay(0.002) }), 2000), 0.4 * punch)), dist);
const snare = (seed = 5): Buf =>
  add(gain(bp(osc(0.25, { wave: 'noise', freq: 0, seed, amp: expDecay(0.06) }), 2000, 0.8), 0.9), gain(osc(0.2, { wave: 'tri', freq: sweep(240, 170, 0.05), amp: expDecay(0.04) }), 0.6));
const hat = (open = false, seed = 9): Buf => hp(osc(open ? 0.3 : 0.06, { wave: 'noise', freq: 0, seed, amp: expDecay(open ? 0.09 : 0.015) }), 7500);
const metalTick = (f = 3200): Buf => hp(osc(0.08, { wave: 'sine', freq: f, fm: { ratio: 2.76, index: 5 }, amp: expDecay(0.02) }), 2000);
const clank = (f = 340, decay = 0.25): Buf =>
  add(osc(0.6, { wave: 'sine', freq: f, fm: { ratio: 2.76, index: (t) => 7 * Math.exp(-t / 0.08) }, amp: expDecay(decay) }), gain(lp(osc(0.05, { wave: 'noise', freq: 0, amp: expDecay(0.01) }), 3000), 0.5));
const piston = (): Buf =>
  drive(add(gain(lp(osc(0.3, { wave: 'noise', freq: 0, seed: 17, amp: expDecay(0.07) }), 1400), 1.2), osc(0.3, { wave: 'sine', freq: sweep(120, 60, 0.08), amp: expDecay(0.08) })), 1.8);
const steam = (dur: number): Buf => bp(osc(dur, { wave: 'noise', freq: 0, seed: 23, amp: adsr(0.05, 0.3, 0.5, dur * 0.5, dur * 0.4) }), sweep(5000, 2500, dur), 1.2);

function bass(note: number, dur: number, wave: 'saw' | 'square' = 'saw', cut = 900, distort = 0): Buf {
  const x = add(osc(dur, { wave, freq: mtof(note), duty: 0.5 }), gain(osc(dur, { wave: 'sine', freq: mtof(note - 12) }), 0.6));
  const y = lp(gain(x, adsr(0.005, 0.08, 0.7, 0.05, dur - 0.05)), (t) => 120 + cut * Math.exp(-t / 0.12), 2);
  return distort ? drive(y, distort) : y;
}
const pluck = (note: number, dur: number, bright = 3000, duty = 0.25): Buf =>
  lp(osc(dur, { wave: 'square', freq: mtof(note), duty, amp: expDecay(dur * 0.35) }), (t) => 400 + bright * Math.exp(-t / 0.08));
const bellTone = (note: number, dur: number, ratio = 3.5): Buf =>
  osc(dur, { wave: 'sine', freq: mtof(note), fm: { ratio, index: (t) => 3 * Math.exp(-t / 0.3) }, amp: expDecay(dur * 0.4) });

function pad(notes: number[], dur: number, cut = 1000, detune = 0.006, seed = 1): Stereo {
  const r = rng(seed);
  const out = stereo(dur);
  for (const n of notes)
    for (const [pan, dt] of [[-0.6, -detune], [0.6, detune], [0, 0]] as const) {
      const f = mtof(n) * (1 + dt + r() * 0.001);
      const v = osc(dur, { wave: 'saw', freq: f, amp: adsr(Math.min(0.8, dur * 0.3), 0.4, 0.8, Math.min(1.2, dur * 0.3), dur * 0.7) });
      mixPan(out, lp(v, (t) => cut * (1 + 0.3 * Math.sin(t * 1.3 + seed))), 0, 0.12 / notes.length, pan);
    }
  return out;
}
const addStereo = (dst: Stereo, src: Stereo, at: number, g = 1) => {
  mixPan(dst, src.l, at, g, -1);
  mixPan(dst, src.r, at, g, 1);
};

export interface Rendered {
  data: Stereo;
  seconds: number;
}

function finish(out: Stereo, loopSec: number, rev: { wet: number; room?: number }, peak = 0.82): Rendered {
  const wet = reverbStereo(out, { ...rev, tail: 0 });
  const len = secs(loopSec);
  // DC-block before wrapping: the filter's own settling then also loops cleanly
  const l = wrapLoop(dcBlock(wet.l), len), r = wrapLoop(dcBlock(wet.r), len);
  return { data: normalizeStereo({ l, r }, peak), seconds: loopSec };
}

// ---------- Main menu: "Neon Skyline" (A minor, 92 BPM, 16 bars) ----------
export function menuTheme(): Rendered {
  const bpm = 92, B = 60 / bpm, bar = 4 * B, bars = 16, loop = bars * bar;
  const out = stereo(loop + 6);
  const chords = [[57, 60, 64, 71], [53, 57, 60, 64], [48, 55, 60, 64], [55, 59, 62, 67], [57, 60, 64, 71], [53, 57, 60, 64], [50, 57, 62, 65], [52, 56, 59, 64]];
  chords.forEach((ch, i) => {
    const t = i * 2 * bar;
    addStereo(out, pad(ch, 2 * bar + 1.2, 1100, 0.006, i + 1), t, 1.0);
    for (let k = 0; k < 2; k++) mixPan(out, gain(bass(ch[0] - 24, bar * 0.95, 'tri', 300), 0.5), t + k * bar, 0.55, 0);
    const arp = [...ch, ch[1] + 12, ch[2] + 12, ch[3] + 12, ch[2] + 12].map((n) => n + 12);
    for (let s = 0; s < 16; s++) {
      const n = arp[s % arp.length];
      mixPan(out, echo(pluck(n, B * 0.45, 1800, 0.125), B * 0.75, 0.35, 0.35, 0), t + s * (B / 2), 0.11, s % 2 ? 0.45 : -0.45);
    }
  });
  for (let b = 0; b < bars; b++) {
    const t = b * bar;
    mixPan(out, kick(0.4, 1), t, 0.33);
    mixPan(out, kick(0.4, 1), t + 2.5 * B, 0.22);
    for (let k = 0; k < 4; k++) mixPan(out, hat(false, 9 + k), t + k * B + B / 2, b >= 8 ? 0.06 : 0.035, 0.3);
    if (b % 4 === 3) mixPan(out, hat(true, 31), t + 3.5 * B, 0.05, -0.3);
  }
  const melody: [number, number, number][] = [[8, 0, 76], [8, 1.5, 74], [8, 3, 72], [9, 2, 71], [10, 0, 72], [10, 2, 76], [11, 0, 79], [12, 0, 81], [12, 2, 79], [13, 1, 76], [14, 0, 74], [14, 2, 72], [15, 0, 71], [15, 2, 68]];
  for (const [b, beat, n] of melody) mixPan(out, echo(bellTone(n, 2.2, 3.01), B * 1.5, 0.4, 0.4, 0), b * bar + beat * B, 0.16, 0.15);
  return finish(out, loop, { wet: 0.42, room: 0.88 });
}

// ---------- Main battlefield: "Grid Command" (D minor, 116 BPM, 16 bars) ----------
export function mainTheme(): Rendered {
  const bpm = 116, B = 60 / bpm, bar = 4 * B, bars = 16, loop = bars * bar, st = B / 4;
  const out = stereo(loop + 6);
  const prog = [
    { root: 38, ch: [62, 65, 69] },
    { root: 34, ch: [58, 62, 65] },
    { root: 41, ch: [60, 65, 69] },
    { root: 36, ch: [60, 64, 67] },
  ];
  for (let b = 0; b < bars; b++) {
    const t = b * bar, { root, ch } = prog[b % 4];
    addStereo(out, pad(ch, bar + 0.6, 900, 0.005, b + 3), t, 0.55);
    const bl = [0, 0, 12, 0, 0, 12, 0, 7];
    bl.forEach((iv, k) => mixPan(out, bass(root + iv, B * 0.45, 'saw', 700), t + k * (B / 2), 0.32, 0));
    for (let s = 0; s < 16; s++) {
      const n = ch[s % 3] + (s % 6 < 3 ? 12 : 24);
      const cut = 900 + 1700 * (0.5 + 0.5 * Math.sin((b * 16 + s) * 0.05));
      mixPan(out, pluck(n, st * 1.6, cut), t + s * st, 0.085, Math.sin(s * 0.8) * 0.5);
    }
    for (const s of [0, 6, 8, 14]) if (s !== 14 || b % 2) mixPan(out, kick(0.8, 1.4), t + s * st, 0.42);
    for (const s of [4, 12]) mixPan(out, snare(5 + b), t + s * st, 0.2, 0.05);
    for (let s = 0; s < 16; s += 2) mixPan(out, hat(false, 40 + s), t + s * st, s % 4 === 2 ? 0.07 : 0.04, 0.35);
    if (b >= 8) for (let s = 1; s < 16; s += 4) mixPan(out, hat(false, 60 + s), t + s * st, 0.025, -0.35);
  }
  const motif: [number, number, number][] = [[0, 0, 69], [0, 1.5, 72], [0, 3, 74], [1, 0, 72], [1, 2, 70], [2, 0, 69], [2, 2, 65], [3, 0, 67], [3, 2, 64]];
  for (const start of [4, 12])
    for (const [db, beat, n] of motif) {
      const lead = lp(osc(B * 1.4, { wave: 'square', duty: 0.3, freq: (t) => mtof(n) * (1 + 0.004 * Math.sin(t * 34)), amp: adsr(0.02, 0.15, 0.6, 0.2, B) }), 2600);
      mixPan(out, echo(lead, B * 0.75, 0.3, 0.3, 0), (start + db) * bar + beat * B, 0.1, -0.15);
    }
  return finish(out, loop, { wet: 0.26, room: 0.8 });
}

// ---------- Industrial Dimension: "Foundry Protocol" (E phrygian, 100 BPM, 16 bars) ----------
export function industrialTheme(): Rendered {
  const bpm = 100, B = 60 / bpm, bar = 4 * B, bars = 16, loop = bars * bar, st = B / 4;
  const out = stereo(loop + 6);
  const drone = add(osc(loop + 1, { wave: 'saw', freq: mtof(28) }), gain(osc(loop + 1, { wave: 'saw', freq: mtof(35) * 1.002 }), 0.6));
  mixPan(out, lp(drone, (t) => 180 + 120 * Math.sin(t * 0.4)), 0, 0.22, 0);
  const pattern = [0, 0, 12, 0, 1, 0, 12, 0, 0, 0, 3, 0, 1, 0, 12, 1];
  for (let b = 0; b < bars; b++) {
    const t = b * bar, shift = b % 4 === 3 ? 1 : 0;
    const chord = b % 4 < 2 ? [52, 55, 59] : [53, 57, 60];
    addStereo(out, pad(chord, bar + 0.8, 650, 0.008, b + 11), t, 0.5);
    pattern.forEach((iv, s) => {
      if (s % 2 && iv === 0 && b % 2 === 0) return;
      mixPan(out, bass(28 + iv + shift, st * 0.9, 'saw', 1100, 2.2), t + s * st, 0.2, 0);
    });
    for (let k = 0; k < 4; k++) mixPan(out, kick(1, 2.2), t + k * B, 0.4);
    for (const k of [1, 3]) mixPan(out, piston(), t + k * B, 0.3, 0.1);
    for (let s = 0; s < 16; s += 2) mixPan(out, metalTick(2600 + (s % 4) * 400), t + s * st + st, 0.05, s % 4 ? 0.4 : -0.4);
    for (const [s, f] of [[3, 330], [10, 470], [13, 260]] as const) if ((b + s) % 3 !== 0) mixPan(out, clank(f, 0.2), t + s * st, 0.07, s % 2 ? -0.6 : 0.6);
    if (b % 4 === 3) mixPan(out, steam(1.4), t + 2.5 * B, 0.09, -0.5);
  }
  const motif: [number, number, number][] = [[8, 0, 76], [8, 2, 77], [9, 0, 79], [9, 3, 77], [10, 0, 76], [11, 0, 74], [11, 2, 77], [12, 0, 76], [13, 0, 77], [13, 2, 79], [14, 0, 81], [15, 0, 79], [15, 2, 77]];
  for (const [b, beat, n] of motif) mixPan(out, echo(bellTone(n, 1.4, 1.41), B * 0.75, 0.35, 0.35, 0), b * bar + beat * B, 0.11, 0.2);
  return finish(out, loop, { wet: 0.3, room: 0.86 });
}

// ---------- Ambience ----------
/** Distant city of 2100: wind and traffic bed, hover cars passing, electronic chirps, far machinery. */
export function cityAmbience(): Rendered {
  const loop = 24;
  const out = stereo(loop + 4);
  const r = rng(77);
  for (const [pan, seed] of [[-0.7, 1], [0.7, 2]] as const) {
    const bed = lp(osc(loop + 2, { wave: 'noise', freq: 0, seed, amp: (t) => 0.7 + 0.3 * Math.sin(t * 0.33 + seed) }), 380);
    mixPan(out, bed, 0, 0.6, pan);
    mixPan(out, bp(osc(loop + 2, { wave: 'noise', freq: 0, seed: seed + 10 }), 180, 0.8), 0, 0.25, pan);
  }
  for (const [at, dir, pitch] of [[1.5, 1, 1], [7.2, -1, 1.3], [12.8, 1, 0.8], [18.6, -1, 1.1], [21.5, 1, 1.5]] as const) {
    const d = 3.2;
    const whoosh = bp(osc(d, { wave: 'noise', freq: 0, seed: Math.round(at * 10), amp: bell(d / 2, d / 4) }), (t) => 600 * pitch * (1.3 - 0.6 * (t / d)), 2.5);
    const hum = osc(d, { wave: 'saw', freq: (t) => 140 * pitch * (1.15 - 0.3 * (t / d)), amp: (t) => 0.15 * bell(d / 2, d / 4)(t) });
    mixPan(out, add(whoosh, lp(hum, 900)), at, 0.5, (t) => dir * (-0.9 + 1.8 * Math.min(1, t / d)));
  }
  for (let i = 0; i < 9; i++) {
    const at = 0.8 + i * 2.6 + r() * 0.8, f = 1800 + Math.abs(r()) * 2600;
    const chirp = echo(osc(0.08, { wave: 'sine', freq: sweep(f, f * 1.3, 0.06), amp: expDecay(0.02) }), 0.18, 0.4, 0.5, 0.6);
    mixPan(out, chirp, at, 0.06, r() * 0.8);
  }
  for (const at of [5.5, 15.3]) {
    mixPan(out, lp(osc(0.6, { wave: 'sine', freq: sweep(90, 45, 0.2), amp: expDecay(0.15) }), 300), at, 0.35, -0.3);
    mixPan(out, osc(1.2, { wave: 'sine', freq: 620, fm: { ratio: 2.7, index: 3 }, amp: expDecay(0.3) }), at + 0.15, 0.05, -0.4);
  }
  return finish(out, loop, { wet: 0.4, room: 0.9 }, 0.7);
}

/** Factory floor: machinery hum, generator buzz, ventilation, conveyor clatter, hydraulics, sparks. */
export function factoryAmbience(): Rendered {
  const loop = 24;
  const out = stereo(loop + 4);
  const hum = add(osc(loop + 2, { wave: 'saw', freq: 55 }), gain(osc(loop + 2, { wave: 'saw', freq: 110.3 }), 0.5));
  mixPan(out, lp(hum, 260), 0, 0.3, 0);
  mixPan(out, gain(bp(osc(loop + 2, { wave: 'square', freq: 120 }), 480, 3), (t) => 0.5 + 0.5 * Math.sin(t * Math.PI * 0.5)), 0, 0.07, 0.3);
  for (const [pan, seed] of [[-0.8, 3], [0.8, 4]] as const)
    mixPan(out, hp(lp(osc(loop + 2, { wave: 'noise', freq: 0, seed }), 1500), 200), 0, 0.22, pan);
  const tickA = bp(osc(0.05, { wave: 'noise', freq: 0, seed: 5, amp: expDecay(0.008) }), 2200, 3);
  const tickB = lp(osc(0.08, { wave: 'sine', freq: 140, amp: expDecay(0.02) }), 400);
  for (let t = 0; t < loop; t += 0.3) {
    mixPan(out, tickA, t, 0.09, -0.5);
    if (Math.round(t / 0.3) % 2 === 0) mixPan(out, tickB, t + 0.02, 0.12, -0.5);
  }
  for (const at of [3.1, 14.7]) mixPan(out, hp(osc(1.8, { wave: 'noise', freq: 0, seed: Math.round(at), amp: adsr(0.1, 0.3, 0.6, 1, 0.8) }), 3000), at, 0.12, 0.6);
  for (const [at, f] of [[7.4, 180], [11.2, 240], [19.9, 160]] as const) {
    mixPan(out, drive(add(lp(osc(0.5, { wave: 'noise', freq: 0, amp: expDecay(0.06) }), 900), osc(0.5, { wave: 'sine', freq: sweep(f * 0.6, 45, 0.15), amp: expDecay(0.12) })), 1.6), at, 0.35, -0.2);
    mixPan(out, osc(1.4, { wave: 'sine', freq: f * 3.3, fm: { ratio: 2.76, index: 4 }, amp: expDecay(0.35) }), at + 0.05, 0.05, 0.2);
  }
  const cr = rng(91);
  for (let i = 0; i < 4; i++) {
    const at = 2 + i * 5.7;
    mixPan(out, hp(osc(0.4, { wave: 'noise', freq: 0, seed: 200 + i, amp: (t) => (Math.sin(t * 400 + i) > 0.75 ? Math.exp(-t / 0.15) : 0) }), 3500), at, 0.1, cr() * 0.7);
  }
  return finish(out, loop, { wet: 0.32, room: 0.92 }, 0.7);
}

export const MUSIC = { menu: menuTheme, main: mainTheme, industrial: industrialTheme };
export const AMBIENCE = { city: cityAmbience, factory: factoryAmbience };
