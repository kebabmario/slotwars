// Industrial Dimension battlefield, painted pixel by pixel as one connected facility (192x192 = 12x12 tiles of 16px).
//
// Zones (tile columns/rows):
//   Furnace & generator hall ..... cols 0-4, rows 0-3
//   Hot/sludge pipe run .......... cols 0-4, row 4  + vertical pipe bundle col 6, rows 0-4
//   Processing plant ............. cols 7-11, rows 0-4 (sludge + coolant tanks, press, robot arm)
//   Twin conveyor line ........... all columns, rows 5-6
//   Steel catwalks ............... col 5 (rows 0-4, 8-11) and row 7
//   Storage & maintenance ........ cols 0-4, rows 8-11 (racks, drums, forklift bot, portal bay at A12)
//   Control & power .............. cols 6-11, rows 8-11 (consoles, cable tray, transformers, vent fan)
//
// Every function draws for animation frame F (0..3). Frames loop, so motion is planned in 4 steps.

export interface Painter {
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect(x: number, y: number, w: number, h: number): void;
}

export const INDUSTRIAL_FRAMES = 4;
export const INDUSTRIAL_MAP_SIZE = 192;

// Palette: dark steel, charcoal, muted greys, industrial orange, hazard yellow, sludge green, electric blue.
export const IND = {
  K: '#0d0c11', S0: '#17181e', S1: '#22232b', S2: '#2f313a', S3: '#42454f', S4: '#5a5e6b', S5: '#8b909e', S6: '#c2c7d2',
  O3: '#5a1e0c', O2: '#b8461a', O1: '#ff8a2a', OY: '#ffd23f', W: '#fff4d6',
  Y: '#e8b923', Y2: '#7a6214',
  G3: '#1d4a1f', G2: '#3f9a2f', G1: '#8fe85a',
  B3: '#14305e', B2: '#2a7cff', B1: '#7ff6ff',
  R2: '#5e1010', R1: '#ff3b3b',
  BR1: '#4e261a', BR2: '#3a1b12', BR3: '#6a3424',
  WD: '#6b4a2a', WD2: '#4a321c', CB: '#8a7350', OL: '#55663a', BL: '#3d4f74',
};
const C = IND;
const T = 16;

let G: Painter;
let F = 0;

function rect(x: number, y: number, w: number, h: number, c: string) {
  // clip to the map so shadows at the edges never spill onto a neighbouring sheet frame
  const x1 = Math.min(x + w, INDUSTRIAL_MAP_SIZE), y1 = Math.min(y + h, INDUSTRIAL_MAP_SIZE);
  x = Math.max(0, x);
  y = Math.max(0, y);
  w = x1 - x;
  h = y1 - y;
  if (w <= 0 || h <= 0) return;
  G.fillStyle = c;
  G.fillRect(x, y, w, h);
}
const px = (x: number, y: number, c: string) => rect(x, y, 1, 1, c);
function bevel(x: number, y: number, w: number, h: number, face: string, light: string, dark: string) {
  rect(x, y, w, h, face);
  rect(x, y, w, 1, light);
  rect(x, y, 1, h, light);
  rect(x, y + h - 1, w, 1, dark);
  rect(x + w - 1, y, 1, h, dark);
}
/** Outlined, beveled block: the standard machine housing. */
function box(x: number, y: number, w: number, h: number, face: string, light: string, dark: string) {
  rect(x, y, w, h, C.K);
  bevel(x + 1, y + 1, w - 2, h - 2, face, light, dark);
}
function dither(x: number, y: number, w: number, h: number, c: string, phase = 0) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if ((x + i + y + j + phase) % 2 === 0) px(x + i, y + j, c);
}
/** Dithered drop shadow that peeks out 2px to the right and bottom of an object drawn afterwards. */
const shadow = (x: number, y: number, w: number, h: number) => dither(x + 2, y + 2, w, h, C.K);
function disc(cx: number, cy: number, r: number, c: string | ((dx: number, dy: number) => string | null)) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r * r) {
        const col = typeof c === 'string' ? c : c(dx, dy);
        if (col) px(x, y, col);
      }
    }
}
function line(x0: number, y0: number, x1: number, y1: number, c: string, w = 1) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    rect(x0 - Math.floor(w / 2), y0 - Math.floor(w / 2), w, w, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
function hazard(x: number, y: number, w: number, h: number, shift = 0) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(x + i, y + j, Math.floor((i + j + shift) / 3) % 2 ? C.K : C.Y);
}
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (a: number, b: number) => ((a * 73856093) ^ (b * 19349663)) >>> 0;
const blink = (offset = 0) => (F + offset) % 4 < 2;

