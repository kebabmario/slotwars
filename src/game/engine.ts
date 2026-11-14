// Slot Wars rules engine. Pure state logic, no DOM.
// Every action function mutates the given GameState and returns an ActionResult.

import {
  ABILITY_VALUES as AV,
  BOARD_SIZE,
  DIMENSION,
  KING_ABILITIES,
  KING_DEFAULT_NAME,
  KING_NAME_MAX,
  MACHINES,
  QUADRANT_SIZE,
  REPAIR_STATION,
  RULES,
  SHOCK_TRAP,
  INDUSTRIAL,
  INDUSTRIAL_VALUES as IV,
  CONVEYOR,
  TESLA,
  DRONE,
  OVERLOAD_MINE,
  STRUCTURES,
  TURRET,
  type AbilityTarget,
} from './config.ts';
import type {
  ActionResult,
  Dim,
  Dir,
  GameState,
  KingAbility,
  Machine,
  MachineKind,
  PlayerId,
  Pos,
  Structure,
  StructureKind,
} from './types.ts';

// ---------- geometry ----------

export const QUADRANT_NAMES = ['Q1', 'Q2', 'Q3', 'Q4'];
export const DIM_NAMES = ['Main Battlefield', 'Industrial Dimension'];
export const PORTAL: Pos = { r: RULES.portalPos[0], c: RULES.portalPos[1] };
export const DIM_PORTAL: Pos = { r: DIMENSION.portalPos[0], c: DIMENSION.portalPos[1] };
export const portalOf = (dim: Dim): Pos => (dim === 0 ? PORTAL : DIM_PORTAL);

export function quadrantOf(p: Pos): number {
  return (p.r >= QUADRANT_SIZE ? 2 : 0) + (p.c >= QUADRANT_SIZE ? 1 : 0);
}
export function homeQuadrant(player: PlayerId): number {
  return player === 0 ? 0 : 3;
}
export function inBounds(p: Pos): boolean {
  return p.r >= 0 && p.c >= 0 && p.r < BOARD_SIZE && p.c < BOARD_SIZE;
}
export function samePos(a: Pos, b: Pos): boolean {
  return a.r === b.r && a.c === b.c;
}
export function chebyshev(a: Pos, b: Pos): number {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.c - b.c));
}
export function isPortal(p: Pos, dim: Dim = 0): boolean {
  return samePos(p, portalOf(dim));
}
export function areaCells(anchor: Pos, size: number): Pos[] {
  const out: Pos[] = [];
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) out.push({ r: anchor.r + r, c: anchor.c + c });
  return out;
}
function line(a: Pos, b: Pos): Pos[] {
  // Bresenham, excluding the start cell.
  const out: Pos[] = [];
  let { r, c } = a;
  const dr = Math.abs(b.r - r), dc = Math.abs(b.c - c);
  const sr = r < b.r ? 1 : -1, sc = c < b.c ? 1 : -1;
  let err = dc - dr;
  while (r !== b.r || c !== b.c) {
    const e2 = 2 * err;
    if (e2 > -dr) { err -= dr; c += sc; }
    if (e2 < dc) { err += dc; r += sr; }
    out.push({ r, c });
  }
  return out;
}

// ---------- lookup ----------

/** Display name of a player (set at match setup, defaults to "Player n"). */
export const playerName = (s: GameState, p: PlayerId) => s.players[p].name;
export const machineAt = (s: GameState, p: Pos, dim: Dim = 0) => s.machines.find((m) => m.dim === dim && samePos(m.pos, p));
export const structureAt = (s: GameState, p: Pos) => s.structures.find((x) => samePos(x.pos, p));
export const getMachine = (s: GameState, id: number) => s.machines.find((m) => m.id === id);
export const isJammed = (s: GameState, m: Machine) => m.jammedThrough >= s.turn;
export const isDisabled = (s: GameState, m: Machine) => m.disabledThrough >= s.turn;
export const isShielded = (s: GameState, m: Machine) => m.shieldThrough >= s.turn;
const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);
export const sanitizeKingName = (name: string | undefined) => (name ?? '').trim().slice(0, KING_NAME_MAX) || KING_DEFAULT_NAME;
/** Display name: the King uses its owner's chosen name, everything else its machine name. */
export const machineName = (s: GameState, m: Machine) => (m.kind === 'sludgy' ? s.players[m.owner].kingName : MACHINES[m.kind].name);

function log(s: GameState, text: string, player: PlayerId | null = s.current) {
  s.log.push({ turn: s.turn, player, text });
}
const fail = (error: string): ActionResult => ({ ok: false, error });
const OK: ActionResult = { ok: true };

// ---------- setup ----------

export interface MatchSetup {
  playerNames?: [string, string];
  startingPoints?: number; // defaults to RULES.startingPoints (CONFIRMED: 3)
}

export function createGame(
  kings: [KingAbility, KingAbility],
  fog = RULES.fogOfWar,
  names: [string, string] = [KING_DEFAULT_NAME, KING_DEFAULT_NAME],
  setup: MatchSetup = {},
): GameState {
  const start = Number.isInteger(setup.startingPoints) && setup.startingPoints! >= 0 ? setup.startingPoints! : RULES.startingPoints;
  const player = (king: KingAbility, name: string, i: number) => ({
    name: (setup.playerNames?.[i] ?? '').trim().slice(0, 14) || `Player ${i + 1}`,
    points: start,
    sp: RULES.startingSp,
    king,
    kingName: sanitizeKingName(name),
    dimTurns: 0,
    research: 0,
    unlocked: [] as string[],
    overcharge: false,
    revealQuadrant: null,
    revealThrough: -1,
  });
  const s: GameState = {
    turn: 0,
    current: 0,
    actionUsed: false,
    actionBy: null,
    actionType: null,
    machines: [],
    structures: [],
    players: [player(kings[0], names[0], 0), player(kings[1], names[1], 1)],
    log: [],
    events: [],
    winner: null,
    nextId: 1,
    fog,
    pendingSummon: null,
    wreckage: [],
  };
  ([0, 1] as PlayerId[]).forEach((p) => {
    const [r, c] = RULES.kingStart[p];
    s.machines.push(newMachine(s, 'sludgy', p, { r, c }));
  });
  log(s, 'Match start. Protect your King!', null);
  startTurn(s);
  return s;
}

