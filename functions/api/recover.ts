import { normalizeRecoveryCode, passwordError, RECOVERY_ALPHABET, usernameError } from '../../src/net/account-rules.ts';
import {
  clientIp, createSession, fail, formatRecovery, gate, IP_LIMIT, json, newRecoveryCode, originOk, readJson, RECOVERY_LEN, sessionCookie, sha256, turnstileOk,
  USER_LIMIT, WINDOW, type Fn,
} from '../_lib/server.ts';

const WRONG = 'Wrong username or recovery code.';

/**
 * Sets a new password with the one-time recovery code (decision F). Signs out every other browser
 * and issues a fresh recovery code, since the old one is now spent.
 */
export const onRequestPost: Fn = async ({ request, env }) => {
  if (!originOk(request, env)) return fail(403, 'Forbidden origin.');
  const b = await readJson(request);
  if (!b) return fail(400, 'Bad request.');
  if (usernameError(b.username)) return fail(401, WRONG);
  const username = b.username as string, lc = username.toLowerCase();
  const pwErr = passwordError(b.newPassword, username);
  if (pwErr) return fail(400, pwErr);
  const code = normalizeRecoveryCode(b.recoveryCode);
  const ip = clientIp(request);

  const ug = gate(env, `u:${lc}`), ig = gate(env, `ip:${ip}`);
  const [us, is] = await Promise.all([ug.peek(WINDOW), ig.peek(WINDOW)]);
  const retryAfter = Math.max(us.retryAfter, is.retryAfter);
  if (retryAfter) return fail(429, 'Too many failed attempts. Try again later.', { retryAfter });
  if (!(await turnstileOk(env, b.turnstile, ip))) return fail(403, 'Please complete the check.', { captcha: true });

  const user = await env.DB.prepare(`SELECT id, username, recovery_hash FROM users WHERE username_lc = ? AND status = 'active'`)
    .bind(lc).first<{ id: number; username: string; recovery_hash: string | null }>();
  if (!user || !user.recovery_hash || code.length !== RECOVERY_LEN || (await sha256(code)) !== user.recovery_hash) {
    await Promise.all([ug.fail(USER_LIMIT.lockAfter, WINDOW, USER_LIMIT.lockMs), ig.fail(IP_LIMIT.lockAfter, WINDOW, IP_LIMIT.lockMs)]);
    return fail(401, WRONG);
  }

  const { hash, algo } = await ug.hash(b.newPassword as string);
  const fresh = newRecoveryCode(RECOVERY_ALPHABET);
  // only succeeds if the code was not used by a concurrent request in the meantime
  const res = await env.DB.batch([
    env.DB.prepare('UPDATE users SET pass_hash = ?, pass_algo = ?, recovery_hash = ? WHERE id = ? AND recovery_hash = ?')
      .bind(hash, algo, await sha256(fresh), user.id, user.recovery_hash),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
  ]);
  if (!res[0].meta.changes) return fail(401, WRONG);
  await ug.reset();
  const token = await createSession(env, user.id);
  return json({ username: user.username, recoveryCode: formatRecovery(fresh) }, 200, { 'Set-Cookie': sessionCookie(token) });
};
