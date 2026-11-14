import { clearCookie, fail, json, originOk, readJson, sessionUser, type Fn } from '../_lib/server.ts';

/** POST {} signs out this browser; POST { all: true } signs out every browser on the account. */
export const onRequestPost: Fn = async ({ request, env }) => {
  if (!originOk(request, env)) return fail(403, 'Forbidden origin.');
  const b = (await readJson(request)) ?? {};
  const user = await sessionUser(request, env);
  if (user) {
    const q = b.all === true
      ? env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id)
      : env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(user.tokenHash);
    await q.run();
  }
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie });
};
