import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from './engine.ts';
import { DIMENSION, STRUCTURES } from './config.ts';
import { applyAction, eventsFor, LocalController, parseAction, redactFor, type Action } from './actions.ts';
import type { GameEvent, GameState, PlayerId, Pos } from './types.ts';

const game = (fog = true) => E.createGame(['guardian', 'overcharge'], fog, ['A', 'B']);
const myKing = (s: GameState, p: PlayerId) => s.machines.find((m) => m.kind === 'sludgy' && m.owner === p)!;

test('wrong seat is rejected without touching the state', () => {
  const s = game();
  const k = myKing(s, 0);
  const to = E.getMoveTargets(s, k.id)[0].pos;
  const snap = JSON.stringify(s);
  const r = applyAction(s, 1, { t: 'move', id: k.id, to });
  assert.equal(r.ok, false);
  assert.equal(JSON.stringify(s), snap);
  assert.equal(applyAction(s, 0, { t: 'move', id: k.id, to }).ok, true);
});

test('malformed payloads are rejected without touching the state', () => {
  const s = game();
  const snap = JSON.stringify(s);
  const bad: unknown[] = [
    null, 42, 'endTurn', [], {}, { t: 'nuke' },
    { t: 'move', id: -1, to: { r: 0, c: 0 } }, { t: 'move', id: 1.5, to: { r: 0, c: 0 } }, { t: 'move', id: 1, to: { r: 12, c: 0 } },
    { t: 'move', id: 1, to: { r: '1', c: 0 } }, { t: 'attack', id: 1 }, { t: 'spawn', kind: '__proto__', at: { r: 0, c: 0 } },
    { t: 'spawn', kind: 'constructor', at: { r: 0, c: 0 } }, { t: 'spawn', kind: 'scout', at: { r: 0, c: 0 }, dir: 'X' },
    { t: 'ability', id: 1, key: 7 }, { t: 'summon', ids: 'all' }, { t: 'summon', ids: [1, -2] }, { t: 'assignDrone', dockId: 1 },
  ];
  for (const b of bad) {
    assert.equal(parseAction(b), null, JSON.stringify(b));
    assert.equal(applyAction(s, 0, b).ok, false);
  }
  assert.equal(JSON.stringify(s), snap);
});

test('illegal but well-formed moves are refused by the engine without mutation', () => {
  const s = game();
  const k = myKing(s, 0);
  const snap = JSON.stringify(s);
  assert.equal(applyAction(s, 0, { t: 'move', id: k.id, to: { r: 11, c: 11 } }).ok, false);
  assert.equal(applyAction(s, 0, { t: 'move', id: myKing(s, 1).id, to: myKing(s, 1).pos }).ok, false);
  assert.equal(JSON.stringify(s), snap);
});

test('parseAction strips unknown fields', () => {
  assert.deepEqual(parseAction({ t: 'move', id: 3, to: { r: 1, c: 2, x: 9 }, evil: true }), { t: 'move', id: 3, to: { r: 1, c: 2 } });
});

test('LocalController plays whoever is current (hot-seat)', () => {
  let s = game(false);
  const c = new LocalController(() => s);
  assert.equal(c.apply({ t: 'endTurn' }).ok, true);
  assert.equal(s.current, 1);
  assert.equal(c.apply({ t: 'endTurn' }).ok, true);
  s = game(false); // follows a replaced state, as after Restart
  assert.equal(c.apply({ t: 'endTurn' }).ok, true);
  assert.equal(s.current, 1);
});

