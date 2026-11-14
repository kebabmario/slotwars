// Game screen: renders the GameState and turns clicks into engine actions.
import { BOARD_SIZE, KING_ABILITIES, MACHINES, QUADRANT_SIZE, STRUCTURES } from '../game/config.ts';
import * as E from '../game/engine.ts';
import { LocalController, type MatchController } from '../game/actions.ts';
import type { MatchResult } from '../net/protocol.ts';
import type { Dim, Dir, GameState, KingAbility, Machine, MachineKind, PlayerId, Pos, StructureKind } from '../game/types.ts';
import { DIM_PORTAL_SPRITE, DRONE_SPRITE, ICONS, MACHINE_SPRITES, MINE_BURST_SPRITE, PORTAL_FRAME2, PORTAL_SPRITE, STRUCTURE_FRAME2, STRUCTURE_SPRITES } from '../assets/sprites/index.ts';
import { spriteUrl } from '../assets/render.ts';
import { boardMapUrl, boardSheetUrl } from '../assets/map.ts';
import { DIMENSION } from '../game/config.ts';
import { PORTAL_THEMES, playEmerge, playEnter, playWipe } from './portal-fx.ts';
import { audio } from '../audio/audio.ts';
import { lcd } from './lcd.ts';
import { DESTROY, abilityRecipe, armorGlint, healSparkle, impact, muzzle, projectile, spawnRecipe, structureDestroy, victory, type Recipe } from './fx-art.ts';
import { playFx } from './fx-run.ts';
import { motion } from './motion.ts';
import { messageBox, windowHtml } from './chrome.ts';
import type { Settings } from '../settings.ts';

type Mode = { t: 'idle' } | { t: 'spawn'; kind: E.SpawnKind } | { t: 'ability'; id: number; key: string } | { t: 'drone'; dockId: number };

/** Escapes text that may contain player-chosen King names. */
export const esc = (t: string) => t.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const SPAWN_ORDER: E.SpawnKind[] = ['scout', 'defender', 'striker', 'saboteur', 'breacher', 'medic', 'taxer', 'barricade', 'turret', 'repair', 'trap'];
const INDUSTRIAL_ORDER: E.SpawnKind[] = ['welder', 'juggernaut', 'crusher', 'conveyor', 'tesla', 'dock', 'mine'];
const DIRS: Dir[] = ['N', 'E', 'S', 'W'];
const DIR_ARROWS: Record<Dir, string> = { N: '↑', E: '→', S: '↓', W: '←' };
const key = (p: Pos) => `${p.r},${p.c}`;
const spawnName = (k: E.SpawnKind) => (k in MACHINES ? MACHINES[k as MachineKind].name : STRUCTURES[k as StructureKind].name);
const spawnSprite = (k: E.SpawnKind) => (k in MACHINES ? MACHINE_SPRITES[k as MachineKind] : STRUCTURE_SPRITES[k as StructureKind]);

/** Player actions the tutorial can gate and observe. */
export type GuidedAction =
  | { kind: 'select'; id: number }
  | { kind: 'deselect' }
  | { kind: 'move'; id: number; to: Pos }
  | { kind: 'attack'; id: number; to: Pos }
  | { kind: 'spawnPick'; spawn: string }
  | { kind: 'spawn'; spawn: string; at: Pos }
  | { kind: 'abilityPick'; key: string }
  | { kind: 'ability'; key: string }
  | { kind: 'endTurn' }
  | { kind: 'tab'; dim: Dim }
  | { kind: 'other' };

export interface TutorialHooks {
  allow(a: GuidedAction): boolean;
  done(a: GuidedAction): void;
  afterRender(): void;
  exit(): void;
}

export interface MatchOptions {
  kings: [KingAbility, KingAbility];
  names: [string, string]; // King names
  fog: boolean;
  playerNames?: [string, string];
  startingPoints?: number;
}

/** Online play: the server owns the state; this device plays one seat. */
export interface OnlineSession {
  ctl: MatchController;
  initial: GameState;
  resign(): void;
  claim(): void;
  leave(): void; // closes the connection and returns to the online screen
}

export class GameScreen {
  private s: GameState;
  /** Every state change goes through here (hot-seat: applied in the browser). */
  private ctl: MatchController = new LocalController(() => this.s);
  private online?: OnlineSession;
  private result: MatchResult | null = null;
  private awayUntil: [number | null, number | null] = [null, null]; // online: when each absent player's grace ends
  private netNote = ''; // online: connection or pause message
  private netTimer = 0;
  private sel: { kind: 'machine' | 'structure'; id: number } | null = null;
  private mode: Mode = { t: 'idle' };
  private hover: Pos | null = null;
  private viewDim: Dim = 0; // battlefield shown on screen
  private busy = false;
  private fxHidden = new Map<string, number>(); // "dim:r,c" -> sprite hidden while its spawn animation plays
  private conveyorDir: Dir = 'E'; // direction for the next conveyor placed // true while a portal transition plays: every input is ignored
  private el!: Record<string, HTMLElement>;
  private notice = '';
  private onKey = (e: KeyboardEvent) => {
    if (this.busy || document.querySelector('.modal-back')) return;
    if (e.key === 'Escape') this.cancel();
    if ((e.key === 'r' || e.key === 'R') && this.mode.t === 'spawn' && this.mode.kind === 'conveyor') {
      this.conveyorDir = DIRS[(DIRS.indexOf(this.conveyorDir) + 1) % 4];
      this.render();
    }
  };

  private root: HTMLElement;
  private opts: MatchOptions;
  private settings: Settings;
  private go: (screen: string) => void;

  private tutorial?: TutorialHooks;

  constructor(root: HTMLElement, opts: MatchOptions, settings: Settings, go: (screen: string) => void, tutorial?: TutorialHooks, online?: OnlineSession) {
    this.tutorial = tutorial;
    this.root = root;
    this.opts = opts;
    this.settings = settings;
    this.go = go;
    this.online = online;
    if (online) this.ctl = online.ctl;
    this.s = online ? online.initial : E.createGame(this.opts.kings, this.opts.fog, this.opts.names, { playerNames: this.opts.playerNames, startingPoints: this.opts.startingPoints });
    this.mount();
    audio.play('match_start');
    setTimeout(() => (boardSheetUrl(1), boardMapUrl(1, 0)), 0); // pre-render the dimension so a warp never stalls
    if (import.meta.env.DEV) Object.assign(window, { slotwars: this, slotwarsFx: { DESTROY, spawnRecipe, abilityRecipe, impact, victory } }); // debug handles
    addEventListener('keydown', this.onKey);
  }

  destroy() {
    removeEventListener('keydown', this.onKey);
    clearInterval(this.netTimer);
  }

  private get viewer(): PlayerId {
    return this.ctl.seat ?? this.s.current; // hot-seat: whoever is playing; online: this device's seat
  }

  // ---------- layout ----------

