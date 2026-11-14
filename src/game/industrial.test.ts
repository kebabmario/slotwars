import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addResearch, assignDrone, attack, createGame, endTurn, getAbilities, getAbilityTargets, getSpawnTiles,
  isUnlocked, machineAt, move, spawn, useAbility, canSeeStructure, getMoveTargets,
} from './engine.ts';
import { INDUSTRIAL, INDUSTRIAL_VALUES as IV, OVERLOAD_MINE, DRONE, TESLA } from './config.ts';
import type { GameState, MachineKind, PlayerId, Pos } from './types.ts';

function place(s: GameState, kind: MachineKind, owner: PlayerId, pos: Pos, dim: 0 | 1 = 0, hp = kind === 'juggernaut' ? 60 : 50) {
  s.machines.push({
    id: s.nextId++, kind, owner, pos, dim, hp, maxHp: hp,
    jammedThrough: -1, disabledThrough: -1, shieldThrough: -1, barrierThrough: -1, guardian: false, bonusAttacks: 0,
  });
  return s.machines[s.machines.length - 1];
}
const fresh = () => createGame(['guardian', 'guardian'], false);
const unlockAll = (s: GameState, p: PlayerId = 0) => addResearch(s, p, 99);

test('industrial items are locked until research unlocks them', () => {
  const s = fresh();
  s.players[0].points = 50;
  assert.equal(isUnlocked(s, 0, 'welder'), false);
  assert.equal(getSpawnTiles(s, 'welder').length, 0);
  assert.ok(!spawn(s, 'welder', { r: 3, c: 3 }).ok);
  assert.ok(isUnlocked(s, 0, 'scout'));
  addResearch(s, 0, INDUSTRIAL.unlocks.welder);
  assert.ok(isUnlocked(s, 0, 'welder'));
  assert.equal(isUnlocked(s, 0, 'crusher'), INDUSTRIAL.unlocks.crusher <= INDUSTRIAL.unlocks.welder);
  assert.equal(isUnlocked(s, 1, 'welder'), false); // per player
  assert.ok(spawn(s, 'welder', { r: 3, c: 3 }).ok);
  assert.ok(!spawn(s, 'welder', { r: 8, c: 8 }).ok); // home quadrant only
});

test('research is earned by ending turns with a machine in the dimension', () => {
  const s = fresh();
  place(s, 'scout', 0, { r: 5, c: 5 }, 1);
  endTurn(s);
  assert.equal(s.players[0].research, INDUSTRIAL.researchPerTurn);
  assert.equal(s.players[1].research, 0);
  assert.ok(s.players[0].unlocked.includes('welder'));
});

test('new machines spawn on the main battlefield with their own HP', () => {
  const s = fresh();
  unlockAll(s);
  s.players[0].points = 50;
  assert.ok(spawn(s, 'juggernaut', { r: 3, c: 3 }).ok);
  const j = machineAt(s, { r: 3, c: 3 }, 0)!;
  assert.equal(j.dim, 0);
  assert.equal(j.maxHp, 60);
});

test('Juggernaut: Reinforced Plating and Protective Barrier', () => {
  const s = fresh();
  const st = place(s, 'striker', 0, { r: 5, c: 5 });
  const j = place(s, 'juggernaut', 1, { r: 6, c: 6 });
  attack(s, st.id, j.pos);
  assert.equal(j.hp, 60 - (30 - IV.platingReduction));
  endTurn(s);
  s.players[1].sp = 6;
  const ally = place(s, 'scout', 1, { r: 7, c: 7 });
  assert.ok(useAbility(s, j.id, 'barrier', { r: 6, c: 6 }).ok);
  assert.ok(ally.barrierThrough >= s.turn + 1);
});

test('Barrier reduces damage on the next enemy turn', () => {
  const s = fresh();
  endTurn(s); // P2 turn
  s.players[1].sp = 6;
  const j = place(s, 'juggernaut', 1, { r: 6, c: 6 });
  const ally = place(s, 'scout', 1, { r: 7, c: 6 });
  useAbility(s, j.id, 'barrier', { r: 6, c: 6 });
  endTurn(s); // P1 turn
  const st = place(s, 'striker', 0, { r: 6, c: 5 });
  attack(s, st.id, ally.pos);
  assert.equal(ally.hp, 50 - (30 - IV.barrierReduction));
});

test('Welder: adjacent repair uses the action; reconstruction rebuilds wreckage', () => {
  const s = fresh();
  const w = place(s, 'welder', 0, { r: 3, c: 3 });
  const hurt = place(s, 'scout', 0, { r: 3, c: 4 }, 0, 50);
  hurt.hp = 30;
  const diag = place(s, 'scout', 0, { r: 4, c: 4 });
  diag.hp = 30;
  assert.deepEqual(getAbilityTargets(s, w.id, 'weld'), [{ r: 3, c: 4 }]);
  assert.ok(useAbility(s, w.id, 'weld', { r: 3, c: 4 }).ok);
  assert.equal(hurt.hp, 30 + IV.weldAmount);
  assert.equal(s.actionUsed, true);
  // a repair station is destroyed, then rebuilt
  s.structures.push({ id: s.nextId++, kind: 'repair', owner: 0, pos: { r: 1, c: 4 }, hp: 40 });
  endTurn(s);
  const cr = place(s, 'crusher', 1, { r: 3, c: 6 });
  s.structures[0].hp = 10;
  attack(s, cr.id, { r: 1, c: 4 });
  assert.equal(s.structures.length, 0);
  assert.equal(s.wreckage.length, 1);
  endTurn(s);
  s.players[0].sp = 5;
  assert.deepEqual(getAbilityTargets(s, w.id, 'reconstruct'), [{ r: 1, c: 4 }]);
  assert.ok(useAbility(s, w.id, 'reconstruct', { r: 1, c: 4 }).ok);
  assert.equal(s.structures[0].kind, 'repair');
  assert.equal(s.structures[0].hp, 40);
  assert.equal(s.wreckage.length, 0);
});

