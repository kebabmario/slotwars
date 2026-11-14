import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  attack,
  createGame,
  endTurn,
  getAttackTargets,
  getMoveTargets,
  getSpawnTiles,
  machineAt,
  move,
  spawn,
  useAbility,
  canSeeMachine,
  summon,
  getSummonCandidates,
  machineName,
} from './engine.ts';
import type { GameState, MachineKind, PlayerId, Pos } from './types.ts';

function place(s: GameState, kind: MachineKind, owner: PlayerId, pos: Pos, dim: 0 | 1 = 0) {
  s.machines.push({
    id: s.nextId++, kind, owner, pos, dim, hp: 50, maxHp: 50,
    jammedThrough: -1, disabledThrough: -1, shieldThrough: -1, barrierThrough: -1, guardian: false, bonusAttacks: 0,
  });
  return s.machines[s.machines.length - 1];
}
const fresh = () => createGame(['guardian', 'overcharge'], false);

test('start resources and turn flow', () => {
  const s = fresh();
  assert.equal(s.players[0].points, 3);
  assert.equal(s.players[0].sp, 2);
  assert.equal(s.players[1].sp, 0);
  endTurn(s);
  assert.equal(s.current, 1);
  assert.equal(s.players[1].sp, 2);
  assert.equal(s.players[1].points, 3);
});

test('orthogonal 1-step move, one action per turn', () => {
  const s = fresh();
  const k = s.machines[0];
  const targets = getMoveTargets(s, k.id).map((o) => `${o.pos.r},${o.pos.c}`).sort();
  assert.deepEqual(targets, ['0,1', '1,0', '1,2', '2,1']);
  assert.ok(move(s, k.id, { r: 1, c: 2 }).ok);
  assert.equal(getMoveTargets(s, k.id).length, 0);
});

test('scout quickstep reaches 2 squares', () => {
  const s = fresh();
  const sc = place(s, 'scout', 0, { r: 4, c: 4 });
  assert.equal(getMoveTargets(s, sc.id).length, 12);
});

test('spawning is free of the action and limited to home quadrant', () => {
  const s = fresh();
  assert.ok(getSpawnTiles(s, 'scout').every((p) => p.r < 6 && p.c < 6));
  assert.ok(spawn(s, 'scout', { r: 3, c: 3 }).ok);
  assert.equal(s.players[0].points, 2);
  assert.equal(s.actionUsed, false);
  assert.ok(!spawn(s, 'scout', { r: 8, c: 8 }).ok);
});

test('diagonal attacks up to 2, 25 damage, striker 30, defender fortify', () => {
  const s = fresh();
  const st = place(s, 'striker', 0, { r: 5, c: 5 });
  const d = place(s, 'defender', 1, { r: 7, c: 7 });
  place(s, 'scout', 1, { r: 5, c: 6 }); // orthogonal: not a target
  assert.deepEqual(getAttackTargets(s, st.id).map((t) => t.machineId), [d.id]);
  attack(s, st.id, d.pos);
  assert.equal(d.hp, 50 - 25); // 30 - 5 fortify
  assert.equal(getAttackTargets(s, st.id).length, 0);
});

test('guardian blocks one attack, overcharge deals 50, king death ends game', () => {
  const s = fresh();
  s.players[0].sp = 9;
  const k0 = s.machines[0];
  assert.ok(useAbility(s, k0.id, 'guardian').ok);
  endTurn(s);
  s.players[1].sp = 9;
  const k1 = s.machines[1];
  assert.ok(useAbility(s, k1.id, 'overcharge').ok);
  const st = place(s, 'striker', 1, { r: 2, c: 2 });
  attack(s, st.id, k0.pos);
  assert.equal(k0.hp, 50);
  assert.equal(s.players[1].overcharge, false);
  endTurn(s);
  endTurn(s);
  s.players[1].overcharge = true;
  attack(s, st.id, k0.pos);
  assert.equal(s.winner, 1);
});

