// Pixel-art effect recipes: destruction sequences, attacks, spawns, abilities, celebrations.
// Every recipe draws one frame onto a Painter at art resolution (16 px per tile), so the same code
// renders to a canvas in the game and to a fake painter in tests. No DOM access here.
import type { Painter } from '../assets/sprites/environment/industrial-map.ts';
import { MACHINE_SPRITES, STRUCTURE_SPRITES } from '../assets/sprites/index.ts';
import { colorsFor, type Sprite, type Team } from '../assets/render.ts';

export interface Recipe {
  w: number; // canvas size in art pixels
  h: number;
  ax: number; // where the anchor tile's top-left sits inside the canvas
  ay: number;
  frames: number;
  fps: number;
  shake?: 'light' | 'heavy'; // board shake the caller should add
  draw: (g: Painter, f: number) => void;
}

// ---------- palette ----------
export const FX = {
  k: '#14121c', w: '#ffffff', y: '#ffd23f', Y: '#c48a12', o: '#ff9a3c', O: '#c4501a', r: '#ff4a4a', R: '#9c1f2f',
  c: '#5ff3ff', C: '#1f8fa8', p: '#c85cff', P: '#6b2a99', g: '#45d07a', G: '#1f7a45', s: '#6fbf3a', S: '#3d7a1f', z: '#b6f05a',
  d: '#3b3f52', m: '#6b7088', l: '#a3a8bf', smoke: '#5a5d6e', smoke2: '#34363f', dust: '#8a7350', dust2: '#5c4a36', b: '#2a7cff',
};
const FIRE = [FX.w, FX.y, FX.o, FX.O, FX.smoke];
const SPARK = [FX.w, FX.y, FX.o];

// ---------- primitives ----------
function rect(g: Painter, x: number, y: number, w: number, h: number, c: string) {
  g.fillStyle = c;
  g.fillRect(Math.round(x), Math.round(y), w, h);
}
const px = (g: Painter, x: number, y: number, c: string) => rect(g, x, y, 1, 1, c);
function rng(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** Ordered-dither threshold so "transparency" stays crisp pixels. */
const bayer = (x: number, y: number) => [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5][(y & 3) * 4 + (x & 3)] / 16;

function disc(g: Painter, cx: number, cy: number, r: number, color: string, density = 1) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r && bayer(x, y) < density) px(g, x, y, color);
}
/** Flat ellipse for things lying on the floor: puddles, scorch marks, dust. */
function ellipse(g: Painter, cx: number, cy: number, rx: number, ry: number, color: string, density = 1) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++)
      if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1 && bayer(x, y) < density) px(g, x, y, color);
}
function ring(g: Painter, cx: number, cy: number, r: number, thick: number, color: string, density = 1) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d <= r && d > r - thick && bayer(x, y) < density) px(g, x, y, color);
    }
}
function line(g: Painter, x0: number, y0: number, x1: number, y1: number, c: string) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let e = dx + dy;
  for (;;) {
    px(g, x0, y0, c);
    if (x0 === x1 && y0 === y1) return;
    const e2 = 2 * e;
    if (e2 >= dy) { e += dy; x0 += sx; }
    if (e2 <= dx) { e += dx; y0 += sy; }
  }
}

interface Blit {
  dx?: (row: number) => number; // per-row horizontal offset (glitch, shear)
  keep?: (x: number, y: number) => boolean; // pixel mask (dissolve, halves)
  tint?: string; // flat colour (flash)
  map?: (color: string, x: number, y: number) => string | null; // recolour (char, glow)
  scaleY?: number; // squash toward the bottom edge
  scaleX?: number; // squash toward the centre column
  rot90?: boolean; // lying on its side
}
/** Draws a sprite with per-pixel transforms. ox/oy = top-left of the 16x16 cell. */
function blit(g: Painter, spr: Sprite, team: Team, ox: number, oy: number, o: Blit = {}) {
  const pal = colorsFor(team, spr), P = spr.pixels, H = P.length, W = P[0].length;
  const sy = o.scaleY ?? 1, sx = o.scaleX ?? 1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const ch = P[y][x];
      if (ch === '.' || (o.keep && !o.keep(x, y))) continue;
      let c: string | null = o.tint ?? pal[ch];
      if (o.map) c = o.map(c, x, y);
      if (!c) continue;
      let tx = x, ty = y;
      if (o.rot90) { tx = H - 1 - y; ty = x; }
      const fx = ox + W / 2 + (tx - W / 2) * sx + (o.dx ? o.dx(y) : 0);
      const fy = oy + H - (H - ty) * sy;
      rect(g, fx, fy, Math.max(1, Math.ceil(sx)), Math.max(1, Math.ceil(sy)), c);
    }
}

interface Burst {
  n: number;
  x: number;
  y: number;
  speed: [number, number]; // px per frame
  angle?: [number, number]; // radians, default full circle
  gravity?: number;
  life: [number, number]; // frames
  colors: string[]; // over lifetime
  size?: [number, number];
  start?: number;
  stagger?: number; // random start delay range
  floor?: number; // bounce line
}
/** Deterministic particle system: every particle is a pure function of (seed, index, frame). */
function burst(g: Painter, f: number, seed: number, b: Burst) {
  const r = rng(seed);
  for (let i = 0; i < b.n; i++) {
    const a = b.angle ? lerp(b.angle[0], b.angle[1], r()) : r() * Math.PI * 2;
    const sp = lerp(b.speed[0], b.speed[1], r()), life = lerp(b.life[0], b.life[1], r());
    const size = Math.round(lerp((b.size ?? [1, 1])[0], (b.size ?? [1, 1])[1], r()));
    const t = f - (b.start ?? 0) - Math.floor(r() * (b.stagger ?? 0));
    if (t < 0 || t > life) continue;
    const x = b.x + Math.cos(a) * sp * t;
    let y = b.y + Math.sin(a) * sp * t + 0.5 * (b.gravity ?? 0) * t * t;
    if (b.floor !== undefined && y > b.floor) y = b.floor - (y - b.floor) * 0.35;
    rect(g, x, y, size, size, b.colors[Math.min(b.colors.length - 1, Math.floor((t / (life + 0.001)) * b.colors.length))]);
  }
}
/** Rising, expanding, thinning smoke puffs. */
function smoke(g: Painter, f: number, seed: number, x: number, y: number, n: number, start = 0, color = FX.smoke, spread = 6) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const ox = (r() - 0.5) * spread, delay = Math.floor(r() * 4), drift = (r() - 0.5) * 0.6, life = 7 + r() * 5;
    const t = f - start - delay;
    if (t < 0 || t > life) continue;
    const k = t / life;
    disc(g, x + ox + drift * t, y - t * 1.1, 1.5 + k * 4, color, 0.85 * (1 - k));
  }
}
function chunk(g: Painter, x: number, y: number, w: number, h: number, c: string, edge = FX.k) {
  rect(g, x, y, w, h, edge);
  if (w > 2 && h > 2) rect(g, x + 1, y + 1, w - 2, h - 2, c);
}