/** Places a machine directly (tutorial scenarios and tests). Skips cost and spawn rules on purpose. */
export function placeMachine(s: GameState, kind: MachineKind, owner: PlayerId, pos: Pos, dim: Dim = 0): Machine {
  const m = newMachine(s, kind, owner, pos);
  m.dim = dim;
  s.machines.push(m);
  return m;
}

function newMachine(s: GameState, kind: MachineKind, owner: PlayerId, pos: Pos): Machine {
  return {
    id: s.nextId++,
    kind,
    owner,
    pos: { ...pos },
    dim: 0,
    hp: MACHINES[kind].hp ?? RULES.machineHp,
    maxHp: MACHINES[kind].hp ?? RULES.machineHp,
    jammedThrough: -1,
    disabledThrough: -1,
    shieldThrough: -1,
    barrierThrough: -1,
    guardian: false,
    bonusAttacks: 0,
  };
}

// ---------- visibility ----------

export function visibleQuadrants(s: GameState, viewer: PlayerId): Set<number> {
  const set = new Set<number>();
  if (!s.fog) return new Set([0, 1, 2, 3]);
  set.add(homeQuadrant(viewer)); // PROVISIONAL vision rule: home quadrant + any quadrant you occupy
  for (const m of s.machines) if (m.owner === viewer && m.dim === 0) set.add(quadrantOf(m.pos));
  const pl = s.players[viewer];
  if (pl.revealQuadrant !== null && pl.revealThrough >= s.turn) set.add(pl.revealQuadrant);
  return set;
}
export function canSeeTile(s: GameState, viewer: PlayerId, p: Pos): boolean {
  return visibleQuadrants(s, viewer).has(quadrantOf(p));
}
export function canSeeMachine(s: GameState, viewer: PlayerId, m: Machine): boolean {
  if (m.dim === 1 && !DIMENSION.fog) return true;
  return m.owner === viewer || canSeeTile(s, viewer, m.pos);
}
export function canSeeStructure(s: GameState, viewer: PlayerId, st: Structure): boolean {
  if (st.owner === viewer) return true;
  if (STRUCTURES[st.kind].hidden && (st.kind !== 'trap' || SHOCK_TRAP.hiddenFromEnemy)) {
    const pl = s.players[viewer];
    return pl.revealThrough >= s.turn && pl.revealQuadrant === quadrantOf(st.pos);
  }
  return canSeeTile(s, viewer, st.pos);
}

// ---------- shared rules ----------

function passable(s: GameState, p: Pos, dim: Dim): boolean {
  if (!inBounds(p) || machineAt(s, p, dim) || isPortal(p, dim)) return false;
  if (dim === 1) return true; // structures only exist on the main battlefield
  const st = structureAt(s, p);
  return !(st && STRUCTURES[st.kind].solid);
}
/** Free landing tile closest to `from` (ring by ring, row-major), used for portal arrivals. */
function nearestFree(s: GameState, dim: Dim, from: Pos): Pos | undefined {
  for (let d = 0; d < BOARD_SIZE; d++)
    for (let r = from.r - d; r <= from.r + d; r++)
      for (let c = from.c - d; c <= from.c + d; c++) {
        const p = { r, c };
        if (chebyshev(p, from) === d && passable(s, p, dim)) return p;
      }
}
function transport(s: GameState, m: Machine) {
  const to: Dim = m.dim === 0 ? 1 : 0;
  const at = nearestFree(s, to, portalOf(to));
  if (!at) return log(s, 'The portal is jammed: no room on the other side.');
  s.events.push({ type: 'warp', dim: m.dim, pos: { ...portalOf(m.dim) } });
  m.dim = to;
  m.pos = at;
  s.events.push({ type: 'warp', dim: to, pos: { ...at } });
  log(s, `${playerName(s, m.owner)}'s ${machineName(s, m)} warped to the ${DIM_NAMES[to]} (${coord(at)}).`);
}
function tileEmpty(s: GameState, p: Pos): boolean {
  return inBounds(p) && !machineAt(s, p) && !structureAt(s, p) && !isPortal(p);
}
function canAct(s: GameState, m: Machine | undefined): m is Machine {
  return !!m && s.winner === null && s.pendingSummon === null && m.owner === s.current && !isDisabled(s, m);
}
function checkWinner(s: GameState) {
  if (s.winner !== null) return;
  const alive = [0, 1].map((p) => s.machines.some((m) => m.kind === 'sludgy' && m.owner === p));
  if (!alive[0] && !alive[1]) s.winner = 'draw';
  else if (!alive[0]) s.winner = 1;
  else if (!alive[1]) s.winner = 0;
  if (s.winner !== null)
    log(s, s.winner === 'draw' ? 'Both Kings are down. Draw!' : `${playerName(s, s.winner)} wins the match!`, null);
}

function destroyMachine(s: GameState, m: Machine) {
  s.machines = s.machines.filter((x) => x !== m);
  s.events.push({ type: 'destroyed', dim: m.dim, pos: { ...m.pos }, kind: m.kind, owner: m.owner });
  log(s, `${playerName(s, m.owner)}'s ${machineName(s, m)} was destroyed!`);
}
function destroyStructure(s: GameState, st: Structure, wreck = true) {
  s.structures = s.structures.filter((x) => x !== st);
  s.events.push({ type: 'destroyed', dim: 0, pos: { ...st.pos }, structure: true, kind: st.kind, owner: st.owner });
  // Destroyed barricades and repair stations leave wreckage the Welder can rebuild.
  if (wreck && (st.kind === 'barricade' || st.kind === 'repair')) s.wreckage.push({ kind: st.kind, owner: st.owner, pos: { ...st.pos } });
}

