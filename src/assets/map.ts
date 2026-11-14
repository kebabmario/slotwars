// Renders each 12x12 battlefield (192x192 px) into images: single frames and a vertical animation sheet.
import { drawSprite } from './render.ts';
import { cityTile } from './sprites/environment/maps.ts';
import { drawIndustrialMap, INDUSTRIAL_FRAMES, INDUSTRIAL_MAP_SIZE } from './sprites/environment/industrial-map.ts';

const SIZE = INDUSTRIAL_MAP_SIZE;
export const MAP_FRAMES = [2, INDUSTRIAL_FRAMES] as const; // animation frames per battlefield
const cache = new Map<string, string>();

function paint(g: CanvasRenderingContext2D, dim: 0 | 1, frame: number, oy = 0) {
  if (dim === 1) {
    if (oy) g.translate(0, oy);
    drawIndustrialMap(g, frame);
    if (oy) g.translate(0, -oy);
  } else for (let r = 0; r < 12; r++) for (let c = 0; c < 12; c++) drawSprite(g, cityTile(r, c, (frame % 2) as 0 | 1), 'neutral', c * 16, r * 16 + oy);
}

/** One frame of a battlefield. */
export function boardMapUrl(dim: 0 | 1, frame: number): string {
  const key = `${dim}:${frame}`;
  let url = cache.get(key);
  if (!url) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = SIZE;
    paint(cv.getContext('2d')!, dim, frame);
    url = cv.toDataURL();
    cache.set(key, url);
  }
  return url;
}

/** All frames of a battlefield stacked vertically, for CSS stepped animation. */
export function boardSheetUrl(dim: 0 | 1): string {
  const key = `sheet:${dim}`;
  let url = cache.get(key);
  if (!url) {
    const n = MAP_FRAMES[dim];
    const cv = document.createElement('canvas');
    cv.width = SIZE;
    cv.height = SIZE * n;
    const g = cv.getContext('2d')!;
    for (let f = 0; f < n; f++) paint(g, dim, f, f * SIZE);
    url = cv.toDataURL();
    cache.set(key, url);
  }
  return url;
}