test('Welder cannot rebuild onto an occupied tile or from the dimension', () => {
  const s = fresh();
  s.wreckage.push({ kind: 'barricade', owner: 0, pos: { r: 2, c: 2 } });
  const w = place(s, 'welder', 0, { r: 4, c: 4 });
  s.players[0].sp = 10;
  place(s, 'scout', 0, { r: 2, c: 2 });
  assert.equal(getAbilityTargets(s, w.id, 'reconstruct').length, 0);
  w.dim = 1;
  assert.equal(getAbilities(s, w.id).find((a) => a.key === 'reconstruct')!.reason, 'Main battlefield only');
});

test('Crusher: Demolition bonus vs structures and Groundbreaker area', () => {
  const s = fresh();
  const cr = place(s, 'crusher', 0, { r: 5, c: 5 });
  s.structures.push({ id: s.nextId++, kind: 'turret', owner: 1, pos: { r: 6, c: 6 }, hp: 60 });
  attack(s, cr.id, { r: 6, c: 6 });
  assert.equal(s.structures[0].hp, 60 - 25 - IV.demolitionBonus);
  s.players[0].sp = 6;
  const e1 = place(s, 'scout', 1, { r: 4, c: 4 });
  const e2 = place(s, 'scout', 1, { r: 5, c: 7 }); // outside 3x3
  const f = place(s, 'scout', 0, { r: 4, c: 5 });
  const eDim = place(s, 'scout', 1, { r: 4, c: 6 }, 1); // other dimension
  assert.ok(useAbility(s, cr.id, 'groundbreaker').ok);
  assert.equal(e1.hp, 50 - IV.groundbreakerDamage);
  assert.equal(e2.hp, 50);
  assert.equal(f.hp, IV.groundbreakerFriendlyFire ? 50 - IV.groundbreakerDamage : 50);
  assert.equal(eDim.hp, 50);
});

test('Conveyor pushes the machine on it at the end of the turn', () => {
  const s = fresh();
  unlockAll(s);
  s.players[0].points = 20;
  assert.ok(spawn(s, 'conveyor', { r: 3, c: 3 }, { dir: 'S' }).ok);
  assert.equal(s.structures[0].dir, 'S');
  const m = place(s, 'scout', 1, { r: 3, c: 3 });
  endTurn(s);
  assert.deepEqual(m.pos, { r: 4, c: 3 });
  // blocked destination: stays put
  const blocker = place(s, 'scout', 0, { r: 4, c: 3 });
  m.pos = { r: 3, c: 3 };
  endTurn(s);
  assert.deepEqual(m.pos, { r: 3, c: 3 });
  assert.deepEqual(blocker.pos, { r: 4, c: 3 });
});

test('Tesla Generator adds SP at the start of its owner turn', () => {
  const s = fresh();
  unlockAll(s);
  s.players[0].points = 20;
  spawn(s, 'tesla', { r: 2, c: 2 });
  const before = s.players[0].sp;
  endTurn(s);
  endTurn(s);
  assert.equal(s.players[0].sp, before + 2 + TESLA.spPerTurn);
});

test('Drone Dock repairs its assigned machine and can be reassigned, even in the dimension', () => {
  const s = fresh();
  unlockAll(s);
  s.players[0].points = 20;
  const king = s.machines[0];
  king.hp = 30;
  spawn(s, 'dock', { r: 3, c: 3 });
  const dock = s.structures[0];
  assert.equal(dock.droneTarget, king.id);
  const sc = place(s, 'scout', 0, { r: 5, c: 5 }, 1);
  sc.hp = 20;
  assert.ok(assignDrone(s, dock.id, sc.id).ok);
  assert.ok(!assignDrone(s, dock.id, s.machines[1].id).ok); // enemy King
  endTurn(s);
  endTurn(s);
  assert.equal(sc.hp, DRONE.followsIntoDimension ? 20 + DRONE.heal : 20);
  assert.equal(king.hp, 30);
});

test('Overload Mine: hidden, damages and jams the first enemy, then disappears', () => {
  const s = fresh();
  unlockAll(s);
  s.players[0].points = 20;
  spawn(s, 'mine', { r: 2, c: 3 });
  assert.equal(canSeeStructure(s, 1, s.structures[0]), false);
  endTurn(s);
  const d = place(s, 'striker', 1, { r: 2, c: 4 });
  assert.ok(getMoveTargets(s, d.id).some((o) => o.pos.r === 2 && o.pos.c === 3));
  move(s, d.id, { r: 2, c: 3 });
  assert.equal(d.hp, 50 - OVERLOAD_MINE.damage);
  assert.ok(d.jammedThrough >= s.turn + OVERLOAD_MINE.jamTurns);
  assert.equal(s.structures.length, 0);
});

test('industrial machines keep HP, owner and statuses through the portal', () => {
  const s = fresh();
  const j = place(s, 'juggernaut', 0, { r: 0, c: 10 });
  j.hp = 41;
  j.barrierThrough = 7;
  move(s, j.id, { r: 0, c: 11 });
  assert.equal(j.dim, 1);
  assert.equal(j.hp, 41);
  assert.equal(j.barrierThrough, 7);
  assert.equal(j.maxHp, 60);
  assert.equal(j.owner, 0);
});
