// User preferences (general, persisted under one key) and the last match configuration
// (persisted separately). Everything read from storage is validated field by field, so missing,
// outdated or hand-edited data falls back to defaults instead of breaking the game.
import { KING_DEFAULT_NAME, KING_NAME_MAX, RULES } from './game/config.ts';
import type { KingAbility } from './game/types.ts';

export type Level = 'low' | 'medium' | 'high';
export type Speed = 'slow' | 'normal' | 'fast';

export interface Settings {
  // gameplay presentation
  passScreen: boolean;
  // display
  crt: boolean;
  ambientBackground: boolean; // animated city behind the menus and board
  decorativeFx: boolean; // screen shake, flashes, turn/victory banners, fireworks
  boardDetail: Level; // battlefield art animation: low = static, medium = animated board, high = + animated structures
  // animation
  animQuality: Level; // high = every effect, medium = no secondary sparkle/flash, low = primary effects at half frame rate
  animSpeed: Speed;
  reducedMotion: boolean;
  // audio
  masterVolume: number; // 0..100
  musicVolume: number;
  sfxVolume: number;
  ambienceVolume: number;
  muted: boolean;
}

export const SETTINGS_VERSION = 2;
const KEY = 'slotwars.settings';

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  passScreen: true,
  crt: true,
  ambientBackground: true,
  decorativeFx: true,
  boardDetail: 'high',
  animQuality: 'high',
  animSpeed: 'normal',
  reducedMotion: false,
  masterVolume: 80,
  musicVolume: 60,
  sfxVolume: 80,
  ambienceVolume: 50,
  muted: false,
};

const LEVELS: Level[] = ['low', 'medium', 'high'];
const SPEEDS: Speed[] = ['slow', 'normal', 'fast'];
const VOLUMES = ['masterVolume', 'musicVolume', 'sfxVolume', 'ambienceVolume'] as const;

/** Validates untrusted data into a complete Settings object. Pure: safe to unit test. */
export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: Settings = { ...DEFAULT_SETTINGS };
  const bool = (k: keyof Settings) => {
    if (typeof r[k] === 'boolean') (out as unknown as Record<string, unknown>)[k] = r[k];
  };
  (['passScreen', 'crt', 'ambientBackground', 'decorativeFx', 'reducedMotion', 'muted'] as const).forEach(bool);
  for (const k of VOLUMES) if (typeof r[k] === 'number' && Number.isFinite(r[k])) out[k] = Math.round(Math.min(100, Math.max(0, r[k] as number)));
  if (LEVELS.includes(r.boardDetail as Level)) out.boardDetail = r.boardDetail as Level;
  if (LEVELS.includes(r.animQuality as Level)) out.animQuality = r.animQuality as Level;
  if (SPEEDS.includes(r.animSpeed as Speed)) out.animSpeed = r.animSpeed as Speed;
  // v1 had a single "animations" switch: off meant no motion
  if (r.reducedMotion === undefined && r.animations === false) out.reducedMotion = true;
  return out;
}

export function loadSettings(): Settings {
  try {
    return sanitizeSettings(JSON.parse(localStorage.getItem(KEY) ?? '{}'));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...s, version: SETTINGS_VERSION }));
  } catch {
    /* storage blocked: settings last for this session only */
  }
}

// ---------- match configuration ----------

export interface MatchConfig {
  playerNames: [string, string];
  kingNames: [string, string];
  kings: [KingAbility, KingAbility];
  fog: boolean;
  startingPoints: number;
}

export const PLAYER_NAME_MAX = 14;
export const STARTING_POINTS_RANGE = [0, 20] as const;
const MATCH_KEY = 'slotwars.match';
const ABILITIES: KingAbility[] = ['guardian', 'overcharge', 'phantom'];

export const DEFAULT_MATCH: Readonly<MatchConfig> = {
  playerNames: ['Player 1', 'Player 2'],
  kingNames: [KING_DEFAULT_NAME, KING_DEFAULT_NAME],
  kings: ['guardian', 'overcharge'],
  fog: RULES.fogOfWar,
  startingPoints: RULES.startingPoints,
};

const cleanName = (v: unknown, max: number, fallback: string) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : fallback);

export function sanitizeMatch(raw: unknown): MatchConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pair = (k: string) => (Array.isArray(r[k]) ? (r[k] as unknown[]) : []);
  const pts = Number(r.startingPoints);
  return {
    playerNames: [0, 1].map((i) => cleanName(pair('playerNames')[i], PLAYER_NAME_MAX, DEFAULT_MATCH.playerNames[i])) as [string, string],
    kingNames: [0, 1].map((i) => cleanName(pair('kingNames')[i], KING_NAME_MAX, KING_DEFAULT_NAME)) as [string, string],
    kings: [0, 1].map((i) => (ABILITIES.includes(pair('kings')[i] as KingAbility) ? pair('kings')[i] : DEFAULT_MATCH.kings[i])) as [KingAbility, KingAbility],
    fog: typeof r.fog === 'boolean' ? r.fog : DEFAULT_MATCH.fog,
    startingPoints: Number.isInteger(pts) && pts >= STARTING_POINTS_RANGE[0] && pts <= STARTING_POINTS_RANGE[1] ? pts : DEFAULT_MATCH.startingPoints,
  };
}
export function loadMatchConfig(): MatchConfig {
  try {
    return sanitizeMatch(JSON.parse(localStorage.getItem(MATCH_KEY) ?? '{}'));
  } catch {
    return sanitizeMatch({});
  }
}
export function saveMatchConfig(m: MatchConfig) {
  try {
    localStorage.setItem(MATCH_KEY, JSON.stringify(m));
  } catch {
    /* storage blocked */
  }
}
