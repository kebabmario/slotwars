// Sound effects. Each recipe returns a mono buffer. Palette: chiptune squares for UI,
// filtered noise + FM metal for machines, resonant sweeps for the portal. A light bitcrush ties them together.
import {
  add, adsr, bell, bp, buf, concat, crush, dcBlock, drive, echo, expDecay, fade, gain, hp, lp, mix, mtof, normalize, osc, reverb, sweep,
  type Buf,
} from './dsp.ts';

const retro = (x: Buf, bits = 10) => crush(x, bits);
const env = (x: Buf, e: (t: number) => number) => gain(x, e);

function blip(note: number, dur: number, duty = 0.25, decay = 0.05): Buf {
  return env(osc(dur, { wave: 'square', freq: mtof(note), duty }), (t) => Math.exp(-t / decay));
}
function fmBell(freq: number, dur: number, ratio = 3.5, idx = 4, decay = 0.4): Buf {
  return osc(dur, { wave: 'sine', freq, fm: { ratio, index: (t) => idx * Math.exp(-t / (decay * 0.5)) }, amp: (t) => Math.exp(-t / decay) });
}
function thud(freq = 70, dur = 0.3, decay = 0.08): Buf {
  return osc(dur, { wave: 'sine', freq: sweep(freq * 2.2, freq, 0.06), amp: expDecay(decay) });
}
function noiseBurst(dur: number, decay: number, seed = 3): Buf {
  return osc(dur, { wave: 'noise', freq: 0, amp: expDecay(decay), seed });
}
function metal(freq: number, dur: number, decay: number): Buf {
  return add(fmBell(freq, dur, 2.76, 6, decay), gain(fmBell(freq * 1.51, dur, 3.9, 3, decay * 0.6), 0.5));
}