/** Applies damage with every reduction. Returns damage dealt. */
function damageMachine(s: GameState, t: Machine, base: number, isAttack: boolean, source: string): number {
  if (isAttack && t.guardian) {
    t.guardian = false;
    s.events.push({ type: 'blocked', dim: t.dim, pos: { ...t.pos } });
    log(s, `Guardian blocked ${source}!`);
    return 0;
  }
  let reduce = 0;
  if (t.kind === 'defender' && !isJammed(s, t)) reduce += AV.fortifyReduction;
  if (isShielded(s, t)) reduce += AV.shieldWallReduction;
  if (t.kind === 'juggernaut' && !isJammed(s, t)) reduce += IV.platingReduction;
  if (t.barrierThrough >= s.turn) reduce += IV.barrierReduction;
  const dmg = Math.max(0, base - reduce);
  t.hp = Math.max(0, t.hp - dmg);
  s.events.push({ type: 'damage', dim: t.dim, pos: { ...t.pos }, amount: dmg, kind: t.kind, armor: Math.min(reduce, base) });
  log(s, `${source} hit ${playerName(s, t.owner)}'s ${machineName(s, t)} for ${dmg}${reduce ? ` (-${reduce} armor)` : ''}.`);
  if (t.hp <= 0) destroyMachine(s, t);
  return dmg;
}
function heal(s: GameState, m: Machine, amount: number) {
  const gained = Math.min(amount, m.maxHp - m.hp);
  m.hp += gained;
  if (gained > 0) s.events.push({ type: 'heal', dim: m.dim, pos: { ...m.pos }, amount: gained });
  return gained;
}

// ---------- movement ----------

export interface MoveOption {
  pos: Pos;
  path: Pos[];
  portal?: boolean; // stepping here warps the machine to the other battlefield
}

export function moveRange(s: GameState, m: Machine): number {
  return m.kind === 'scout' && !isJammed(s, m) ? AV.quickstepRange : 1;
}

export function getMoveTargets(s: GameState, id: number): MoveOption[] {
  const m = getMachine(s, id);
  if (!canAct(s, m) || s.actionUsed) return [];
  const range = moveRange(s, m);
  const seen = new Map<string, Pos[]>([[`${m.pos.r},${m.pos.c}`, []]]);
  let frontier: { pos: Pos; path: Pos[] }[] = [{ pos: m.pos, path: [] }];
  const out: MoveOption[] = [];
  for (let step = 0; step < range; step++) {
    const next: typeof frontier = [];
    for (const f of frontier)
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const p = { r: f.pos.r + dr, c: f.pos.c + dc };
        const key = `${p.r},${p.c}`;
        if (seen.has(key)) continue;
        if (isPortal(p, m.dim)) {
          seen.set(key, []);
          out.push({ pos: p, path: [...f.path, p], portal: true }); // the portal ends movement
          continue;
        }
        if (!passable(s, p, m.dim)) continue;
        const path = [...f.path, p];
        seen.set(key, path);
        out.push({ pos: p, path });
        next.push({ pos: p, path });
      }
    frontier = next;
  }
  return out;
}

export function move(s: GameState, id: number, to: Pos): ActionResult {
  const opt = getMoveTargets(s, id).find((o) => samePos(o.pos, to));
  if (!opt) return fail('Invalid move.');
  const m = getMachine(s, id)!;
  const from = { ...m.pos };
  s.actionUsed = true;
  s.actionBy = id;
  s.actionType = 'move';
  for (const step of opt.path) {
    if (isPortal(step, m.dim)) {
      log(s, `${machineName(s, m)} entered the portal at ${coord(step)}.`);
      transport(s, m);
      checkWinner(s);
      return OK;
    }
    m.pos = { ...step };
    if (enterTile(s, m)) break;
  }
  if (s.machines.includes(m)) log(s, `${machineName(s, m)} moved ${coord(from)} → ${coord(m.pos)}${m.dim ? ' (Industrial)' : ''}.`);
  checkWinner(s);
  return OK;
}

/** Triggers enemy traps and mines on the machine's current tile. Returns true when movement must stop. */
function enterTile(s: GameState, m: Machine): boolean {
  if (m.dim !== 0) return false;
  const st = structureAt(s, m.pos);
  if (!st || st.owner === m.owner) return false;
  if (st.kind === 'trap') {
    s.events.push({ type: 'zap', dim: 0, pos: { ...m.pos } });
    if (SHOCK_TRAP.singleUse) destroyStructure(s, st);
    damageMachine(s, m, SHOCK_TRAP.damage, false, 'A Shock Trap');
    return SHOCK_TRAP.stopsMovement;
  }
  if (st.kind === 'mine') {
    s.events.push({ type: 'mine', dim: 0, pos: { ...m.pos } });
    if (OVERLOAD_MINE.singleUse) destroyStructure(s, st);
    const alive = s.machines.includes(m);
    damageMachine(s, m, OVERLOAD_MINE.damage, false, 'An Overload Mine');
    if (alive && s.machines.includes(m)) {
      m.jammedThrough = Math.max(m.jammedThrough, s.turn + OVERLOAD_MINE.jamTurns);
      log(s, `Overload: ${machineName(s, m)}'s ${MACHINES[m.kind].passive.name} is offline.`);
    }
    return true;
  }
  return false;
}

export const coord = (p: Pos) => `${String.fromCharCode(65 + p.c)}${p.r + 1}`;

// ---------- combat ----------

export interface AttackOption {
  pos: Pos;
  machineId?: number;
  structureId?: number;
}