// ---------- floor & walkways ----------

function floorTile(c: number, r: number) {
  const x = c * T, y = r * T, h = hash(c + 7, r + 3);
  rect(x, y, T, T, C.S2);
  for (let j = 3; j < T - 1; j += 4)
    for (let i = 2 + ((j >> 2) % 2) * 2; i < T - 2; i += 4) {
      px(x + i, y + j, C.S1);
      px(x + i + 1, y + j - 1, C.S3);
    }
  rect(x, y, T, 1, C.S3);
  rect(x, y, 1, T, C.S3);
  rect(x, y + T - 1, T, 1, C.S0);
  rect(x + T - 1, y, 1, T, C.S0);
  for (const [i, j] of [[2, 2], [13, 2], [2, 13], [13, 13]]) {
    px(x + i, y + j, C.S4);
    px(x + i + 1, y + j + 1, C.S0);
  }
  if (h % 5 === 0) {
    // oil stain
    disc(x + 5 + (h % 6), y + 6 + (h % 4), 3, (dx, dy) => ((Math.round(dx) + Math.round(dy)) % 2 ? C.S1 : C.S0));
  }
  if (h % 7 === 3) line(x + 3, y + 11, x + 9, y + 9, C.S3); // scuff
}

function catwalk(x: number, y: number, w: number, h: number, vertical: boolean) {
  rect(x, y, w, h, C.S0);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if ((x + i) % 3 === 0 || (y + j) % 3 === 0) px(x + i, y + j, C.S3);
  if (vertical) {
    hazard(x, y, 2, h);
    hazard(x + w - 2, y, 2, h, 1);
    rect(x + 2, y, 1, h, C.S5);
    rect(x + w - 3, y, 1, h, C.S4);
  } else {
    hazard(x, y, w, 2);
    hazard(x, y + h - 2, w, 2, 1);
    rect(x, y + 2, w, 1, C.S5);
    rect(x, y + h - 3, w, 1, C.S4);
  }
}

// ---------- pipes ----------

const PIPE_SHADE = [C.K, C.S5, C.S4, C.S4, C.S3, C.S1, C.K];
function hpipe(x: number, y: number, w: number, band?: string) {
  PIPE_SHADE.forEach((c, i) => rect(x, y + i, w, 1, c));
  for (let fx = x + 6; fx < x + w - 2; fx += 24) {
    rect(fx, y - 1, 3, 9, C.K);
    rect(fx + 1, y, 1, 7, C.S5);
    if (band) {
      rect(fx + 10, y + 1, 3, 5, band);
      rect(fx + 10, y + 1, 3, 1, C.W);
    }
  }
}
function vpipe(x: number, y: number, h: number, band?: string) {
  PIPE_SHADE.forEach((c, i) => rect(x + i, y, 1, h, c));
  for (let fy = y + 5; fy < y + h - 2; fy += 20) {
    rect(x - 1, fy, 9, 3, C.K);
    rect(x, fy + 1, 7, 1, C.S5);
    if (band) rect(x + 1, fy + 9, 5, 3, band);
  }
}
function gauge(cx: number, cy: number, angles: number[]) {
  // steel bezel, small dial face, red zone tick, moving needle
  disc(cx + 0.5, cy + 0.5, 4.5, C.K);
  disc(cx + 0.5, cy + 0.5, 3.6, (dx, dy) => (dx + dy < 0 ? C.S5 : C.S3));
  disc(cx + 0.5, cy + 0.5, 2.6, C.S6);
  px(cx + 2, cy - 1, C.R1);
  const a = angles[F % angles.length];
  px(cx, cy, C.K);
  px(Math.round(cx + Math.cos(a) * 2), Math.round(cy + Math.sin(a) * 2), C.K);
}
function valveWheel(cx: number, cy: number) {
  disc(cx, cy, 5, (dx, dy) => (dx * dx + dy * dy > 12 ? C.R1 : null));
  disc(cx, cy, 5.6, (dx, dy) => (dx * dx + dy * dy > 26 ? C.K : null));
  line(cx - 3, cy, cx + 3, cy, C.R2);
  line(cx, cy - 3, cx, cy + 3, C.R2);
  disc(cx, cy, 1.5, C.S5);
}
function beacon(x: number, y: number, on: boolean, color = C.R1, dim = C.R2) {
  rect(x - 1, y - 1, 4, 4, C.K);
  rect(x, y, 2, 2, on ? color : dim);
  if (on) {
    px(x - 2, y, color);
    px(x + 3, y + 1, color);
    px(x + 1, y - 2, color);
    px(x, y + 3, color);
  }
}

