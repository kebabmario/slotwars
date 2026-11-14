// Shared action layer: one entry point for every state change, used by local play now and by the
// online match server later. It adds seat checks, payload checks and fog-of-war redaction around
// the existing engine functions. Rules live only in engine.ts; nothing here changes them.
import * as E from './engine.ts';
import { DIMENSION, MACHINES, STRUCTURES, BOARD_SIZE } from './config.ts';
import type { ActionResult, Dim, Dir, GameEvent, GameState, LogEntry, PlayerId, Pos } from './types.ts';

/** Bump when a rules change makes saved or in-flight online matches incompatible. */
export const RULES_VERSION = 1;

export type Action =
  | { t: 'move'; id: number; to: Pos }
  | { t: 'attack'; id: number; at: Pos }
  | { t: 'spawn'; kind: E.SpawnKind; at: Pos; dir?: Dir }
  | { t: 'ability'; id: number; key: string; target?: Pos }
  | { t: 'endTurn' }
  | { t: 'summon'; ids: number[] }
  | { t: 'assignDrone'; dockId: number; machineId: number };

/** Per-player quadrant sets the player could see before or after the action (used for redaction). */
export type Seen = [Set<number>, Set<number>];
export type AppliedResult = ActionResult & { seen: Seen };

const DIRS: readonly string[] = ['N', 'E', 'S', 'W'];
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isId = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0 && (x as number) < 1e6;
const isPos = (x: unknown): x is Pos =>
  isObj(x) && Number.isInteger(x.r) && Number.isInteger(x.c) && (x.r as number) >= 0 && (x.c as number) >= 0 && (x.r as number) < BOARD_SIZE && (x.c as number) < BOARD_SIZE;
const pos = (p: Pos): Pos => ({ r: p.r, c: p.c });

/** Checks an untrusted payload (for example from a WebSocket) and returns a clean Action, or null. */
export function parseAction(x: unknown): Action | null {
  if (!isObj(x)) return null;
  switch (x.t) {
    case 'move':
      return isId(x.id) && isPos(x.to) ? { t: 'move', id: x.id, to: pos(x.to) } : null;
    case 'attack':
      return isId(x.id) && isPos(x.at) ? { t: 'attack', id: x.id, at: pos(x.at) } : null;
    case 'spawn': {
      const kind = x.kind;
      if (typeof kind !== 'string' || !(Object.hasOwn(MACHINES, kind) || Object.hasOwn(STRUCTURES, kind)) || !isPos(x.at)) return null;
      if (x.dir !== undefined && !(typeof x.dir === 'string' && DIRS.includes(x.dir))) return null;
      return { t: 'spawn', kind: kind as E.SpawnKind, at: pos(x.at), ...(x.dir !== undefined ? { dir: x.dir as Dir } : {}) };
    }
    case 'ability':
      if (!isId(x.id) || typeof x.key !== 'string' || x.key.length > 32 || (x.target !== undefined && !isPos(x.target))) return null;
      return { t: 'ability', id: x.id, key: x.key, ...(x.target !== undefined ? { target: pos(x.target as Pos) } : {}) };
    case 'endTurn':
      return { t: 'endTurn' };
    case 'summon':
      return Array.isArray(x.ids) && x.ids.length <= 64 && x.ids.every(isId) ? { t: 'summon', ids: [...x.ids] } : null;
    case 'assignDrone':
      return isId(x.dockId) && isId(x.machineId) ? { t: 'assignDrone', dockId: x.dockId, machineId: x.machineId } : null;
    default:
      return null;
  }
}

function dispatch(s: GameState, a: Action): ActionResult {
  switch (a.t) {
    case 'move': return E.move(s, a.id, a.to);
    case 'attack': return E.attack(s, a.id, a.at);
    case 'spawn': return E.spawn(s, a.kind, a.at, a.dir ? { dir: a.dir } : {});
    case 'ability': return E.useAbility(s, a.id, a.key, a.target);
    case 'endTurn': return E.endTurn(s);
    case 'summon': return E.summon(s, a.ids);
    case 'assignDrone': return E.assignDrone(s, a.dockId, a.machineId);
  }
}

const COORD = /\b([A-L])(1[0-2]|[1-9])\b/g;
/** Fail closed: a log line is shown to a player only if every board coordinate in it was visible to them. */
function lineVisibleTo(text: string, seen: Set<number>): boolean {
  // Industrial Dimension coordinates are public while the dimension has no fog
  if (text.includes('Industrial') && !DIMENSION.fog) return true;
  for (const m of text.matchAll(COORD)) if (!seen.has(E.quadrantOf({ r: Number(m[2]) - 1, c: m[1].charCodeAt(0) - 65 }))) return false;
  return true;
}

/**
 * The only way to change a match. `seat` is the player sending the action (in hot-seat that is
 * whoever's turn it is). Rejects without touching the state when the seat or payload is wrong;
 * otherwise runs the engine function, which itself refuses illegal moves without mutating.
 */
