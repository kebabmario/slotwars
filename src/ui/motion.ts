// Single source of truth for animation preferences. Presentation only: nothing here may touch game rules.
import type { Level, Speed } from '../settings.ts';

let prefs = { quality: 'high' as Level, speed: 'normal' as Speed, reduced: false, decorative: true };
const SPEED: Record<Speed, number> = { slow: 0.6, normal: 1, fast: 1.6 };

const osReduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function setMotion(p: { quality: Level; speed: Speed; reduced: boolean; decorative: boolean }) {
  prefs = { ...p };
}

export const motion = {
  /** Reduced motion from the in-game toggle or the operating system. */
  reduced: () => prefs.reduced || osReduced(),
  /** Playback-rate multiplier for effects (1 = normal). */
  speed: () => SPEED[prefs.speed],
  /** Scales an effect duration in ms by the speed setting. */
  ms: (n: number) => n / SPEED[prefs.speed],
  quality: () => prefs.quality,
  /** Secondary flourishes (muzzle flashes, sparkles, glints, afterimages): high quality only. */
  secondary: () => prefs.quality === 'high' && !motion.reduced(),
  /** Decorative extras (shake, flashes, banners, fireworks). */
  decorative: () => prefs.decorative && !motion.reduced(),
};
