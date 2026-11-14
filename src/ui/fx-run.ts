// Plays fx-art recipes on the board's effect layer as small pixelated canvases.
import type { Pos } from '../game/types.ts';
import type { Recipe } from './fx-art.ts';
import { motion } from './motion.ts';

export interface FxLayer {
  board: HTMLElement;
  fx: HTMLElement;
}

/**
 * Draws `recipe` frame by frame with its anchor tile on `at` (tile coords, may be fractional).
 * Resolves when finished or when the layer is torn down (restart, menu), so callers never hang.
 */
export function playFx(layer: FxLayer, recipe: Recipe, at: Pos, o: { delay?: number; className?: string } = {}): Promise<void> {
  if (motion.reduced()) return Promise.resolve();
  const fps = recipe.fps * motion.speed(), step = motion.quality() === 'low' ? 2 : 1; // low quality: half the frames
  const tile = layer.board.clientWidth / 12, k = tile / 16;
  const cv = document.createElement('canvas');
  cv.width = recipe.w;
  cv.height = recipe.h;
  cv.className = `pfx-canvas ${o.className ?? ''}`;
  Object.assign(cv.style, {
    left: `${at.c * tile - recipe.ax * k}px`,
    top: `${at.r * tile - recipe.ay * k}px`,
    width: `${recipe.w * k}px`,
    height: `${recipe.h * k}px`,
  });
  const g = cv.getContext('2d')!;
  return new Promise((resolve) => {
    const startAt = performance.now() + (o.delay ?? 0); // callers pass delays already scaled by speed
    let last = -1;
    const tick = (now: number) => {
      if (now < startAt) return void requestAnimationFrame(tick);
      if (!cv.isConnected && last >= 0) return resolve(); // layer was cleared
      if (last < 0) layer.fx.appendChild(cv);
      const raw = Math.floor(((now - startAt) / 1000) * fps), f = raw - (raw % step);
      if (f >= recipe.frames) {
        cv.remove();
        return resolve();
      }
      if (f !== last) {
        g.clearRect(0, 0, cv.width, cv.height);
        recipe.draw(g, f);
        last = f;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
