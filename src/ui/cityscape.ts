// Animated pixel-art skyline of Earth, 2100. Drawn at low resolution and scaled up with hard edges.

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Building {
  x: number;
  w: number;
  h: number;
  color: string;
  windows: { x: number; y: number; color: string; flicker: number }[];
  antenna: boolean;
  sign?: { color: string; y: number; w: number };
  billboard?: boolean;
}
interface Car {
  x: number;
  y: number;
  speed: number;
  dir: 1 | -1;
  color: string;
}

const SKY = ['#0b0820', '#120c2e', '#1a1240', '#24164d', '#2f1a57', '#3d1f5c', '#4f2560'];
const WINDOW_COLORS = ['#ffd23f', '#5ff3ff', '#ff7ad9', '#ffb35a', '#8fd0ff'];
const NEON = ['#ff3ea5', '#5ff3ff', '#c85cff', '#ffd23f', '#3aff8a'];

export class Cityscape {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private scale = 2;
  private far: Building[] = [];
  private mid: Building[] = [];
  private cars: Car[] = [];
  private stars: { x: number; y: number; tw: number }[] = [];
  private t = 0;
  private timer = 0;
  dim = false;
  animate = true;

  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    addEventListener('resize', () => this.layout());
    this.layout();
    this.timer = window.setInterval(() => this.frame(), 1000 / 15);
  }

  private layout() {
    this.scale = Math.max(2, Math.floor(innerHeight / 200));
    this.w = Math.ceil(innerWidth / this.scale);
    this.h = Math.ceil(innerHeight / this.scale);
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.canvas.style.width = `${this.w * this.scale}px`;
    this.canvas.style.height = `${this.h * this.scale}px`;
    this.generate();
    this.draw();
  }

  private generate() {
    const r = rng(2100);
    const ground = this.h - 14;
    const make = (minH: number, maxH: number, color: string, density: number, out: Building[], extras: boolean) => {
      out.length = 0;
      let x = -4;
      while (x < this.w + 4) {
        const w = 10 + Math.floor(r() * 18);
        const h = minH + Math.floor(r() * (maxH - minH));
        const b: Building = { x, w, h, color, windows: [], antenna: r() < 0.3 };
        for (let wy = ground - h + 4; wy < ground - 3; wy += 3)
          for (let wx = x + 2; wx < x + w - 2; wx += 3)
            if (r() < density) b.windows.push({ x: wx, y: wy, color: WINDOW_COLORS[Math.floor(r() * WINDOW_COLORS.length)], flicker: r() });
        if (extras && r() < 0.35) b.sign = { color: NEON[Math.floor(r() * NEON.length)], y: ground - h + 2 + Math.floor(r() * 10), w: Math.min(w - 2, 6 + Math.floor(r() * 8)) };
        if (extras && !b.sign && w > 20 && r() < 0.5) b.billboard = true;
        out.push(b);
        x += w + Math.floor(r() * 3);
      }
    };
    make(30, Math.max(60, this.h * 0.55), '#1c1538', 0.12, this.far, false);
    make(18, Math.max(40, this.h * 0.4), '#100c22', 0.35, this.mid, true);
    this.stars = Array.from({ length: Math.floor(this.w * 0.25) }, () => ({ x: Math.floor(r() * this.w), y: Math.floor(r() * this.h * 0.5), tw: r() }));
    this.cars = Array.from({ length: 9 }, (_, i) => ({
      x: Math.floor(r() * this.w),
      y: Math.floor(this.h * (0.18 + (i % 3) * 0.12)),
      speed: 0.6 + r() * 1.4,
      dir: i % 2 ? 1 : -1,
      color: NEON[Math.floor(r() * NEON.length)],
    }));
  }

  private frame() {
    if (!this.animate) return;
    this.t++;
    for (const c of this.cars) {
      c.x += c.speed * c.dir;
      if (c.x > this.w + 10) c.x = -10;
      if (c.x < -10) c.x = this.w + 10;
    }
    this.draw();
  }

  private px(x: number, y: number, w: number, h: number, color: string) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(Math.round(x), Math.round(y), w, h);
  }

  private draw() {
    const { w, h, t } = this;
    const g = this.ctx;
    const ground = h - 14;
    // Sky: stepped bands with a dithered seam between each pair.
    const band = Math.ceil(ground / SKY.length);
    SKY.forEach((col, i) => {
      this.px(0, i * band, w, band, col);
      if (i > 0) {
        g.fillStyle = SKY[i - 1];
        for (let x = (i % 2); x < w; x += 2) g.fillRect(x, i * band, 1, 1);
      }
    });
    for (const s of this.stars) if ((t + Math.floor(s.tw * 40)) % 40 > 3) this.px(s.x, s.y, 1, 1, s.tw > 0.8 ? '#ffffff' : '#8a86b8');
    // Moon
    const mx = Math.floor(w * 0.78), my = Math.floor(h * 0.16), mr = 12;
    for (let y = -mr; y <= mr; y++)
      for (let x = -mr; x <= mr; x++)
        if (x * x + y * y <= mr * mr) this.px(mx + x, my + y, 1, 1, x + y > 6 ? '#b9b2d8' : '#e6e0f5');
    this.px(mx - 4, my - 3, 3, 2, '#b9b2d8');
    this.px(mx + 2, my + 4, 2, 2, '#b9b2d8');
    // Space elevator with a climbing car
    const ex = Math.floor(w * 0.18);
    this.px(ex, 0, 1, ground, '#3a2f66');
    this.px(ex - 1, (h - ((t * 0.7) % h)) | 0, 3, 3, '#5ff3ff');
    // Far skyline
    for (const b of this.far) {
      this.px(b.x, ground - b.h, b.w, b.h, b.color);
      for (const wd of b.windows) this.px(wd.x, wd.y, 1, 1, '#3d3370');
    }
    // Traffic lanes (behind the mid skyline)
    for (const c of this.cars) {
      this.px(c.x, c.y, 4, 2, '#2a2448');
      this.px(c.x + (c.dir > 0 ? 4 : -1), c.y, 1, 1, '#fff6c0');
      this.px(c.x + (c.dir > 0 ? -1 : 4), c.y + 1, 1, 1, c.color);
      this.px(c.x + (c.dir > 0 ? -3 : 6), c.y + 1, 2, 1, c.color + '66');
    }
    // Mid skyline
    for (const b of this.mid) {
      this.px(b.x, ground - b.h, b.w, b.h, b.color);
      this.px(b.x, ground - b.h, b.w, 1, '#231a45');
      for (const wd of b.windows) {
        const off = (Math.floor(t / 15) + Math.floor(wd.flicker * 97)) % 23 === 0;
        if (!off) this.px(wd.x, wd.y, 1, 1, wd.color);
      }
      if (b.antenna) {
        const ax = b.x + Math.floor(b.w / 2);
        this.px(ax, ground - b.h - 6, 1, 6, '#2a2448');
        if (t % 20 < 10) this.px(ax, ground - b.h - 7, 1, 1, '#ff4a4a');
      }
      if (b.sign) {
        const on = Math.floor(t / 8 + b.x) % 7 !== 0;
        this.px(b.x + 1, b.sign.y, b.sign.w, 2, on ? b.sign.color : '#2a2448');
      }
      if (b.billboard) {
        const bx = b.x + 3, by = ground - b.h + 4, bw = b.w - 6;
        this.px(bx - 1, by - 1, bw + 2, 9, '#2a2448');
        const phase = Math.floor(t / 20) % NEON.length;
        for (let i = 0; i < bw; i++) this.px(bx + i, by + ((i + Math.floor(t / 3)) % 7), 1, 1, NEON[(phase + (i >> 2)) % NEON.length]);
      }
    }
    // Elevated maglev track and train
    this.px(0, ground, w, 14, '#07060f');
    this.px(0, ground + 3, w, 2, '#2a2448');
    for (let x = 4; x < w; x += 24) this.px(x, ground + 5, 2, 9, '#1a1530');
    const trainLen = 60, tx = ((t * 3) % (w + trainLen * 4)) - trainLen;
    if (tx < w) {
      this.px(tx, ground - 2, trainLen, 5, '#c0c0d8');
      for (let i = 2; i < trainLen - 2; i += 4) this.px(tx + i, ground - 1, 2, 1, '#5ff3ff');
      this.px(tx + trainLen, ground - 1, 2, 3, '#fff6c0');
    }
    if (this.dim) {
      g.fillStyle = 'rgba(5, 4, 14, 0.55)';
      g.fillRect(0, 0, w, h);
    }
  }

  destroy() {
    clearInterval(this.timer);
  }
}