// ---------- tiny 3x5 font for effect captions ----------
const GLYPHS: Record<string, string> = {
  E: '111100111100111', R: '110101110101101', X: '101101010101101', '2': '111001111100111', $: '011110010011110',
  '+': '000010111010000', '1': '010110010010111',
};
function text(g: Painter, s: string, x: number, y: number, color: string, outline = FX.k) {
  [...s].forEach((ch, i) => {
    const bits = GLYPHS[ch];
    if (!bits) return;
    for (const pass of [0, 1])
      for (let j = 0; j < 15; j++) {
        if (bits[j] !== '1') continue;
        const gx = x + i * 4 + (j % 3), gy = y + Math.floor(j / 3);
        if (pass === 0) { if (outline) for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) px(g, gx + ddx, gy + ddy, outline); }
        else px(g, gx, gy, color);
      }
  });
}

// =====================================================================
// Destruction: one hand-built sequence per machine. Canvas 48x48, tile at (16,16).
// =====================================================================
const D = { w: 48, h: 48, ax: 16, ay: 16 };
const OX = 16, OY = 16, CX = 24, CY = 24, GROUND = 31;
const jitter = (f: number, amp = 1) => (f % 2 ? amp : -amp);

export type DestroyRecipe = (team: Team) => Recipe;

