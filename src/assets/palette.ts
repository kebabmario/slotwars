// Shared Slot Wars palette. Every sprite maps its letters through this table.
// Upper/lower case pairs are usually main/shade. '.' is transparent.
export const PALETTE: Record<string, string> = {
  k: '#14121c', // outline
  d: '#3b3f52', // dark steel
  m: '#6b7088', // mid steel
  l: '#a3a8bf', // light steel
  w: '#e8ecf5', // highlight
  y: '#ffd23f', // gold
  Y: '#c48a12',
  r: '#ff4a4a', // red light
  R: '#9c1f2f',
  c: '#5ff3ff', // cyan glow
  C: '#1f8fa8',
  p: '#c85cff', // purple glow
  P: '#6b2a99',
  g: '#45d07a', // medic green
  G: '#1f7a45',
  o: '#ff9a3c', // orange
  s: '#6fbf3a', // sludge
  S: '#3d7a1f',
  z: '#b6f05a', // sludge highlight
  b: '#7a4a2a', // rust
  B: '#4a2a18',
};

// Team colors replace T (main), t (shade) and L (light).
export const TEAM_COLORS: Record<0 | 1, Record<string, string>> = {
  0: { T: '#3a7bff', t: '#1d3f9e', L: '#8fd0ff' },
  1: { T: '#ff5a3a', t: '#9e2a1d', L: '#ffb08f' },
};
export const NEUTRAL_TEAM: Record<string, string> = { T: '#8a8fa8', t: '#4f546a', L: '#c9cde0' };

export const SPRITE_SIZE = 16;
