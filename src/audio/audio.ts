// Central audio manager. Every sound in the game goes through `audio`.
// - Web Audio graph: source -> per-voice gain -> bus (music / sfx / ambience) -> master -> compressor -> speakers.
// - Nothing is created until the first user gesture (browser autoplay rules); wanted music/ambience start then.
// - SFX have a per-sound cooldown, a per-sound voice cap and a global voice cap, plus slight pitch variation.
// - Music and ambience loop sample-accurately (loopStart/loopEnd) and crossfade when the scene changes.
import { SOUNDS, type SoundName } from './manifest.ts';

export type Bus = 'music' | 'sfx' | 'ambience';
export interface AudioPrefs {
  master: number; // 0..1
  music: number;
  sfx: number;
  ambience: number;
  muted: boolean;
}

/** Relative loudness per effect so frequent sounds sit lower than rare, important ones. */
const SFX_LEVEL: Partial<Record<SoundName, number>> = {
  ui_hover: 0.18, ui_click: 0.4, ui_nav: 0.32, select: 0.38, deselect: 0.3, error: 0.4,
  turn: 0.55, match_start: 0.7, match_end: 0.75, unlock: 0.6,
  move: 0.45, attack: 0.55, hit: 0.6, destroy: 0.8, spawn: 0.55, ability: 0.6, heal: 0.5, shield: 0.6,
  structure_hit: 0.6, structure_destroy: 0.8, trap: 0.6, mine: 0.75, conveyor: 0.45,
  portal_charge: 0.6, portal_enter: 0.65, portal_warp: 0.7, portal_return: 0.7, portal_arrive: 0.65,
};
const COOLDOWN_MS: Partial<Record<SoundName, number>> = { ui_hover: 70, ui_click: 40, heal: 90, hit: 60, conveyor: 80 };
const DEFAULT_COOLDOWN = 45;
const MAX_VOICES_PER_SOUND = 3;
const MAX_VOICES = 14;
const BUS_BASE: Record<Bus, number> = { music: 0.55, sfx: 0.9, ambience: 0.5 };
const MUSIC_FADE = 1.6;
const AMBIENCE_FADE = 2.2;

interface Loaded {
  buffer: AudioBuffer;
  start: number; // seconds of encoder padding to skip
}
interface Voice {
  name: SoundName;
  src: AudioBufferSourceNode;
  started: number;
}
interface Loop {
  name: SoundName;
  src: AudioBufferSourceNode;
  gain: GainNode;
}

