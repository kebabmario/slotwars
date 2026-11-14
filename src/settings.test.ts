import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MATCH, DEFAULT_SETTINGS, sanitizeMatch, sanitizeSettings } from './settings.ts';

test('missing or garbage settings fall back to defaults', () => {
  assert.deepEqual(sanitizeSettings(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(sanitizeSettings('nope'), DEFAULT_SETTINGS);
  assert.deepEqual(sanitizeSettings({ masterVolume: 'loud', animSpeed: 'ludicrous', boardDetail: 7, crt: 'yes' }), DEFAULT_SETTINGS);
});

test('valid values survive, volumes are clamped and rounded', () => {
  const s = sanitizeSettings({ masterVolume: 140, musicVolume: -3, sfxVolume: 33.6, animQuality: 'low', animSpeed: 'fast', boardDetail: 'medium', muted: true });
  assert.equal(s.masterVolume, 100);
  assert.equal(s.musicVolume, 0);
  assert.equal(s.sfxVolume, 34);
  assert.equal(s.animQuality, 'low');
  assert.equal(s.animSpeed, 'fast');
  assert.equal(s.boardDetail, 'medium');
  assert.equal(s.muted, true);
});

test('v1 settings migrate: animations off becomes reduced motion; unknown keys dropped', () => {
  const s = sanitizeSettings({ animations: false, fog: false, crt: false, version: 1 });
  assert.equal(s.reducedMotion, true);
  assert.equal(s.crt, false);
  assert.ok(!('animations' in s) && !('fog' in s));
  assert.equal(sanitizeSettings({ animations: true }).reducedMotion, false);
});

test('match config is validated separately', () => {
  assert.deepEqual(sanitizeMatch(null), DEFAULT_MATCH);
  const m = sanitizeMatch({ playerNames: ['  Ada ', ''], kingNames: ['X'.repeat(40)], kings: ['phantom', 'teleport'], fog: false, startingPoints: 99 });
  assert.deepEqual(m.playerNames, ['Ada', 'Player 2']);
  assert.equal(m.kingNames[0].length, 16);
  assert.equal(m.kingNames[1], 'Mr. Sludgy');
  assert.deepEqual(m.kings, ['phantom', 'overcharge']);
  assert.equal(m.fog, false);
  assert.equal(m.startingPoints, 3);
  assert.equal(sanitizeMatch({ startingPoints: 12 }).startingPoints, 12);
});
