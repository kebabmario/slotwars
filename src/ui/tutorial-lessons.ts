// Tutorial lesson scripts. DOM-free: each step names what to highlight, which player action it waits for,
// and (for tests) how to perform that action through the real engine. Scenarios use real rules and values.
import { ABILITY_VALUES, INDUSTRIAL, KING_ABILITIES, RULES, SHOCK_TRAP, STRUCTURES, TURRET, REPAIR_STATION } from '../game/config.ts';
import * as E from '../game/engine.ts';
import type { Dim, GameState, Machine, Pos } from '../game/types.ts';
import type { GuidedAction } from './game.ts';

export interface Step {
  text: string; // static HTML
  tiles?: (s: GameState) => Pos[]; // board squares to highlight
  ui?: string[]; // UI elements to highlight (CSS selectors inside the game window)
  view?: Dim; // battlefield to show for this step
  icon?: string; // machine or structure sprite shown in the coach window
  task?: string; // short instruction for interactive steps
  expect?: (a: GuidedAction, s: GameState) => boolean; // interactive: the action that completes the step
  allow?: (a: GuidedAction, s: GameState) => boolean; // extra harmless actions permitted during the step
  solve?: (s: GameState) => GuidedAction; // performs the step through the engine (tests)
  passOpponent?: boolean; // after End Turn, the tutorial opponent passes so control returns to you
}
export interface Lesson {
  id: string;
  title: string;
  setup: () => GameState;
  steps: Step[];
}

// ---------- helpers ----------
const base = () => E.createGame(['guardian', 'overcharge'], false, ['Mr. Sludgy', 'Mr. Sludgy'], { playerNames: ['You', 'Rival'] });
const king = (s: GameState, p: 0 | 1) => s.machines.find((m) => m.kind === 'sludgy' && m.owner === p)!;
const mine = (s: GameState, kind: string) => s.machines.find((m) => m.kind === kind && m.owner === 0)!;
const quadrant = (q: number) => E.areaCells({ r: q >= 2 ? 6 : 0, c: q % 2 ? 6 : 0 }, 6);
const moves = (s: GameState, m: Machine) => E.getMoveTargets(s, m.id).map((o) => o.pos);
const isSelect = (a: GuidedAction, m: Machine) => a.kind === 'select' && a.id === m.id;
const selectStep = (who: (s: GameState) => Machine, text: string): Step => ({
  text,
  tiles: (s) => [who(s).pos],
  task: 'Click the highlighted machine.',
  expect: (a, s) => isSelect(a, who(s)),
  solve: (s) => ({ kind: 'select', id: who(s).id }),
});
const endTurnStep = (text: string): Step => ({
  text,
  ui: ['#end-turn'],
  task: 'Press End Turn.',
  expect: (a) => a.kind === 'endTurn',
  solve: (s) => (E.endTurn(s), { kind: 'endTurn' }),
  passOpponent: true,
});
const spawnSteps = (kind: string, pickText: string, placeText: string): Step[] => [
  {
    text: pickText,
    icon: kind,
    ui: [`[data-spawn="${kind}"]`],
    task: 'Click the highlighted spawn button.',
    expect: (a) => a.kind === 'spawnPick' && a.spawn === kind,
    solve: () => ({ kind: 'spawnPick', spawn: kind }),
  },
  {
    text: placeText,
    icon: kind,
    tiles: (s) => E.getSpawnTiles(s, kind as E.SpawnKind),
    task: 'Click any green square in your home quadrant.',
    expect: (a) => a.kind === 'spawn' && a.spawn === kind,
    allow: (a) => a.kind === 'spawnPick' && a.spawn === kind,
    solve: (s) => {
      const at = E.getSpawnTiles(s, kind as E.SpawnKind)[0];
      E.spawn(s, kind as E.SpawnKind, at);
      return { kind: 'spawn', spawn: kind, at };
    },
  },
];

