import { CODE_ALPHABET } from '../../src/net/protocol.ts';
import { fail, json, originOk, sessionUser, type Fn } from '../_lib/server.ts';

/** POST /api/rooms: creates a private match and returns its invite code. Needs a signed-in player. */
export const onRequestPost: Fn = async ({ request, env }) => {
  if (!originOk(request, env)) return fail(403, 'Forbidden origin.');
  const user = await sessionUser(request, env);
  if (!user) return fail(401, 'Sign in to play online.');
  for (let i = 0; i < 5; i++) {
    const code = [...crypto.getRandomValues(new Uint8Array(6))].map((b) => CODE_ALPHABET[b % 32]).join(''); // 256 % 32 === 0: no bias
    if (await env.ROOM.get(env.ROOM.idFromName(code)).create(code, { userId: user.id, username: user.username })) return json({ code }, 201);
  }
  return fail(503, 'Could not create a match. Try again.');
};