function canAttackNow(s: GameState, m: Machine): boolean {
  if (!s.actionUsed) return true;
  return s.actionBy === m.id && s.actionType === 'attack' && m.bonusAttacks > 0;
}

export function getAttackTargets(s: GameState, id: number): AttackOption[] {
  const m = getMachine(s, id);
  if (!canAct(s, m) || !canAttackNow(s, m)) return [];
  const out: AttackOption[] = [];
  for (let d = 1; d <= RULES.attackRange; d++)
    for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const p = { r: m.pos.r + dr * d, c: m.pos.c + dc * d };
      if (!inBounds(p)) continue;
      const t = machineAt(s, p, m.dim);
      if (t) {
        if (t.owner !== m.owner && canSeeMachine(s, m.owner, t)) out.push({ pos: p, machineId: t.id });
        continue;
      }
      if (m.dim !== 0) continue;
      const st = structureAt(s, p);
      if (!st || st.owner === m.owner || !canSeeStructure(s, m.owner, st)) continue;
      const breach = st.kind === 'barricade' && m.kind === 'breacher' && !isJammed(s, m);
      const hittable = !!STRUCTURES[st.kind].attackable && RULES.structuresAttackable;
      if (breach || hittable) out.push({ pos: p, structureId: st.id });
    }
  return out;
}

export function attackDamage(s: GameState, m: Machine): number {
  const pl = s.players[m.owner];
  if (pl.overcharge && (RULES.overchargeScope === 'player' || m.kind === 'sludgy')) return AV.overchargeDamage;
  if (m.kind === 'striker' && !isJammed(s, m)) return AV.heavyHitDamage;
  return RULES.attackDamage;
}

export function attack(s: GameState, id: number, at: Pos): ActionResult {
  const opt = getAttackTargets(s, id).find((o) => samePos(o.pos, at));
  if (!opt) return fail('Invalid target.');
  const m = getMachine(s, id)!;
  const pl = s.players[m.owner];
  const dmg = attackDamage(s, m);
  if (dmg === AV.overchargeDamage && pl.overcharge) {
    pl.overcharge = false;
    log(s, 'Overcharge discharged!');
  }
  if (s.actionUsed) m.bonusAttacks--;
  s.actionUsed = true;
  s.actionBy = id;
  s.actionType = 'attack';
  const name = machineName(s, m);
  s.events.push({ type: 'shot', dim: m.dim, from: { ...m.pos }, to: { ...at }, source: m.kind, heavy: dmg > RULES.attackDamage || m.kind === 'crusher' || m.kind === 'breacher' || m.kind === 'juggernaut' });

  if (opt.machineId !== undefined) {
    const t = getMachine(s, opt.machineId)!;
    const wasGuarded = t.guardian;
    damageMachine(s, t, dmg, true, name);
    if (m.kind === 'saboteur' && !isJammed(s, m) && !wasGuarded && s.machines.includes(t)) {
      t.jammedThrough = s.turn + 1;
      log(s, `Jammer: ${machineName(s, t)}'s ${MACHINES[t.kind].passive.name} is offline for 1 turn.`);
    }
  } else {
    const st = s.structures.find((x) => x.id === opt.structureId)!;
    if (st.kind === 'barricade') {
      destroyStructure(s, st);
      log(s, `${name} breached a barricade at ${coord(st.pos)}.`);
    } else {
      const total = dmg + (m.kind === 'crusher' && !isJammed(s, m) ? IV.demolitionBonus : 0);
      st.hp = Math.max(0, st.hp - total);
      s.events.push({ type: 'damage', dim: 0, pos: { ...st.pos }, amount: total, structure: true });
      log(s, `${name} hit a ${STRUCTURES[st.kind].name} for ${total}${total > dmg ? ' (Demolition)' : ''}.`);
      if (st.hp <= 0) {
        destroyStructure(s, st);
        log(s, `${playerName(s, st.owner)}'s ${STRUCTURES[st.kind].name} was destroyed!`);
      }
    }
  }
  checkWinner(s);
  return OK;
}

// ---------- spawning ----------

export type SpawnKind = MachineKind | StructureKind;

export function spawnCost(kind: SpawnKind): number | null {
  return kind in MACHINES ? MACHINES[kind as MachineKind].cost : STRUCTURES[kind as StructureKind].cost;
}

export const isIndustrial = (kind: SpawnKind) =>
  kind in MACHINES ? !!MACHINES[kind as MachineKind].industrial : !!STRUCTURES[kind as StructureKind].industrial;
export const unlockCost = (kind: SpawnKind): number => INDUSTRIAL.unlocks[kind] ?? 0;
export const isUnlocked = (s: GameState, p: PlayerId, kind: SpawnKind) => !isIndustrial(kind) || s.players[p].unlocked.includes(kind);

export function getSpawnTiles(s: GameState, kind: SpawnKind): Pos[] {
  const cost = spawnCost(kind);
  if (s.winner !== null || s.pendingSummon !== null || cost === null || s.players[s.current].points < cost) return [];
  if (!isUnlocked(s, s.current, kind)) return [];
  const q = homeQuadrant(s.current);
  const out: Pos[] = [];
  for (let r = 0; r < BOARD_SIZE; r++)
    for (let c = 0; c < BOARD_SIZE; c++) {
      const p = { r, c };
      if (quadrantOf(p) === q && tileEmpty(s, p)) out.push(p);
    }
  return out;
}