  private mount() {
    const cols = Array.from({ length: BOARD_SIZE }, (_, i) => `<span>${String.fromCharCode(65 + i)}</span>`).join('');
    const rows = Array.from({ length: BOARD_SIZE }, (_, i) => `<span>${i + 1}</span>`).join('');
    this.root.innerHTML = windowHtml(
      this.online ? 'Slot Wars · Online Match' : 'Slot Wars · Local Match',
      `<div class="sunken hud" id="hud"></div>
       <div class="main">
         <div class="board-frame">
           <div class="dimtabs" id="dimtabs" role="tablist"></div>
           <div class="board-wrap">
             <div class="cols">${cols}</div>
             <div class="rows">${rows}</div>
             <div class="board" id="board" role="grid" aria-label="Battlefield"></div>
           </div>
         </div>
         <aside class="side" id="side"></aside>
       </div>
       <div class="well log" id="log" aria-live="polite"></div>`,
      {
        cls: 'game',
        close: true,
        menubar: this.online
          ? '<button data-m="resign">Re<u>s</u>ign</button><button data-m="rules">Quick <u>H</u>elp</button><button data-m="menu"><u>L</u>eave</button>'
          : `<button data-m="restart"><u>R</u>estart</button><button data-m="new"><u>N</u>ew Match</button>
                  <button data-m="rules">Quick <u>H</u>elp</button><button data-m="menu"><u>M</u>ain Menu</button>`,
        status: `<div id="st-hover">Ready.</div><div id="st-mode" class="fit"></div><div id="st-fog" class="fit"></div>`,
      },
    );
    const $ = (id: string) => this.root.querySelector<HTMLElement>(`#${id}`)!;
    this.el = { tabs: $('dimtabs'), hud: $('hud'), board: $('board'), side: $('side'), log: $('log'), hover: $('st-hover'), mode: $('st-mode'), fog: $('st-fog') };
    const fx = document.createElement('div');
    fx.className = 'fx';
    this.el.fx = fx;

    this.root.querySelector('[data-act="close"]')!.addEventListener('click', () => !this.busy && (this.tutorial ? this.tutorial.exit() : this.confirmLeave()));
    if (this.tutorial) this.root.querySelector('.game')?.classList.add('tutorial-mode');
    this.root.querySelector('.menubar')!.addEventListener('click', (e) => {
      const m = (e.target as HTMLElement).closest<HTMLElement>('[data-m]')?.dataset.m;
      if (this.busy) return;
      if (m === 'restart') this.confirmRestart();
      if (m === 'new') this.confirmLeave('setup');
      if (m === 'menu') this.confirmLeave();
      if (m === 'rules') this.quickHelp();
      if (m === 'resign') this.confirmResign();
    });
    this.el.board.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('.tile');
      if (t) this.clickTile({ r: +t.dataset.r!, c: +t.dataset.c! });
    });
    this.el.board.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!this.busy) this.cancel();
    });
    this.el.board.addEventListener('mouseover', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('.tile');
      if (!t) return;
      const p = { r: +t.dataset.r!, c: +t.dataset.c! };
      if (this.hover && E.samePos(this.hover, p)) return;
      this.hover = p;
      this.el.hover.textContent = this.describeTile(p);
      if (this.mode.t === 'ability') this.renderBoard();
    });
    this.el.side.addEventListener('click', (e) => this.clickSide(e));
    this.el.tabs.addEventListener('click', (e) => {
      const d = (e.target as HTMLElement).closest<HTMLElement>('[data-dim]')?.dataset.dim;
      if (d === undefined || this.busy || !this.gate({ kind: 'tab', dim: Number(d) as Dim })) return;
      this.viewDim = Number(d) as Dim;
      this.hover = null;
      this.render();
      this.tutorial?.done({ kind: 'tab', dim: this.viewDim });
    });
    this.render();
  }

  // ---------- input ----------

  private cancel() {
    if (this.mode.t !== 'idle') this.mode = { t: 'idle' };
    else this.sel = null;
    this.notice = '';
    this.render();
  }

  private selectedMachine(): Machine | undefined {
    return this.sel?.kind === 'machine' ? E.getMachine(this.s, this.sel.id) : undefined;
  }

  private clickTile(p: Pos) {
    const s = this.s;
    if (s.winner !== null || this.busy) return;
    this.notice = '';
    if (this.mode.t === 'spawn') {
      const kind = this.mode.kind;
      if (!this.gate({ kind: 'spawn', spawn: kind, at: p })) return;
      const r = this.ctl.apply({ t: 'spawn', kind, at: p, dir: this.conveyorDir });
      if (this.sentOnline(r)) return;
      if (r.ok) this.tutorial?.done({ kind: 'spawn', spawn: kind, at: p });
      if (r.ok) {
        audio.play('spawn');
        this.mode = { t: 'idle' };
        const m = E.machineAt(s, p, 0);
        if (m && kind in MACHINES) this.sel = { kind: 'machine', id: m.id };
        this.afterAction();
      } else this.flashNotice(r.error);
      return;
    }
    if (this.mode.t === 'drone') {
      if (!this.gate({ kind: 'other' })) return;
      const target = E.machineAt(s, p, this.viewDim);
      const r = target ? this.ctl.apply({ t: 'assignDrone', dockId: this.mode.dockId, machineId: target.id }) : { ok: false as const, error: 'Pick one of your machines.' };
      if (this.sentOnline(r)) return;
      if (!r.ok) return this.flashNotice(r.error);
      audio.play('select');
      this.mode = { t: 'idle' };
      return this.afterAction();
    }
    if (this.mode.t === 'ability') {
      const { id, key: k } = this.mode;
      const target = this.abilityTargetFor(id, k, p);
      if (!target) return this.flashNotice('Not a valid target.');
      if (!this.gate({ kind: 'ability', key: k })) return;
      const r = this.ctl.apply({ t: 'ability', id, key: k, target });
      if (this.sentOnline(r)) return;
      this.mode = { t: 'idle' };
      if (!r.ok) this.flashNotice(r.error);
      else audio.play('ability');
      this.afterAction();
      if (r.ok) this.tutorial?.done({ kind: 'ability', key: k });
      return;
    }
    const m = this.selectedMachine();
    if (m && m.owner === this.viewer) {
      if (m.dim === this.viewDim && E.getMoveTargets(s, m.id).some((o) => E.samePos(o.pos, p))) {
        const from = { ...m.pos }, fromDim = m.dim;
        if (!this.gate({ kind: 'move', id: m.id, to: p })) return;
        if (this.sentOnline(this.ctl.apply({ t: 'move', id: m.id, to: p }))) return;
        const moved: GuidedAction = { kind: 'move', id: m.id, to: p };
        if (m.dim === fromDim) audio.play('move', { rate: m.kind === 'scout' ? 1.25 : ['juggernaut', 'crusher', 'breacher'].includes(m.kind) ? 0.8 : 1 });
        if (m.kind === 'scout' && m.dim === fromDim && Math.abs(m.pos.r - from.r) + Math.abs(m.pos.c - from.c) === 2 && motion.secondary())
          void playFx({ board: this.el.board, fx: this.el.fx }, abilityRecipe({ key: 'quickstep', w: 1, h: 1, team: m.owner }), from); // Quickstep afterimage
        if (!s.machines.includes(m)) this.sel = null;
        else if (m.dim !== fromDim) return void this.portalTransition([{ m, from }], fromDim, 'portal').then(() => this.tutorial?.done(moved)); // the engine warped it
        this.afterAction();
        return this.tutorial?.done(moved);
      }
      if (m.dim === this.viewDim && E.getAttackTargets(s, m.id).some((o) => E.samePos(o.pos, p))) {
        if (!this.gate({ kind: 'attack', id: m.id, to: p })) return;
        if (this.sentOnline(this.ctl.apply({ t: 'attack', id: m.id, at: p }))) return;
        audio.play('attack', { rate: ['crusher', 'breacher', 'juggernaut'].includes(m.kind) ? 0.8 : m.kind === 'scout' ? 1.2 : 1 });
        this.afterAction();
        return this.tutorial?.done({ kind: 'attack', id: m.id, to: p });
      }
    }
    const um = E.machineAt(s, p, this.viewDim);
    const st = this.viewDim === 0 ? E.structureAt(s, p) : undefined;
    const had = this.sel;
    let next: typeof this.sel = null;
    if (um && E.canSeeMachine(s, this.viewer, um)) next = m?.id === um.id ? null : { kind: 'machine', id: um.id };
    else if (st && E.canSeeStructure(s, this.viewer, st)) next = { kind: 'structure', id: st.id };
    const act: GuidedAction = next?.kind === 'machine' ? { kind: 'select', id: next.id } : next ? { kind: 'other' } : { kind: 'deselect' };
    if ((next?.id !== had?.id || next?.kind !== had?.kind) && !this.gate(act)) return;
    this.sel = next;
    if (this.sel && (this.sel.id !== had?.id || this.sel.kind !== had?.kind)) audio.play('select');
    else if (!this.sel && had) audio.play('deselect');
    this.render();
    if (next?.id !== had?.id || next?.kind !== had?.kind) this.tutorial?.done(act);
  }

  /** Tutorial gate: returns false (with feedback) when the action is not the one the current step asks for. */
  private gate(a: GuidedAction): boolean {
    if (this.online && this.s.current !== this.viewer && !['select', 'deselect', 'tab', 'other'].includes(a.kind)) {
      this.flashNotice("It's your opponent's turn.");
      return false;
    }
    if (!this.tutorial || this.tutorial.allow(a)) return true;
    this.flashNotice('Follow the tutorial step first.');
    return false;
  }

  private abilityTargetFor(id: number, k: string, p: Pos): Pos | undefined {
    const targets = E.getAbilityTargets(this.s, id, k);
    const ab = E.getAbilities(this.s, id).find((a) => a.key === k);
    if (!ab) return;
    if (ab.target.type === 'area') {
      const anchor = this.areaAnchor(p, ab.target.size);
      return targets.find((t) => E.samePos(t, anchor));
    }
    if (ab.target.type === 'quadrant') return targets.find((t) => E.quadrantOf(t) === E.quadrantOf(p));
    return targets.find((t) => E.samePos(t, p));
  }

  private areaAnchor(p: Pos, size: number): Pos {
    const off = Math.floor((size - 1) / 2);
    const clamp = (v: number) => Math.max(0, Math.min(BOARD_SIZE - size, v - off));
    return { r: clamp(p.r), c: clamp(p.c) };
  }

  private clickSide(e: Event) {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b || b.disabled || this.busy) return;
    const s = this.s;
    this.notice = '';
    const pick: GuidedAction = b.dataset.spawn ? { kind: 'spawnPick', spawn: b.dataset.spawn } : b.dataset.ability ? { kind: 'abilityPick', key: b.dataset.ability } : b.id === 'end-turn' ? { kind: 'endTurn' } : { kind: 'other' };
    // instant abilities fire on the button press, so they are judged as the ability itself
    const instant = b.dataset.ability && this.selectedMachine() && E.getAbilities(s, this.selectedMachine()!.id).find((a) => a.key === b.dataset.ability)?.target.type === 'instant';
    if (!this.gate(instant ? { kind: 'ability', key: b.dataset.ability! } : pick)) return;
    if (b.dataset.net === 'claim') return this.online?.claim();
    if (b.dataset.dir) {
      this.conveyorDir = b.dataset.dir as Dir;
      return this.render();
    }
    if (b.dataset.assign) {
      this.mode = this.mode.t === 'drone' ? { t: 'idle' } : { t: 'drone', dockId: Number(b.dataset.assign) };
      return this.render();
    }
    if (b.dataset.spawn) {
      const kind = b.dataset.spawn as E.SpawnKind;
      this.mode = this.mode.t === 'spawn' && this.mode.kind === kind ? { t: 'idle' } : { t: 'spawn', kind };
      if (this.mode.t === 'spawn') this.viewDim = 0; // spawning only happens on the main battlefield
      if (this.mode.t === 'spawn' && E.getSpawnTiles(s, kind).length === 0) {
        this.mode = { t: 'idle' };
        this.flashNotice('No free tile in your home quadrant.');
      }
      this.render();
      if (this.mode.t === 'spawn') this.tutorial?.done(pick);
      return;
    }
    if (b.dataset.ability) {
      const m = this.selectedMachine();
      if (!m) return;
      const ab = E.getAbilities(s, m.id).find((a) => a.key === b.dataset.ability)!;
      if (ab.target.type === 'instant') {
        const r = this.ctl.apply({ t: 'ability', id: m.id, key: ab.key });
        if (this.sentOnline(r)) return;
        if (!r.ok) this.flashNotice(r.error);
        else audio.play('ability');
        this.afterAction();
        if (r.ok) this.tutorial?.done({ kind: 'ability', key: ab.key });
        return;
      }
      this.mode = this.mode.t === 'ability' && this.mode.key === ab.key ? { t: 'idle' } : { t: 'ability', id: m.id, key: ab.key };
      if (this.mode.t === 'ability') this.viewDim = ab.target.type === 'tile' || ab.target.type === 'quadrant' ? 0 : m.dim;
      this.render();
      if (this.mode.t === 'ability') this.tutorial?.done(pick);
      return;
    }
    if (b.id === 'end-turn') this.endTurn();
  }

  private flashNotice(text: string) {
    if (text) audio.play('error');
    this.notice = text;
    this.render();
  }

  private async endTurn() {
    if (this.busy) return;
    const actor = this.s.current;
    const unlockedBefore = this.s.players.map((p) => p.unlocked.length);
    const res = this.ctl.apply({ t: 'endTurn' });
    if (this.sentOnline(res)) return;
    if (!res.ok) {
      if (this.s.pendingSummon === this.s.current) this.summonDialog();
      return this.flashNotice(res.error);
    }
    this.mode = { t: 'idle' };
    this.sel = null;
    this.viewDim = 0;
    if (this.s.events.some((e) => e.type === 'shot')) audio.play('attack', { rate: 0.75, volume: 0.8 }); // turret volley
    if (this.s.winner === null) audio.play('turn', { delay: 0.15 });
    if (this.s.players.some((p, i) => p.unlocked.length > unlockedBefore[i])) audio.play('unlock', { delay: 0.35 });
    this.playEvents(actor);
    this.render();
    if (this.s.winner !== null) return this.showWinner();
    if (this.settings.passScreen && this.s.fog) {
      const p = this.s.current;
      this.root.classList.add('hidden-board');
      const box = messageBox(
        'Pass the Device',
        `<div class="pass"><div>Hand over to</div><div class="who" style="color:var(--p${p + 1})">${this.pn(p).toUpperCase()}</div><div>${this.pn(p === 0 ? 1 : 0)}, no peeking!</div></div>`,
        ['I am ready'],
        spriteUrl(MACHINE_SPRITES.sludgy, p),
      );
      document.querySelector('.modal-back')?.setAttribute('style', 'background:#05040e');
      await box;
      this.root.classList.remove('hidden-board');
    }
    this.turnBanner();
    this.tutorial?.done({ kind: 'endTurn' });
    if (this.s.pendingSummon === this.s.current) this.summonDialog();
  }

  /** "PLAYER n · ROUND x" strip across the board plus a pulse on the active HUD tag. */
  private turnBanner() {
    if (!motion.decorative()) return;
    const s = this.s, p = s.current;
    const b = document.createElement('div');
    b.className = `turn-banner p${p + 1}`;
    b.innerHTML = `<img src="${spriteUrl(MACHINE_SPRITES.sludgy, p)}" alt="" /><b>${this.pn(p).toUpperCase()}</b><span>ROUND ${Math.floor(s.turn / 2) + 1}</span>`;
    this.el.fx.appendChild(b);
    setTimeout(() => b.remove(), motion.ms(1300));
    this.el.hud.classList.add('turn-start');
    setTimeout(() => this.el.hud.classList.remove('turn-start'), motion.ms(1000));
  }

  /** Escaped display name of a player, for HTML. */
  private pn(p: PlayerId) {
    return esc(this.s.players[p].name);
  }

  private animOn() {
    return !motion.reduced();
  }

  private shakeBoard(kind: 'light' | 'heavy') {
    const el = this.root.querySelector('.board-frame');
    if (!el) return;
    el.classList.remove('shake-light', 'shake-heavy');
    void (el as HTMLElement).offsetWidth; // restart the CSS animation
    el.classList.add(`shake-${kind}`);
    setTimeout(() => el.classList.remove(`shake-${kind}`), kind === 'heavy' ? 450 : 250);
  }

  /** Target flinches and flashes white when hit. */
  private react(p: Pos, heavy: boolean) {
    const u = this.el.board.querySelector(`.tile[data-r="${p.r}"][data-c="${p.c}"] .unit`);
    if (!u) return;
    u.classList.remove('hit-react', 'hit-heavy');
    void (u as HTMLElement).offsetWidth;
    u.classList.add('hit-react');
    if (heavy) u.classList.add('hit-heavy');
    setTimeout(() => u.classList.remove('hit-react', 'hit-heavy'), 420);
  }

  /** The opponent held the dimension for 3 turns: pick machines to send through. */
  private summonDialog() {
    const s = this.s;
    if (document.querySelector('.summon-list')) return; // already open
    audio.play('portal_charge');
    const pool = E.getSummonCandidates(s);
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = windowHtml(
      'Portal Surge',
      `<div class="msg"><img src="${spriteUrl(DIM_PORTAL_SPRITE)}" alt="" />
         <div>${this.pn(s.current)}, your opponent has held the <b>Industrial Dimension</b> for ${DIMENSION.summonAfterTurns} turns.
         Choose which of your machines go through the portal (at least one).</div></div>
       <div class="summon-list">${pool
         .map(
           (m) => `<label class="radio"><input type="checkbox" value="${m.id}" />
             <img src="${spriteUrl(MACHINE_SPRITES[m.kind], m.owner)}" alt="" />
             <span><b>${esc(E.machineName(s, m))}</b><small>${E.coord(m.pos)} · ${m.hp}/${m.maxHp} HP</small></span></label>`,
         )
         .join('')}</div>
       <div class="row-end"><button class="btn big" id="send" disabled>Send Through</button></div>`,
    );
    const boxes = [...back.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
    const send = back.querySelector<HTMLButtonElement>('#send')!;
    boxes.forEach((b) => b.addEventListener('change', () => (send.disabled = !boxes.some((x) => x.checked))));
    send.addEventListener('click', () => {
      if (this.busy) return;
      const ids = boxes.filter((b) => b.checked).map((b) => Number(b.value));
      const before = new Map(pool.map((m) => [m.id, { ...m.pos }]));
      const r = this.ctl.apply({ t: 'summon', ids });
      if (this.sentOnline(r)) return void back.remove();
      if (!r.ok) return this.flashNotice(r.error);
      back.remove();
      const sent = ids.map((id) => E.getMachine(s, id)).filter((m): m is Machine => !!m && m.dim === 1);
      this.portalTransition(sent.map((m) => ({ m, from: before.get(m.id)! })), 0, 'summon');
    });
    document.body.appendChild(back);
    boxes[0]?.focus();
  }

  /**
   * Animates machines the engine has already moved between battlefields.
   * 'portal': one machine stepped on the portal. 'summon': machines pulled in where they stood.
   * Input stays locked until the transition ends, so it can never be triggered twice.
   */
  private async portalTransition(travellers: { m: Machine; from: Pos }[], fromDim: Dim, kind: 'portal' | 'summon') {
    const s = this.s;
    s.events = s.events.filter((e) => e.type !== 'warp');
    const toDim: Dim = fromDim === 0 ? 1 : 0;
    if (!travellers.length || motion.reduced()) {
      audio.play(fromDim === 0 ? 'portal_warp' : 'portal_return');
      audio.play('portal_arrive', { delay: 0.25 });
      this.viewDim = toDim;
      return this.afterAction();
    }
    audio.play('portal_charge');
    audio.play('portal_enter', { delay: 0.18 });
    this.busy = true;
    this.root.classList.add('busy');
    const stage = { board: this.el.board, fx: this.el.fx };
    const sprite = (m: Machine) => spriteUrl(MACHINE_SPRITES[m.kind], m.owner);
    const srcPortal = E.portalOf(fromDim), dstPortal = E.portalOf(toDim);
    try {
      if (this.viewDim !== fromDim) {
        this.viewDim = fromDim;
        this.renderBoard();
      }
      await Promise.all(
        travellers.map(({ m, from }, i) =>
          new Promise((r) => setTimeout(r, motion.ms(i * 120))).then(() =>
            playEnter(stage, { sprite: sprite(m), flip: m.owner === 1, from, portal: kind === 'portal' ? srcPortal : from, theme: PORTAL_THEMES[fromDim] }),
          ),
        ),
      );
      audio.play(fromDim === 0 ? 'portal_warp' : 'portal_return');
      await playWipe(stage, {
        from: kind === 'portal' ? srcPortal : travellers[0].from,
        to: kind === 'portal' ? dstPortal : travellers[0].m.pos,
        fromTheme: PORTAL_THEMES[fromDim],
        toTheme: PORTAL_THEMES[toDim],
        swap: () => {
          this.viewDim = toDim;
          this.render();
        },
      });
      audio.play('portal_arrive');
      await Promise.all(
        travellers.map(({ m }, i) =>
          new Promise((r) => setTimeout(r, motion.ms(i * 120))).then(() =>
            playEmerge(stage, { sprite: sprite(m), flip: m.owner === 1, portal: kind === 'portal' ? dstPortal : m.pos, to: m.pos, theme: PORTAL_THEMES[toDim] }),
          ),
        ),
      );
    } finally {
      this.busy = false;
      this.root.classList.remove('busy');
      this.afterAction();
    }
  }

  private afterAction() {
    this.playEvents(this.viewer);
    if (this.sel?.kind === 'machine' && !E.getMachine(this.s, this.sel.id)) this.sel = null;
    this.render();
    if (this.s.winner !== null) this.showWinner();
  }

  private async showWinner() {
    const w = this.s.winner!;
    audio.play('match_end', { delay: 0.4, vary: 0 });
    if (this.animOn()) {
      // let the King's destruction play, then fireworks + banner before the dialog
      await new Promise((r) => setTimeout(r, motion.ms(1500)));
      if (this.s.winner !== w) return; // restarted meanwhile
      const b = document.createElement('div');
      b.className = `win-banner ${w === 'draw' ? '' : `p${w + 1}`}`;
      b.innerHTML = w === 'draw' ? '<b>DRAW</b><span>BOTH KINGS DOWN</span>' : `<b>${this.pn(w).toUpperCase()} WINS</b><span>${esc(this.s.players[w === 0 ? 1 : 0].kingName)} IS DOWN</span>`;
      if (motion.decorative()) {
        this.el.fx.appendChild(b);
        await playFx({ board: this.el.board, fx: this.el.fx }, victory(w === 'draw' ? 'neutral' : w), { r: 0, c: 0 });
      }
      if (this.s.winner !== w) return;
    }
    const loserName = w === 'draw' ? '' : esc(this.s.players[w === 0 ? 1 : 0].kingName);
    const text = w === 'draw' ? 'Both Kings fell. It is a draw!' : `<b>${this.pn(w)}</b> destroyed ${loserName} and wins the match!`;
    if (this.online) {
      const loser = w === 'draw' ? '' : this.pn(w === 0 ? 1 : 0);
      const reason = this.result?.reason ?? 'king';
      const online = reason === 'resign' ? `<b>${this.pn(w as PlayerId)}</b> wins: ${loser} resigned.`
        : reason === 'forfeit' ? `<b>${this.pn(w as PlayerId)}</b> wins: ${loser} did not come back in time.`
        : reason === 'abandoned' ? 'Both players left, so the match was abandoned. It is not rated.'
        : text;
      await messageBox('Match Over', online, ['Leave'], spriteUrl(MACHINE_SPRITES.sludgy, w === 'draw' ? 'neutral' : w));
      return this.online.leave();
    }
    const i = await messageBox('Match Over', text, ['Rematch', 'Main Menu'], spriteUrl(MACHINE_SPRITES.sludgy, w === 'draw' ? 'neutral' : w));
    if (i === 0) this.restart();
    if (i === 1) this.go('menu');
  }

  // ---------- tutorial API ----------
  get state(): GameState {
    return this.s;
  }
  get element(): HTMLElement {
    return this.root;
  }
  get view(): Dim {
    return this.viewDim;
  }
  get isBusy() {
    return this.busy;
  }
  /** Replaces the match state (tutorial scenarios). */
  loadState(s: GameState, view: Dim = 0) {
    this.s = s;
    this.el.fx.replaceChildren();
    this.fxHidden.clear();
    this.sel = null;
    this.mode = { t: 'idle' };
    this.notice = '';
    this.viewDim = view;
    this.render();
  }
  setView(d: Dim) {
    if (this.viewDim === d) return;
    this.viewDim = d;
    this.render();
  }
  refresh() {
    this.afterAction();
  }

  private restart() {
    this.s = E.createGame(this.opts.kings, this.opts.fog, this.opts.names, { playerNames: this.opts.playerNames, startingPoints: this.opts.startingPoints });
    this.el.fx.replaceChildren(); // drop any effect still playing from the last match
    this.fxHidden.clear();
    audio.play('match_start');
    this.sel = null;
    this.mode = { t: 'idle' };
    this.notice = '';
    this.viewDim = 0;
    this.render();
  }

  private async confirmRestart() {
    const i = await messageBox('Restart', 'Restart this match from turn 1?', ['Restart', 'Cancel'], spriteUrl(MACHINE_SPRITES.sludgy, this.viewer));
    if (i === 0) this.restart();
  }

  private async confirmLeave(to = 'menu') {
    if (this.online) {
      if (this.s.winner === null && (await messageBox('Leave Match', 'Leave this match? You have 2 minutes to come back before your opponent can claim the win.', ['Leave', 'Stay'])) !== 0) return;
      return this.online.leave();
    }
    if (this.s.winner !== null) return this.go(to);
    const i = await messageBox('Leave Match', 'Abandon the current match?', ['Leave', 'Stay']);
    if (i === 0) this.go(to);
  }

  private quickHelp() {
    messageBox(
      'Quick Help',
      `<b>Select</b> a machine, then:<br/>· cyan tiles = move (1 square, Scout 2)<br/>· red crosshair = diagonal attack (range 2)<br/>
       <b>Spawn</b> from the side panel into your home quadrant (free action).<br/>
       <b>Abilities</b> spend SP. Area abilities follow your cursor.<br/>
       <b>Right-click / Esc</b> cancels. One move or attack per turn.`,
      ['OK'],
    );
  }

  // ---------- online ----------

  /** Online: the action went to the server; its result arrives in receive(). */
  private sentOnline(r: { ok: boolean }): boolean {
    if (!('pending' in r)) return false;
    this.mode = { t: 'idle' };
    this.render();
    return true;
  }

  /** Online: a new view from the server (already redacted for this seat) and the events this seat may see. */
  receive(msg: { view: GameState; events: GameState['events']; actor: PlayerId | null; ack?: { action: string }; result: MatchResult | null }) {
    const prev = this.s, me = this.viewer;
    this.result = msg.result;
    this.netNote = '';
    this.s = msg.view;
    this.s.events = msg.events;
    if (msg.result && msg.view.winner === null) this.s.winner = msg.result.winner ?? 'draw';
    const act = msg.ack?.action;
    if (act === 'move') audio.play('move');
    if (act === 'attack') audio.play('attack');
    if (act === 'spawn') audio.play('spawn');
    if (act === 'ability') audio.play('ability');
    if (this.sel?.kind === 'machine' && !E.getMachine(this.s, this.sel.id)) this.sel = null;
    if (this.s.current !== me) this.mode = { t: 'idle' };
    // my own machines that changed battlefield because of my action: play the portal transition
    const travellers = msg.actor === me
      ? this.s.machines.flatMap((m) => {
          const old = prev.machines.find((o) => o.id === m.id);
          return old && old.dim !== m.dim && m.owner === me ? [{ m, from: old.pos, dim: old.dim }] : [];
        })
      : [];
    if (travellers.length && this.s.winner === null) {
      void this.portalTransition(travellers, travellers[0].dim, act === 'summon' ? 'summon' : 'portal');
      return;
    }
    if (prev.turn !== this.s.turn && this.s.winner === null && msg.actor !== null) {
      if (this.s.events.some((e) => e.type === 'shot')) audio.play('attack', { rate: 0.75, volume: 0.8 }); // turret volley
      audio.play('turn', { delay: 0.15 });
      if (this.s.players[me].unlocked.length > prev.players[me].unlocked.length) audio.play('unlock', { delay: 0.35 });
      this.playEvents(me);
      this.render();
      this.turnBanner();
      if (this.s.pendingSummon === me) this.summonDialog();
      return;
    }
    this.afterAction();
    if (this.s.winner === null && this.s.pendingSummon === me) this.summonDialog();
  }

  /** Online: a short message, e.g. why the server refused an action. */
  notify(text: string) {
    this.flashNotice(text);
  }

  /** Online: ms of reconnect grace left for each seat (null = connected). */
  setPresence(away: [number | null, number | null]) {
    const now = Date.now();
    this.awayUntil = away.map((ms) => (ms === null ? null : now + ms)) as [number | null, number | null];
    clearInterval(this.netTimer);
    if (away.some((x) => x !== null)) this.netTimer = window.setInterval(() => this.renderSideOnly(), 1000);
    this.renderSideOnly();
  }

  /** Online: connection trouble or a paused match (shown until the next update). */
  setNetNote(text: string) {
    this.netNote = text;
    this.renderSideOnly();
  }

  private renderSideOnly() {
    if (!this.busy && this.el?.side?.isConnected) this.render();
  }

  private netHtml() {
    if (!this.online) return '';
    const opp = (1 - this.viewer) as PlayerId, until = this.awayUntil[opp];
    if (this.netNote) return `<div class="net-note">${esc(this.netNote)}</div>`;
    if (until === null || this.s.winner !== null) return '';
    const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
    return left > 0
      ? `<div class="net-note">${this.pn(opp)} disconnected. They have ${left}s to return.</div>`
      : `<div class="net-note">${this.pn(opp)} did not return. <button class="btn" data-net="claim">Claim Win</button></div>`;
  }

  private async confirmResign() {
    if (!this.online || this.s.winner !== null) return;
    const i = await messageBox('Resign', 'Resign this match? Your opponent wins.', ['Resign', 'Cancel'], spriteUrl(MACHINE_SPRITES.sludgy, this.viewer));
    if (i === 0) this.online.resign();
  }

  // ---------- effects ----------

  private playEvents(viewer: PlayerId) {
    const events = this.s.events.splice(0);
    this.playEventSounds(events, viewer);
    // Damage/heal numbers always show (they are information); everything else follows the motion settings.
    const board = this.el.board, s = this.s;
    if (!this.el.fx.isConnected) board.appendChild(this.el.fx);
    const size = board.clientWidth / BOARD_SIZE;
    const dim = this.viewDim;
    const layer = { board, fx: this.el.fx };
    const visible = (p: Pos) => dim === 1 || !s.fog || E.canSeeTile(s, viewer, p) || E.canSeeTile(s, s.current, p);
    const at = (el: HTMLElement, p: Pos, d = 0) => {
      el.style.left = `${p.c * size}px`;
      el.style.top = `${p.r * size}px`;
      el.style.animationDelay = `${d}ms`;
      this.el.fx.appendChild(el);
      setTimeout(() => el.remove(), 1400 + d);
    };
    const fx = (recipe: Recipe, p: Pos, d: number) => {
      if (recipe.shake && motion.decorative()) setTimeout(() => this.shakeBoard(recipe.shake!), d);
      return playFx(layer, recipe, p, { delay: d });
    };
    const num = (cls: string, text: string, p: Pos, d: number) => {
      const n = document.createElement('div');
      n.className = `num ${cls}`;
      n.textContent = text;
      at(n, p, d);
    };
    const shotAt = new Map<string, number>(); // target tile -> impact time, so the reaction lands with the hit
    let delay = 0;
    // Ability effects lead the damage and healing they cause.
    const ordered = [...events.filter((e) => e.type === 'ability'), ...events.filter((e) => e.type !== 'ability')];
    for (const ev of ordered) {
      if (ev.type === 'ability') {
        const showFrom = ev.dim === dim, showTo = ev.key === 'phantom' && ev.toDim === dim;
        if (!showFrom && !showTo) continue;
        if (ev.key === 'phantom') {
          if (showFrom) void fx(abilityRecipe({ key: 'phantom', w: 1, h: 1, team: ev.owner, machineKind: 'sludgy' }), ev.from, 0);
          if (showTo) {
            const hideKey = `0:${ev.to.r},${ev.to.c}`;
            this.fxHidden.set(hideKey, 1);
            void fx(abilityRecipe({ key: 'phantom_in', w: 1, h: 1, team: ev.owner }), ev.to, motion.ms(450)).then(() => this.reveal(hideKey, ev.to));
          }
          continue;
        }
        if (!ev.cells.some(visible)) continue;
        const r0 = Math.min(...ev.cells.map((c) => c.r)), c0 = Math.min(...ev.cells.map((c) => c.c));
        const w = Math.max(...ev.cells.map((c) => c.c)) - c0 + 1, h = Math.max(...ev.cells.map((c) => c.r)) - r0 + 1;
        const structureKind = ev.key === 'reconstruct' ? E.structureAt(s, ev.to)?.kind : undefined;
        void fx(abilityRecipe({ key: ev.key, w, h, team: ev.owner, structureKind }), { r: r0, c: c0 }, 0);
        if (ev.key === 'hulksmash' || ev.key === 'groundbreaker' || ev.key === 'massrepair') delay = Math.max(delay, motion.ms(260));
        continue;
      }
      if (ev.dim !== dim) continue;
      switch (ev.type) {
        case 'push':
          if (visible(ev.to) && motion.secondary()) { const f = document.createElement('div'); f.className = 'flash tech'; at(f, ev.to, delay); }
          break;
        case 'shot': {
          if (!visible(ev.from) && !visible(ev.to)) break;
          const heavy = !!ev.heavy, source = ev.source ?? 'scout';
          const dist = Math.max(Math.abs(ev.to.r - ev.from.r), Math.abs(ev.to.c - ev.from.c));
          // low quality / reduced motion: no projectile flight, the impact lands immediately
          const flies = this.animOn() && motion.quality() !== 'low';
          const travel = flies ? motion.ms(60 + dist * 90) : 0;
          if (motion.secondary()) void fx(muzzle(heavy), ev.from, delay);
          if (flies) this.flyProjectile(projectile(source, heavy), ev.from, ev.to, delay, travel);
          const hitAt = delay + travel;
          void fx(impact(heavy, source === 'turret' ? '#ffd23f' : heavy ? '#ff9a3c' : '#5ff3ff'), ev.to, hitAt);
          shotAt.set(`${ev.to.r},${ev.to.c}`, hitAt);
          if (this.animOn()) setTimeout(() => this.react(ev.to, heavy), hitAt);
          delay = hitAt;
          break;
        }
        case 'damage': {
          if (!visible(ev.pos)) break;
          const hit = shotAt.get(`${ev.pos.r},${ev.pos.c}`) ?? delay;
          num('dmg', `-${ev.amount}`, ev.pos, hit);
          if (!shotAt.has(`${ev.pos.r},${ev.pos.c}`) && this.animOn()) setTimeout(() => this.react(ev.pos, false), hit);
          if (ev.armor && !ev.structure && motion.secondary()) {
            // Fortify (Defender), Reinforced Plating (Juggernaut), otherwise Shield Wall / Barrier
            const color = ev.kind === 'defender' ? '#5ff3ff' : ev.kind === 'juggernaut' ? '#ffd23f' : '#8fd0ff';
            void fx(armorGlint(color), ev.pos, hit);
          }
          break;
        }
        case 'heal':
          if (visible(ev.pos)) { num('heal', `+${ev.amount}`, ev.pos, delay); if (motion.secondary()) void fx(healSparkle(), ev.pos, delay); }
          break;
        case 'blocked':
          if (visible(ev.pos)) { num('info', 'BLOCK', ev.pos, delay); void fx(abilityRecipe({ key: 'guardian', w: 1, h: 1, team: 'neutral' }), ev.pos, delay); }
          break;
        case 'destroyed': {
          if (!visible(ev.pos)) break;
          const team = ev.owner ?? 'neutral';
          const recipe = ev.structure ? structureDestroy(ev.kind ?? 'turret', team) : (DESTROY[ev.kind ?? ''] ?? DESTROY.scout)(team);
          const d = (shotAt.get(`${ev.pos.r},${ev.pos.c}`) ?? delay) + motion.ms(80);
          void fx(recipe, ev.pos, d);
          if (ev.kind === 'sludgy' && motion.decorative()) setTimeout(() => { this.el.board.classList.add('king-down'); setTimeout(() => this.el.board.classList.remove('king-down'), 600); }, d);
          break;
        }
        case 'mine': {
          if (!visible(ev.pos)) break;
          const img = document.createElement('img');
          img.className = 'boom';
          img.src = spriteUrl(MINE_BURST_SPRITE);
          img.alt = '';
          at(img, ev.pos, delay);
          void fx(impact(true, '#5ff3ff'), ev.pos, delay);
          break;
        }
        case 'zap':
          if (visible(ev.pos)) { if (motion.secondary()) { const f = document.createElement('div'); f.className = 'flash zap'; at(f, ev.pos, delay); } void fx(impact(false, '#ffd23f'), ev.pos, delay); }
          break;
        case 'spawn': {
          const hiddenKind = ev.kind === 'trap' || ev.kind === 'mine';
          if (!visible(ev.pos) || (hiddenKind && ev.owner !== viewer)) break;
          const recipe = spawnRecipe(ev.kind, ev.owner), hideKey = `0:${ev.pos.r},${ev.pos.c}`;
          this.fxHidden.set(hideKey, 1);
          void fx(recipe, ev.pos, delay).then(() => this.reveal(hideKey, ev.pos));
          break;
        }
        case 'warp': {
          if (visible(ev.pos)) { const f = document.createElement('div'); f.className = 'flash tech'; at(f, ev.pos, delay); }
          break;
        }
      }
    }
  }

  /** Shows a sprite hidden for its arrival animation. */
  private reveal(hideKey: string, p: Pos) {
    this.fxHidden.delete(hideKey);
    this.el.board.querySelectorAll(`.tile[data-r="${p.r}"][data-c="${p.c}"] .fx-hidden`).forEach((e) => e.classList.remove('fx-hidden'));
  }

  /** Projectile flies from attacker to target, rotated to the diagonal it travels. */
  private flyProjectile(recipe: Recipe, from: Pos, to: Pos, delay: number, travel: number) {
    if (!this.animOn()) return;
    const tile = this.el.board.clientWidth / BOARD_SIZE;
    const cv = document.createElement('canvas');
    cv.width = recipe.w;
    cv.height = recipe.h;
    cv.className = 'pfx-canvas proj';
    recipe.draw(cv.getContext('2d')!, 0);
    const dr = Math.sign(to.r - from.r), dc = Math.sign(to.c - from.c);
    const rot = dr > 0 ? (dc > 0 ? 0 : 90) : dc < 0 ? 180 : 270; // art points down-right
    Object.assign(cv.style, { left: `${from.c * tile}px`, top: `${from.r * tile}px`, width: `${tile}px`, height: `${tile}px`, visibility: 'hidden' });
    this.el.fx.appendChild(cv);
    setTimeout(() => {
      cv.style.visibility = '';
      cv.animate(
        [{ transform: `translate(0,0) rotate(${rot}deg)` }, { transform: `translate(${(to.c - from.c) * tile}px, ${(to.r - from.r) * tile}px) rotate(${rot}deg)` }],
        { duration: travel, easing: 'steps(6, end)', fill: 'forwards' },
      ).finished.then(() => cv.remove(), () => cv.remove());
    }, delay);
    setTimeout(() => cv.remove(), delay + travel + 200);
  }

  // ---------- rendering ----------

  /** One sound per kind of event per action, so big area hits don't stack a dozen copies. */
  private playEventSounds(events: GameState['events'], viewer: PlayerId) {
    const s = this.s;
    const heard = (dim: Dim, p: Pos) => dim === 1 || !s.fog || E.canSeeTile(s, viewer, p) || E.canSeeTile(s, s.current, p);
    const done = new Set<string>();
    const once = (key: string, fn: () => void) => {
      if (!done.has(key)) {
        done.add(key);
        fn();
      }
    };
    for (const ev of events) {
      const pos = 'pos' in ev ? ev.pos : 'to' in ev ? ev.to : ev.cells[0];
      if (!pos || !heard(ev.dim, pos)) continue;
      switch (ev.type) {
        case 'damage': once(ev.structure ? 'sh' : 'h', () => audio.play(ev.structure ? 'structure_hit' : 'hit', { delay: 0.05 })); break;
        case 'destroyed': once(ev.structure ? 'sd' : 'd', () => audio.play(ev.structure ? 'structure_destroy' : 'destroy', { delay: 0.08 })); break;
        case 'heal': once('heal', () => audio.play('heal')); break;
        case 'blocked': once('shield', () => audio.play('shield')); break;
        case 'zap': once('trap', () => audio.play('trap')); break;
        case 'mine': once('mine', () => audio.play('mine')); break;
        case 'push': once('push', () => audio.play('conveyor')); break;
      }
    }
  }

  /** Music and ambience follow the battlefield on screen; same track = no-op inside the manager. */
  private syncScene() {
    audio.setMusic(this.viewDim === 1 ? 'music_industrial' : 'music_main');
    audio.setAmbience(this.viewDim === 1 ? 'amb_factory' : 'amb_city');
  }

  private render() {
    this.syncScene();
    this.renderTabs();
    this.renderHud();
    this.renderBoard();
    this.renderSide();
    this.renderLog();
    const s = this.s;
    this.el.mode.textContent = this.modeLabel();
    this.el.fog.textContent = s.fog ? 'Fog: ON' : 'Fog: OFF';
    this.tutorial?.afterRender(); // side panel and HUD are rebuilt after the board
  }

  private renderTabs() {
    const s = this.s;
    const count = (d: Dim, p: PlayerId) => s.machines.filter((m) => m.dim === d && m.owner === p).length;
    const tab = (d: Dim, label: string) => {
      const extra =
        d === 1
          ? ([0, 1] as PlayerId[])
              .filter((p) => s.players[p].dimTurns > 0)
              .map((p) => ` · P${p + 1} ${s.players[p].dimTurns}/${DIMENSION.summonAfterTurns}`)
              .join('')
          : '';
      return `<button class="dimtab ${this.viewDim === d ? 'on' : ''}" role="tab" aria-selected="${this.viewDim === d}" data-dim="${d}">
        <img src="${spriteUrl(d ? DIM_PORTAL_SPRITE : PORTAL_SPRITE)}" alt="" />${label}
        <small><span style="color:var(--p1)">P1 ${count(d, 0)}</span> · <span style="color:var(--p2)">P2 ${count(d, 1)}</span>${extra}</small></button>`;
    };
    this.el.tabs.innerHTML = tab(0, 'Main Battlefield') + tab(1, 'Industrial Dimension');
  }

  private modeLabel(): string {
    if (this.notice) return `⚠ ${this.notice}`;
    if (this.s.winner !== null) return 'Match over';
    if (this.mode.t === 'spawn')
      return `Place ${spawnName(this.mode.kind)}${this.mode.kind === 'conveyor' ? ` facing ${E.DIR_NAMES[this.conveyorDir]} (R rotates)` : ''}`;
    if (this.mode.t === 'drone') return 'Pick a machine for the drone';
    if (this.mode.t === 'ability') {
      const m = this.mode;
      const ab = E.getAbilities(this.s, m.id).find((a) => a.key === m.key);
      return `Target: ${ab?.name}`;
    }
    return this.s.actionUsed ? 'Action used' : 'Action ready';
  }

  private renderHud() {
    const s = this.s;
    const side = (p: PlayerId) => {
      const pl = s.players[p];
      const div = document.createElement('div');
      div.className = `pstat p${p + 1} ${s.winner !== null ? (s.winner === p ? 'victor' : s.winner === 'draw' ? 'dim' : 'defeated') : s.current === p ? 'active' : 'dim'}`;
      div.innerHTML = `<span class="tag" title="Player ${p + 1}">${this.pn(p)}</span>`;
      const counter = (icon: string, value: number, label: string) => {
        const c = document.createElement('div');
        c.className = 'counter';
        c.title = label;
        c.innerHTML = `<img src="${icon}" alt="${label}" />`;
        const cv = lcd(value);
        cv.setAttribute('role', 'img');
        cv.setAttribute('aria-label', `${label}: ${value}`);
        c.appendChild(cv);
        return c;
      };
      div.appendChild(counter(spriteUrl(ICONS.point), pl.points, 'Points'));
      div.appendChild(counter(spriteUrl(ICONS.sp), pl.sp, 'SP'));
      const king = document.createElement('small');
      king.textContent = `${pl.kingName} · ${KING_ABILITIES[pl.king].name}${pl.overcharge ? ' ⚡' : ''}`;
      king.className = 'kingtag';
      div.appendChild(king);
      if (p === 1) div.append(...[...div.childNodes].reverse());
      return div;
    };
    const center = document.createElement('div');
    center.className = 'center-hud';
    const face = s.winner === null ? s.current : s.winner === 'draw' ? 'neutral' : s.winner;
    center.innerHTML = `<button class="btn face" id="face" title="Restart match" aria-label="Restart match"><img src="${spriteUrl(MACHINE_SPRITES.sludgy, face)}" alt="" /></button>`;
    const tb = document.createElement('div');
    tb.className = 'turnbox';
    const turnLcd = lcd(Math.floor(s.turn / 2) + 1, 3, '#5ff3ff', '#0a3038');
    turnLcd.setAttribute('aria-label', `Round ${Math.floor(s.turn / 2) + 1}`);
    tb.append('ROUND', turnLcd);
    const who = document.createElement('div');
    who.className = 'who';
    who.style.color = `var(--p${s.current + 1})`;
    who.textContent = s.winner !== null ? 'GAME OVER' : s.players[s.current].name.toUpperCase();
    tb.appendChild(who);
    center.appendChild(tb);
    this.el.hud.replaceChildren(side(0), center, side(1));
    this.el.hud.querySelector('#face')!.addEventListener('click', () => !this.online && this.gate({ kind: 'other' }) && this.confirmRestart());
  }

  private highlights(): Map<string, string> {
    const s = this.s;
    const hl = new Map<string, string>();
    const m = this.selectedMachine();
    const caster = this.mode.t === 'ability' ? E.getMachine(s, this.mode.id) : undefined;
    if (this.mode.t === 'spawn') {
      if (this.viewDim === 0) for (const p of E.getSpawnTiles(s, this.mode.kind)) hl.set(key(p), 'spawn');
    } else if (this.mode.t === 'ability') {
      const { id, key: k } = this.mode;
      const ab = E.getAbilities(s, id).find((a) => a.key === k);
      const boardOk = ab?.target.type === 'tile' || ab?.target.type === 'quadrant' ? this.viewDim === 0 : caster?.dim === this.viewDim;
      if (!boardOk) return hl;
      const targets = E.getAbilityTargets(s, id, k);
      if (ab?.target.type === 'area') {
        if (this.hover) {
          const anchor = this.areaAnchor(this.hover, ab.target.size);
          const ok = targets.some((t) => E.samePos(t, anchor));
          for (const c of E.areaCells(anchor, ab.target.size)) hl.set(key(c), ok ? 'area' : 'area bad');
        }
      } else if (ab?.target.type === 'quadrant') {
        for (const t of targets)
          for (const c of E.areaCells(t, QUADRANT_SIZE)) hl.set(key(c), 'target');
      } else for (const t of targets) hl.set(key(t), 'target');
    } else if (this.mode.t === 'drone') {
      for (const x of s.machines) if (x.owner === this.viewer && x.dim === this.viewDim) hl.set(key(x.pos), 'target');
    } else if (m && m.owner === this.viewer && m.dim === this.viewDim) {
      for (const o of E.getMoveTargets(s, m.id)) hl.set(key(o.pos), o.portal ? 'move portal' : 'move');
      for (const o of E.getAttackTargets(s, m.id)) hl.set(key(o.pos), 'attack');
    }
    if (this.sel) {
      const obj = this.sel.kind === 'machine' ? E.getMachine(s, this.sel.id) : s.structures.find((x) => x.id === this.sel!.id);
      const objDim = this.sel.kind === 'machine' ? (obj as Machine | undefined)?.dim : 0;
      if (obj && objDim === this.viewDim && !hl.has(key(obj.pos))) hl.set(key(obj.pos), 'selected');
    }
    return hl;
  }

  private renderBoard() {
    const s = this.s;
    const v = this.viewer;
    const dim = this.viewDim;
    const vis = E.visibleQuadrants(s, v);
    const hl = this.highlights();
    const fogOn = s.fog && dim === 0;
    const portal = E.portalOf(dim);
    const portalSprite = dim ? DIM_PORTAL_SPRITE : PORTAL_SPRITE;
    this.el.board.style.backgroundImage = `url(${boardMapUrl(dim, 0)})`;
    this.el.board.classList.toggle('industrial', dim === 1);
    // machine id -> drone is hovering over it
    const droned = new Set<number>();
    for (const d of s.structures)
      if (d.kind === 'dock' && E.canSeeStructure(s, v, d) && d.droneTarget != null) droned.add(d.droneTarget);
    let html =
      dim === 0
        ? `<div class="map2" style="background-image:url(${boardMapUrl(0, 1)})"></div>`
        : `<div class="map2 sheet" style="background-image:url(${boardSheetUrl(1)})"></div>`;
    for (let r = 0; r < BOARD_SIZE; r++)
      for (let c = 0; c < BOARD_SIZE; c++) {
        const p = { r, c };
        const q = E.quadrantOf(p);
        const cls = ['tile'];
        if (c === QUADRANT_SIZE - 1) cls.push('qedge-r');
        if (r === QUADRANT_SIZE - 1) cls.push('qedge-b');
        let inner = '';
        if (E.samePos(p, portal))
          inner += `<img class="spr obj" src="${spriteUrl(portalSprite)}" alt="" /><img class="spr obj portal-f2" src="${spriteUrl(portalSprite, 'neutral', PORTAL_FRAME2)}" alt="" />`;
        const st = dim === 0 ? E.structureAt(s, p) : undefined;
        if (st && E.canSeeStructure(s, v, st)) {
          const rot = st.dir ? ` rot-${st.dir}` : '';
          const hid = this.fxHidden.has(`0:${r},${c}`) ? ' fx-hidden' : '';
          inner += `<img class="spr obj${rot}${hid}" src="${spriteUrl(STRUCTURE_SPRITES[st.kind], st.owner)}" alt="" />`;
          const f2 = STRUCTURE_FRAME2[st.kind];
          if (f2) {
            const url = 'pixels' in f2 ? spriteUrl(f2 as never, st.owner) : spriteUrl(STRUCTURE_SPRITES[st.kind], st.owner, f2 as Record<string, string>);
            inner += `<img class="spr obj anim-f2${rot}${hid}" src="${url}" alt="" />`;
          }
          if (STRUCTURES[st.kind].hp > 1) inner += hpBar(st.hp, STRUCTURES[st.kind].hp);
        }
        const m = E.machineAt(s, p, dim);
        if (m && E.canSeeMachine(s, v, m)) {
          const hidU = this.fxHidden.has(`${dim}:${r},${c}`) ? ' fx-hidden' : '';
          inner += `<img class="spr unit p${m.owner + 1}-face${hidU}" src="${spriteUrl(MACHINE_SPRITES[m.kind], m.owner)}" alt="" />`;
          inner += `<i class="owner p${m.owner + 1}"></i>` + hpBar(m.hp, m.maxHp) + badges(s, m);
          if (droned.has(m.id)) inner += `<img class="drone" src="${spriteUrl(DRONE_SPRITE, m.owner)}" alt="" />`;
        }
        if (fogOn && !vis.has(q)) inner += '<i class="fog"></i>';
        const h = hl.get(key(p));
        if (h) inner += `<i class="hl ${h}"></i>`;
        html += `<button class="${cls.join(' ')}" data-r="${r}" data-c="${c}" aria-label="${esc(this.describeTile(p))}">${inner}</button>`;
      }
    this.el.board.innerHTML = html;
    this.el.board.appendChild(this.el.fx);
    this.tutorial?.afterRender();
  }

  private describeTile(p: Pos): string {
    const s = this.s;
    const v = this.viewer;
    const dim = this.viewDim;
    const parts = [E.coord(p), dim ? 'Industrial' : E.QUADRANT_NAMES[E.quadrantOf(p)]];
    if (E.isPortal(p, dim)) parts.push(dim ? 'Portal back to the main battlefield' : 'Portal to the Industrial Dimension');
    if (dim === 0 && s.fog && !E.canSeeTile(s, v, p)) parts.push('no signal');
    const m = E.machineAt(s, p, dim);
    if (m && E.canSeeMachine(s, v, m)) parts.push(`${E.machineName(s, m)} (P${m.owner + 1}) ${m.hp}/${m.maxHp} HP`);
    const st = dim === 0 ? E.structureAt(s, p) : undefined;
    if (st && E.canSeeStructure(s, v, st)) parts.push(`${STRUCTURES[st.kind].name} (P${st.owner + 1})`);
    return parts.join(' · ');
  }

  private renderSide() {
    const s = this.s;
    const pl = s.players[this.viewer];
    const m = this.selectedMachine();
    const st = this.sel?.kind === 'structure' ? s.structures.find((x) => x.id === this.sel!.id) : undefined;

    let info = '<div class="unit-info"><div class="full">Click one of your machines to command it.</div></div>';
    if (m) {
      const d = MACHINES[m.kind];
      const chips: string[] = [];
      if (m.guardian) chips.push('<b class="good">Guardian</b>');
      if (E.isShielded(s, m)) chips.push('<b class="good">Shield Wall</b>');
      if (m.barrierThrough >= s.turn) chips.push('<b class="good">Barrier</b>');
      if (d.industrial) chips.push('<b>Industrial</b>');
      if (m.bonusAttacks > 0) chips.push('<b class="good">Double Strike</b>');
      if (E.isJammed(s, m)) chips.push(`<b class="bad">Jammed: no ${d.passive.name}</b>`);
      if (E.isDisabled(s, m)) chips.push('<b class="bad">System Failure</b>');
      info = `<div class="unit-info">
        <div class="portrait"><img src="${spriteUrl(MACHINE_SPRITES[m.kind], m.owner)}" alt="" /></div>
        <div><div class="uname">${esc(E.machineName(s, m))}</div>
          <div class="meta" style="color:var(--p${m.owner + 1})">${this.pn(m.owner)}${m.kind === 'sludgy' ? ' · King' : ''} · ${E.coord(m.pos)}</div>
          <div class="meta">${E.DIM_NAMES[m.dim]}</div>
          <div class="meta">HP ${m.hp}/${m.maxHp}</div>
          <div class="hp-big"><i style="width:${(m.hp / m.maxHp) * 100}%;${m.hp <= m.maxHp * 0.3 ? 'background:#ff4a4a' : ''}"></i></div></div>
        <div class="chips">${chips.join('')}</div>
        <div class="full"><b>${d.passive.name}:</b> ${d.passive.text}</div></div>`;
    } else if (st) {
      const d = STRUCTURES[st.kind];
      info = `<div class="unit-info">
        <div class="portrait"><img src="${spriteUrl(STRUCTURE_SPRITES[st.kind], st.owner)}" alt="" /></div>
        <div><div class="uname">${d.name}</div><div class="meta" style="color:var(--p${st.owner + 1})">${this.pn(st.owner)} · ${E.coord(st.pos)}</div>
        ${d.hp > 1 ? `<div class="meta">HP ${st.hp}/${d.hp}</div>` : ''}
        ${st.dir ? `<div class="meta">Direction: ${DIR_ARROWS[st.dir]} ${E.DIR_NAMES[st.dir]}</div>` : ''}</div>
        <div class="full">${d.text}</div>
        ${st.kind === 'dock' ? this.dockInfo(st) : ''}</div>`;
    }

    let abil = '<div class="abilities"><div class="hint">Select one of your machines.</div></div>';
    if (m && m.owner === s.current) {
      const list = E.getAbilities(s, m.id);
      const moves = E.getMoveTargets(s, m.id).length, atks = E.getAttackTargets(s, m.id).length;
      abil = `<div class="abilities">
        <div class="hint">${E.isDisabled(s, m) ? 'Offline this turn.' : `${moves} move(s) · ${atks} target(s) in range`}</div>
        ${list
          .map((a) => {
            const on = this.mode.t === 'ability' && this.mode.key === a.key;
            return `<button class="btn ${on ? 'on' : ''}" data-ability="${a.key}" ${a.usable ? '' : 'disabled'} title="${esc(a.text)}">
              <span>${a.name}${a.usesAction ? ' <small>(action)</small>' : ''}</span>
              <small>${a.usable ? (a.sp ? `${a.sp} SP` : 'free') : a.reason}</small></button>`;
          })
          .join('')}
      </div>`;
    } else if (m) abil = '<div class="abilities"><div class="hint">Enemy machine.</div></div>';

    const spawnBtn = (k: E.SpawnKind) => {
      const cost = E.spawnCost(k)!;
      const on = this.mode.t === 'spawn' && this.mode.kind === k;
      if (!E.isUnlocked(s, this.viewer, k)) {
        const need = E.unlockCost(k);
        return `<button class="btn locked" disabled title="${spawnName(k)} · locked: unlocks at ${need} Industrial research">
          <img src="${spriteUrl(spawnSprite(k), this.viewer)}" alt="" /><img class="lock" src="${spriteUrl(ICONS.lock)}" alt="locked" />
          <span class="cost">R${need}<img src="${spriteUrl(ICONS.research)}" alt="research" /></span>
          <span style="font-size:11px">${spawnName(k).split(' ')[0]}</span></button>`;
      }
      return `<button class="btn ${on ? 'on' : ''}" data-spawn="${k}" ${pl.points < cost || s.winner !== null ? 'disabled' : ''} title="${spawnName(k)} · ${cost} point(s)">
        <img src="${spriteUrl(spawnSprite(k), this.viewer)}" alt="" /><span class="cost">${cost}<img src="${spriteUrl(ICONS.point)}" alt="points" /></span>
        <span style="font-size:11px">${spawnName(k).split(' ')[0]}</span></button>`;
    };
    const spawn = SPAWN_ORDER.map(spawnBtn).join('');
    const next = E.nextUnlock(s, this.viewer);
    const industrial = `<div class="research"><img src="${spriteUrl(ICONS.research)}" alt="" />
        Research <b>${pl.research}</b>${next ? ` · next: ${spawnName(next.kind as E.SpawnKind)} at ${next.need}` : ' · all unlocked'}</div>
      <div class="spawn-grid">${INDUSTRIAL_ORDER.map(spawnBtn).join('')}</div>
      ${
        this.mode.t === 'spawn' && this.mode.kind === 'conveyor'
          ? `<div class="dirs" role="group" aria-label="Conveyor direction">${DIRS.map(
              (d) => `<button class="btn ${this.conveyorDir === d ? 'on' : ''}" data-dir="${d}" aria-label="Face ${E.DIR_NAMES[d]}">${DIR_ARROWS[d]}</button>`,
            ).join('')}</div>`
          : ''
      }`;

    this.el.side.innerHTML = `
      ${this.netHtml()}<div class="group"><span class="legend">Selected</span>${info}</div>
      <div class="group"><span class="legend">Abilities</span>${abil}</div>
      <div class="group"><span class="legend">Spawn · Q${this.viewer ? 4 : 1}</span><div class="spawn-grid">${spawn}</div></div>
      <div class="group"><span class="legend">Industrial · Q${this.viewer ? 4 : 1}</span>${industrial}</div>
      <div class="action-state"><span>Action: <b class="${s.actionUsed ? 'used' : 'ready'}">${s.actionUsed ? 'USED' : 'READY'}</b></span><span>Turn ${s.turn + 1}</span></div>
      <button class="btn big endturn" id="end-turn" ${s.winner !== null || s.current !== this.viewer ? 'disabled' : ''}>${s.current === this.viewer ? 'End Turn ▶' : "Opponent's Turn"}</button>`;
  }

  private dockInfo(dock: { id: number; owner: PlayerId; droneTarget?: number | null }) {
    const s = this.s;
    const t = E.droneTargetOf(s, dock as never);
    const mine = dock.owner === this.viewer;
    return `<div class="full"><img class="inline-ico" src="${spriteUrl(DRONE_SPRITE, dock.owner)}" alt="" />
      Drone follows: <b>${t ? `${esc(E.machineName(s, t))} (${E.coord(t.pos)}${t.dim ? ', Industrial' : ''})` : 'nobody'}</b></div>
      ${mine ? `<div class="full"><button class="btn ${this.mode.t === 'drone' ? 'on' : ''}" data-assign="${dock.id}">Reassign drone</button></div>` : ''}`;
  }

  private renderLog() {
    const entries = this.s.log.slice(-80);
    this.el.log.innerHTML = entries
      .map((e) => `<div class="${e.player === null ? 'sys' : `p${e.player}`}">${esc(e.text)}</div>`)
      .join('');
    this.el.log.scrollTop = this.el.log.scrollHeight;
  }
}

function hpBar(hp: number, max: number) {
  const pct = (hp / max) * 100;
  return `<span class="hpbar"><i class="${pct <= 30 ? 'low' : pct <= 60 ? 'mid' : ''}" style="width:calc(${pct}% - 2px)"></i></span>`;
}

function badges(s: GameState, m: Machine) {
  const b: string[] = [];
  if (m.guardian) b.push('G');
  if (E.isShielded(s, m)) b.push('S');
  if (m.barrierThrough >= s.turn) b.push('B');
  if (m.bonusAttacks > 0) b.push('×2');
  if (E.isJammed(s, m)) b.push('J');
  if (E.isDisabled(s, m)) b.push('X');
  return b.length ? `<span class="badges">${b.map((x) => `<b>${x}</b>`).join('')}</span>` : '';
}
