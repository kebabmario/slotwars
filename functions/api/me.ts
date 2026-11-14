import { fail, json, sessionCookie, sessionUser, type Fn } from '../_lib/server.ts';

export const onRequestGet: Fn = async ({ request, env }) => {
  const user = await sessionUser(request, env);
  if (!user) return fail(401, 'Not signed in.');
  return json({ username: user.username, createdAt: user.createdAt }, 200, user.renewed ? { 'Set-Cookie': sessionCookie(user.renewed) } : {});
};
