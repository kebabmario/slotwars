// Shared local test stack: throwaway D1 + Durable Objects + Pages Functions, all on this machine.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export const API = 'http://localhost:8788';
export const ORIGIN = API;
export const TURNSTILE_TEST_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX'; // accepted by the always-pass test secret in .dev.vars

const results = [];
export function check(name, pass, detail = '') {
  results.push(!!pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

export async function req(method, path, { body, cookie, origin = ORIGIN } = {}) {
  const r = await fetch(API + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(origin ? { Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = r.headers.get('set-cookie') ?? '';
  const tok = setCookie.match(/__Host-sw_session=([0-9a-f]{64})/)?.[1];
  return { status: r.status, body: await r.json().catch(() => null), setCookie, cookie: tok ? `__Host-sw_session=${tok}` : null };
}
export const post = (path, body, o = {}) => req('POST', path, { body, ...o });

/** Starts both dev servers on a fresh state folder. `roomVars` are passed to the rooms Worker (e.g. short grace). */
export async function startStack({ roomVars = {} } = {}) {
  if (await fetch(`${API}/`).then(() => true, () => false)) {
    console.error('Port 8788 is already in use (a dev server is running). Stop it first: this test starts its own servers.');
    process.exit(1);
  }
  const state = mkdtempSync(join(tmpdir(), 'slotwars-test-'));
  const wr = (args) => spawn('npx', ['wrangler', ...args, '--persist-to', state], { stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'slotwars-db', '--local', '--persist-to', state], { stdio: 'pipe' });
  const vars = Object.entries(roomVars).flatMap(([k, v]) => ['--var', `${k}:${v}`]);
  const rooms = wr(['dev', '--config', 'workers/rooms/wrangler.jsonc', '--port', '8790', ...vars]);
  const site = wr(['pages', 'dev', '--port', '8788']);
  let log = '';
  for (const p of [rooms, site]) {
    p.stdout.on('data', (d) => (log += d));
    p.stderr.on('data', (d) => (log += d));
  }
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    const ok = await fetch(`${API}/api/me`).then((r) => r.status === 401).catch(() => false);
    if (ok && /Ready on .*8790/.test(log)) break;
  }
  await sleep(1500);
  return {
    d1: (sql) => execFileSync('npx', ['wrangler', 'd1', 'execute', 'slotwars-db', '--local', '--persist-to', state, '--json', '--command', sql], { stdio: 'pipe' }).toString(),
    async stop(crashed) {
      rooms.kill();
      site.kill();
      await sleep(500);
      rmSync(state, { recursive: true, force: true });
      if (crashed) check('driver crashed', false, String(crashed?.stack ?? crashed));
      const failed = results.filter((x) => !x).length;
      console.log(`\n${results.length - failed}/${results.length} checks passed`);
      if (failed) console.log('--- wrangler log tail ---\n' + log.split('\n').slice(-30).join('\n'));
      process.exit(failed ? 1 : 0);
    },
  };
}
