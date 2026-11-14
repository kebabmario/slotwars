// Seven-segment LCD counter in the spirit of classic minefield counters.
const SEG: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd',
  '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g', ' ': '',
};
const DW = 11, DH = 19;

function seg(g: CanvasRenderingContext2D, x: number, y: number, s: string) {
  const h = (sx: number, sy: number) => { g.fillRect(x + sx + 1, y + sy, 7, 1); g.fillRect(x + sx + 2, y + sy + 1, 5, 1); };
  const hb = (sx: number, sy: number) => { g.fillRect(x + sx + 2, y + sy - 1, 5, 1); g.fillRect(x + sx + 1, y + sy, 7, 1); };
  const v = (sx: number, sy: number) => { g.fillRect(x + sx, y + sy + 1, 1, 7); g.fillRect(x + sx + 1, y + sy + 2, 1, 5); };
  const vr = (sx: number, sy: number) => { g.fillRect(x + sx, y + sy + 2, 1, 5); g.fillRect(x + sx + 1, y + sy + 1, 1, 7); };
  if (s === 'a') h(1, 0);
  if (s === 'd') hb(1, 18);
  if (s === 'g') { g.fillRect(x + 2, y + 9, 7, 1); g.fillRect(x + 3, y + 8, 5, 1); g.fillRect(x + 3, y + 10, 5, 1); }
  if (s === 'f') v(0, 0);
  if (s === 'e') v(0, 9);
  if (s === 'b') vr(9, 0);
  if (s === 'c') vr(9, 9);
}

export function lcd(value: number, digits = 3, on = '#ff2a1a', off = '#4a0a06'): HTMLCanvasElement {
  const text = String(Math.max(-99, Math.min(999, value))).padStart(digits, '0').slice(-digits);
  const cv = document.createElement('canvas');
  cv.width = digits * (DW + 2) + 2;
  cv.height = DH + 4;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, cv.width, cv.height);
  [...text].forEach((ch, i) => {
    const x = 2 + i * (DW + 2), y = 2;
    for (const s of 'abcdefg') {
      g.fillStyle = SEG[ch].includes(s) ? on : off;
      seg(g, x, y, s);
    }
  });
  cv.className = 'lcd';
  return cv;
}