// ---------- furnace & generator hall ----------

function furnace() {
  const x = 0, y = 0, w = 48, h = 32;
  shadow(x, y, w, h);
  rect(x, y, w, h, C.K);
  for (let j = 7; j < h - 1; j++)
    for (let i = 1; i < w - 1; i++) {
      const row = Math.floor((j - 7) / 4), mortar = (j - 7) % 4 === 3 || (i + (row % 2) * 4) % 8 === 0;
      px(x + i, y + j, mortar ? C.BR2 : (j - 7) % 4 === 0 ? C.BR3 : C.BR1);
    }
  bevel(x + 1, y + 1, w - 2, 6, C.S3, C.S4, C.S1); // steel hood
  for (let i = 4; i < w - 4; i += 4) rect(x + i, y + 3, 2, 2, C.K);
  // arched mouth
  const mx = 11, my = 11, mw = 26, mh = 21;
  rect(mx, my + 3, mw, mh - 3, C.K);
  rect(mx + 2, my + 1, mw - 4, 2, C.K);
  rect(mx + 5, my, mw - 10, 1, C.K);
  const layers: [number, string][] = [[1, C.O3], [3, C.O2], [6, C.O1]];
  for (const [inset, col] of layers) {
    rect(mx + inset, my + 3 + inset, mw - inset * 2, mh - 3 - inset, col);
    rect(mx + inset + 2, my + 1 + inset, mw - inset * 2 - 4, 2, col);
  }
  const core = [6, 8, 7, 9][F];
  rect(mx + 9, my + mh - core, mw - 18, core, C.OY);
  rect(mx + 11, my + mh - core + 2, mw - 22, core - 2, C.W);
  const rand = rng(F + 11);
  for (let i = 0; i < 6; i++) px(mx + 3 + Math.floor(rand() * (mw - 6)), my + 4 + Math.floor(rand() * 10), rand() > 0.5 ? C.OY : C.W);
  for (let i = mx + 2; i < mx + mw - 2; i += 4) rect(i, my + mh - 6, 1, 6, C.K); // grate bars
  gauge(5, 15, [-2.2, -2.0, -2.3, -1.9]);
  beacon(42, 13, blink());
  // heat shimmer on the floor
  for (let j = 32; j < 42; j++)
    for (let i = 6; i < 42; i++) if ((i + j + F) % 2 === 0 && (j < 36 || (i + j) % 4 === 0)) px(i, j, j < 35 ? C.O2 : C.O3);
}

