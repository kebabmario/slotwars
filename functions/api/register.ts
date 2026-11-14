import { passwordError, RECOVERY_ALPHABET, usernameError } from '../../src/net/account-rules.ts';
import {
  clientIp, createSession, fail, formatRecovery, gate, json, newRecoveryCode, originOk, readJson, REGISTER_LIMIT, sessionCookie, sha256, turnstileOk, type Fn,
} from '../_lib/server.ts';

const HOUR = 3_600_000;

export const onRequestPost: Fn = async ({ request, env }) => {
  if (!originOk(request, env)) return fail(403, 'Forbidden origin.');
  const b = await readJson(request);
  if (!b) return fail(400, 'Bad request.');
  const err = usernameError(b.username) ?? passwordError(b.password, b.username as string);
  if (err) return fail(400, err);
  const username = b.username as string, password = b.password as string, lc = username.toLowerCase();
  const ip = clientIp(request);

  const reg = gate(env, `reg:${ip}`);
  const st = await reg.peek(HOUR);
  if (st.retryAfter > 0) return fail(429, 'Too many new accounts from this network. Try again later.', { retryAfter: st.retryAfter });
  if (!(await turnstileOk(env, b.turnstile, ip))) return fail(403, 'Please complete the check.', { captcha: true });
  // cheap check first so a taken name never costs a hash; the UNIQUE index settles races below
  if (await env.DB.prepare('SELECT 1 FROM users WHERE username_lc = ?').bind(lc).first()) return fail(409, 'That username is taken.');

  const { hash, algo } = await gate(env, `u:${lc}`).hash(password);
  const code = newRecoveryCode(RECOVERY_ALPHABET);
  const row = await env.DB.prepare(
    `INSERT INTO users (username, username_lc, pass_hash, pass_algo, recovery_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(username_lc) DO NOTHING RETURNING id`,
  ).bind(username, lc, hash, algo, await sha256(code), Date.now()).first<{ id: number }>();
  if (!row) return fail(409, 'That username is taken.');
  await reg.fail(REGISTER_LIMIT.perHour, HOUR, HOUR); // counts registrations per network

  const token = await createSession(env, row.id);
  return json({ username, recoveryCode: formatRecovery(code) }, 201, { 'Set-Cookie': sessionCookie(token) });
};