/** Spawning never uses the turn's action (CONFIRMED). */
export function spawn(s: GameState, kind: SpawnKind, at: Pos, opts: { dir?: Dir } = {}): ActionResult {
  if (!isUnlocked(s, s.current, kind)) return fail(`Locked: needs ${unlockCost(kind)} Industrial research.`);
  if (!getSpawnTiles(s, kind).some((p) => samePos(p, at))) return fail('Cannot spawn there.');
  const pl = s.players[s.current];
  pl.points -= spawnCost(kind)!;
  if (kind in MACHINES) {
    s.machines.push(newMachine(s, kind as MachineKind, s.current, at));
    s.events.push({ type: 'spawn', dim: 0, pos: { ...at }, kind, owner: s.current });
    log(s, `Spawned ${MACHINES[kind as MachineKind].name} at ${coord(at)}.`);
  } else {
    const k = kind as StructureKind;
    const st: Structure = { id: s.nextId++, kind: k, owner: s.current, pos: { ...at }, hp: STRUCTURES[k].hp };
    if (k === 'conveyor') st.dir = opts.dir ?? 'E';
    if (k === 'dock') {
      // the drone starts on the nearest friendly machine on the main battlefield
      const near = s.machines
        .filter((m) => m.owner === s.current && m.dim === 0)
        .sort((a, b) => chebyshev(a.pos, at) - chebyshev(b.pos, at) || a.id - b.id)[0];
      st.droneTarget = near?.id ?? null;
    }
    s.structures.push(st);
    s.events.push({ type: 'spawn', dim: 0, pos: { ...at }, kind, owner: s.current });
    // Hidden objects are logged without a position so the log does not give them away.
    log(s, STRUCTURES[k].hidden ? `Deployed a ${STRUCTURES[k].name}.` : `Built ${STRUCTURES[k].name} at ${coord(at)}${st.dir ? ` facing ${DIR_NAMES[st.dir]}` : ''}.`);
  }
  return OK;
}

// ---------- abilities ----------

export interface AbilityOption {
  key: string;
  name: string;
  sp: number;
  text: string;
  target: AbilityTarget;
  usesAction: boolean;
  usable: boolean;
  reason?: string;
}

export function getAbilities(s: GameState, id: number): AbilityOption[] {
  const m = getMachine(s, id);
  if (!m) return [];
  const out: AbilityOption[] = [];
  const def = MACHINES[m.kind];
  if (m.kind === 'welder')
    out.push({
      key: 'weld',
      name: 'Repair',
      sp: 0,
      text: `Restore ${IV.weldAmount} HP to a damaged friendly machine orthogonally adjacent.`,
      target: { type: 'ally', range: 1 },
      usesAction: IV.weldUsesAction,
      usable: false,
    });
  if (m.kind === 'medic')
    out.push({
      key: 'repair',
      name: 'Repair',
      sp: 0,
      text: `Restore ${AV.repairAmount} HP to a damaged friendly machine within ${AV.repairRange} square.`,
      target: { type: 'ally', range: AV.repairRange },
      usesAction: RULES.repairUsesAction,
      usable: false,
    });
  if (m.kind === 'sludgy') {
    const k = s.players[m.owner].king;
    const kd = KING_ABILITIES[k];
    out.push({ key: k, name: kd.name, sp: kd.sp, text: kd.text.replace('Your King', machineName(s, m)), target: kd.target, usesAction: RULES.spAbilitiesUseAction, usable: false });
  } else if (def.special) {
    const sd = def.special;
    out.push({ key: sd.key, name: sd.name, sp: sd.sp, text: sd.text, target: sd.target, usesAction: RULES.spAbilitiesUseAction, usable: false });
  }
  for (const a of out) {
    const reason = blockReason(s, m, a);
    a.usable = !reason;
    if (reason) a.reason = reason;
  }
  return out;
}

function blockReason(s: GameState, m: Machine, a: AbilityOption): string | undefined {
  if (s.winner !== null) return 'Match over';
  if (m.owner !== s.current) return 'Not your machine';
  if (s.pendingSummon !== null) return 'Choose summoned machines';
  if (isDisabled(s, m)) return 'System failure';
  const pl = s.players[m.owner];
  if (pl.sp < a.sp) return `Needs ${a.sp} SP`;
  if (a.usesAction && s.actionUsed) return 'Action used';
  if ((a.key === 'repair' || a.key === 'weld') && isJammed(s, m)) return 'Jammed';
  if (a.key === 'reconstruct' && IV.reconstructNeedsMainBoard && m.dim !== 0) return 'Main battlefield only';
  if (a.key === 'guardian' && m.guardian) return 'Already active';
  if (a.key === 'overcharge' && pl.overcharge) return 'Already charged';
  if (a.key === 'doublestrike' && m.bonusAttacks > 0) return 'Already active';
  if (a.key === 'robbery' && s.players[other(m.owner)].points <= 0) return 'Opponent is broke';
  if (a.target.type !== 'instant' && a.target.type !== 'area' && getAbilityTargets(s, m.id, a.key).length === 0)
    return 'No valid target';
  return undefined;
}

/** Valid targets for tile/ally/quadrant abilities, valid anchors (top-left) for area abilities. */
export function getAbilityTargets(s: GameState, id: number, key: string): Pos[] {
  const m = getMachine(s, id);
  if (!m) return [];
  if (key === 'phantom') {
    const q = homeQuadrant(m.owner);
    const out: Pos[] = [];
    for (let r = 0; r < BOARD_SIZE; r++)
      for (let c = 0; c < BOARD_SIZE; c++) {
        const p = { r, c };
        if (quadrantOf(p) === q && tileEmpty(s, p)) out.push(p);
      }
    return out;
  }
  if (key === 'weld')
    return s.machines
      .filter((x) => x.owner === m.owner && x !== m && x.dim === m.dim && x.hp < x.maxHp && Math.abs(x.pos.r - m.pos.r) + Math.abs(x.pos.c - m.pos.c) === 1)
      .map((x) => ({ ...x.pos }));
  if (key === 'reconstruct')
    return s.wreckage.filter((w) => w.owner === m.owner && tileEmpty(s, w.pos)).map((w) => ({ ...w.pos }));
  if (key === 'repair')
    return s.machines
      .filter((x) => x.owner === m.owner && x !== m && x.dim === m.dim && x.hp < x.maxHp && chebyshev(x.pos, m.pos) <= AV.repairRange)
      .map((x) => ({ ...x.pos }));
  if (key === 'spotter') {
    const vis = visibleQuadrants(s, m.owner);
    // A quadrant target is encoded as its top-left tile.
    return [0, 1, 2, 3].filter((q) => !vis.has(q)).map((q) => ({ r: q >= 2 ? QUADRANT_SIZE : 0, c: q % 2 ? QUADRANT_SIZE : 0 }));
  }
  const ab = getAbilities(s, id).find((a) => a.key === key);
  if (ab?.target.type === 'area') {
    const size = ab.target.size;
    const out: Pos[] = [];
    for (let r = 0; r <= BOARD_SIZE - size; r++)
      for (let c = 0; c <= BOARD_SIZE - size; c++) {
        const anchor = { r, c };
        if (!RULES.areaMustContainCaster || areaCells(anchor, size).some((p) => samePos(p, m.pos))) out.push(anchor);
      }
    return out;
  }
  return [];
}

