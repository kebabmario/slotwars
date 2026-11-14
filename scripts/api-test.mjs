// End-to-end account API checks against local D1 and Durable Objects (no Cloudflare account needed).
import { check, post, req, startStack, TURNSTILE_TEST_TOKEN as T } from './harness.mjs';

const API = 'http://localhost:8788';
const stack = await startStack();
const d1 = stack.d1;
let crashed = null;
try {

  // ---------- registration ----------
  check('foreign Origin refused', (await post('/api/register', { username: 'ada', password: 'correct horse battery', turnstile: T }, { origin: 'https://evil.example' })).status === 403);
  check('missing Origin refused', (await post('/api/register', { username: 'ada', password: 'correct horse battery', turnstile: T }, { origin: null })).status === 403);
  check('bad username rejected', (await post('/api/register', { username: 'a b', password: 'correct horse battery', turnstile: T })).status === 400);
  check('common password rejected', (await post('/api/register', { username: 'ada', password: 'password123', turnstile: T })).status === 400);
  check('Turnstile required for registration', (await post('/api/register', { username: 'ada', password: 'correct horse battery' })).body?.captcha === true);
  let t0 = Date.now();
  const reg = await post('/api/register', { username: 'Ada_1', password: 'correct horse battery', turnstile: T });
  check('register: 201 + recovery code', reg.status === 201 && /^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/.test(reg.body?.recoveryCode ?? ''), `${Date.now() - t0} ms incl. Argon2id`);
  const flags = ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=2592000'];
  check('__Host- cookie flags, no Domain', flags.every((f) => reg.setCookie.includes(f)) && !/Domain=/i.test(reg.setCookie));
  check('username unique ignoring case', (await post('/api/register', { username: 'ada_1', password: 'another good passphrase', turnstile: T })).status === 409);
  check('password stored as peppered Argon2id, never plain', d1(`SELECT pass_hash, pass_algo FROM users`).toString().includes('argon2id$m=19456,t=2,p=1$') && !d1(`SELECT pass_hash FROM users`).toString().includes('correct horse'));

  // ---------- sessions ----------
  const me = await req('GET', '/api/me', { cookie: reg.cookie });
  check('me with session cookie', me.status === 200 && me.body?.username === 'Ada_1');
  check('me without cookie: 401', (await req('GET', '/api/me')).status === 401);
  const hdr = await fetch(API + '/api/me'), page = await fetch(API + '/');
  check('API sends nosniff + frame DENY', hdr.headers.get('x-content-type-options') === 'nosniff' && hdr.headers.get('x-frame-options') === 'DENY');
  check('pages send X-Frame-Options DENY (clickjacking)', page.headers.get('x-frame-options') === 'DENY');
  check('profile lookup ignores case', (await req('GET', '/api/profile?u=ADA_1')).body?.username === 'Ada_1');
  check('profile unknown: 404', (await req('GET', '/api/profile?u=nobody')).status === 404);
  check('login wrong password: 401 generic', (await post('/api/login', { username: 'ada_1', password: 'wrong wrong wrong' })).body?.error === 'Wrong username or password.');
  t0 = Date.now();
  check('login unknown user: same 401', (await post('/api/login', { username: 'ghost', password: 'wrong wrong wrong' })).body?.error === 'Wrong username or password.', `${Date.now() - t0} ms (still hashes)`);
  const s2 = await post('/api/login', { username: 'ADA_1', password: 'correct horse battery' });
  check('login ok (case-insensitive username)', s2.status === 200 && !!s2.cookie && s2.cookie !== reg.cookie);
  check('logout needs our Origin', (await post('/api/logout', {}, { cookie: s2.cookie, origin: 'https://evil.example' })).status === 403);
  const lo = await post('/api/logout', {}, { cookie: s2.cookie });
  check('logout clears cookie', lo.status === 200 && lo.setCookie.includes('Max-Age=0'));
  check('logged-out session rejected, other still valid', (await req('GET', '/api/me', { cookie: s2.cookie })).status === 401 && (await req('GET', '/api/me', { cookie: reg.cookie })).status === 200);
  const s3 = await post('/api/login', { username: 'ada_1', password: 'correct horse battery' });
  d1(`UPDATE sessions SET expires_at = ${Date.now() + 86_400_000} WHERE user_id = 1`);
  const renew = await req('GET', '/api/me', { cookie: s3.cookie });
  check('session near expiry is renewed', renew.status === 200 && renew.setCookie.includes('Max-Age=2592000'));
  d1(`UPDATE sessions SET expires_at = ${Date.now() - 1000}`);
  check('expired session rejected', (await req('GET', '/api/me', { cookie: s3.cookie })).status === 401);
  const a = await post('/api/login', { username: 'ada_1', password: 'correct horse battery' });
  const b = await post('/api/login', { username: 'ada_1', password: 'correct horse battery' });
  await post('/api/logout', { all: true }, { cookie: a.cookie });
  check('log out everywhere ends every session', (await req('GET', '/api/me', { cookie: b.cookie })).status === 401);

  // ---------- throttling ----------
  await post('/api/register', { username: 'bob', password: 'long secret passphrase', turnstile: T });
  let last;
  for (let i = 1; i <= 3; i++) last = await post('/api/login', { username: 'bob', password: `wrong guess ${i}` });
  check('Turnstile requested after 3 failures', last.body?.captcha === true);
  check('without the check the 4th try is refused', (await post('/api/login', { username: 'bob', password: 'long secret passphrase' })).body?.captcha === true);
  check('with the check a correct login works', (await post('/api/login', { username: 'bob', password: 'long secret passphrase', turnstile: T })).status === 200);
  for (let i = 1; i <= 10; i++) last = await post('/api/login', { username: 'bob', password: `wrong again ${i}`, turnstile: T });
  const locked = await post('/api/login', { username: 'bob', password: 'long secret passphrase', turnstile: T });
  check('locked after 10 failures, even with the right password', locked.status === 429 && locked.body?.retryAfter > 800, `retryAfter ${locked.body?.retryAfter} s`);

  // ---------- recovery ----------
  const c = await post('/api/register', { username: 'cyd', password: 'first original passphrase', turnstile: T });
  const code = c.body.recoveryCode;
  check('recover: wrong code refused', (await post('/api/recover', { username: 'cyd', recoveryCode: 'AAAAA-AAAAA-AAAAA-AAAAA', newPassword: 'second brand new passphrase', turnstile: T })).status === 401);
  const rec = await post('/api/recover', { username: 'CYD', recoveryCode: code.toLowerCase(), newPassword: 'second brand new passphrase', turnstile: T });
  check('recover: code works (any case), new code issued', rec.status === 200 && rec.body?.recoveryCode && rec.body.recoveryCode !== code);
  check('recover: old sessions ended', (await req('GET', '/api/me', { cookie: c.cookie })).status === 401);
  check('recover: old password no longer works', (await post('/api/login', { username: 'cyd', password: 'first original passphrase', turnstile: T })).status === 401);
  check('recover: new password works', (await post('/api/login', { username: 'cyd', password: 'second brand new passphrase', turnstile: T })).status === 200);
  check('recover: used code cannot be reused', (await post('/api/recover', { username: 'cyd', recoveryCode: code, newPassword: 'third passphrase here', turnstile: T })).status === 401);

  // ---------- registration rate limit (5 per network per hour) ----------
  const extra = [];
  for (let i = 0; i < 4; i++) extra.push((await post('/api/register', { username: `filler${i}`, password: 'filler passphrase 123', turnstile: T })).status);
  check('6th registration from one network in an hour refused', extra.slice(0, 2).every((s) => s === 201) && extra.at(-1) === 429, extra.join(','));
} catch (e) {
  crashed = e;
} finally {
  await stack.stop(crashed);
}
