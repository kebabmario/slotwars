// Pixel-art portal transition: charge-up, pull-in, dimensional wipe, emergence.
// Pure presentation. The engine has already moved the machine; this only animates it (~1.1s total).
import type { Pos } from '../game/types.ts';
import { motion } from './motion.ts';

export interface PortalTheme {
  core: string;
  glow: string;
  spark: string;
}
export const PORTAL_THEMES: [PortalTheme, PortalTheme] = [
  { core: '#5ff3ff', glow: '#c85cff', spark: '#ffffff' }, // main battlefield portal
  { core: '#ffd23f', glow: '#ff8a2a', spark: '#fff4d6' }, // industrial portal
];

export interface FxStage {
  board: HTMLElement; // .board grid
  fx: HTMLElement; // absolutely positioned layer inside the board
}

const STEPS = (n: number) => `steps(${n}, end)`;
const tileSize = (st: FxStage) => st.board.clientWidth / 12;
const center = (st: FxStage, p: Pos) => ({ x: (p.c + 0.5) * tileSize(st), y: (p.r + 0.5) * tileSize(st) });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ringCache = new Map<string, string>();
/** 32x32 pixel ring sprite (two concentric dotted rings). */
function ringSprite(t: PortalTheme): string {
  const key = t.core + t.glow;
  let url = ringCache.get(key);
  if (!url) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 32;
    const g = cv.getContext('2d')!;
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        const d = Math.hypot(x + 0.5 - 16, y + 0.5 - 16);
        if (d > 13.5 && d <= 15.5) g.fillStyle = (x + y) % 4 ? t.core : t.spark;
        else if (d > 10 && d <= 11 && (x + y) % 3 === 0) g.fillStyle = t.glow;
        else continue;
        g.fillRect(x, y, 1, 1);
      }
    url = cv.toDataURL();
    ringCache.set(key, url);
  }
  return url;
}

function el(st: FxStage, cls: string, x: number, y: number, size: number, html?: HTMLElement): HTMLElement {
  const e = html ?? document.createElement('div');
  e.classList.add('pfx', ...cls.split(' ').filter(Boolean));
  Object.assign(e.style, { left: `${x - size / 2}px`, top: `${y - size / 2}px`, width: `${size}px`, height: `${size}px` });
  st.fx.appendChild(e);
  return e;
}

function pulseRing(st: FxStage, p: Pos, t: PortalTheme, from: number, to: number, ms: number) {
  const { x, y } = center(st, p);
  const img = document.createElement('img');
  img.src = ringSprite(t);
  img.alt = '';
  const ring = el(st, 'ring', x, y, tileSize(st), img);
  return ring
    .animate([{ transform: `scale(${from})`, opacity: 1 }, { transform: `scale(${to})`, opacity: 0 }], { duration: motion.ms(ms), easing: STEPS(6), fill: 'forwards' })
    .finished.then(() => ring.remove());
}

/** Square pixel particles flying into (implode) or out of (explode) a tile. */
function particles(st: FxStage, p: Pos, t: PortalTheme, mode: 'in' | 'out', ms: number, count = 16) {
  const { x, y } = center(st, p);
  const s = Math.max(3, Math.round(tileSize(st) / 12));
  const jobs: Promise<void>[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.4;
    const r = tileSize(st) * (0.9 + Math.random() * 0.7);
    const dx = Math.round(Math.cos(a) * r), dy = Math.round(Math.sin(a) * r);
    const d = el(st, 'spark', x, y, s);
    d.style.background = [t.core, t.glow, t.spark][i % 3];
    const outer = `translate(${dx}px, ${dy}px)`, inner = 'translate(0, 0)';
    const frames = mode === 'in' ? [{ transform: outer, opacity: 0.2 }, { transform: inner, opacity: 1 }] : [{ transform: inner, opacity: 1 }, { transform: outer, opacity: 0 }];
    jobs.push(d.animate(frames, { duration: motion.ms(ms), delay: motion.ms(Math.random() * 60), easing: STEPS(5), fill: 'forwards' }).finished.then(() => d.remove()));
  }
  return Promise.all(jobs);
}

function spriteClone(st: FxStage, src: string, p: Pos, flip: boolean) {
  const { x, y } = center(st, p);
  const img = document.createElement('img');
  img.src = src;
  img.alt = '';
  const e = el(st, 'traveler', x, y, tileSize(st), img);
  if (flip) e.dataset.flip = '1';
  return e;
}
const flipT = (e: HTMLElement) => (e.dataset.flip ? ' scaleX(-1)' : '');

function chargePortal(st: FxStage, portal: Pos, on: boolean) {
  st.board.querySelector(`.tile[data-r="${portal.r}"][data-c="${portal.c}"]`)?.classList.toggle('portal-charge', on);
}