function generator() {
  const x = 48, y = 0;
  shadow(x, y, 32, 32);
  box(x, y, 32, 32, C.S3, C.S4, C.S1);
  const cx = x + 16, cy = y + 16;
  disc(cx, cy, 13, C.K);
  disc(cx, cy, 12, C.S0);
  disc(cx, cy, 12, (dx, dy) => (dx * dx + dy * dy > 100 ? C.S4 : null));
  for (let k = 0; k < 4; k++) {
    const a = (F * Math.PI) / 8 + (k * Math.PI) / 2;
    line(cx + Math.cos(a) * 2, cy + Math.sin(a) * 2, cx + Math.cos(a) * 9, cy + Math.sin(a) * 9, C.S5, 2);
    line(cx + Math.cos(a + 0.25) * 3, cy + Math.sin(a + 0.25) * 3, cx + Math.cos(a + 0.25) * 9, cy + Math.sin(a + 0.25) * 9, C.S4);
  }
  disc(cx, cy, 3, C.B2);
  rect(cx - 1, cy - 1, 2, 2, C.B1);
  [[x + 3, y + 3], [x + 27, y + 3], [x + 3, y + 27], [x + 27, y + 27]].forEach(([lx, ly], i) => rect(lx, ly, 2, 2, blink(i) ? C.B1 : C.B3));
}

function teslaPosts() {
  const posts = [[52, 50], [74, 50]];
  for (const [x, y] of posts) {
    shadow(x - 3, y + 2, 7, 9);
    box(x - 3, y + 6, 7, 6, C.S3, C.S4, C.S1);
    for (let i = 0; i < 3; i++) rect(x - 2 + (i % 2), y + 1 + i * 2, 5 - (i % 2) * 2, 2, i % 2 ? C.S4 : C.S5);
    disc(x + 0.5, y, 2.5, C.B2);
    px(x, y - 1, C.B1);
  }
  // power cable from the generator
  line(66, 32, 66, 56, C.K, 3);
  line(66, 32, 66, 56, C.B3);
  line(66, 56, 74, 58, C.K, 2);
  // arc
  if (F !== 3) {
    const rand = rng(F * 7 + 3);
    let lx = 54, ly = 50;
    for (let xx = 56; xx <= 72; xx += 2) {
      const ny = 50 + Math.round((rand() - 0.5) * 6);
      line(lx, ly, xx, ny, C.B1);
      if (rand() > 0.6) px(xx, ny - 1, C.W);
      lx = xx;
      ly = ny;
    }
    line(lx, ly, 74, 50, C.B1);
  } else line(54, 50, 74, 50, C.B3);
}

function ingotPallets() {
  for (const [x, y] of [[4, 44], [24, 44]]) {
    shadow(x, y, 16, 14);
    rect(x, y + 10, 16, 4, C.WD2);
    for (let i = 0; i < 16; i += 5) rect(x + i, y + 10, 3, 4, C.WD);
    for (let k = 0; k < 3; k++)
      for (let row = 0; row < 2; row++) {
        const ix = x + 1 + k * 5, iy = y + 2 + row * 4;
        rect(ix, iy, 5, 4, C.K);
        rect(ix + 1, iy + 1, 3, 2, row ? C.S4 : C.O3);
        px(ix + 1, iy + 1, row ? C.S5 : C.O2);
      }
  }
}

// ---------- processing plant ----------

function tank(x: number, y: number, liquid: [string, string, string], seed: number) {
  const cx = x + 16, cy = y + 16;
  disc(cx + 2, cy + 2, 15, (dx, dy) => ((Math.floor(dx) + Math.floor(dy)) % 2 ? C.K : null));
  disc(cx, cy, 15, C.K);
  disc(cx, cy, 14, (dx, dy) => (dx + dy > 2 ? C.S3 : C.S4));
  disc(cx, cy, 11.5, C.K);
  disc(cx, cy, 10.5, liquid[2]);
  disc(cx, cy, 9.5, (dx, dy) => (dx + dy < -7 ? liquid[0] : liquid[1]));
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    px(Math.round(cx + Math.cos(a) * 12.8 - 0.5), Math.round(cy + Math.sin(a) * 12.8 - 0.5), C.S5);
  }
  const rand = rng(seed * 31 + F);
  for (let i = 0; i < 4; i++) {
    const bx = Math.round(cx - 6 + rand() * 12), by = Math.round(cy - 6 + rand() * 12);
    px(bx, by, C.W);
    px(bx - 1, by, liquid[0]);
    px(bx + 1, by, liquid[0]);
    px(bx, by - 1, liquid[0]);
  }
  rect(cx - 6, cy - 7, 2, 1, C.W); // glass glare
  px(cx - 7, cy - 6, C.W);
}

