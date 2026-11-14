import { usernameError } from '../../src/net/account-rules.ts';
import { fail, json, type Fn } from '../_lib/server.ts';

/** Public profile: GET /api/profile?u=<username>. Ratings and history join this in a later phase. */
export const onRequestGet: Fn = async ({ request, env }) => {
  const u = new URL(request.url).searchParams.get('u');
  if (usernameError(u)) return fail(404, 'No such player.');
  const row = await env.DB.prepare(`SELECT username, created_at FROM users WHERE username_lc = ? AND status = 'active'`)
    .bind(u!.toLowerCase()).first<{ username: string; created_at: number }>();
  return row ? json({ username: row.username, createdAt: row.created_at }) : fail(404, 'No such player.');
};
