// Main battlefield layout. One character per tile, 12x12, drawn as a single pixel-art map.
import type { Sprite } from '../../render.ts';
import { CITY_TILES } from './city-tiles.ts';

// Main battlefield, Earth 2100. Roads at rows/cols 2 and 9; Kings start on the helipads at B2 and K11.
export const CITY_LAYOUT = [
  'BS|BNBBGB|BO',
  'BH|BBBBBB!SB',
  '==+=-===-+==',
  'BB|NBGBSB|BH',
  'SB!BBBBNB|BB',
  'GB|BHPPBB|SB',
  'BS|BBPPHB|BG',
  'BB|BNBBBB!BS',
  'HB|SBGBNB|BB',
  '==+==-===+-=',
  'BS!BBBBBB|HB',
  'GB|BNBBSB|BB',
];

const CITY_BASE = {
  a: '#2b2c35', A: '#ffd23f', j: '#1c1d24', e: '#8a8d9c', u: '#6c6f7d', E: '#4a4c58',
  v: '#2f7a3a', V: '#1f5428', i: '#6fd256', I: '#3f9a3a', q: '#ffe27a', Q: '#4a3f2a',
};
// Rooftop and neon colors per quadrant: Q1 P1 blue, Q2 portal violet, Q3 neutral steel, Q4 P2 red.
export const CITY_QUADRANT_COLORS = [
  { f: '#3d4e78', F: '#2c3a5c', h: '#6a80b8', H: '#1a2238', n: '#5aa2ff', N: '#1d3f9e' },
  { f: '#4a3a6a', F: '#36294f', h: '#7a62a8', H: '#1e1530', n: '#ff5ad0', N: '#6b2a5a' },
  { f: '#4a5058', F: '#363b42', h: '#7a828c', H: '#1e2126', n: '#5ff3ff', N: '#1f6a78' },
  { f: '#6a3c3a', F: '#4f2b2a', h: '#a86460', H: '#2a1212', n: '#ff7a5a', N: '#7a2a1d' },
];

const ROOF_VARIANTS = ['roof_plain', 'roof_ac', 'roof_vent', 'roof_tank', 'roof_skylight', 'roof_antenna', 'roof_plain'];
const hash = (r: number, c: number) => ((r * 73856093) ^ (c * 19349663)) >>> 0;

function cityKey(ch: string, r: number, c: number): string {
  switch (ch) {
    case 'H': return 'roof_helipad';
    case 'S': return 'roof_solar';
    case 'G': return 'roof_garden';
    case 'N': return 'roof_sign';
    case '=': return 'road_h';
    case '-': return c % 2 ? 'road_h_car2' : 'road_h_car';
    case '|': return 'road_v';
    case '!': return 'road_v_car';
    case '+': return 'cross';
    case 'P': return 'plaza';
    case 'O': return 'plaza_portal';
    default: return ROOF_VARIANTS[hash(r, c) % ROOF_VARIANTS.length];
  }
}

/** City tile sprite for a board cell. frame 1 uses the `_2` variant when the tile has one. */
export function cityTile(r: number, c: number, frame: 0 | 1 = 0): Sprite {
  const quadrant = (r >= 6 ? 2 : 0) + (c >= 6 ? 1 : 0);
  const key = cityKey(CITY_LAYOUT[r][c], r, c);
  const k = frame && CITY_TILES[`${key}_2`] ? `${key}_2` : key;
  return { name: `city:${k}:q${quadrant}`, pixels: CITY_TILES[k], colors: { ...CITY_BASE, ...CITY_QUADRANT_COLORS[quadrant] } };
}
// The Industrial Dimension is painted as one facility in industrial-map.ts.