export function useAbility(s: GameState, id: number, key: string, target?: Pos): ActionResult {
  const m = getMachine(s, id);
  if (!m) return fail('No machine.');
  const ab = getAbilities(s, id).find((a) => a.key === key);
  if (!ab) return fail('Unknown ability.');
  if (!ab.usable) return fail(ab.reason ?? 'Unavailable.');
  if (ab.target.type !== 'instant') {
    if (!target) return fail('Pick a target.');
    if (!getAbilityTargets(s, id, key).some((p) => samePos(p, target))) return fail('Invalid target.');
  }
  const pl = s.players[m.owner];
  const opp = s.players[other(m.owner)];
  pl.sp -= ab.sp;
  if (ab.usesAction) {
    s.actionUsed = true;
    s.actionBy = id;
    s.actionType = key === 'repair' || key === 'weld' ? 'repair' : null;
  }
  const area = ab.target.type === 'area' && target ? areaCells(target, ab.target.size) : [];
  const casterFrom = { ...m.pos }, casterDim = m.dim;
  const inArea = (x: Machine) => x.dim === m.dim && area.some((p) => samePos(p, x.pos));
  const dim = m.dim;

  switch (key) {
    case 'weld': {
      const t = machineAt(s, target!, m.dim)!;
      const g = heal(s, t, IV.weldAmount);
      log(s, `Welder repaired ${machineName(s, t)} (+${g} HP).`);
      break;
    }
    case 'reconstruct': {
      const i = s.wreckage.findIndex((w) => w.owner === m.owner && samePos(w.pos, target!));
      const w = s.wreckage.splice(i, 1)[0];
      s.structures.push({ id: s.nextId++, kind: w.kind, owner: w.owner, pos: { ...w.pos }, hp: STRUCTURES[w.kind].hp });
      s.events.push({ type: 'area', dim: 0, cells: [{ ...w.pos }], tone: 'help' });
      log(s, `Emergency Reconstruction: ${STRUCTURES[w.kind].name} rebuilt at ${coord(w.pos)}.`);
      break;
    }
    case 'barrier': {
      const hit = s.machines.filter((x) => x.owner === m.owner && inArea(x));
      hit.forEach((x) => (x.barrierThrough = s.turn + 1));
      s.events.push({ type: 'area', dim, cells: area, tone: 'help' });
      log(s, `Protective Barrier covers ${hit.length} machine(s).`);
      break;
    }
    case 'groundbreaker': {
      const cells: Pos[] = [];
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const p = { r: m.pos.r + dr, c: m.pos.c + dc };
        if (inBounds(p)) cells.push(p);
      }
      s.events.push({ type: 'area', dim, cells, tone: 'harm' });
      log(s, 'GROUNDBREAKER!');
      const hit = s.machines.filter(
        (x) => x !== m && x.dim === m.dim && (IV.groundbreakerFriendlyFire || x.owner !== m.owner) && chebyshev(x.pos, m.pos) <= 1,
      );
      for (const x of hit) damageMachine(s, x, IV.groundbreakerDamage, false, 'Groundbreaker');
      break;
    }
    case 'repair': {
      const t = machineAt(s, target!, m.dim)!;
      const g = heal(s, t, AV.repairAmount);
      log(s, `Medic repaired ${machineName(s, t)} (+${g} HP).`);
      break;
    }
    case 'guardian':
      m.guardian = true;
      s.events.push({ type: 'area', dim, cells: [{ ...m.pos }], tone: 'help' });
      log(s, `Guardian online: ${machineName(s, m)} will block the next attack.`);
      break;
    case 'overcharge':
      pl.overcharge = true;
      log(s, `Overcharge primed: next attack deals ${AV.overchargeDamage}.`);
      break;
    case 'phantom': {
      s.events.push({ type: 'area', dim, cells: [{ ...m.pos }], tone: 'tech' });
      m.pos = { ...target! };
      m.dim = 0; // Phantom always lands in the home quadrant of the main battlefield
      s.events.push({ type: 'area', dim: 0, cells: [{ ...m.pos }], tone: 'tech' });
      log(s, `Phantom: ${machineName(s, m)} teleported.`);
      break;
    }
    case 'spotter': {
      const q = quadrantOf(target!);
      pl.revealQuadrant = q;
      pl.revealThrough = s.turn;
      log(s, `Spotter revealed ${QUADRANT_NAMES[q]}.`);
      break;
    }
    case 'shieldwall': {
      const hit = s.machines.filter((x) => x.owner === m.owner && inArea(x));
      hit.forEach((x) => (x.shieldThrough = s.turn + 1));
      s.events.push({ type: 'area', dim, cells: area, tone: 'help' });
      log(s, `Shield Wall raised over ${hit.length} machine(s).`);
      break;
    }
    case 'doublestrike':
      m.bonusAttacks = 1;
      log(s, 'Double Strike ready: Striker can attack twice this turn.');
      break;
    case 'systemfailure': {
      const hit = s.machines.filter((x) => x.owner !== m.owner && inArea(x));
      hit.forEach((x) => (x.disabledThrough = s.turn + 1));
      s.events.push({ type: 'area', dim, cells: area, tone: 'tech' });
      log(s, `System Failure: ${hit.length} enemy machine(s) offline next turn.`);
      break;
    }
    case 'hulksmash': {
      s.events.push({ type: 'area', dim, cells: area, tone: 'harm' });
      log(s, 'HULK SMASH!');
      for (const x of s.machines.filter((x) => x !== m && inArea(x))) damageMachine(s, x, AV.hulkSmashDamage, false, 'Hulk Smash');
      break;
    }
    case 'massrepair': {
      const hit = s.machines.filter((x) => x.owner === m.owner && inArea(x));
      let total = 0;
      hit.forEach((x) => (total += heal(s, x, AV.massRepairAmount)));
      s.events.push({ type: 'area', dim, cells: area, tone: 'help' });
      log(s, `Mass Repair restored ${total} HP.`);
      break;
    }
    case 'robbery': {
      const stolen = Math.min(AV.robberyPoints, opp.points);
      opp.points -= stolen;
      pl.points += stolen;
      log(s, `Point Robbery! Stole ${stolen} point(s).`);
      break;
    }
  }
  // One presentation event per ability use, for its visual effect.
  const around = (p: Pos) => areaCells({ r: p.r - 1, c: p.c - 1 }, 3).filter(inBounds);
  const fxCells =
    key === 'spotter' ? areaCells(target!, QUADRANT_SIZE) : key === 'groundbreaker' ? around(casterFrom) : area.length ? area : target && ab.target.type !== 'instant' ? [{ ...target }] : [casterFrom];
  s.events.push({ type: 'ability', dim: casterDim, key, owner: m.owner, from: casterFrom, to: { ...(target ?? m.pos) }, toDim: m.dim, cells: fxCells });
  checkWinner(s);
  return OK;
}