export const DESTROY: Record<string, DestroyRecipe> = {
  // King: crown flies off, the sludge body melts into a bubbling puddle. The longest, loudest sequence.
  sludgy: (team) => ({
    ...D, w: 64, h: 64, ax: 24, ay: 24, frames: 22, fps: 13, shake: 'heavy',
    draw(g, f) {
      const spr = MACHINE_SPRITES.sludgy, ox = 24, oy = 24, cx = 32, ground = 39;
      if (f < 4) {
        blit(g, spr, team, ox + jitter(f), oy, f % 2 ? { tint: FX.w } : {});
        if (f >= 2) ring(g, cx, 32, 4 + f * 3, 2, FX.z, 0.6);
        return;
      }
      const k = clamp01((f - 4) / 9);
      const pw = 6 + k * 18;
      for (let i = 0; i < 3; i++) ellipse(g, cx, ground, pw - i * 3, Math.max(1.5, (pw - i * 3) * 0.28), [FX.S, FX.s, FX.z][i], i === 2 ? 0.5 : 1);
      if (f < 14) blit(g, spr, team, ox, oy, { keep: (_x, y) => y >= 3, scaleY: Math.max(0.12, 1 - k), scaleX: 1 + k * 0.6 });
      // crown arcs up and away, spinning by alternating width
      const t = f - 4, crownX = ox + t * 1.3, crownY = oy - t * 3.2 + 0.32 * t * t;
      if (crownY < 60) blit(g, spr, team, crownX, crownY, { keep: (_x, y) => y < 3, scaleX: t % 4 < 2 ? 1 : 0.5 });
      burst(g, f, 7, { n: 18, x: cx, y: ground - 4, speed: [0.8, 2.2], angle: [Math.PI * 1.05, Math.PI * 1.95], gravity: 0.32, life: [6, 11], colors: [FX.z, FX.s, FX.S], size: [1, 2], start: 5, floor: ground + 2 });
      // collar chunk in team colour
      if (f >= 5 && f < 15) { const tt = f - 5; chunk(g, ox + 2 - tt * 1.4, oy + 11 - tt * 1.8 + 0.3 * tt * tt, 4, 3, colorsFor(team).T); }
      // bubbles pop on the puddle
      const r = rng(f * 13 + 1);
      for (let i = 0; i < 3; i++) if (f > 9) ring(g, cx - pw + 4 + r() * (pw * 2 - 8), ground - 1 - r() * 2, 1.6 + r(), 1, FX.z);
      if (f > 17) ellipse(g, cx, ground, pw + 2, (pw + 2) * 0.3, FX.k, (f - 17) / 5); // the puddle sinks into the floor
    },
  }),

  // Scout: spins out, thrusters sputter, pops into a streak of blue sparks.
  scout: (team) => ({
    ...D, frames: 12, fps: 16,
    draw(g, f) {
      const spr = MACHINE_SPRITES.scout;
      if (f < 5) {
        blit(g, spr, team, OX, OY - f, { scaleX: [1, 0.55, 0.15, 0.55, 1][f], map: f % 2 ? (c) => c : undefined });
        burst(g, f, 3, { n: 6, x: CX - 4, y: OY + 13 - f, speed: [0.5, 1.4], angle: [Math.PI * 0.4, Math.PI * 0.6], life: [2, 4], colors: [FX.y, FX.o, FX.smoke], stagger: 3 });
        burst(g, f, 4, { n: 6, x: CX + 4, y: OY + 13 - f, speed: [0.5, 1.4], angle: [Math.PI * 0.4, Math.PI * 0.6], life: [2, 4], colors: [FX.y, FX.o, FX.smoke], stagger: 3 });
        return;
      }
      const team1 = colorsFor(team).L;
      burst(g, f, 9, { n: 22, x: CX, y: CY - 4, speed: [1.2, 3], life: [3, 7], colors: [FX.w, team1, FX.c, FX.C], start: 5, gravity: 0.15 });
      if (f < 9) line(g, CX + 2, CY - 10 - (f - 5) * 3, CX + 2, CY - 13 - (f - 5) * 3, FX.l); // antenna flies off
      smoke(g, f, 5, CX, CY - 2, 3, 6, FX.smoke, 4);
    },
  }),

  // Defender: the shield cracks, splits in half and falls; the body crumples into a heap.
  defender: (team) => ({
    ...D, frames: 13, fps: 13,
    draw(g, f) {
      const spr = MACHINE_SPRITES.defender, shield = (x: number, y: number) => x >= 3 && x <= 13 && y >= 4 && y <= 12;
      if (f < 3) {
        blit(g, spr, team, OX + jitter(f), OY);
        const cracks: [number, number, number, number][] = [[24, 22, 21, 26], [24, 22, 27, 25], [24, 22, 23, 28], [21, 26, 19, 24], [27, 25, 29, 27]];
        for (let i = 0; i <= f + 1 && i < cracks.length; i++) line(g, ...cracks[i], f % 2 ? FX.w : FX.k);
        return;
      }
      const t = f - 3;
      blit(g, spr, team, OX, OY, { keep: (x, y) => !shield(x, y) && y < 13, scaleY: Math.max(0.25, 1 - t * 0.12) });
      blit(g, spr, team, OX, OY, { keep: (_x, y) => y >= 13 });
      blit(g, spr, team, OX - t * 1.6, OY + 0.4 * t * t, { keep: (x, y) => shield(x, y) && x < 8 });
      blit(g, spr, team, OX + t * 1.6, OY + 0.4 * t * t, { keep: (x, y) => shield(x, y) && x >= 8 });
      burst(g, f, 21, { n: 10, x: CX, y: GROUND, speed: [0.4, 1.1], angle: [Math.PI, Math.PI * 2], life: [5, 9], colors: [FX.l, FX.m, FX.d], size: [1, 2], start: 4, gravity: 0.08 });
      smoke(g, f, 22, CX, GROUND, 4, 5, FX.dust2, 10);
    },
  }),

  // Striker: both fists blow first, then the core erupts in a fireball and chunky debris.
  striker: (team) => ({
    ...D, frames: 12, fps: 14,
    draw(g, f) {
      const spr = MACHINE_SPRITES.striker;
      if (f < 5) blit(g, spr, team, OX + jitter(f), OY, { map: (c, x, y) => (y >= 9 && y <= 10 && (x < 4 || x > 11) && f % 2 ? FX.w : c) });
      if (f >= 2 && f < 7) disc(g, OX + 2, OY + 10, 2 + (f - 2), FIRE[Math.min(4, f - 2)]);
      if (f >= 3 && f < 8) disc(g, OX + 14, OY + 10, 2 + (f - 3), FIRE[Math.min(4, f - 3)]);
      if (f >= 4) {
        const t = f - 4;
        if (t < 5) { disc(g, CX, CY, 3 + t * 2.2, FX.O); disc(g, CX, CY, 2 + t * 1.6, FX.o); disc(g, CX, CY, 1 + t, t < 3 ? FX.w : FX.y); }
        const T = colorsFor(team).T, r = rng(31);
        for (let i = 0; i < 6; i++) {
          const a = r() * Math.PI * 2, sp = 1.2 + r() * 1.4;
          chunk(g, CX + Math.cos(a) * sp * t, CY + Math.sin(a) * sp * t + 0.2 * t * t, 3, 2, i % 2 ? T : FX.m);
        }
        smoke(g, f, 33, CX, CY, 5, 6, FX.smoke2, 8);
      }
    },
  }),

  // Saboteur: digital glitch with colour-split slices, then a pixel dissolve into static.
  saboteur: (team) => ({
    ...D, frames: 13, fps: 14,
    draw(g, f) {
      const spr = MACHINE_SPRITES.saboteur, r = rng(f * 17 + 5);
      const offs = Array.from({ length: 16 }, () => (r() < 0.35 ? Math.round((r() - 0.5) * (2 + f)) : 0));
      if (f < 10) {
        const dissolve = clamp01((f - 5) / 5);
        const keep = (x: number, y: number) => bayer(x * 3 + 1, y * 5 + 2) >= dissolve;
        blit(g, spr, team, OX - 1, OY, { dx: (y) => offs[y], tint: FX.c, keep });
        blit(g, spr, team, OX + 1, OY, { dx: (y) => offs[y], tint: FX.p, keep });
        blit(g, spr, team, OX, OY, { dx: (y) => offs[y], keep });
      }
      for (let i = 0; i < 6 + f * 2; i++) px(g, OX - 6 + r() * 28, OY - 4 + r() * 24, r() < 0.5 ? FX.p : r() < 0.5 ? FX.w : FX.P);
      if (f >= 10) {
        const half = Math.max(0, 14 - (f - 10) * 6);
        rect(g, CX - half, CY, half * 2 + 1, 1, FX.p);
        px(g, CX, CY, FX.w);
      }
    },
  }),

  // Breacher: shudders, then a heavy blast throws hazard-striped plates; thick smoke and a scorch mark.
  breacher: (team) => ({
    ...D, frames: 15, fps: 13, shake: 'heavy',
    draw(g, f) {
      const spr = MACHINE_SPRITES.breacher;
      if (f >= 3) ellipse(g, CX, GROUND, Math.min(13, 6 + f), Math.min(4, 2 + f * 0.3), FX.k, 0.7);
      if (f < 3) { blit(g, spr, team, OX + jitter(f, 2), OY, { map: (c) => (c === colorsFor(team, spr).y && f % 2 ? FX.w : c) }); return; }
      const t = f - 3;
      if (t < 4) { disc(g, CX, CY, 4 + t * 3, FX.O); disc(g, CX, CY, 3 + t * 2.4, FX.o); disc(g, CX, CY, 2 + t * 1.5, t < 2 ? FX.w : FX.y); }
      const r = rng(41);
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI * (0.1 + 0.8 * (i / 5)), sp = 1.4 + r() * 0.8;
        const x = CX + Math.cos(a) * sp * t, y = Math.min(GROUND + 2, CY + Math.sin(a) * sp * t + 0.28 * t * t);
        chunk(g, x, y, 4, 3, FX.m);
        px(g, x + 1, y + 1, FX.y);
      }
      smoke(g, f, 43, CX, CY - 2, 9, 4, FX.smoke2, 14);
      smoke(g, f, 44, CX, CY, 5, 6, FX.smoke, 10);
      burst(g, f, 45, { n: 10, x: CX, y: CY, speed: [0.3, 0.9], angle: [-Math.PI * 0.9, -Math.PI * 0.1], life: [6, 10], colors: [FX.y, FX.o, FX.O], start: 4 });
    },
  }),

  // Medic: the cross flickers red, a heartbeat line flatlines, the body fades as green pluses rise.
  medic: (team) => ({
    ...D, frames: 14, fps: 12,
    draw(g, f) {
      const spr = MACHINE_SPRITES.medic, fadeK = clamp01((f - 3) / 7);
      blit(g, spr, team, OX, OY, {
        keep: (x, y) => bayer(x, y) >= fadeK,
        map: (c, x, y) => (y >= 8 && y <= 11 && x >= 5 && x <= 10 && c === colorsFor(team, spr).g && f % 2 ? FX.r : c),
      });
      const beat = f === 3 || f === 4;
      for (let x = 10; x < 38; x++) {
        let y = CY + 2;
        if (beat && x > 20 && x < 28) y += [0, -3, -6, 4, -2, 0, 0, 0][x - 21];
        if (f >= 2 && f < 12) px(g, x, y, f > 9 ? FX.G : FX.g);
      }
      const r = rng(55);
      for (let i = 0; i < 5; i++) {
        const t = f - 4 - i, x = OX + 2 + r() * 12;
        if (t < 0 || t > 8) continue;
        text(g, '+', Math.round(x), Math.round(OY + 8 - t * 1.8), t > 5 ? FX.G : FX.g, '');
      }
    },
  }),

  // Taxer: hat pops, coins fountain and bounce, the body tips over and fades.
  taxer: (team) => ({
    ...D, frames: 14, fps: 13,
    draw(g, f) {
      const spr = MACHINE_SPRITES.taxer;
      if (f < 3) blit(g, spr, team, OX + jitter(f), OY);
      else if (f < 6) blit(g, spr, team, OX, OY, { dx: (y) => Math.round((15 - y) * (f - 2) * 0.12), keep: (_x, y) => y >= 4 });
      else blit(g, spr, team, OX + 1, OY + 3, { rot90: true, keep: (x, y) => y >= 4 && bayer(x, y) >= clamp01((f - 9) / 5) });
      if (f >= 2) { const t = f - 2; blit(g, spr, team, OX - t * 1.2, OY - t * 2.6 + 0.3 * t * t, { keep: (_x, y) => y < 5, scaleX: t % 4 < 2 ? 1 : 0.6 }); }
      const r = rng(61);
      for (let i = 0; i < 9; i++) {
        const a = -Math.PI * (0.2 + 0.6 * r()), sp = 1 + r() * 1.3, t = f - 2 - Math.floor(r() * 2);
        if (t < 0) continue;
        let y = CY + Math.sin(a) * sp * t + 0.25 * t * t;
        if (y > GROUND) y = GROUND - (y - GROUND) * 0.3;
        const x = CX + Math.cos(a) * sp * t;
        if (f > 12 && i % 2) continue;
        disc(g, x, y, 1.6, FX.Y);
        px(g, Math.round(x - 0.5), Math.round(y - 1), FX.y);
      }
    },
  }),

  // Juggernaut: the power core overloads and blows the armour plates off; the charred tracks remain.
  juggernaut: (team) => ({
    ...D, frames: 16, fps: 13, shake: 'heavy',
    draw(g, f) {
      const spr = MACHINE_SPRITES.juggernaut, core = (x: number, y: number) => y >= 8 && y <= 10 && x >= 5 && x <= 10;
      const plates = (x: number, y: number) => y >= 4 && y <= 11 && !core(x, y);
      if (f < 5) {
        blit(g, spr, team, OX + (f > 2 ? jitter(f) : 0), OY);
        disc(g, CX, OY + 9.5, 1 + f * 1.2, f % 2 ? FX.w : FX.c, 0.55);
        for (let i = 0; i < f; i++) line(g, CX, OY + 9, CX + [-6, 6, -4, 5][i], OY + 9 + [-4, -3, 3, 4][i], FX.c);
        return;
      }
      const t = f - 5;
      const char = (c: string) => (t > 1 ? (c === FX.k ? c : FX.d) : c);
      blit(g, spr, team, OX, OY, { keep: (_x, y) => y >= 11, map: char });
      if (t < 4) disc(g, CX, OY + 9, 5 + t * 3, t < 2 ? FX.w : FX.c, t < 2 ? 1 : 0.5);
      ring(g, CX, OY + 9, 4 + t * 2.4, 2, FX.c, Math.max(0, 1 - t / 7));
      const dirs = [[-1, -1], [1, -1], [-1, 0.2], [1, 0.2]];
      dirs.forEach(([dx, dy], i) =>
        blit(g, spr, team, OX + dx * t * 1.7, OY + dy * t * 1.7 + 0.2 * t * t, {
          keep: (x, y) => plates(x, y) && (dx < 0 ? x < 8 : x >= 8) && (dy < 0 ? y < 8 : y >= 8),
          scaleX: (t + i) % 4 < 2 ? 1 : 0.7,
        }),
      );
      smoke(g, f, 71, CX, OY + 10, 7, 7, FX.smoke2, 12);
    },
  }),

  // Welder: the torch sprays out of control, the gas tank bursts in a blue-orange flash.
  welder: (team) => ({
    ...D, frames: 12, fps: 14,
    draw(g, f) {
      const spr = MACHINE_SPRITES.welder, arm = (x: number, y: number) => x >= 10 && y <= 8;
      if (f < 6) {
        blit(g, spr, team, OX, OY, { keep: (x, y) => !arm(x, y) });
        blit(g, spr, team, OX + jitter(f), OY + (f % 3 === 0 ? 1 : 0), { keep: arm });
        burst(g, f, 80 + f, { n: 10, x: OX + 12, y: OY + 1, speed: [1, 2.6], life: [1, 3], colors: [FX.w, FX.c, FX.b] });
      }
      if (f >= 5) {
        const t = f - 5;
        if (t < 4) { disc(g, OX + 6, OY + 10, 3 + t * 2, FX.b, 0.8); disc(g, OX + 6, OY + 10, 2 + t * 1.5, FX.o); disc(g, OX + 6, OY + 10, 1 + t, FX.w); }
        burst(g, f, 83, { n: 12, x: OX + 6, y: OY + 10, speed: [0.8, 2], life: [4, 7], colors: [FX.o, FX.m, FX.d], size: [1, 2], gravity: 0.2, start: 5, floor: GROUND });
        const fl = (f % 2) + 2;
        if (t < 7) for (let i = 0; i < 3; i++) rect(g, OX + 3 + i * 3, GROUND - fl - (i % 2), 2, fl, i % 2 ? FX.c : FX.b);
      }
    },
  }),

  // Crusher: the warning light blinks out, the claw snaps off and falls, the hull crushes into dust.
  crusher: (team) => ({
    ...D, frames: 15, fps: 13, shake: 'heavy',
    draw(g, f) {
      const spr = MACHINE_SPRITES.crusher, claw = (x: number, y: number) => x <= 6 && y <= 6, tracks = (_x: number, y: number) => y >= 11;
      const light = f < 3 ? (f % 2 ? FX.r : FX.w) : FX.d;
      if (f < 3) { blit(g, spr, team, OX + jitter(f), OY); px(g, OX + 12, OY, light); return; }
      const t = f - 3;
      const fallY = Math.min(GROUND - 6, OY + 0.5 * t * t), fallX = OX - t * 0.8;
      blit(g, spr, team, fallX, fallY, { keep: claw, scaleX: t > 4 ? 0.8 : 1 });
      blit(g, spr, team, OX, OY, { keep: (x, y) => !claw(x, y) && !tracks(x, y), scaleY: Math.max(0.35, 1 - t * 0.1) });
      blit(g, spr, team, OX - Math.min(4, t * 0.6), OY, { keep: (x, y) => tracks(x, y) && x < 8 });
      blit(g, spr, team, OX + Math.min(4, t * 0.6), OY, { keep: (x, y) => tracks(x, y) && x >= 8 });
      if (t >= 3) for (let i = 0; i < 3; i++) ellipse(g, CX + (i - 1) * 9, GROUND - 1, 4 + (t - 3) * 1.1, 2 + (t - 3) * 0.5, i === 1 ? FX.dust : FX.dust2, Math.max(0, 0.9 - (t - 3) / 10));
      burst(g, f, 91, { n: 8, x: CX, y: CY + 2, speed: [0.8, 1.6], angle: [-Math.PI * 0.95, -Math.PI * 0.05], gravity: 0.25, life: [5, 8], colors: [FX.l, FX.m, FX.d], size: [1, 2], start: 4, floor: GROUND });
    },
  }),
};

