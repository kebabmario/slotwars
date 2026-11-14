import { CODE_RE } from '../../src/net/protocol.ts';
import { fail, originOk, sessionUser, type Fn } from '../_lib/server.ts';

/**
 * WebSocket entry: checks Origin and the session cookie, then hands the socket to the match's
 * Durable Object with the verified user. The client can never choose its own identity or seat.
 */
export const onRequestGet: Fn = async ({ request, env, params }) => {
  if (request.headers.get('Upgrade') !== 'websocket') return fail(426, 'Expected WebSocket.');
  if (!originOk(request, env)) return fail(403, 'Forbidden origin.');
  const user = await sessionUser(request, env);
  if (!user) return fail(401, 'Sign in to play online.');
  const code = String(params.code ?? '').toUpperCase();
  if (!CODE_RE.test(code)) return fail(404, 'No such match.');
  // fresh headers: nothing the browser sent can pose as the verified identity
  const headers = new Headers({ Upgrade: 'websocket', 'X-User-Id': String(user.id), 'X-Username': user.username });
  return env.ROOM.get(env.ROOM.idFromName(code)).fetch(new Request(request.url, { headers }));
};
