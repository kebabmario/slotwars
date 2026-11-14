import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SR, dcBlock, osc, wav, wrapLoop } from './dsp.ts';
import { SFX, renderSfx } from './sfx.ts';
import { SOUNDS } from '../../src/audio/manifest.ts';

test('wrapLoop folds the tail onto the start', () => {
  const x = new Float32Array([1, 2, 3, 4, 5, 6]);
  assert.deepEqual([...wrapLoop(x, 4)], [6, 8, 3, 4]);
});

test('dcBlock removes offset from a pulse wave', () => {
  const x = dcBlock(osc(1, { wave: 'square', freq: 220, duty: 0.25 }));
  const tail = x.subarray(SR / 2);
  const mean = tail.reduce((a, b) => a + b, 0) / tail.length;
  assert.ok(Math.abs(mean) < 0.01, `dc ${mean}`);
});

test('wav header is valid 16-bit PCM', () => {
  const w = wav([new Float32Array(10), new Float32Array(10)]);
  const v = new DataView(w.buffer);
  assert.equal(String.fromCharCode(...w.subarray(0, 4)), 'RIFF');
  assert.equal(v.getUint16(22, true), 2);
  assert.equal(v.getUint32(24, true), SR);
  assert.equal(w.length, 44 + 10 * 2 * 2);
});

test('every effect renders, is audible, never clips, and is in the manifest', () => {
  for (const name of Object.keys(SFX)) {
    const x = renderSfx(name);
    let peak = 0;
    for (const v of x) peak = Math.max(peak, Math.abs(v));
    assert.ok(peak > 0.5 && peak <= 0.9, `${name} peak ${peak}`);
    assert.ok(name in SOUNDS, `${name} missing from manifest: run npm run audio`);
  }
});