/** Structures crumble into steel bits and dust (shared: they are not machines). */
export function structureDestroy(kind: string, team: Team): Recipe {
  const spr = (STRUCTURE_SPRITES as Record<string, Sprite>)[kind];
  return {
    ...D, frames: 11, fps: 14, shake: 'light',
    draw(g, f) {
      if (f < 6) blit(g, spr, team, OX, OY, { scaleY: 1 - f * 0.12, keep: (x, y) => bayer(x, y) >= f / 8 });
      if (f >= 1 && f < 4) disc(g, CX, CY + 2, 3 + f * 2, f === 1 ? FX.w : FX.o, 0.7);
      burst(g, f, 101, { n: 12, x: CX, y: CY + 2, speed: [0.6, 1.8], angle: [-Math.PI, 0], gravity: 0.22, life: [5, 9], colors: [FX.l, FX.m, FX.d], size: [1, 2], start: 1, floor: GROUND });
      smoke(g, f, 102, CX, GROUND, 5, 2, FX.dust2, 12);
    },
  };
}

// =====================================================================
// Attacks
// =====================================================================
/** Muzzle flash on the attacker. */
export const muzzle = (heavy: boolean): Recipe => ({
  w: 32, h: 32, ax: 8, ay: 8, frames: 4, fps: 18,
  draw(g, f) {
    const s = (heavy ? 7 : 5) - f * 1.5;
    if (s <= 0) return;
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) line(g, 16, 16, 16 + dx * s, 16 + dy * s, f ? FX.y : FX.w);
    disc(g, 16, 16, s * 0.5, FX.w);
  },
});
/** Projectile sprite (16x16), drawn pointing to the lower right; the caller rotates it per diagonal. */
export const projectile = (source: string, heavy: boolean): Recipe => ({
  w: 16, h: 16, ax: 0, ay: 0, frames: 2, fps: 20,
  draw(g, f) {
    if (source === 'turret') {
      line(g, 4, 4, 11, 11, FX.Y);
      line(g, 6, 6, 11, 11, FX.y);
      px(g, 11, 11, FX.w);
      return;
    }
    if (heavy) {
      for (let i = 0; i < 4; i++) disc(g, 4 + i, 4 + i, 1.2, [FX.smoke, FX.O, FX.o, FX.y][i], 0.8);
      disc(g, 10, 10, 3, FX.O);
      disc(g, 10, 10, 2.2, f ? FX.y : FX.o);
      px(g, 10, 9, FX.w);
      return;
    }
    line(g, 3, 3, 12, 12, FX.C);
    line(g, 6, 6, 12, 12, FX.c);
    disc(g, 11.5, 11.5, 1.6, FX.w);
  },
});
/** Impact burst on the target. Heavy hits add debris and a crack ring. */
export const impact = (heavy: boolean, color: string = FX.c): Recipe => ({
  w: 48, h: 48, ax: 16, ay: 16, frames: heavy ? 9 : 7, fps: 18, shake: heavy ? 'light' : undefined,
  draw(g, f) {
    if (f < 3) disc(g, CX, CY, (heavy ? 5 : 3) + f * 2, f === 0 ? FX.w : FX.y, f === 0 ? 1 : 0.6);
    ring(g, CX, CY, (heavy ? 5 : 3) + f * (heavy ? 2.4 : 1.8), 1, f < 3 ? FX.w : color, Math.max(0, 1 - f / 7));
    burst(g, f, heavy ? 111 : 112, { n: heavy ? 16 : 9, x: CX, y: CY, speed: [1, heavy ? 2.6 : 2], life: [2, 5], colors: SPARK });
    if (heavy) {
      burst(g, f, 113, { n: 6, x: CX, y: CY, speed: [0.6, 1.4], angle: [-Math.PI, 0], gravity: 0.25, life: [5, 8], colors: [FX.l, FX.m], size: [2, 2], start: 1 });
      if (f >= 1) for (const a of [0.3, 1.9, 3.4, 4.8]) line(g, CX, CY + 4, CX + Math.cos(a) * Math.min(9, 3 + f * 2), CY + 4 + Math.sin(a) * Math.min(4, 1 + f), FX.k);
    }
  },
});
/** Armour glint when Fortify / Plating / Shield Wall / Barrier soaks damage. */
export const armorGlint = (color: string): Recipe => ({
  w: 32, h: 32, ax: 8, ay: 8, frames: 7, fps: 16,
  draw(g, f) {
    const h = 6 + Math.min(f, 3) * 2;
    for (let y = 16 - h; y <= 16 + h; y++) px(g, 9 + Math.abs(y - 16) * 0.3, y, f > 4 ? FX.C : color);
    line(g, 9, 16 - h, 9 + f * 2, 16 - h + f * 3, FX.w);
  },
});
/** Healing sparkle: green pluses drifting up. */
export const healSparkle = (): Recipe => ({
  w: 32, h: 32, ax: 8, ay: 8, frames: 9, fps: 14,
  draw(g, f) {
    const r = rng(121);
    for (let i = 0; i < 4; i++) {
      const t = f - i, x = 10 + r() * 12;
      if (t >= 0 && t < 6) text(g, '+', Math.round(x), Math.round(20 - t * 2), t > 3 ? FX.G : FX.g, '');
    }
  },
});

