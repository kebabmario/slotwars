import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRecoveryCode, passwordError, usernameError } from './account-rules.ts';

test('usernames: 3–16 letters, digits or _', () => {
  for (const ok of ['abc', 'Mr_Sludgy', 'a1234567890123_Z']) assert.equal(usernameError(ok), null, ok);
  for (const bad of ['ab', 'a'.repeat(17), 'bad name', 'émile', 'a-b', '', null, 42]) assert.ok(usernameError(bad), String(bad));
});

test('passwords: length, common list, repeats, username', () => {
  assert.equal(passwordError('correct horse battery'), null);
  assert.ok(passwordError('short'));
  assert.ok(passwordError('x'.repeat(129)));
  assert.ok(passwordError('Password123'));
  assert.ok(passwordError('aaaaaaaaaaaa'));
  assert.ok(passwordError('mr_sludgy_rules!', 'Mr_Sludgy'));
  assert.ok(passwordError(undefined));
});

test('recovery codes are normalized for typing', () => {
  assert.equal(normalizeRecoveryCode(' abcde-fghjk-23456-mnpqr '), 'ABCDEFGHJK23456MNPQR');
  assert.equal(normalizeRecoveryCode(7), '');
});