export function applyAction(s: GameState, seat: PlayerId, action: unknown): AppliedResult {
  const before: Seen = [E.visibleQuadrants(s, 0), E.visibleQuadrants(s, 1)];
  const reject = (error: string): AppliedResult => ({ ok: false, error, seen: before });
  if (s.winner !== null) return reject('Match over.');
  if (seat !== s.current) return reject('Not your turn.');
  const a = parseAction(action);
  if (!a) return reject('Malformed action.');
  const logFrom = s.log.length;
  const r = dispatch(s, a);
  const seen: Seen = [0, 1].map((p) => new Set([...before[p], ...E.visibleQuadrants(s, p as PlayerId)])) as Seen;
  if (s.fog) {
    const hiddenDeploy = a.t === 'spawn' && Object.hasOwn(STRUCTURES, a.kind) && STRUCTURES[a.kind as keyof typeof STRUCTURES].hidden;
    for (const e of s.log.slice(logFrom)) {
      const to = ([0, 1] as PlayerId[]).filter((p) => p === seat || (!hiddenDeploy && lineVisibleTo(e.text, seen[p])));
      if (to.length < 2) e.visibleTo = to;
    }
  }
  return { ...r, seen };
}

const logVisible = (e: LogEntry, viewer: PlayerId) => !e.visibleTo || e.visibleTo.includes(viewer);

/** What one player may know: a deep copy with hidden machines, structures, wreckage and log lines removed. */
export function redactFor(s: GameState, viewer: PlayerId): GameState {
  const v = structuredClone(s);
  v.machines = v.machines.filter((m) => E.canSeeMachine(s, viewer, m));
  v.structures = v.structures.filter((x) => E.canSeeStructure(s, viewer, x));
  v.wreckage = v.wreckage.filter((w) => w.owner === viewer || E.canSeeTile(s, viewer, w.pos));
  v.log = v.log.filter((e) => logVisible(e, viewer));
  v.events = [];
  return v;
}

/**
 * Events one player may see. `seen` comes from applyAction (visibility before or after the action),
 * so a player still sees their own machine being destroyed. A hidden start point is replaced by the
 * end point, so an unseen shooter or mover is never revealed.
 */
export function eventsFor(s: GameState, viewer: PlayerId, events: GameEvent[], seen: Set<number> = E.visibleQuadrants(s, viewer)): GameEvent[] {
  if (!s.fog) return events.filter((e) => !(e.type === 'spawn' && e.owner !== viewer && isHiddenKind(e.kind)));
  const vis = (dim: Dim, p: Pos) => (dim === 1 && !DIMENSION.fog) || seen.has(E.quadrantOf(p));
  const out: GameEvent[] = [];
  for (const e of events) {
    switch (e.type) {
      case 'spawn':
        if (e.owner === viewer || (!isHiddenKind(e.kind) && vis(e.dim, e.pos))) out.push(e);
        break;
      case 'ability': {
        if (e.owner === viewer) { out.push(e); break; }
        const cells = e.cells.filter((c) => vis(e.dim, c));
        const toSeen = vis(e.toDim, e.to), fromSeen = vis(e.dim, e.from);
        if (!toSeen && !fromSeen && !cells.length) break;
        out.push({ ...e, cells, from: fromSeen ? e.from : toSeen ? e.to : cells[0] ?? e.from, to: toSeen ? e.to : fromSeen ? e.from : cells[0] ?? e.to, toDim: toSeen ? e.toDim : e.dim });
        break;
      }
      case 'shot':
      case 'push':
        if (vis(e.dim, e.to)) out.push(vis(e.dim, e.from) ? e : { ...e, from: e.to });
        break;
      case 'area': {
        const cells = e.cells.filter((c) => vis(e.dim, c));
        if (cells.length) out.push({ ...e, cells });
        break;
      }
      default:
        if (vis(e.dim, e.pos)) out.push(e);
    }
  }
  return out;
}
const isHiddenKind = (k: string) => Object.hasOwn(STRUCTURES, k) && !!STRUCTURES[k as keyof typeof STRUCTURES].hidden;

/** Online: the action was sent; the result arrives later as a new view from the server. */
export type Pending = { ok: true; pending: true };

/** How the UI sends actions. Local play applies them in the browser; online play sends them to the server. */
export interface MatchController {
  /** The seat this device plays, or null in hot-seat, where it is always the current player. */
  readonly seat: PlayerId | null;
  apply(action: Action): AppliedResult | Pending;
}

export class LocalController implements MatchController {
  readonly seat = null;
  private state: () => GameState;
  constructor(state: () => GameState) {
    this.state = state;
  }
  apply(action: Action): AppliedResult {
    const s = this.state();
    return applyAction(s, s.current, action);
  }
}
