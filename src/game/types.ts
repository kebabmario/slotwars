export type PlayerId = 0 | 1;
export type MachineKind =
  | 'sludgy' | 'scout' | 'defender' | 'striker' | 'saboteur' | 'breacher' | 'medic' | 'taxer'
  | 'juggernaut' | 'welder' | 'crusher'; // industrial machines (unlocked through the dimension)
export type StructureKind =
  | 'barricade' | 'turret' | 'repair' | 'trap'
  | 'conveyor' | 'tesla' | 'dock' | 'mine'; // industrial spawnables (unlocked through the dimension)
export type Dir = 'N' | 'E' | 'S' | 'W';
export type KingAbility = 'guardian' | 'overcharge' | 'phantom';
/** 0 = main battlefield (Earth, 2100), 1 = industrial dimension. */
export type Dim = 0 | 1;

export interface Pos {
  r: number;
  c: number;
}

export interface Machine {
  id: number;
  kind: MachineKind;
  owner: PlayerId;
  pos: Pos;
  dim: Dim; // which battlefield the machine is on
  hp: number;
  maxHp: number;
  // Status effects store the last global turn number they apply to.
  jammedThrough: number; // regular ability disabled
  disabledThrough: number; // cannot move, attack or use abilities
  shieldThrough: number; // Shield Wall reduction active
  barrierThrough: number; // Juggernaut's Protective Barrier reduction active
  guardian: boolean; // Mr. Sludgy's next incoming attack is blocked
  bonusAttacks: number; // Double Strike, reset every turn
}

export interface Structure {
  id: number;
  kind: StructureKind;
  owner: PlayerId;
  pos: Pos;
  hp: number;
  dir?: Dir; // conveyor belt direction
  droneTarget?: number | null; // drone dock: machine the drone follows
}

/** A destroyed barricade or repair station the Welder can rebuild. */
export interface Wreck {
  kind: StructureKind;
  owner: PlayerId;
  pos: Pos;
}

export interface PlayerState {
  name: string; // display name chosen at setup
  points: number;
  sp: number;
  king: KingAbility;
  kingName: string; // cosmetic only; the King is always the 'sludgy' machine
  dimTurns: number; // own turns ended with a machine in the dimension while the opponent had none there
  research: number; // Industrial research, earned in the dimension
  unlocked: string[]; // industrial machines/spawnables this player can spawn
  overcharge: boolean;
  revealQuadrant: number | null;
  revealThrough: number;
}

export type GameEvent =
  // kind/owner/armor/source/heavy are presentation metadata for animations; they never affect rules
  | { type: 'damage'; dim: Dim; pos: Pos; amount: number; structure?: boolean; kind?: string; armor?: number }
  | { type: 'heal'; dim: Dim; pos: Pos; amount: number }
  | { type: 'blocked'; dim: Dim; pos: Pos }
  | { type: 'destroyed'; dim: Dim; pos: Pos; structure?: boolean; kind?: string; owner?: PlayerId }
  | { type: 'shot'; dim: Dim; from: Pos; to: Pos; source?: string; heavy?: boolean }
  | { type: 'zap'; dim: Dim; pos: Pos }
  | { type: 'warp'; dim: Dim; pos: Pos }
  | { type: 'mine'; dim: Dim; pos: Pos }
  | { type: 'push'; dim: Dim; from: Pos; to: Pos }
  | { type: 'area'; dim: Dim; cells: Pos[]; tone: 'harm' | 'help' | 'tech' }
  | { type: 'spawn'; dim: Dim; pos: Pos; kind: string; owner: PlayerId }
  | { type: 'ability'; dim: Dim; key: string; owner: PlayerId; from: Pos; to: Pos; toDim: Dim; cells: Pos[] };

export interface LogEntry {
  turn: number;
  player: PlayerId | null;
  text: string;
  /** Online fog of war: players allowed to read this line. Absent means everyone. Hot-seat shows every line. */
  visibleTo?: PlayerId[];
}

export interface GameState {
  turn: number; // global turn counter, player = turn % 2
  current: PlayerId;
  actionUsed: boolean;
  actionBy: number | null; // machine that used the action
  actionType: 'move' | 'attack' | 'repair' | null;
  machines: Machine[];
  structures: Structure[];
  players: [PlayerState, PlayerState];
  log: LogEntry[];
  events: GameEvent[]; // drained by the UI after each action
  winner: PlayerId | 'draw' | null;
  nextId: number;
  fog: boolean;
  pendingSummon: PlayerId | null; // this player must pick machines to bring into the dimension
  wreckage: Wreck[];
}

export type ActionResult = { ok: true } | { ok: false; error: string };
