import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LESSONS } from './tutorial-lessons.ts';
import * as E from '../game/engine.ts';

test('the tutorial has the six required lessons in order', () => {
  assert.deepEqual(LESSONS.map((l) => l.id), ['board', 'machines', 'combat', 'economy', 'spawnables', 'industrial']);
});

for (const lesson of LESSONS)
  test(`lesson "${lesson.title}" can be completed with real game actions`, () => {
    const s = lesson.setup();
    const before = JSON.stringify(E.createGame(['guardian', 'overcharge'], false).players.map((p) => p.points));
    lesson.steps.forEach((step, i) => {
      for (const p of step.tiles?.(s) ?? []) assert.ok(E.inBounds(p), `${lesson.id} step ${i}: highlight off-board`);
      if (!step.expect) return;
      assert.ok(step.task, `${lesson.id} step ${i}: interactive steps say what to do`);
      assert.ok(!step.expect({ kind: 'other' }, s), `${lesson.id} step ${i}: unrelated actions are rejected`);
      assert.ok(!step.expect({ kind: 'endTurn' }, s) || step.passOpponent, `${lesson.id} step ${i}: End Turn only where asked`);
      const a = step.solve!(s);
      assert.ok(step.expect(a, s), `${lesson.id} step ${i}: the real action completes the step`);
      if (step.passOpponent && s.current === 1) E.endTurn(s);
    });
    assert.equal(s.winner, null, `${lesson.id}: no one wins during a lesson`);
    assert.equal(JSON.stringify(E.createGame(['guardian', 'overcharge'], false).players.map((p) => p.points)), before, 'normal matches unaffected');
    if (lesson.id === 'combat') assert.ok(!s.machines.some((m) => m.owner === 1 && m.kind === 'scout'), 'the attack destroys the scout');
    if (lesson.id === 'economy') assert.ok(s.machines.find((m) => m.kind === 'sludgy' && m.owner === 0)!.guardian, 'Guardian activated');
    if (lesson.id === 'spawnables') assert.deepEqual(s.structures.map((x) => x.kind).sort(), ['barricade', 'trap']);
    if (lesson.id === 'industrial') {
      assert.equal(s.machines.find((m) => m.kind === 'scout')!.dim, 1);
      assert.ok(E.isUnlocked(s, 0, 'welder') && E.isUnlocked(s, 0, 'conveyor'), 'research unlocked content');
      assert.equal(s.current, 0, 'control returned to the player');
    }
  });