function valveWall() {
  const x = 176;
  rect(x, 0, 16, 32, C.S1);
  vpipe(x + 1, 0, 32, C.G2);
  vpipe(x + 8, 0, 32, C.B2);
  valveWheel(x + 4, 12);
  beacon(x + 11, 26, blink(1), C.OY, C.Y2);
}

function processor() {
  // feed pipes from the tanks
  vpipe(125, 30, 10, C.G2);
  vpipe(157, 30, 10, C.B2);
  const x = 114, y = 38, w = 76, h = 40;
  shadow(x, y, w, h);
  box(x, y, w, h, C.S3, C.S4, C.S1);
  hazard(x + 2, y + 2, w - 4, 3, F);
  for (let j = y + 9; j < y + h - 8; j += 3) rect(x + 4, j, 10, 1, C.K); // vents
  // press
  const px0 = x + 18, py0 = y + 7;
  box(px0, py0, 26, 28, C.S0, C.S1, C.K);
  const piston = [0, 5, 10, 5][F];
  rect(px0 + 12, py0 + 2, 2, 4 + piston, C.S5);
  box(px0 + 4, py0 + 5 + piston, 18, 5, C.S4, C.S5, C.S3);
  rect(px0 + 3, py0 + 22, 20, 3, C.O2);
  rect(px0 + 3, py0 + 22, 20, 1, C.O1);
  if (F === 2) for (const [sx, sy] of [[-2, 20], [24, 21], [3, 19], [21, 18], [12, 19]]) px(px0 + sx, py0 + sy, sx % 2 ? C.OY : C.W);
  // robot arm
  const bx = x + 60, by = y + 26;
  disc(bx, by, 6, C.K);
  disc(bx, by, 5, C.S4);
  disc(bx, by, 2, C.O2);
  const elbow = [[bx - 6, by - 13], [bx - 2, by - 15], [bx + 4, by - 14], [bx - 2, by - 15]][F];
  const claw = [[bx - 16, by - 12], [bx - 10, by - 19], [bx + 6, by - 20], [bx - 10, by - 19]][F];
  line(bx, by, elbow[0], elbow[1], C.K, 4);
  line(elbow[0], elbow[1], claw[0], claw[1], C.K, 4);
  line(bx, by, elbow[0], elbow[1], C.O1, 2);
  line(elbow[0], elbow[1], claw[0], claw[1], C.O1, 2);
  disc(elbow[0], elbow[1], 2, C.S5);
  rect(claw[0] - 2, claw[1] - 2, 5, 2, C.S5);
  rect(claw[0] - 2, claw[1], 1, 2, C.S5);
  rect(claw[0] + 2, claw[1], 1, 2, C.S5);
  // status LEDs and beacon
  [C.G1, C.OY, C.R1, C.G1, C.B1].forEach((c, i) => rect(x + 4 + i * 4, y + h - 5, 2, 2, (F + i) % 3 ? c : C.S0));
  beacon(x + w - 6, y + 8, blink());
}

// ---------- conveyor line ----------

