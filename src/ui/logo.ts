// Slot Wars logo: 5x7 bitmap letters, each pixel drawn as a small beveled tile.
const GLYPHS: Record<string, string[]> = {
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
};

// Stepped bands, top to bottom: [face, light edge, dark edge]
const BANDS: Record<'blue' | 'red', [string, string, string][]> = {
  blue: [['#8fd0ff', '#e8f6ff', '#3a7bff'], ['#5aa2ff', '#a8d4ff', '#1d3f9e'], ['#3a7bff', '#8fd0ff', '#14245e']],
  red: [['#ffd23f', '#fff2b0', '#c48a12'], ['#ff9a3c', '#ffd0a0', '#9e4a12'], ['#ff5a3a', '#ffb08f', '#6e1d12']],
};

export function drawLogo(cell = 6): HTMLCanvasElement {
  const words: [string, 'blue' | 'red'][] = [['SLOT', 'blue'], ['WARS', 'red']];
  const letterW = 5 * cell, gap = cell, wordGap = cell * 4;
  const width = words.reduce((w, [t]) => w + t.length * (letterW + gap) - gap, 0) + wordGap + cell * 2;
  const height = 7 * cell + cell * 2;
  const cv = document.createElement('canvas');
  cv.width = width;
  cv.height = height;
  const g = cv.getContext('2d')!;
  let x = cell;
  for (const [word, scheme] of words) {
    for (const ch of word) {
      GLYPHS[ch].forEach((row, r) => {
        const band = BANDS[scheme][r < 2 ? 0 : r < 5 ? 1 : 2];
        [...row].forEach((on, c) => {
          if (on !== '#') return;
          const px = x + c * cell, py = cell + r * cell;
          g.fillStyle = '#0b0a12'; // drop shadow
          g.fillRect(px + 2, py + 2, cell, cell);
          g.fillStyle = band[0];
          g.fillRect(px, py, cell, cell);
          g.fillStyle = band[1];
          g.fillRect(px, py, cell, 1);
          g.fillRect(px, py, 1, cell);
          g.fillStyle = band[2];
          g.fillRect(px, py + cell - 1, cell, 1);
          g.fillRect(px + cell - 1, py, 1, cell);
        });
      });
      x += letterW + gap;
    }
    x += wordGap - gap;
  }
  return cv;
}