// ---------- turn flow ----------

function startTurn(s: GameState) {
  const pl = s.players[s.current];
  pl.sp += RULES.spPerTurn;
  const teslas = s.structures.filter((x) => x.kind === 'tesla' && x.owner === s.current).length;
  if (teslas) {
    pl.sp += teslas * TESLA.spPerTurn;
    log(s, `Tesla Generator: +${teslas * TESLA.spPerTurn} SP.`);
  }
  for (const dock of s.structures.filter((x) => x.kind === 'dock' && x.owner === s.current)) {
    const m = dock.droneTarget != null ? getMachine(s, dock.droneTarget) : undefined;
    if (!m || (m.dim !== 0 && !DRONE.followsIntoDimension)) continue;
    const g = heal(s, m, DRONE.heal);
    if (g) log(s, `Repair drone patched ${machineName(s, m)} (+${g} HP).`);
  }
  for (const st of s.structures.filter((x) => x.kind === 'repair' && x.owner === s.current)) {
    for (const m of s.machines.filter((x) => x.owner === s.current && x.dim === 0 && chebyshev(x.pos, st.pos) <= REPAIR_STATION.range)) {
      const g = heal(s, m, REPAIR_STATION.heal);
      if (g) log(s, `Repair Station fixed ${machineName(s, m)} (+${g} HP).`);
    }
  }
  log(s, `— ${playerName(s, s.current)}'s turn —`);
}

function fireTurrets(s: GameState) {
  const p = s.current;
  for (const t of s.structures.filter((x) => x.kind === 'turret' && x.owner === p)) {
    for (let shot = 0; shot < TURRET.shotsPerTurn; shot++) {
      const target = s.machines
        .filter((m) => m.owner !== p && m.dim === 0 && chebyshev(m.pos, t.pos) <= TURRET.range)
        .sort((a, b) => chebyshev(a.pos, t.pos) - chebyshev(b.pos, t.pos) || a.hp - b.hp || a.id - b.id)[0];
      if (!target) break;
      const block = line(t.pos, target.pos)
        .map((c) => structureAt(s, c))
        .find((x) => x?.kind === 'barricade' && (TURRET.ownBarricadesBlock || x.owner !== p));
      if (block) {
        s.events.push({ type: 'shot', dim: 0, from: { ...t.pos }, to: { ...block.pos }, source: 'turret' });
        destroyStructure(s, block);
        log(s, `A barricade at ${coord(block.pos)} absorbed a turret bullet and crumbled.`);
      } else {
        s.events.push({ type: 'shot', dim: 0, from: { ...t.pos }, to: { ...target.pos }, source: 'turret' });
        damageMachine(s, target, TURRET.damage, true, 'Turret');
      }
    }
  }
}

export function endTurn(s: GameState): ActionResult {
  if (s.winner !== null) return fail('Match over.');
  if (s.pendingSummon !== null) return fail('Choose which machines to bring into the dimension first.');
  const pl = s.players[s.current];
  pl.points += RULES.pointsPerTurn; // base income, paid at end of turn so both players start their first turn on 3
  const taxers = s.machines.filter((m) => m.kind === 'taxer' && m.owner === s.current && !isJammed(s, m));
  if (taxers.length) {
    pl.points += taxers.length * AV.interestPoints;
    log(s, `Interest: +${taxers.length * AV.interestPoints} point(s).`);
  }
  fireTurrets(s);
  if (CONVEYOR.pushEveryTurn) runConveyors(s);
  checkWinner(s);
  if (s.winner !== null) return OK;
  trackDimension(s);
  for (const m of s.machines) m.bonusAttacks = 0;
  s.turn++;
  s.current = other(s.current);
  s.actionUsed = false;
  s.actionBy = null;
  s.actionType = null;
  startTurn(s);
  return OK;
}

// ---------- industrial dimension ----------

