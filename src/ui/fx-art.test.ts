import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ABILITY_KEYS, DESTROY, abilityRecipe, armorGlint, impact, muzzle, projectile, spawnRecipe, structureDestroy, victory, type Recipe } from './fx-art.ts';
import { MACHINE_SPRITES, STRUCTURE_SPRITES } from '../assets/sprites/index.ts';

/** Renders every frame into colour buffers; counts painted pixels and anything drawn off-canvas. */
function renderAll(r: Recipe) {
  const frames: string[][] = [];
  let off = 0;
  for (let f = 0; f < r.frames; f++) {
    const buf = new Array<string>(r.w * r.h).fill('');
    const g = {
      fillStyle: '' as string,
      fillRect(x: number, y: number, w: number, h: number) {
        for (let j = y; j < y + h; j++)
          for (let i = x; i < x + w; i++) {
            if (i < 0 || j < 0 || i >= r.w || j >= r.h) { off++; continue; }
            buf[j * r.w + i] = this.fillStyle;
          }
      },
    };
    r.draw(g, f);
    frames.push(buf);
  }
  return { frames, off, painted: frames.map((b) => b.filter(Boolean).length) };
}
const diff = (a: string[], b: string[]) => a.filter((c, i) => c !== b[i]).length;

const MACHINES = Object.keys(MACHINE_SPRITES);

test('every machine has its own multi-frame destruction sequence', () => {
  assert.deepEqual(Object.keys(DESTROY).sort(), [...MACHINES].sort());
  for (const kind of MACHINES) {
    const r = DESTROY[kind](0);
    const { frames, painted } = renderAll(r);
    assert.ok(r.frames >= 10, `${kind}: ${r.frames} frames`);
    assert.ok(painted[0] > 40, `${kind}: frame 0 shows the machine (${painted[0]} px)`);
    assert.ok(painted.slice(-3).some((n) => n > 0) || painted[r.frames - 4] > 0, `${kind}: still visible near the end`);
    let changes = 0;
    for (let f = 1; f < frames.length; f++) if (diff(frames[f], frames[f - 1]) > 0) changes++;
    assert.ok(changes >= r.frames - 2, `${kind}: animates every frame (${changes}/${r.frames - 1})`);
  }
});

test('destruction sequences are genuinely different from each other', () => {
  const sigs = MACHINES.map((k) => ({ k, fr: renderAll(DESTROY[k](0)).frames }));
  for (let i = 0; i < sigs.length; i++)
    for (let j = i + 1; j < sigs.length; j++) {
      const a = sigs[i], b = sigs[j];
      // compare the mid-sequence frames, where the machine-specific action happens
      const fa = a.fr[Math.floor(a.fr.length / 2)], fb = b.fr[Math.floor(b.fr.length / 2)];
      const n = Math.max(fa.filter(Boolean).length, fb.filter(Boolean).length);
      const shared = fa.length === fb.length ? fa.filter((c, x) => c && c === fb[x]).length : 0;
      assert.ok(shared / n < 0.5, `${a.k} vs ${b.k} share ${((shared / n) * 100).toFixed(0)}% of mid-sequence pixels`);
    }
});

test('the King has the longest sequence and shakes the board', () => {
  const king = DESTROY.sludgy(1);
  for (const k of MACHINES) if (k !== 'sludgy') assert.ok(king.frames > DESTROY[k](1).frames, k);
  assert.equal(king.shake, 'heavy');
});

test('team colours apply: P1 and P2 destructions differ', () => {
  for (const k of MACHINES) assert.ok(diff(renderAll(DESTROY[k](0)).frames[0], renderAll(DESTROY[k](1)).frames[0]) > 0, k);
});

test('attack, spawn, ability and structure effects all draw something', () => {
  const all: [string, Recipe][] = [
    ['muzzle', muzzle(false)], ['muzzle heavy', muzzle(true)],
    ['bolt', projectile('striker', false)], ['slug', projectile('crusher', true)], ['tracer', projectile('turret', false)],
    ['impact', impact(false)], ['impact heavy', impact(true)], ['fortify', armorGlint('#fff')], ['victory', victory(0)],
    ...MACHINES.filter((k) => k !== 'sludgy').map((k) => [`spawn ${k}`, spawnRecipe(k, 0)] as [string, Recipe]),
    ...Object.keys(STRUCTURE_SPRITES).map((k) => [`spawn ${k}`, spawnRecipe(k, 1)] as [string, Recipe]),
    ...Object.keys(STRUCTURE_SPRITES).map((k) => [`wreck ${k}`, structureDestroy(k, 0)] as [string, Recipe]),
    ...ABILITY_KEYS.filter((k) => k !== 'fortify').map((k) => [k, abilityRecipe({ key: k, w: 3, h: 3, team: 0, structureKind: 'repair', machineKind: 'sludgy' })] as [string, Recipe]),
  ];
  for (const [name, r] of all) {
    const { painted } = renderAll(r);
    assert.ok(Math.max(...painted) > 5, `${name} draws nothing`);
  }
  assert.ok(impact(true).frames > impact(false).frames, 'heavy impacts last longer');
});

test('industrial machines deploy from a crate, others materialise in a beam', () => {
  const crate = renderAll(spawnRecipe('crusher', 0)).frames[2].filter((c) => c === '#ffd23f').length;
  const beam = renderAll(spawnRecipe('striker', 0)).frames[2].filter((c) => c === '#ffd23f').length;
  assert.ok(crate > beam, 'crate hazard stripes visible');
});