test('double strike allows second attack', () => {
  const s = fresh();
  s.players[0].sp = 6;
  const st = place(s, 'striker', 0, { r: 5, c: 5 });
  const a = place(s, 'scout', 1, { r: 6, c: 6 });
  assert.ok(useAbility(s, st.id, 'doublestrike').ok);
  attack(s, st.id, a.pos);
  assert.ok(attack(s, st.id, a.pos).ok);
  assert.ok(!machineAt(s, { r: 6, c: 6 }));
});

test('shock trap triggers on enemy entry', () => {
  const s = fresh();
  spawn(s, 'trap', { r: 2, c: 2 });
  endTurn(s);
  const sc = place(s, 'scout', 1, { r: 2, c: 4 });
  move(s, sc.id, { r: 2, c: 2 });
  assert.equal(sc.hp, 30);
  assert.equal(s.structures.length, 0);
});

test('turret fires at end of turn, barricade absorbs', () => {
  const s = fresh();
  s.players[0].points = 10;
  spawn(s, 'turret', { r: 4, c: 4 });
  const e = place(s, 'scout', 1, { r: 4, c: 6 });
  endTurn(s);
  assert.equal(e.hp, 40);
  endTurn(s);
  s.structures.push({ id: s.nextId++, kind: 'barricade', owner: 1, pos: { r: 4, c: 5 }, hp: 1 });
  endTurn(s);
  assert.equal(e.hp, 40);
  assert.equal(s.structures.filter((x) => x.kind === 'barricade').length, 0);
});

test('fog hides enemy outside visible quadrants', () => {
  const s = createGame(['guardian', 'guardian'], true);
  const enemyKing = s.machines[1];
  assert.equal(canSeeMachine(s, 0, enemyKing), false);
  s.players[0].sp = 4;
  const sc = place(s, 'scout', 0, { r: 2, c: 2 });
  assert.ok(useAbility(s, sc.id, 'spotter', { r: 6, c: 6 }).ok);
  assert.equal(canSeeMachine(s, 0, enemyKing), true);
  endTurn(s);
  assert.equal(canSeeMachine(s, 0, enemyKing), false);
});

test('jammer disables fortify; system failure disables acting', () => {
  const s = fresh();
  s.players[0].sp = 7;
  const sab = place(s, 'saboteur', 0, { r: 5, c: 5 });
  const d = place(s, 'defender', 1, { r: 6, c: 6 });
  attack(s, sab.id, d.pos);
  assert.equal(d.hp, 30); // 25 - 5
  assert.ok(useAbility(s, sab.id, 'systemfailure', { r: 4, c: 4 }).ok);
  endTurn(s);
  assert.equal(getMoveTargets(s, d.id).length, 0);
});

test('hulk smash hits friends and foes, not self', () => {
  const s = fresh();
  s.players[0].sp = 6;
  const b = place(s, 'breacher', 0, { r: 4, c: 4 });
  const f = place(s, 'scout', 0, { r: 5, c: 5 });
  const e = place(s, 'scout', 1, { r: 6, c: 6 });
  assert.ok(useAbility(s, b.id, 'hulksmash', { r: 4, c: 4 }).ok);
  assert.equal(b.hp, 50);
  assert.equal(f.hp, 40);
  assert.equal(e.hp, 40);
});

test('king names are cosmetic', () => {
  const s = createGame(['guardian', 'guardian'], false, ['  Lord Goo  ', '']);
  assert.equal(s.players[0].kingName, 'Lord Goo');
  assert.equal(s.players[1].kingName, 'Mr. Sludgy');
  const k = s.machines[0];
  assert.equal(machineName(s, k), 'Lord Goo');
  assert.equal(k.kind, 'sludgy');
  assert.equal(k.hp, 50);
  assert.equal(createGame(['guardian', 'guardian'], false, ['X'.repeat(40), 'b']).players[0].kingName.length, 16);
});