export const inDimension = (s: GameState, p: PlayerId) => s.machines.some((m) => m.owner === p && m.dim === 1);

/** Counts the current player's turns in the dimension and pulls the opponent in after DIMENSION.summonAfterTurns. */
function trackDimension(s: GameState) {
  const p = s.current, opp = other(p), pl = s.players[p];
  if (inDimension(s, p)) addResearch(s, p, INDUSTRIAL.researchPerTurn);
  if (!inDimension(s, p)) {
    pl.dimTurns = 0;
    return;
  }
  if (inDimension(s, opp)) return; // PROVISIONAL: the counter pauses while both players are inside
  pl.dimTurns++;
  log(s, `${playerName(s, p)} has held the ${DIM_NAMES[1]} for ${pl.dimTurns}/${DIMENSION.summonAfterTurns} turn(s).`);
  if (pl.dimTurns >= DIMENSION.summonAfterTurns && s.machines.some((m) => m.owner === opp && m.dim === 0)) {
    pl.dimTurns = 0;
    s.pendingSummon = opp;
    log(s, `The portal surges! ${playerName(s, opp)} must send machines into the ${DIM_NAMES[1]}.`, null);
  }
}

/** Machines the summoned player may choose from. */
export function getSummonCandidates(s: GameState): Machine[] {
  if (s.pendingSummon === null) return [];
  return s.machines.filter((m) => m.owner === s.pendingSummon && m.dim === 0);
}

/** Resolves a pending summon: the chosen machines (at least one) are pulled into the dimension. Free action. */
export function summon(s: GameState, ids: number[]): ActionResult {
  if (s.pendingSummon === null || s.pendingSummon !== s.current) return fail('No summon pending.');
  const pool = getSummonCandidates(s);
  const chosen = [...new Set(ids)].map((id) => pool.find((m) => m.id === id));
  if (!chosen.length || chosen.some((m) => !m)) return fail('Pick at least one of your machines on the main battlefield.');
  const arrival = { r: DIMENSION.summonArrival[0], c: DIMENSION.summonArrival[1] };
  for (const m of chosen as Machine[]) {
    const at = nearestFree(s, 1, arrival);
    if (!at) break;
    s.events.push({ type: 'warp', dim: 0, pos: { ...m.pos } });
    m.dim = 1;
    m.pos = at;
    s.events.push({ type: 'warp', dim: 1, pos: { ...at } });
  }
  log(s, `${playerName(s, s.current)} sent ${chosen.map((m) => machineName(s, m!)).join(', ')} into the ${DIM_NAMES[1]}.`);
  s.pendingSummon = null;
  return OK;
}

// ---------- industrial research & spawnables ----------

export const DIR_NAMES: Record<Dir, string> = { N: 'north', E: 'east', S: 'south', W: 'west' };
export const DIR_STEP: Record<Dir, [number, number]> = { N: [-1, 0], E: [0, 1], S: [1, 0], W: [0, -1] };

/** Adds Industrial research and unlocks everything whose threshold is now met. */
export function addResearch(s: GameState, p: PlayerId, amount: number) {
  const pl = s.players[p];
  pl.research += amount;
  const fresh = Object.entries(INDUSTRIAL.unlocks)
    .filter(([kind, need]) => pl.research >= need && !pl.unlocked.includes(kind))
    .map(([kind]) => kind);
  if (!amount && !fresh.length) return;
  log(s, `${playerName(s, p)} Industrial research: ${pl.research}.`, p);
  for (const kind of fresh) {
    pl.unlocked.push(kind);
    const name = kind in MACHINES ? MACHINES[kind as MachineKind].name : STRUCTURES[kind as StructureKind].name;
    log(s, `${playerName(s, p)} unlocked the ${name}!`, p);
  }
}

/** Next locked item for a player, for the UI. */
export function nextUnlock(s: GameState, p: PlayerId): { kind: string; need: number } | null {
  const pl = s.players[p];
  const left = Object.entries(INDUSTRIAL.unlocks).filter(([k]) => !pl.unlocked.includes(k)).sort((a, b) => a[1] - b[1]);
  return left.length ? { kind: left[0][0], need: left[0][1] } : null;
}

/** Every conveyor pushes the machine standing on it one square, once per machine per turn. */
function runConveyors(s: GameState) {
  const moved = new Set<number>();
  for (const belt of s.structures.filter((x) => x.kind === 'conveyor')) {
    const m = machineAt(s, belt.pos, 0);
    if (!m || moved.has(m.id)) continue;
    const [dr, dc] = DIR_STEP[belt.dir ?? 'E'];
    const to = { r: m.pos.r + dr, c: m.pos.c + dc };
    if (!passable(s, to, 0)) continue; // blocked: the machine stays put
    moved.add(m.id);
    s.events.push({ type: 'push', dim: 0, from: { ...m.pos }, to: { ...to } });
    m.pos = to;
    log(s, `Conveyor moved ${playerName(s, m.owner)}'s ${machineName(s, m)} to ${coord(to)}.`, null);
    enterTile(s, m);
  }
}

/** Assigns a dock's drone to a friendly machine. Free action. */
export function assignDrone(s: GameState, dockId: number, machineId: number): ActionResult {
  const dock = s.structures.find((x) => x.id === dockId && x.kind === 'dock');
  const m = getMachine(s, machineId);
  if (!dock || dock.owner !== s.current || s.winner !== null || s.pendingSummon !== null) return fail('Not your drone dock.');
  if (!m || m.owner !== dock.owner) return fail('Pick one of your machines.');
  dock.droneTarget = m.id;
  log(s, `Repair drone now follows ${machineName(s, m)}.`);
  return OK;
}

/** Machine a dock's drone currently follows (null when it has none or the machine is gone). */
export function droneTargetOf(s: GameState, dock: Structure): Machine | undefined {
  return dock.droneTarget != null ? getMachine(s, dock.droneTarget) : undefined;
}
