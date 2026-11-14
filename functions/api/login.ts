import { PASSWORD_MAX, usernameError } from '../../src/net/account-rules.ts';
import { clientIp, createSession, fail, gate, IP_LIMIT, json, originOk, readJson, sessionCookie, turnstileOk, USER_LIMIT, WINDOW, type Fn } from '../_lib/server.ts';

const WRONG = 'Wrong username or password.';

export const onRequestPost: Fn = async ({ request, env }) => {
  if (!originOk(request, env)) return fail(403, 'Forbidden origin.');
  const b = await readJson(request);
  if (!b) return fail(400, 'Bad request.');
  if (usernameError(b.username) || typeof b.password !== 'string' || !b.password || b.password.length > PASSWORD_MAX) return fail(401, WRONG);
  const lc = (b.username as string).toLowerCase(), password = b.password;
  const ip = clientIp(request);

  const ug = gate(env, `u:${lc}`), ig = gate(env, `ip:${ip}`);
  const [us, is] = await Promise.all([ug.peek(WINDOW), ig.peek(WINDOW)]);
  const retryAfter = Math.max(us.retryAfter, is.retryAfter);
  if (retryAfter) return fail(429, 'Too many failed attempts. Try again later.', { retryAfter });
  const captcha = (us.fails >= USER_LIMIT.captchaAfter || is.fails >= IP_LIMIT.captchaAfter) && !!env.TURNSTILE_SECRET;
  if (captcha && !(await turnstileOk(env, b.turnstile, ip))) return fail(403, 'Please complete the check.', { captcha: true });

  const user = await env.DB.prepare(`SELECT id, username, pass_hash FROM users WHERE username_lc = ? AND status = 'active'`)
    .bind(lc).first<{ id: number; username: string; pass_hash: string }>();
  if (!(await ug.verify(password, user?.pass_hash ?? null)) || !user) {
    await Promise.all([ug.fail(USER_LIMIT.lockAfter, WINDOW, USER_LIMIT.lockMs), ig.fail(IP_LIMIT.lockAfter, WINDOW, IP_LIMIT.lockMs)]);
    const next = !!env.TURNSTILE_SECRET && (us.fails + 1 >= USER_LIMIT.captchaAfter || is.fails + 1 >= IP_LIMIT.captchaAfter);
    return fail(401, WRONG, { captcha: next });
  }
  await ug.reset();
  const token = await createSession(env, user.id);
  return json({ username: user.username }, 200, { 'Set-Cookie': sessionCookie(token) });
};