// ---------- randomized redaction check ----------
function rng(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}
function randomAction(s: GameState, rand: () => number): Action {
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  if (s.pendingSummon !== null) {
    const pool = E.getSummonCandidates(s);
    return { t: 'summon', ids: pool.slice(0, 1 + Math.floor(rand() * Math.min(3, pool.length))).map((m) => m.id) };
  }
  const opts: Action[] = [{ t: 'endTurn' }];
  if (!s.actionUsed) {
    for (const m of s.machines.filter((x) => x.owner === s.current)) {
      for (const o of E.getMoveTargets(s, m.id)) opts.push({ t: 'move', id: m.id, to: o.pos }, { t: 'move', id: m.id, to: o.pos });
      for (const o of E.getAttackTargets(s, m.id)) opts.push({ t: 'attack', id: m.id, at: o.pos }, { t: 'attack', id: m.id, at: o.pos }, { t: 'attack', id: m.id, at: o.pos });
    }
  }
  for (const kind of ['scout', 'striker', 'trap', 'turret', 'barricade', 'mine'] as E.SpawnKind[]) {
    const tiles = E.getSpawnTiles(s, kind);
    if (tiles.length) opts.push({ t: 'spawn', kind, at: pick(tiles) }, { t: 'spawn', kind, at: pick(tiles) });
  }
  return pick(opts);
}
const coordsIn = (e: GameEvent): { dim: 0 | 1; p: Pos }[] => {
  const d = e.dim;
  if (e.type === 'ability') return [{ dim: d, p: e.from }, { dim: e.toDim, p: e.to }, ...e.cells.map((p) => ({ dim: d, p }))];
  if (e.type === 'shot' || e.type === 'push') return [{ dim: d, p: e.from }, { dim: d, p: e.to }];
  if (e.type === 'area') return e.cells.map((p) => ({ dim: d, p }));
  return [{ dim: d, p: e.pos }];
};

test('redaction never leaks hidden machines, traps, mines, events or log lines (randomized games)', () => {
  let actions = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const rand = rng(seed);
    const s = game(true);
    for (let i = 0; i < 160 && s.winner === null; i++) {
      const actor = (s.pendingSummon ?? s.current) as PlayerId;
      const r = applyAction(s, actor, randomAction(s, rand));
      const events = s.events.splice(0);
      if (!r.ok) continue;
      actions++;
      for (const v of [0, 1] as PlayerId[]) {
        const opp = (1 - v) as PlayerId;
        const view = redactFor(s, v);
        const seen = E.visibleQuadrants(s, v);
        // machines: every enemy machine shown is on a visible tile or in the fog-free dimension
        for (const m of view.machines.filter((m) => m.owner === opp))
          assert.ok((m.dim === 1 && !DIMENSION.fog) || seen.has(E.quadrantOf(m.pos)), `seed ${seed}: enemy machine leaked`);
        // hidden structures: never shown unless revealed by the engine's own rule
        for (const st of view.structures.filter((x) => x.owner === opp && STRUCTURES[x.kind].hidden))
          assert.ok(E.canSeeStructure(s, v, st), `seed ${seed}: hidden ${st.kind} leaked`);
        assert.equal(view.events.length, 0);
        // log: no enemy hidden deploy line, and the copy never shares objects with the real state
        assert.ok(!view.log.some((e) => e.player === opp && /^Deployed a /.test(e.text)), `seed ${seed}: deploy line leaked`);
        assert.notEqual(view.machines, s.machines);
        // events: only cells the viewer saw before or after the action, except their own spawns/abilities
        for (const e of eventsFor(s, v, events, r.seen[v])) {
          if ((e.type === 'spawn' || e.type === 'ability') && e.owner === v) continue;
          if (e.type === 'spawn') assert.ok(!STRUCTURES[e.kind as keyof typeof STRUCTURES]?.hidden, `seed ${seed}: hidden spawn event leaked`);
          for (const { dim, p } of coordsIn(e))
            assert.ok((dim === 1 && !DIMENSION.fog) || r.seen[v].has(E.quadrantOf(p)), `seed ${seed}: ${e.type} event leaked a hidden cell`);
        }
      }
    }
  }
  assert.ok(actions > 1000, `only ${actions} actions exercised`);
});

test('without fog every event is shared except enemy hidden deployments', () => {
  const s = game(false);
  const at = E.getSpawnTiles(s, 'trap')[0];
  assert.equal(applyAction(s, 0, { t: 'spawn', kind: 'trap', at }).ok, true);
  const ev = s.events.splice(0);
  assert.ok(eventsFor(s, 0, ev).some((e) => e.type === 'spawn'));
  assert.ok(!eventsFor(s, 1, ev).some((e) => e.type === 'spawn'));
  assert.ok(!redactFor(s, 1).structures.some((x) => x.kind === 'trap'));
});