test('portal: enter, keep stats, fight inside, return', () => {
  const s = fresh();
  const sc = place(s, 'scout', 0, { r: 0, c: 10 });
  sc.hp = 33;
  sc.jammedThrough = 5;
  assert.ok(getMoveTargets(s, sc.id).some((o) => o.portal && o.pos.r === 0 && o.pos.c === 11));
  assert.ok(move(s, sc.id, { r: 0, c: 11 }).ok);
  assert.equal(sc.dim, 1);
  assert.deepEqual(sc.pos, { r: 10, c: 0 }); // nearest free tile to the dimension portal (11,0)
  assert.equal(sc.hp, 33);
  assert.equal(sc.jammedThrough, 5);
  assert.equal(sc.owner, 0);
  assert.equal(machineAt(s, { r: 0, c: 11 }), undefined);
  // a main-board machine on the same coordinates does not collide
  const other = place(s, 'striker', 1, { r: 10, c: 0 });
  assert.ok(machineAt(s, { r: 10, c: 0 }, 0) === other && machineAt(s, { r: 10, c: 0 }, 1) === sc);
  // attacks only reach machines in the same dimension
  endTurn(s);
  const foeInside = place(s, 'defender', 1, { r: 9, c: 1 }, 1);
  endTurn(s);
  sc.jammedThrough = -1;
  assert.deepEqual(getAttackTargets(s, sc.id).map((t) => t.machineId), [foeInside.id]);
  // return through the dimension portal
  sc.pos = { r: 10, c: 0 };
  other.pos = { r: 3, c: 3 };
  assert.ok(move(s, sc.id, { r: 11, c: 0 }).ok);
  assert.equal(sc.dim, 0);
  assert.deepEqual(sc.pos, { r: 0, c: 10 });
});

test('3 turns alone in the dimension summons the opponent, who picks machines', () => {
  const s = fresh();
  const sc = place(s, 'scout', 0, { r: 5, c: 5 }, 1);
  const p2a = place(s, 'striker', 1, { r: 8, c: 8 });
  for (let i = 0; i < 2; i++) { endTurn(s); endTurn(s); }
  assert.equal(s.players[0].dimTurns, 2);
  endTurn(s); // P1's third turn in the dimension ends
  assert.equal(s.pendingSummon, 1);
  assert.equal(s.current, 1);
  assert.ok(!endTurn(s).ok);
  assert.equal(getMoveTargets(s, p2a.id).length, 0);
  assert.deepEqual(getSummonCandidates(s).map((m) => m.id).sort(), [s.machines[1].id, p2a.id].sort());
  assert.ok(!summon(s, []).ok);
  assert.ok(summon(s, [p2a.id]).ok);
  assert.equal(p2a.dim, 1);
  assert.deepEqual(p2a.pos, { r: 0, c: 11 });
  assert.equal(s.pendingSummon, null);
  assert.equal(s.machines[1].dim, 0); // King stayed home
  assert.equal(sc.dim, 1);
  assert.ok(endTurn(s).ok);
});

test('area abilities and turrets stay in their own dimension', () => {
  const s = fresh();
  s.players[0].sp = 6;
  const b = place(s, 'breacher', 0, { r: 4, c: 4 }, 1);
  const inside = place(s, 'scout', 1, { r: 5, c: 5 }, 1);
  const outside = place(s, 'scout', 1, { r: 5, c: 5 });
  assert.ok(useAbility(s, b.id, 'hulksmash', { r: 4, c: 4 }).ok);
  assert.equal(inside.hp, 40);
  assert.equal(outside.hp, 50);
});

test('match setup: player names and starting points, defaults unchanged', () => {
  const d = createGame(['guardian', 'guardian'], false);
  assert.equal(d.players[0].name, 'Player 1');
  assert.equal(d.players[1].points, 3);
  const s = createGame(['guardian', 'phantom'], false, ['Goo', 'Mr. Sludgy'], { playerNames: ['  Ada  ', ''], startingPoints: 10 });
  assert.equal(s.players[0].name, 'Ada');
  assert.equal(s.players[1].name, 'Player 2');
  assert.equal(s.players[0].points, 10);
  assert.equal(s.players[1].points, 10);
  assert.ok(s.log.some((l) => l.text.includes("Ada's turn")));
  assert.equal(createGame(['guardian', 'guardian'], false, undefined, { startingPoints: -4 }).players[0].points, 3);
});