/** Phase 1+2: portal charges, machine slides onto it, gets pulled in. */
export async function playEnter(st: FxStage, o: { sprite: string; flip: boolean; from: Pos; portal: Pos; theme: PortalTheme }) {
  const size = tileSize(st);
  chargePortal(st, o.portal, true);
  st.board.querySelector(`.tile[data-r="${o.from.r}"][data-c="${o.from.c}"] .unit`)?.setAttribute('style', 'visibility:hidden');
  const clone = spriteClone(st, o.sprite, o.from, o.flip);
  const dx = (o.portal.c - o.from.c) * size, dy = (o.portal.r - o.from.r) * size;
  const t = flipT(clone);
  pulseRing(st, o.portal, o.theme, 0.5, 1.6, 300);
  const pull = particles(st, o.portal, o.theme, 'in', 280);
  await clone.animate([{ transform: `translate(0,0)${t}` }, { transform: `translate(${dx}px, ${dy}px)${t}` }], { duration: motion.ms(180), easing: STEPS(6), fill: 'forwards' }).finished;
  pulseRing(st, o.portal, o.theme, 0.3, 2.2, 240);
  await clone.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(1)${t}`, opacity: 1, filter: 'brightness(1)' },
      { transform: `translate(${dx}px, ${dy}px) scale(0.6)${t}`, opacity: 0.9, filter: 'brightness(2.2)' },
      { transform: `translate(${dx}px, ${dy}px) scale(0)${t}`, opacity: 0, filter: 'brightness(3)' },
    ],
    { duration: motion.ms(180), easing: STEPS(5), fill: 'forwards' },
  ).finished;
  clone.remove();
  await pull;
}

/** Phase 3: dimensional wipe. Calls swap() at the midpoint to show the destination battlefield. */
export async function playWipe(st: FxStage, o: { from: Pos; to: Pos; fromTheme: PortalTheme; toTheme: PortalTheme; swap: () => void }) {
  const size = tileSize(st), W = st.board.clientWidth, H = st.board.clientHeight;
  const inset = (p: Pos) => `inset(${p.r * size}px ${W - (p.c + 1) * size}px ${H - (p.r + 1) * size}px ${p.c * size}px)`;
  const veil = document.createElement('div');
  veil.className = 'pfx warp-veil';
  veil.style.setProperty('--a', o.fromTheme.glow);
  veil.style.setProperty('--b', o.fromTheme.core);
  st.fx.appendChild(veil);
  st.board.classList.add('warp-distort');
  await veil.animate([{ clipPath: inset(o.from) }, { clipPath: 'inset(0px 0px 0px 0px)' }], { duration: motion.ms(110), easing: STEPS(5), fill: 'forwards' }).finished;
  o.swap();
  veil.style.setProperty('--a', o.toTheme.glow);
  veil.style.setProperty('--b', o.toTheme.core);
  await wait(motion.ms(30));
  await veil.animate([{ clipPath: 'inset(0px 0px 0px 0px)' }, { clipPath: inset(o.to) }], { duration: motion.ms(120), easing: STEPS(5), fill: 'forwards' }).finished;
  veil.remove();
  st.board.classList.remove('warp-distort');
}

/** Phase 4: machine emerges from a portal (or a summon point) and steps to its landing tile. */
export async function playEmerge(st: FxStage, o: { sprite: string; flip: boolean; portal: Pos; to: Pos; theme: PortalTheme }) {
  const size = tileSize(st);
  chargePortal(st, o.portal, true);
  st.board.querySelector(`.tile[data-r="${o.to.r}"][data-c="${o.to.c}"] .unit`)?.setAttribute('style', 'visibility:hidden');
  const clone = spriteClone(st, o.sprite, o.portal, o.flip);
  const t = flipT(clone);
  clone.style.opacity = '0';
  pulseRing(st, o.portal, o.theme, 2.2, 0.4, 180);
  await wait(motion.ms(60));
  const burst = particles(st, o.portal, o.theme, 'out', 260);
  pulseRing(st, o.portal, o.theme, 0.4, 2, 260);
  await clone.animate(
    [
      { transform: `scale(0)${t}`, opacity: 0, filter: 'brightness(3)' },
      { transform: `scale(0.7)${t}`, opacity: 1, filter: 'brightness(2)' },
      { transform: `scale(1)${t}`, opacity: 1, filter: 'brightness(1)' },
    ],
    { duration: motion.ms(170), easing: STEPS(5), fill: 'forwards' },
  ).finished;
  const dx = (o.to.c - o.portal.c) * size, dy = (o.to.r - o.portal.r) * size;
  if (dx || dy)
    await clone.animate([{ transform: `translate(0,0)${t}` }, { transform: `translate(${dx}px, ${dy}px)${t}` }], { duration: motion.ms(160), easing: STEPS(5), fill: 'forwards' }).finished;
  st.board.querySelector(`.tile[data-r="${o.to.r}"][data-c="${o.to.c}"] .unit`)?.removeAttribute('style');
  clone.remove();
  chargePortal(st, o.portal, false);
  await burst;
}
