// Turns letter-grid sprites into crisp canvases and data URLs.
import { NEUTRAL_TEAM, PALETTE, TEAM_COLORS } from './palette.ts';

export interface Sprite {
  name: string;
  pixels: string[]; // rows of palette letters
  colors?: Record<string, string>; // per-sprite overrides
}

export type Team = 0 | 1 | 'neutral';

/** Throws if rows have uneven width or unknown letters. */
export function validateSprite(s: Sprite, extra: Record<string, string> = {}): void {
  const w = s.pixels[0].length;
  s.pixels.forEach((row, i) => {
    if (row.length !== w) throw new Error(`${s.name}: row ${i} is ${row.length} wide, expected ${w}`);
    for (const ch of row)
      if (ch !== '.' && !(ch in PALETTE) && !(ch in NEUTRAL_TEAM) && !(ch in (s.colors ?? {})) && !(ch in extra))
        throw new Error(`${s.name}: unknown color '${ch}' in row ${i}`);
  });
}

export function colorsFor(team: Team, s?: Sprite): Record<string, string> {
  return { ...PALETTE, ...(team === 'neutral' ? NEUTRAL_TEAM : TEAM_COLORS[team]), ...(s?.colors ?? {}) };
}

export function drawSprite(ctx: CanvasRenderingContext2D, s: Sprite, team: Team, x = 0, y = 0, scale = 1, swap?: Record<string, string>) {
  const pal = colorsFor(team, s);
  s.pixels.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      let ch = row[c];
      if (swap && ch in swap) ch = swap[ch];
      if (ch === '.') continue;
      ctx.fillStyle = pal[ch];
      ctx.fillRect(x + c * scale, y + r * scale, scale, scale);
    }
  });
}

const cache = new Map<string, string>();

/** Data URL of the sprite at native resolution. Scale with CSS image-rendering: pixelated. */
export function spriteUrl(s: Sprite, team: Team = 'neutral', swap?: Record<string, string>): string {
  const key = `${s.name}|${team}|${swap ? JSON.stringify(swap) : ''}`;
  let url = cache.get(key);
  if (!url) {
    const cv = document.createElement('canvas');
    cv.width = s.pixels[0].length;
    cv.height = s.pixels.length;
    drawSprite(cv.getContext('2d')!, s, team, 0, 0, 1, swap);
    url = cv.toDataURL();
    cache.set(key, url);
  }
  return url;
}