function conveyor(y: number, dir: 1 | -1, item: 'ingot' | 'crate') {
  rect(0, y, 192, 16, C.K);
  rect(0, y + 1, 192, 2, C.S4);
  rect(0, y + 1, 192, 1, C.S5);
  rect(0, y + 13, 192, 2, C.S3);
  rect(0, y + 15, 192, 1, C.K);
  rect(0, y + 3, 192, 10, C.S1);
  const off = ((dir * F * 2) % 8 + 8) % 8;
  for (let x = 0; x < 192; x++) {
    const m = (((x - off) % 8) + 8) % 8;
    if (m === 0) rect(x, y + 3, 1, 10, C.K);
    else if (m === 1) rect(x, y + 3, 1, 10, C.S2);
  }
  for (let x = 4; x < 192; x += 8) {
    px(x, y + 14, (x / 8 + F) % 2 ? C.S5 : C.S2); // rollers
    px(x, y + 2, (x / 8 + F) % 2 ? C.S2 : C.S6);
  }
  const shift = ((dir * F * 8) % 32 + 32) % 32;
  for (let k = -1; k < 7; k++) {
    const ix = k * 32 + shift + (item === 'crate' ? 14 : 4);
    if (ix < -12 || ix > 192) continue;
    if (item === 'ingot') {
      rect(ix, y + 5, 12, 6, C.K);
      rect(ix + 1, y + 6, 10, 4, C.O2);
      rect(ix + 1, y + 6, 10, 1, C.O1);
      rect(ix + 3, y + 7, 4, 1, C.OY);
    } else {
      rect(ix, y + 4, 10, 8, C.K);
      rect(ix + 1, y + 5, 8, 6, C.CB);
      rect(ix + 1, y + 5, 8, 1, C.W);
      rect(ix + 4, y + 5, 2, 6, C.Y2);
    }
  }
}

// ---------- storage & maintenance ----------

function racks() {
  const boxes = [C.CB, C.OL, C.BL, C.WD, C.CB, C.BL];
  for (const [x, y] of [[4, 132], [4, 151]]) {
    shadow(x, y, 62, 14);
    rect(x, y, 62, 14, C.K);
    rect(x + 1, y + 1, 60, 12, C.S1);
    for (let i = 0; i <= 60; i += 15) rect(x + i, y, 2, 14, C.S4);
    const rand = rng(x + y);
    for (let bx = x + 3; bx < x + 58; ) {
      const bw = 5 + Math.floor(rand() * 5), col = boxes[Math.floor(rand() * boxes.length)];
      if ((bx - x) % 15 > 11) { bx += 3; continue; }
      rect(bx, y + 2, bw, 9, C.K);
      rect(bx + 1, y + 3, bw - 2, 7, col);
      rect(bx + 1, y + 3, bw - 2, 1, C.S5);
      bx += bw + 1;
    }
  }
}

function drums() {
  const list: [number, number, string, string][] = [[38, 170, C.O2, C.O1], [50, 170, C.B3, C.B2], [38, 182, C.G3, C.G2], [50, 182, C.O2, C.O1]];
  for (const [cx, cy, dark, light] of list) {
    disc(cx + 1.5, cy + 1.5, 5.5, (dx, dy) => ((Math.floor(dx) + Math.floor(dy)) % 2 ? C.K : null));
    disc(cx, cy, 5.5, C.K);
    disc(cx, cy, 4.5, dark);
    disc(cx, cy, 3.5, (dx, dy) => (dx * dx + dy * dy > 6 ? light : dark));
    px(Math.floor(cx) - 2, Math.floor(cy) - 3, C.W);
  }
  // toxic sign on the green drum
  px(38, 181, C.OY);
  px(37, 182, C.OY);
  px(39, 182, C.OY);
}

function forklift() {
  const x = 66, y = 166;
  shadow(x, y, 12, 20);
  rect(x + 2, y - 4, 2, 7, C.S5);
  rect(x + 8, y - 4, 2, 7, C.S5);
  box(x, y + 2, 12, 18, C.OY, C.W, C.Y2);
  rect(x + 3, y + 7, 6, 5, C.K);
  rect(x + 4, y + 8, 4, 2, C.B3);
  hazard(x + 2, y + 15, 8, 3);
  beacon(x + 5, y + 13, blink(2), C.O1, C.O3);
}