export const LESSONS: Lesson[] = [
  {
    id: 'board',
    title: 'Understanding the Board',
    setup: base,
    steps: [
      { text: 'Welcome to <b>Slot Wars</b>! The battlefield is a <b>12×12 grid</b> of squares, split into four <b>6×6 quadrants</b>.', ui: ['.board'] },
      { text: '<b>Q1</b> (top-left, blue) is <b>your home quadrant</b>. Your King starts here, and this is the only place you can spawn.', tiles: () => quadrant(0) },
      { text: '<b>Q4</b> (bottom-right, red) is your <b>opponent\'s home quadrant</b>.', tiles: () => quadrant(3) },
      { text: '<b>Q2</b> (top-right) holds the <b>portal</b> in its far corner, at L1. It leads to another battlefield.', tiles: () => [E.PORTAL, ...quadrant(1)] },
      { text: '<b>Q3</b> (bottom-left) is open street with no special function. Every quadrant can be crossed by any machine.', tiles: () => quadrant(2) },
      {
        text: 'The portal leads to the <b>Industrial Dimension</b>. Have a look at it.',
        ui: ['.dimtab[data-dim="1"]'],
        task: 'Click the Industrial Dimension tab.',
        expect: (a) => a.kind === 'tab' && a.dim === 1,
        solve: () => ({ kind: 'tab', dim: 1 }),
      },
      { text: 'This is a second <b>12×12 battlefield</b> with the same rules. Its portal back to the main battlefield is at <b>A12</b>.', view: 1, tiles: () => [E.DIM_PORTAL] },
      {
        text: 'Head back to the main battlefield.',
        view: 1,
        ui: ['.dimtab[data-dim="0"]'],
        task: 'Click the Main Battlefield tab.',
        expect: (a) => a.kind === 'tab' && a.dim === 0,
        solve: () => ({ kind: 'tab', dim: 0 }),
      },
    ],
  },
  {
    id: 'machines',
    title: 'Machines',
    setup: () => {
      const s = base();
      E.placeMachine(s, 'scout', 0, { r: 3, c: 3 });
      return s;
    },
    steps: [
      { text: 'This is your King, <b>Mr. Sludgy</b>. If your King is destroyed, you <b>lose immediately</b>. You can rename your King when you set up a match.', icon: 'sludgy', tiles: (s) => [king(s, 0).pos] },
      selectStep((s) => king(s, 0), 'Machines are commanded by <b>selecting</b> them.'),
      { text: `The panel shows the selected machine. Most machines have <b>${RULES.machineHp} HP</b>; at 0 HP a machine is destroyed.`, ui: ['.unit-info'] },
      {
        text: 'Cyan squares show where it can go. Machines move <b>one square</b> up, down, left or right, never diagonally.',
        tiles: (s) => moves(s, king(s, 0)),
        task: 'Click a cyan square to move your King.',
        expect: (a, s) => a.kind === 'move' && a.id === king(s, 0).id,
        solve: (s) => {
          const k = king(s, 0), to = moves(s, k)[0];
          E.move(s, k.id, to);
          return { kind: 'move', id: k.id, to };
        },
      },
      endTurnStep('Each turn you get <b>one action</b>: move one machine or attack with one machine. That was it, so end your turn. (In this tutorial your rival passes.)'),
      selectStep((s) => mine(s, 'scout'), 'This is a <b>Scout</b>. Select it.'),
      {
        text: `Scouts have <b>Quickstep</b>: they move up to <b>${ABILITY_VALUES.quickstepRange} squares</b>.`,
        icon: 'scout',
        tiles: (s) => moves(s, mine(s, 'scout')).filter((p) => Math.abs(p.r - mine(s, 'scout').pos.r) + Math.abs(p.c - mine(s, 'scout').pos.c) === 2),
        task: 'Move the Scout two squares away.',
        expect: (a, s) => a.kind === 'move' && a.id === mine(s, 'scout').id,
        solve: (s) => {
          const m = mine(s, 'scout'), to = { r: m.pos.r, c: m.pos.c + 2 };
          E.move(s, m.id, to);
          return { kind: 'move', id: m.id, to };
        },
      },
      { text: 'Every machine has a regular ability and an SP ability. The full list is in <b>How to Play</b>.', icon: 'defender' },
    ],
  },
  {
    id: 'combat',
    title: 'Combat',
    setup: () => {
      const s = base();
      E.placeMachine(s, 'striker', 0, { r: 4, c: 4 });
      E.placeMachine(s, 'scout', 1, { r: 5, c: 5 }).hp = 20; // already damaged in this scenario
      return s;
    },
    steps: [
      {
        text: `Machines attack <b>diagonally</b>, up to <b>${RULES.attackRange} squares</b> away. A normal hit deals <b>${RULES.attackDamage}</b> damage; a Striker's Heavy Hit deals <b>${ABILITY_VALUES.heavyHitDamage}</b>.`,
        icon: 'striker',
        tiles: (s) => {
          const p = mine(s, 'striker').pos, out: Pos[] = [];
          for (let d = 1; d <= RULES.attackRange; d++) for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) out.push({ r: p.r + dr * d, c: p.c + dc * d });
          return out.filter(E.inBounds);
        },
      },
      selectStep((s) => mine(s, 'striker'), 'Select your <b>Striker</b>.'),
      {
        text: 'A red crosshair marks an enemy you can hit. The Rival\'s Scout is already damaged (20 HP).',
        tiles: () => [{ r: 5, c: 5 }],
        task: 'Click the red crosshair to attack.',
        expect: (a, s) => a.kind === 'attack' && a.id === mine(s, 'striker').id,
        solve: (s) => {
          const st = mine(s, 'striker');
          E.attack(s, st.id, { r: 5, c: 5 });
          return { kind: 'attack', id: st.id, to: { r: 5, c: 5 } };
        },
      },
      { text: 'The Scout dropped to <b>0 HP</b> and was <b>destroyed</b>. Destroyed machines are removed from the battlefield.' },
      {
        text: 'Everything revolves around the Kings. <b>Destroy the enemy King to win.</b> Keep yours out of diagonal reach: if it falls, you lose instantly.',
        icon: 'sludgy',
        tiles: (s) => [king(s, 0).pos, king(s, 1).pos],
      },
    ],
  },
  {
    id: 'economy',
    title: 'Economy',
    setup: () => {
      const s = base();
      s.players[0].sp = KING_ABILITIES.guardian.sp; // scenario: you have saved up enough SP
      return s;
    },
    steps: [
      { text: `<b>Points</b> buy machines and spawnables. You start with <b>${RULES.startingPoints}</b> and earn <b>+${RULES.pointsPerTurn}</b> at the end of each turn.`, ui: ['.pstat.p1 .counter:nth-of-type(1)'] },
      ...spawnSteps('scout', 'Spawning <b>does not use your action</b>. Pick the Scout (1 point).', 'Spawns go on empty squares in <b>your home quadrant</b>.'),
      { text: `<b>Skill Points (SP)</b> pay for special abilities. You get <b>+${RULES.spPerTurn} SP</b> at the start of each turn. For this lesson you have already saved ${KING_ABILITIES.guardian.sp}.`, ui: ['.pstat.p1 .counter:nth-of-type(2)'] },
      selectStep((s) => king(s, 0), 'Your King has the ability you picked at match setup. Select your King.'),
      {
        text: `<b>Guardian</b> (${KING_ABILITIES.guardian.sp} SP): ${KING_ABILITIES.guardian.text}`,
        ui: ['[data-ability="guardian"]'],
        task: 'Click the Guardian ability button.',
        expect: (a) => a.kind === 'ability' && a.key === 'guardian',
        solve: (s) => (E.useAbility(s, king(s, 0).id, 'guardian'), { kind: 'ability', key: 'guardian' }),
      },
      { text: 'Guardian is active: the <b>G</b> badge shows it. Abilities spend SP but do not use your action.', tiles: (s) => [king(s, 0).pos] },
    ],
  },
  {
    id: 'spawnables',
    title: 'Spawnables',
    setup: () => {
      const s = base();
      s.players[0].points = 10; // scenario budget
      return s;
    },
    steps: [
      { text: `Besides machines you can build <b>spawnables</b> in your home quadrant. First, the <b>Barricade</b>: ${STRUCTURES.barricade.text}`, icon: 'barricade' },
      ...spawnSteps('barricade', `Pick the Barricade (${STRUCTURES.barricade.cost} point).`, 'Place it in your home quadrant.'),
      { text: `<b>Turret</b>: ${STRUCTURES.turret.text} Range ${TURRET.range}, ${TURRET.damage} damage.`, icon: 'turret' },
      { text: `<b>Repair Station</b>: ${STRUCTURES.repair.text} Range ${REPAIR_STATION.range}, +${REPAIR_STATION.heal} HP.`, icon: 'repair' },
      ...spawnSteps('trap', `<b>Shock Trap</b>: ${STRUCTURES.trap.text} Pick it (${STRUCTURES.trap.cost} points).`, 'Place the trap. Your rival will not see it.'),
      { text: `The trap deals <b>${SHOCK_TRAP.damage}</b> damage to the first enemy machine that steps on it, then disappears.`, icon: 'trap' },
    ],
  },
  {
    id: 'industrial',
    title: 'Industrial Dimension',
    setup: () => {
      const s = base();
      E.placeMachine(s, 'scout', 0, { r: 0, c: 10 });
      return s;
    },
    steps: [
      { text: 'Moving any machine onto the <b>portal</b> sends it to the Industrial Dimension. It keeps its HP, statuses and owner.', tiles: () => [E.PORTAL] },
      selectStep((s) => mine(s, 'scout'), 'Select the Scout next to the portal.'),
      {
        text: 'The portal square is outlined in purple when you can step onto it.',
        tiles: () => [E.PORTAL],
        task: 'Move the Scout onto the portal.',
        expect: (a, s) => a.kind === 'move' && a.id === mine(s, 'scout').id && E.samePos(a.to, E.PORTAL),
        solve: (s) => (E.move(s, mine(s, 'scout').id, E.PORTAL), { kind: 'move', id: mine(s, 'scout').id, to: E.PORTAL }),
      },
      { text: 'Your Scout arrived in the <b>Industrial Dimension</b>. Movement, combat and abilities work exactly the same here. Step on the portal at A12 to go back.', view: 1, tiles: (s) => [mine(s, 'scout').pos, E.DIM_PORTAL] },
      { text: `Ending a turn with at least one machine here earns <b>${INDUSTRIAL.researchPerTurn} Industrial research</b>.`, view: 1, ui: ['.research'] },
      { ...endTurnStep('End your turn with the Scout inside.'), view: 1 },
      {
        text: `Research unlocks Industrial machines and spawnables for the rest of the match. At ${INDUSTRIAL.unlocks.welder} research the <b>Welder</b> and <b>Conveyor Belt</b> become available here, spawned in your home quadrant.`,
        ui: ['[data-spawn="welder"]', '[data-spawn="conveyor"]', '.research'],
      },
      { text: 'That is everything you need. Hold the dimension for 3 turns and your opponent must follow you in. Good luck, Commander!', icon: 'sludgy' },
    ],
  },
];