// =====================================================================
// Spawns
// =====================================================================
const INDUSTRIAL_MACHINES = new Set(['juggernaut', 'welder', 'crusher']);
/** Machines materialise in a beam (industrial ones drop in a crate); structures rise out of the floor. */
export function spawnRecipe(kind: string, team: Team): Recipe {
  const machine = (MACHINE_SPRITES as Record<string, Sprite>)[kind];
  const spr = machine ?? (STRUCTURE_SPRITES as Record<string, Sprite>)[kind];
  const light = colorsFor(team).L;
  if (machine && INDUSTRIAL_MACHINES.has(kind))
    return {
      w: 32, h: 48, ax: 8, ay: 24, frames: 14, fps: 14,
      draw(g, f) {
        const x = 8, base = 24;
        if (f < 9) {
          const y = Math.min(base, -16 + f * f * 1.2 + f * 2);
          if (f >= 6) blit(g, spr, team, x, base, { keep: (_c, r) => r >= 16 - (f - 5) * 5 });
          const open = Math.max(0, f - 6) * 3;
          for (const side of [-1, 1]) {
            const cx = x + (side < 0 ? 0 : 8) + side * open;
            chunk(g, cx, y, 8, 16, FX.m);
            for (let i = 0; i < 16; i += 4) rect(g, cx + 1, y + 1 + i, 6, 2, FX.y);
          }
        } else blit(g, spr, team, x, base);
        if (f >= 4 && f < 11) ellipse(g, 16, 40, 4 + (f - 4) * 2, 2 + (f - 4) * 0.5, FX.dust2, Math.max(0, 0.8 - (f - 4) / 8));
        burst(g, f, 131, { n: 8, x: 16, y: 38, speed: [0.6, 1.4], angle: [-Math.PI, 0], gravity: 0.2, life: [3, 6], colors: SPARK, start: 4 });
      },
    };
  if (machine)
    return {
      w: 32, h: 48, ax: 8, ay: 24, frames: 12, fps: 15,
      draw(g, f) {
        const x = 8, base = 24, scan = 16 - Math.max(0, f - 2) * 2.2;
        const beamW = f < 3 ? f * 3 : f < 9 ? 8 : Math.max(0, 8 - (f - 8) * 3);
        for (let y = 0; y < base + 16; y++) if (bayer(3, y) < 0.6) rect(g, 16 - beamW / 2, y, beamW, 1, light);
        if (f >= 3) blit(g, spr, team, x, base, { keep: (_c, r) => r >= scan, map: (c, _c2, r) => (r < scan + 2 && f < 10 ? FX.w : c) });
        if (f >= 3 && f < 10) rect(g, x - 2, base + Math.round(scan), 20, 1, FX.w);
        burst(g, f, 141, { n: 8, x: 16, y: base + 8, speed: [0.4, 1.2], life: [3, 6], colors: [FX.w, light], start: 6 });
      },
    };
  return {
    w: 32, h: 32, ax: 8, ay: 8, frames: 10, fps: 15,
    draw(g, f) {
      const rise = Math.max(0, 16 - f * 3);
      blit(g, spr, team, 8, 8 + rise, { keep: (_c, r) => r <= 15 - rise });
      if (f < 7) ring(g, 16, 22, 4 + f * 2, 1, FX.dust, 1 - f / 7);
      if (f >= 5 && f < 9) for (const [cx, cy] of [[9, 9], [22, 9], [9, 22], [22, 22]]) px(g, cx, cy, f % 2 ? FX.w : FX.y);
    },
  };
}