class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses = {} as Record<Bus, GainNode>;
  private loaded = new Map<SoundName, Loaded>();
  private loading = new Map<SoundName, Promise<Loaded | null>>();
  private voices: Voice[] = [];
  private lastPlay = new Map<SoundName, number>();
  private loops: Record<'music' | 'ambience', Loop | null> = { music: null, ambience: null };
  private wanted: Record<'music' | 'ambience', SoundName | null> = { music: null, ambience: null };
  private prefs: AudioPrefs = { master: 0.8, music: 0.6, sfx: 0.8, ambience: 0.5, muted: false };
  private failed = false;

  constructor() {
    const unlock = () => {
      this.unlock();
      ['pointerdown', 'keydown', 'touchstart'].forEach((e) => removeEventListener(e, unlock, true));
    };
    ['pointerdown', 'keydown', 'touchstart'].forEach((e) => addEventListener(e, unlock, true));
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend();
      else this.ctx.resume();
    });
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Called on the first user gesture. Safe to call repeatedly. */
  unlock() {
    if (this.ctx || this.failed) {
      this.ctx?.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
    } catch {
      this.failed = true; // no Web Audio: the game stays silent
      return;
    }
    const ctx = this.ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(comp);
    for (const b of ['music', 'sfx', 'ambience'] as Bus[]) {
      this.buses[b] = ctx.createGain();
      this.buses[b].connect(this.master);
    }
    this.applyPrefs(true);
    ctx.resume();
    // Warm the cache so the first click of each sound is not late.
    for (const name of Object.keys(SOUNDS) as SoundName[]) if (SOUNDS[name].kind === 'sfx') void this.load(name);
    if (this.wanted.music) this.setLoop('music', this.wanted.music, true);
    if (this.wanted.ambience) this.setLoop('ambience', this.wanted.ambience, true);
  }

  setPrefs(p: Partial<AudioPrefs>) {
    this.prefs = { ...this.prefs, ...p };
    this.applyPrefs();
  }
  getPrefs(): AudioPrefs {
    return { ...this.prefs };
  }

  private applyPrefs(now = false) {
    if (!this.ctx) return;
    // Cancel pending automation and ramp over ~30 ms: immediate, but without zipper clicks.
    const t = this.ctx.currentTime, ramp = now ? 0.001 : 0.03;
    const to = (p: AudioParam, v: number) => {
      p.cancelScheduledValues(t);
      p.setValueAtTime(p.value, t);
      p.linearRampToValueAtTime(v, t + ramp);
    };
    to(this.master.gain, this.prefs.muted ? 0 : this.prefs.master);
    for (const b of ['music', 'sfx', 'ambience'] as Bus[]) to(this.buses[b].gain, BUS_BASE[b] * this.prefs[b]);
  }

  private load(name: SoundName): Promise<Loaded | null> {
    const cached = this.loaded.get(name);
    if (cached) return Promise.resolve(cached);
    let p = this.loading.get(name);
    if (!p) {
      p = fetch(import.meta.env.BASE_URL + SOUNDS[name].file)
        .then((r) => {
          if (!r.ok) throw new Error(`${r.status}`);
          return r.arrayBuffer();
        })
        .then((data) => this.ctx!.decodeAudioData(data))
        .then((buffer) => {
          // Skip AAC encoder priming if the decoder left it in (first audible sample).
          const ch = buffer.getChannelData(0);
          let i = 0;
          while (i < Math.min(ch.length, 4096) && Math.abs(ch[i]) < 1e-4) i++;
          const entry = { buffer, start: i < 4096 ? i / buffer.sampleRate : 0 };
          this.loaded.set(name, entry);
          return entry;
        })
        .catch((err) => {
          console.warn(`[audio] could not load ${name}:`, err);
          return null;
        });
      this.loading.set(name, p);
    }
    return p;
  }

  /** Plays a one-shot effect. Ignored before the first user gesture. */
  play(name: SoundName, opts: { volume?: number; rate?: number; vary?: number; delay?: number } = {}) {
    if (!this.ctx || this.ctx.state === 'closed') return;
    const now = performance.now();
    if (now - (this.lastPlay.get(name) ?? -1e9) < (COOLDOWN_MS[name] ?? DEFAULT_COOLDOWN)) return;
    this.lastPlay.set(name, now);
    const fire = (l: Loaded | null) => {
      if (!l || !this.ctx) return;
      const ctx = this.ctx;
      this.voices = this.voices.filter((v) => v.started + v.src.buffer!.duration * 1000 + 50 > performance.now());
      const same = this.voices.filter((v) => v.name === name);
      if (same.length >= MAX_VOICES_PER_SOUND) this.stopVoice(same[0]);
      if (this.voices.length >= MAX_VOICES) this.stopVoice(this.voices[0]);
      const src = ctx.createBufferSource();
      src.buffer = l.buffer;
      const vary = opts.vary ?? 0.04;
      src.playbackRate.value = (opts.rate ?? 1) * (1 + (Math.random() * 2 - 1) * vary);
      const g = ctx.createGain();
      g.gain.value = (SFX_LEVEL[name] ?? 0.6) * (opts.volume ?? 1);
      src.connect(g).connect(this.buses.sfx);
      src.start(ctx.currentTime + (opts.delay ?? 0), l.start);
      const voice = { name, src, started: performance.now() };
      this.voices.push(voice);
      src.onended = () => {
        this.voices = this.voices.filter((v) => v !== voice);
        g.disconnect();
      };
    };
    const ready = this.loaded.get(name);
    if (ready) fire(ready);
    else void this.load(name).then(fire);
  }

  private stopVoice(v: Voice) {
    try {
      v.src.stop();
    } catch {
      /* already stopped */
    }
    this.voices = this.voices.filter((x) => x !== v);
  }

  setMusic(name: SoundName | null) {
    this.setLoop('music', name);
  }
  setAmbience(name: SoundName | null) {
    this.setLoop('ambience', name);
  }

  /** Crossfades a looping bus to a new track. Same track = no-op, so callers can sync freely. */
  private setLoop(kind: 'music' | 'ambience', name: SoundName | null, force = false) {
    if (!force && this.wanted[kind] === name) return;
    this.wanted[kind] = name;
    if (!this.ctx) return;
    const fadeTime = kind === 'music' ? MUSIC_FADE : AMBIENCE_FADE;
    const old = this.loops[kind];
    if (old && old.name === name) return;
    if (old) {
      const t = this.ctx.currentTime;
      old.gain.gain.cancelScheduledValues(t);
      old.gain.gain.setValueAtTime(old.gain.gain.value, t);
      old.gain.gain.linearRampToValueAtTime(0, t + fadeTime);
      old.src.stop(t + fadeTime + 0.05);
      this.loops[kind] = null;
    }
    if (!name) return;
    void this.load(name).then((l) => {
      if (!l || !this.ctx || this.wanted[kind] !== name || this.loops[kind]?.name === name) return;
      const ctx = this.ctx, entry = SOUNDS[name];
      const src = ctx.createBufferSource();
      src.buffer = l.buffer;
      src.loop = true;
      src.loopStart = l.start;
      src.loopEnd = Math.min(l.buffer.duration, l.start + ('loop' in entry ? entry.loop : l.buffer.duration));
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(1, ctx.currentTime + fadeTime);
      src.connect(g).connect(this.buses[kind]);
      src.start(ctx.currentTime, l.start);
      this.loops[kind] = { name, src, gain: g };
    });
  }

  /** Snapshot for debugging and tests. */
  debug() {
    return {
      state: this.ctx?.state ?? 'locked',
      music: this.loops.music?.name ?? null,
      ambience: this.loops.ambience?.name ?? null,
      wanted: { ...this.wanted },
      voices: this.voices.map((v) => v.name),
      loaded: this.loaded.size,
      gains: this.ctx
        ? { master: this.master.gain.value, music: this.buses.music.gain.value, sfx: this.buses.sfx.gain.value, ambience: this.buses.ambience.gain.value }
        : null,
    };
  }
}

export const audio = new AudioManager();
if (import.meta.env.DEV) (window as unknown as { slotwarsAudio: AudioManager }).slotwarsAudio = audio; // debug handle