export const SFX: Record<string, () => Buf> = {
  // ---------- UI ----------
  ui_click: () => retro(add(env(osc(0.05, { wave: 'square', freq: sweep(1400, 900, 0.03), duty: 0.3 }), expDecay(0.012)), gain(hp(noiseBurst(0.02, 0.003), 3000), 0.4))),
  ui_hover: () => retro(env(osc(0.03, { wave: 'tri', freq: 2350 }), expDecay(0.006)), 8),
  ui_nav: () => retro(concat(blip(76, 0.05, 0.25, 0.02), blip(83, 0.08, 0.25, 0.03))),
  select: () => retro(concat(blip(84, 0.05, 0.125, 0.025), blip(88, 0.09, 0.125, 0.04))),
  deselect: () => gain(retro(concat(blip(86, 0.05, 0.125, 0.02), blip(81, 0.08, 0.125, 0.03))), 0.7),
  error: () => retro(concat(blip(43, 0.07, 0.5, 0.04), buf(0.03), blip(41, 0.1, 0.5, 0.05)), 7),
  turn: () => {
    const x = add(fmBell(mtof(79), 0.9, 3.5, 2.5, 0.35), (() => { const b = buf(0.9); mix(b, fmBell(mtof(86), 0.75, 3.5, 2.5, 0.35), 0.13); return b; })());
    return reverb(gain(x, 0.6), { wet: 0.25, room: 0.7, tail: 0.6 });
  },
  match_start: () => {
    const out = buf(1.6);
    [60, 64, 67, 72].forEach((n, i) => mix(out, blip(n, 0.3, 0.25, 0.12), i * 0.09, 0.5));
    mix(out, add(blip(72, 0.8, 0.5, 0.35), blip(79, 0.8, 0.25, 0.35), gain(blip(84, 0.8, 0.125, 0.3), 0.6)), 0.38, 0.45);
    mix(out, gain(hp(noiseBurst(0.3, 0.06, 9), 2500), 0.3), 0.38);
    return reverb(retro(out), { wet: 0.2, tail: 0.5 });
  },
  match_end: () => {
    const out = buf(2.6);
    [67, 72, 76, 79, 84].forEach((n, i) => mix(out, blip(n, 0.25, 0.25, 0.1), i * 0.1, 0.45));
    for (const n of [72, 76, 79, 84]) mix(out, env(osc(1.8, { wave: 'square', freq: mtof(n), duty: 0.25 }), adsr(0.02, 0.3, 0.5, 0.9, 0.8)), 0.55, 0.16);
    mix(out, gain(thud(55, 0.6, 0.2), 0.8), 0.55);
    return reverb(retro(lp(out, 6000)), { wet: 0.25, tail: 0.8 });
  },
  unlock: () => {
    const out = buf(0.9);
    [79, 83, 86, 91].forEach((n, i) => mix(out, fmBell(mtof(n), 0.5, 2, 1.5, 0.18), i * 0.06, 0.5));
    return reverb(out, { wet: 0.3, tail: 0.5 });
  },

  // ---------- gameplay ----------
  move: () => {
    const servo = lp(env(osc(0.2, { wave: 'saw', freq: (t) => 170 + 90 * Math.sin(t * 40) + t * 300 }), adsr(0.02, 0.05, 0.6, 0.08, 0.12)), 1400);
    const tick = gain(bp(noiseBurst(0.04, 0.008, 11), 2600, 3), 0.8);
    const b = buf(0.24);
    mix(b, servo, 0, 0.7);
    mix(b, tick, 0);
    mix(b, tick, 0.16, 0.6);
    return retro(b);
  },
  attack: () => {
    const zap = env(osc(0.22, { wave: 'square', freq: sweep(1900, 160, 0.16), duty: 0.35 }), expDecay(0.06));
    const sizzle = gain(hp(noiseBurst(0.18, 0.04, 21), 4000), 0.35);
    return retro(lp(add(zap, sizzle), 7000), 9);
  },
  hit: () => {
    const b = buf(0.4);
    mix(b, gain(lp(noiseBurst(0.15, 0.03, 31), 2500), 0.8));
    mix(b, gain(metal(420, 0.35, 0.12), 0.5));
    mix(b, gain(thud(80, 0.3, 0.07), 0.9));
    return retro(drive(b, 1.5));
  },
  destroy: () => {
    const boom = lp(noiseBurst(1.3, 0.35, 41), sweep(4000, 90, 0.9));
    const sub = osc(1.2, { wave: 'sine', freq: sweep(110, 32, 0.6), amp: expDecay(0.3) });
    const crackle = gain(hp(osc(1.0, { wave: 'noise', freq: 0, seed: 43, amp: (t) => (Math.sin(t * 157) > 0.85 ? Math.exp(-t / 0.4) : 0) }), 3000), 0.5);
    return reverb(retro(drive(add(boom, gain(sub, 1.1), crackle), 2), 8), { wet: 0.18, tail: 0.6 });
  },
  spawn: () => {
    const rise = env(osc(0.6, { wave: 'sine', freq: sweep(260, 1500, 0.45), amp: (t) => 0.6 + 0.4 * Math.sin(t * 90) }), adsr(0.02, 0.1, 0.8, 0.2, 0.4));
    const b = buf(0.8);
    mix(b, rise, 0, 0.6);
    [88, 91, 95].forEach((n, i) => mix(b, blip(n, 0.12, 0.125, 0.04), 0.3 + i * 0.07, 0.35));
    mix(b, gain(thud(90, 0.25, 0.06), 0.6), 0.42);
    return reverb(retro(b), { wet: 0.2, tail: 0.4 });
  },
  ability: () => {
    const b = buf(0.9);
    for (const [n, d] of [[60, 0], [64, 0.04], [67, 0.08], [71, 0.12]] as const)
      mix(b, osc(0.7, { wave: 'saw', freq: (t) => mtof(n + 12 * Math.min(1, t * 2)), amp: adsr(0.05, 0.2, 0.5, 0.3, 0.35) }), d, 0.18);
    const shimmer = gain(hp(osc(0.8, { wave: 'noise', freq: 0, seed: 51, amp: bell(0.4, 0.2) }), 6000), 0.25);
    return reverb(retro(lp(add(b, shimmer), sweep(800, 6000, 0.5))), { wet: 0.3, tail: 0.6 });
  },
  heal: () => {
    const b = buf(0.8);
    [76, 80, 83, 88].forEach((n, i) => mix(b, fmBell(mtof(n), 0.5, 1, 1.2, 0.2), i * 0.07, 0.45));
    return reverb(echo(b, 0.11, 0.3, 0.3, 0.3), { wet: 0.25, tail: 0.5 });
  },
  shield: () => reverb(add(gain(metal(880, 0.7, 0.25), 0.6), gain(osc(0.6, { wave: 'sine', freq: 1320, amp: expDecay(0.2) }), 0.4)), { wet: 0.3, tail: 0.5 }),
  structure_hit: () => {
    const b = buf(0.5);
    mix(b, gain(thud(55, 0.4, 0.1), 1.0));
    mix(b, gain(metal(230, 0.45, 0.16), 0.6));
    mix(b, gain(lp(noiseBurst(0.2, 0.05, 61), 1800), 0.6));
    return retro(drive(b, 1.8));
  },
  structure_destroy: () => {
    const b = buf(1.4);
    mix(b, gain(thud(45, 0.8, 0.25), 1.0));
    for (let i = 0; i < 9; i++) mix(b, gain(bp(noiseBurst(0.12, 0.03, 70 + i), 600 + i * 220, 2), 0.7 - i * 0.05), 0.05 + i * 0.09);
    for (let i = 0; i < 6; i++) mix(b, gain(metal(500 + i * 130, 0.2, 0.05), 0.25), 0.3 + i * 0.13);
    return reverb(retro(drive(b, 1.5)), { wet: 0.2, tail: 0.5 });
  },
  trap: () => {
    const buzz = osc(0.45, { wave: 'square', freq: 62, amp: (t) => (0.6 + 0.4 * Math.sign(Math.sin(t * 190))) * Math.exp(-t / 0.2) });
    const crack = gain(hp(osc(0.45, { wave: 'noise', freq: 0, seed: 81, amp: (t) => (Math.sin(t * 311) > 0.6 ? Math.exp(-t / 0.15) : 0.1 * Math.exp(-t / 0.1)) }), 2500), 0.7);
    return retro(drive(add(lp(buzz, 2000), crack), 2.5), 8);
  },
  mine: () => {
    const whine = osc(0.12, { wave: 'square', freq: sweep(400, 2400, 0.12), duty: 0.4, amp: 0.5 });
    const burst = add(lp(noiseBurst(0.7, 0.15, 91), sweep(6000, 300, 0.5)), gain(osc(0.6, { wave: 'sine', freq: sweep(140, 40, 0.3), amp: expDecay(0.15) }), 0.9));
    const zap = gain(hp(osc(0.6, { wave: 'noise', freq: 0, seed: 93, amp: (t) => (Math.sin(t * 523) > 0.7 ? Math.exp(-t / 0.25) : 0) }), 3500), 0.5);
    return retro(drive(concat(whine, add(burst, zap)), 2), 8);
  },
  conveyor: () => {
    const b = buf(0.32);
    mix(b, gain(thud(110, 0.15, 0.03), 0.8));
    mix(b, gain(metal(700, 0.12, 0.03), 0.4), 0.02);
    mix(b, gain(bp(noiseBurst(0.06, 0.012, 101), 1800, 2), 0.7), 0.15);
    mix(b, gain(metal(820, 0.1, 0.025), 0.3), 0.16);
    return retro(b);
  },

  // ---------- portal ----------
  portal_charge: () => {
    const x = osc(0.7, { wave: 'saw', freq: (t) => 70 + t * 120 + 6 * Math.sin(t * 50), amp: adsr(0.05, 0.1, 0.9, 0.25, 0.45) });
    const res = bp(x, sweep(220, 1600, 0.6), 6);
    return reverb(gain(add(gain(res, 1.4), gain(lp(x, 400), 0.4)), 1), { wet: 0.2, tail: 0.3 });
  },
  portal_enter: () => {
    const suck = bp(osc(0.45, { wave: 'noise', freq: 0, seed: 111, amp: (t) => Math.pow(t / 0.45, 2) }), sweep(400, 4500, 0.45), 3);
    const fall = osc(0.45, { wave: 'sine', freq: sweep(900, 120, 0.45), amp: adsr(0.02, 0.1, 0.8, 0.1, 0.35) });
    return fade(add(gain(suck, 1.6), gain(fall, 0.5)), 0.01, 0.05);
  },
  portal_warp: () => {
    const n = osc(0.65, { wave: 'noise', freq: 0, seed: 121, amp: bell(0.25, 0.16) });
    const swoosh = add(bp(n, (t) => 300 + 2500 * (0.5 + 0.5 * Math.sin(t * 22)), 4), gain(bp(n, (t) => 300 + 2500 * (0.5 + 0.5 * Math.cos(t * 17)), 4), 0.7));
    const sub = osc(0.65, { wave: 'sine', freq: sweep(160, 35, 0.5), amp: bell(0.3, 0.18) });
    return reverb(add(gain(swoosh, 1.4), gain(sub, 0.9)), { wet: 0.25, room: 0.9, tail: 0.5 });
  },
  portal_return: () => {
    const n = osc(0.65, { wave: 'noise', freq: 0, seed: 131, amp: bell(0.3, 0.16) });
    const swoosh = bp(n, sweep(500, 5000, 0.6), 4);
    const rise = osc(0.65, { wave: 'sine', freq: sweep(60, 240, 0.55), amp: bell(0.32, 0.18) });
    const shimmer = osc(0.65, { wave: 'tri', freq: sweep(800, 2400, 0.6), amp: (t) => 0.3 * bell(0.35, 0.15)(t) });
    return reverb(add(gain(swoosh, 1.3), gain(rise, 0.9), shimmer), { wet: 0.25, room: 0.9, tail: 0.5 });
  },
  portal_arrive: () => {
    const pop = add(gain(thud(120, 0.25, 0.05), 0.8), gain(hp(noiseBurst(0.08, 0.02, 141), 2000), 0.5));
    const b = buf(0.7);
    mix(b, pop);
    [84, 88, 91].forEach((n, i) => mix(b, fmBell(mtof(n), 0.4, 2, 2, 0.15), 0.04 + i * 0.05, 0.35));
    return reverb(b, { wet: 0.3, tail: 0.5 });
  },
};

/** Final per-effect mastering: trim to a sensible tail, normalize, gentle fade out. */
export function renderSfx(name: string): Buf {
  const x = dcBlock(SFX[name]());
  return fade(normalize(x, 0.89), 0.002, Math.min(0.08, x.length / 44100 / 4));
}