function portalBay() {
  // loading zone markings and chevrons guiding into the portal at A12
  for (let i = 0; i < 32; i += 2) {
    px(i, 161, C.Y);
    px(31, 160 + i, C.Y);
  }
  for (let k = 0; k < 3; k++) {
    const on = (F + k) % 3 === 0 ? C.OY : C.Y2;
    const cy = 164 + k * 4; // chevrons pointing down (tile A11)
    line(3, cy, 8, cy + 3, on, 2);
    line(13, cy, 8, cy + 3, on, 2);
    const cx = 28 - k * 4; // chevrons pointing left (tile B12)
    line(cx, 179, cx - 3, 184, on, 2);
    line(cx, 189, cx - 3, 184, on, 2);
  }
  disc(8, 184, 7.5, (dx, dy) => {
    const d = dx * dx + dy * dy;
    if (d > 42) return Math.floor((Math.atan2(dy, dx) + Math.PI) / (Math.PI / 4) + F) % 2 ? C.Y : C.K;
    return d > 30 ? C.S4 : C.S1;
  });
}

// ---------- control & power ----------

function cableTray() {
  const x = 96, y = 128, h = 64;
  rect(x, y, 16, h, C.K);
  rect(x + 1, y, 1, h, C.S4);
  rect(x + 14, y, 1, h, C.S4);
  [C.B2, C.R2, C.Y2, C.G3, C.B3].forEach((c, i) => {
    for (let j = 0; j < h; j++) px(x + 3 + i * 2 + (Math.floor((j + i * 5) / 12) % 2), y + j, c);
  });
  for (let j = y + 6; j < y + h; j += 16) rect(x, j, 16, 1, C.S3);
}

function consoles() {
  const x = 112, y = 129;
  shadow(x, y, 64, 14);
  box(x, y, 64, 14, C.S3, C.S4, C.S1);
  const scr = (sx: number) => {
    rect(sx, y + 2, 18, 9, C.K);
    rect(sx + 1, y + 3, 16, 7, '#071418');
  };
  scr(x + 3);
  for (let i = 0; i < 16; i++) px(x + 4 + i, y + 6 + Math.round(Math.sin((i + F * 4) * 0.8) * 2), C.B1);
  scr(x + 23);
  const bars = rng(F + 50);
  for (let i = 0; i < 5; i++) {
    const bh = 1 + Math.floor(bars() * 6);
    rect(x + 25 + i * 3, y + 10 - bh, 2, bh, C.G1);
  }
  scr(x + 43);
  for (let row = 0; row < 3; row++) rect(x + 45, y + 4 + row * 2, ((row + F) % 4) * 3 + 4, 1, C.O1);
  for (let i = 0; i < 8; i++) px(x + 5 + i * 7, y + 12, (i + F) % 3 === 0 ? C.R1 : (i + F) % 3 === 1 ? C.G1 : C.S1);
}

function serverCabinet() {
  const x = 178, y = 129;
  shadow(x, y, 12, 30);
  box(x, y, 12, 30, C.S2, C.S3, C.S0);
  for (let j = 0; j < 6; j++)
    for (let i = 0; i < 2; i++) {
      const on = (hash(i, j) + F) % 3 !== 0;
      rect(x + 3 + i * 4, y + 4 + j * 4, 2, 2, on ? (i ? C.G1 : C.B1) : C.S0);
    }
}

function transformers() {
  for (const x of [114, 130]) {
    const y = 164;
    shadow(x, y, 13, 26);
    box(x, y, 13, 26, C.S3, C.S4, C.S1);
    for (let i = x + 2; i < x + 11; i += 2) rect(i, y + 12, 1, 12, C.S1);
    // high-voltage sign
    for (let j = 0; j < 5; j++) rect(x + 6 - j, y + 3 + j, 1 + j * 2, 1, C.Y);
    px(x + 6, y + 5, C.K);
    px(x + 6, y + 6, C.K);
    for (const ix of [x + 3, x + 9]) {
      rect(ix - 1, y - 4, 3, 4, C.S5);
      rect(ix - 1, y - 3, 3, 1, C.S3);
    }
    if (F % 2 === 0) line(x + 3, y - 5, x + 9, y - 5 - (F === 2 ? 2 : 0), C.B1);
  }
}