// =====================================================================
// Abilities. Area recipes are sized to their cells (16 px per tile).
// =====================================================================
export interface AbilityFx {
  key: string;
  w: number; // in tiles
  h: number;
  team: Team;
  structureKind?: string; // for Emergency Reconstruction
  machineKind?: string; // caster sprite for Phantom
}
const HEX = (g: Painter, cx: number, cy: number, r: number, color: string, density: number) => {
  for (let a = 0; a < 6; a++) {
    const a0 = (a * Math.PI) / 3, a1 = ((a + 1) * Math.PI) / 3;
    if (bayer(a, 0) < density) line(g, cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, color);
  }
};

export function abilityRecipe(o: AbilityFx): Recipe {
  const W = o.w * 16, H = o.h * 16, cx = W / 2, cy = H / 2;
  const base = { w: W + 16, h: H + 16, ax: 8, ay: 8 };
  const X = cx + 8, Y = cy + 8; // centre inside the padded canvas
  const T = colorsFor(o.team);
  switch (o.key) {
    case 'guardian':
      return { ...base, frames: 10, fps: 14, draw(g, f) {
        const r = Math.min(11, 4 + f * 2);
        HEX(g, X, Y, r, f % 2 ? FX.w : FX.c, 1);
        HEX(g, X, Y, r - 2, FX.C, 0.6);
        if (f > 3) burst(g, f, 151, { n: 6, x: X, y: Y, speed: [1.5, 2], life: [2, 3], colors: [FX.w, FX.c], start: 4 });
      } };
    case 'overcharge':
      return { ...base, frames: 10, fps: 15, draw(g, f) {
        const r = rng(f * 7 + 3);
        for (let b = 0; b < 3; b++) {
          let x = X + (r() - 0.5) * 18, y = Y - 12;
          for (let s = 0; s < 5; s++) { const nx = x + (r() - 0.5) * 6, ny = y + 5; line(g, x, y, nx, ny, s % 2 ? FX.y : FX.w); x = nx; y = ny; }
        }
        ring(g, X, Y, 6 + (f % 3) * 2, 1, FX.y, 0.6);
      } };
    case 'phantom':
      return { ...base, frames: 10, fps: 14, draw(g, f) {
        const spr = (MACHINE_SPRITES as Record<string, Sprite>)[o.machineKind ?? 'sludgy'];
        blit(g, spr, o.team, 8, 8 - f, { tint: f % 2 ? FX.p : FX.P, keep: (x, y) => bayer(x, y + f) >= f / 10 });
        burst(g, f, 161, { n: 14, x: X, y: Y + 4, speed: [0.3, 1], angle: [-Math.PI * 0.8, -Math.PI * 0.2], life: [4, 8], colors: [FX.w, FX.p, FX.P] });
      } };
    case 'phantom_in':
      return { ...base, frames: 10, fps: 14, draw(g, f) {
        burst(g, 9 - f, 162, { n: 14, x: X, y: Y, speed: [1, 1.8], life: [9, 9], colors: [FX.p] });
        ring(g, X, Y, Math.max(1, 12 - f * 1.3), 1, f % 2 ? FX.w : FX.p, 1);
      } };
    case 'quickstep':
      return { ...base, frames: 6, fps: 16, draw(g, f) {
        const spr = (MACHINE_SPRITES as Record<string, Sprite>).scout;
        blit(g, spr, o.team, 8, 8, { tint: T.L, keep: (x, y) => bayer(x, y) >= 0.25 + f * 0.15 });
        for (let i = 0; i < 4; i++) rect(g, 6 + i * 2, 10 + i * 4, 6 - f, 1, FX.w);
      } };
    case 'spotter':
      return { ...base, frames: 16, fps: 16, draw(g, f) {
        const a = (f / 16) * Math.PI * 2, R = Math.min(W, H) / 2;
        for (let t = 0; t < 3; t++) line(g, X, Y, X + Math.cos(a - t * 0.12) * R, Y + Math.sin(a - t * 0.12) * R, t ? FX.G : FX.g);
        ring(g, X, Y, (f * 4) % R, 1, FX.g, 0.5);
        ring(g, X, Y, R, 1, FX.G, 0.6);
        if (f % 4 === 0) disc(g, X + Math.cos(a) * R * 0.6, Y + Math.sin(a) * R * 0.6, 2, FX.z);
      } };
    case 'shieldwall':
      return { ...base, frames: 9, fps: 14, draw(g, f) {
        const hgt = Math.min(H, f * 6);
        for (let x = 8; x < 8 + W; x += 4) rect(g, x, 8 + H - hgt, 3, hgt, (x / 4) % 2 ? T.L : FX.c);
        rect(g, 8, 8 + H - hgt, W, 1, FX.w);
        if (f > 5) for (let x = 8; x < 8 + W; x++) if (bayer(x, f) < 0.3) px(g, x, 8 + H - hgt + 2, FX.w);
      } };
    case 'doublestrike':
      return { ...base, frames: 9, fps: 14, draw(g, f) {
        const s = Math.min(10, 3 + f * 2);
        line(g, X - s, Y - s, X + s, Y + s, FX.w);
        line(g, X - s, Y + s, X + s, Y - s, FX.w);
        line(g, X - s + 1, Y - s, X + s, Y + s - 1, FX.o);
        line(g, X - s + 1, Y + s, X + s, Y - s + 1, FX.o);
        if (f > 3) text(g, 'X2', X - 3, Y - 14, FX.y);
      } };
    case 'systemfailure':
      return { ...base, frames: 11, fps: 14, draw(g, f) {
        const r = rng(f * 31 + 7);
        for (let i = 0; i < W * H * 0.08; i++) px(g, 8 + r() * W, 8 + r() * H, r() < 0.5 ? FX.p : r() < 0.5 ? FX.w : FX.P);
        for (let i = 0; i < 4; i++) rect(g, 8, 8 + Math.floor(r() * H), W, 1, r() < 0.5 ? FX.p : FX.c);
        if (f % 3 !== 2) text(g, 'ERR', X - 6, Y - 2, FX.r);
      } };
    case 'hulksmash':
    case 'groundbreaker':
      return { ...base, frames: 12, fps: 14, shake: 'heavy', draw(g, f) {
        const R = Math.max(W, H) / 2 + 4;
        ring(g, X, Y, Math.min(R, 3 + f * 3), 2, f < 3 ? FX.w : FX.dust, Math.max(0, 1 - f / 11));
        const r = rng(o.key === 'hulksmash' ? 171 : 172);
        for (let i = 0; i < 7; i++) {
          const a = r() * Math.PI * 2, len = Math.min(R, f * 3) * (0.6 + r() * 0.4);
          line(g, X, Y, X + Math.cos(a) * len, Y + Math.sin(a) * len, FX.k);
          line(g, X + 1, Y, X + 1 + Math.cos(a) * len * 0.7, Y + Math.sin(a) * len * 0.7, o.key === 'hulksmash' ? FX.o : FX.dust2);
        }
        burst(g, f, 173, { n: 14, x: X, y: Y, speed: [1, 2.2], angle: [-Math.PI, 0], gravity: 0.25, life: [5, 9], colors: [FX.dust, FX.dust2, FX.m], size: [1, 3], start: 1 });
      } };
    case 'massrepair':
      return { ...base, frames: 12, fps: 13, draw(g, f) {
        ring(g, X, Y, Math.min(W / 2 + 2, 4 + f * 2.5), 1, FX.g, Math.max(0, 1 - f / 12));
        const r = rng(181);
        for (let i = 0; i < 10; i++) {
          const t = f - Math.floor(r() * 5), x = 8 + r() * W, y0 = 8 + H - 4 - r() * 8;
          if (t >= 0 && t < 7) text(g, '+', Math.round(x), Math.round(y0 - t * 2.5), t > 4 ? FX.G : FX.g, '');
        }
      } };
    case 'robbery':
      return { ...base, frames: 11, fps: 13, draw(g, f) {
        burst(g, f, 191, { n: 8, x: X, y: Y, speed: [1.2, 2], angle: [-Math.PI * 0.85, -Math.PI * 0.15], gravity: 0.18, life: [8, 10], colors: [FX.y, FX.Y], size: [2, 3] });
        if (f > 2) text(g, '+1', X - 3, Y - 10 - Math.min(6, f - 2), FX.y);
        if (f > 2) text(g, '$', X - 1, Y + 2, FX.y);
      } };
    case 'barrier':
      return { ...base, frames: 11, fps: 13, draw(g, f) {
        const k = clamp01(f / 5);
        for (let y = 0; y < H; y += 6) for (let x = (y / 6) % 2 ? 3 : 0; x < W; x += 6)
          HEX(g, 8 + x + 3, 8 + y + 3, 3 * k, f % 2 ? FX.y : FX.o, f > 7 ? 0.5 : 1);
        rect(g, 8, 8 + H - Math.round(H * k), W, 1, FX.w);
      } };
    case 'reconstruct':
      return { ...base, frames: 13, fps: 13, draw(g, f) {
        for (let i = 0; i <= 16; i += 4) { line(g, 8 + i, 8, 8 + i, 24, FX.C); line(g, 8, 8 + i, 24, 8 + i, FX.C); }
        const spr = (STRUCTURE_SPRITES as Record<string, Sprite>)[o.structureKind ?? 'barricade'];
        if (spr) blit(g, spr, o.team, 8, 8, { keep: (_x, y) => y >= 16 - f * 1.6, map: (c, _x, y) => (y < 16 - f * 1.6 + 2 ? FX.c : c) });
        if (f > 8) burst(g, f, 201, { n: 6, x: 16, y: 16, speed: [1, 1.6], life: [2, 4], colors: [FX.w, FX.c], start: 9 });
      } };
    case 'repair':
    case 'weld':
      return { ...base, frames: 8, fps: 16, draw(g, f) {
        burst(g, f, o.key === 'weld' ? 211 : 212, { n: 10, x: X, y: Y, speed: [0.8, 2], life: [2, 4], colors: o.key === 'weld' ? [FX.w, FX.c, FX.b] : [FX.w, FX.g, FX.G] });
      } };
    default:
      return { ...base, frames: 6, fps: 14, draw(g, f) { ring(g, X, Y, 4 + f * 2, 1, FX.c, 1 - f / 6); } };
  }
}

// =====================================================================
// Match end: pixel fireworks over the whole board (192x192).
// =====================================================================
export const victory = (team: Team): Recipe => ({
  w: 192, h: 192, ax: 0, ay: 0, frames: 30, fps: 14,
  draw(g, f) {
    const T = colorsFor(team);
    const shells: [number, number, number][] = [[50, 60, 0], [140, 50, 5], [96, 100, 10], [40, 130, 15], [150, 130, 18], [96, 40, 22]];
    shells.forEach(([x, y, start], i) => {
      const t = f - start;
      if (t < 0) return;
      if (t < 3) line(g, x, 192 - t * 40, x, 192 - t * 40 - 6, FX.y);
      else burst(g, t - 3, 220 + i, { n: 22, x, y, speed: [1.5, 2.6], gravity: 0.08, life: [6, 9], colors: [FX.w, i % 2 ? T.L : FX.y, T.T, T.t] });
    });
  },
});

export const ABILITY_KEYS = ['guardian', 'overcharge', 'phantom', 'quickstep', 'spotter', 'fortify', 'shieldwall', 'doublestrike', 'systemfailure', 'hulksmash', 'massrepair', 'robbery', 'barrier', 'reconstruct', 'groundbreaker'];