function drone() {
  const cx = 152, cy = 176 + [0, -1, 0, 1][F];
  for (const [lx, ly] of [[-5, -4], [5, -4], [-5, 4], [5, 4]]) line(cx, cy, cx + lx, cy + ly, C.K, 2);
  disc(cx, cy, 4, C.K);
  disc(cx, cy, 3, C.S4);
  px(cx, cy - 1, blink(3) ? C.B1 : C.B3);
  // keep-clear box
  for (let i = 0; i < 14; i += 2) {
    px(145 + i, 163, C.Y);
    px(145 + i, 189, C.Y);
  }
}

function ventFan() {
  const x = 160, y = 160, cx = x + 16, cy = y + 16;
  shadow(x, y, 32, 32);
  box(x, y, 32, 32, C.S3, C.S4, C.S1);
  disc(cx, cy, 13.5, C.K);
  disc(cx, cy, 12.5, C.S0);
  for (let k = 0; k < 4; k++) {
    const a = -(F * Math.PI) / 8 + (k * Math.PI) / 2 + 0.4;
    line(cx + Math.cos(a) * 2, cy + Math.sin(a) * 2, cx + Math.cos(a) * 11, cy + Math.sin(a) * 11, C.S4, 3);
    line(cx + Math.cos(a) * 3, cy + Math.sin(a) * 3, cx + Math.cos(a) * 10, cy + Math.sin(a) * 10, C.S5);
  }
  for (const r of [6, 9.5, 12.5]) disc(cx, cy, r + 0.6, (dx, dy) => (dx * dx + dy * dy > r * r ? C.S2 : null));
  disc(cx, cy, 2.5, C.K);
  rect(cx - 1, cy - 1, 2, 2, blink() ? C.R1 : C.R2);
  for (const [bx, by] of [[x + 3, y + 3], [x + 28, y + 3], [x + 3, y + 28], [x + 28, y + 28]]) px(bx, by, C.S5);
}

// ---------- assemble ----------

export function drawIndustrialMap(painter: Painter, frame: number) {
  G = painter;
  F = ((frame % INDUSTRIAL_FRAMES) + INDUSTRIAL_FRAMES) % INDUSTRIAL_FRAMES;
  for (let r = 0; r < 12; r++) for (let c = 0; c < 12; c++) floorTile(c, r);

  catwalk(80, 0, 16, 80, true);
  catwalk(80, 128, 16, 64, true);
  catwalk(0, 112, 192, 16, false);

  furnace();
  generator();
  ingotPallets();
  teslaPosts();
  hpipe(0, 65, 80, C.O2);
  hpipe(0, 73, 80, C.G2);
  valveWheel(34, 68);
  gauge(58, 76, [-0.6, -0.4, -0.7, -0.3]);
  vpipe(97, 0, 78, C.O2);
  vpipe(104, 0, 78, C.G2);
  rect(111, 0, 1, 78, C.B3);
  box(96, 72, 16, 8, C.S3, C.S4, C.S1);

  tank(112, 0, [C.G1, C.G2, C.G3], 1);
  tank(144, 0, [C.B1, C.B2, C.B3], 2);
  valveWall();
  processor();

  conveyor(80, 1, 'ingot');
  conveyor(96, -1, 'crate');
  beacon(2, 82, blink(), C.OY, C.Y2);
  beacon(188, 109, blink(2), C.OY, C.Y2);

  racks();
  drums();
  forklift();
  portalBay();

  cableTray();
  consoles();
  serverCabinet();
  hpipe(112, 148, 64, C.B2);
  gauge(126, 151, [-0.9, -0.7, -1.0, -0.8]);
  gauge(150, 151, [-2.4, -2.2, -2.5, -2.1]);
  transformers();
  drone();
  ventFan();
}
