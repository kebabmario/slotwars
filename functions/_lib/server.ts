// Shared helpers for the Pages Functions: responses, Origin checks, sessions, Turnstile and AuthGate access.
import type { AuthGate } from '../../workers/rooms/src/auth-gate.ts';
import type { MatchRoom } from '../../workers/rooms/src/match-room.ts';

export interface Env {
  DB: D1Database;
  AUTH: DurableObjectNamespace<AuthGate>;
  ROOM: DurableObjectNamespace<MatchRoom>;
  ALLOWED_ORIGINS: string; // comma-separated exact origins
  TURNSTILE_SECRET?: string; // optional: Turnstile is enforced only when this secret is set
}
export type Fn = PagesFunction<Env>;

export const COOKIE = '__Host-sw_session';
const DAY = 86_400_000;
export const SESSION_MS = 30 * DAY;
const RENEW_BELOW_MS = 15 * DAY; // renew at most every 15 days to save D1 writes

export const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', ...headers } });
export const fail = (status: number, error: string, extra: object = {}) => json({ error, ...extra }, status);

/** Every state-changing request must come from one of our own pages. */
export const originOk = (req: Request, env: Env) => env.ALLOWED_ORIGINS.split(',').includes(req.headers.get('Origin') ?? '');

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  if (!(req.headers.get('Content-Type') ?? '').includes('application/json')) return null;
  const text = await req.text();
  if (text.length > 4096) return null;
  try {
    const v = JSON.parse(text);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
export const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
export const clientIp = (req: Request) => req.headers.get('CF-Connecting-IP') ?? 'local';

export const sessionCookie = (token: string) => `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}`;
export const clearCookie = `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;

export async function createSession(env: Env, userId: number): Promise<string> {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), userId, now, now + SESSION_MS)
    .run();
  return token;
}

export function cookieToken(req: Request): string | null {
  const m = (req.headers.get('Cookie') ?? '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([0-9a-f]{64})(?:;|$)`));
  return m ? m[1] : null;
}

export interface SessionUser {
  id: number;
  username: string;
  createdAt: number;
  tokenHash: string;
  renewed: string | null; // token to re-send in Set-Cookie when the session was extended
}

/** One indexed D1 read per call; an expiring session is extended (one write at most every 15 days). */
export async function sessionUser(req: Request, env: Env): Promise<SessionUser | null> {
  const token = cookieToken(req);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT u.id, u.username, u.created_at, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND u.status = 'active'`,
  ).bind(tokenHash).first<{ id: number; username: string; created_at: number; expires_at: number }>();
  const now = Date.now();
  if (!row || row.expires_at <= now) return null;
  let renewed: string | null = null;
  if (row.expires_at - now < RENEW_BELOW_MS) {
    await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').bind(now + SESSION_MS, tokenHash).run();
    renewed = token;
  }
  return { id: row.id, username: row.username, createdAt: row.created_at, tokenHash, renewed };
}

const TEST_SECRET = /^[123]x0{30,}AA$/;
/** True when Turnstile is off (no secret configured) or the token checks out with Cloudflare. */
export async function turnstileOk(env: Env, token: unknown, ip: string): Promise<boolean> {
  if (!env.TURNSTILE_SECRET) return true;
  if (typeof token !== 'string' || !token || token.length > 2048) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  form.append('remoteip', ip);
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    const v = (await r.json()) as { success?: boolean; hostname?: string };
    if (v.success !== true) return false;
    // a token solved on another site must not count here (Cloudflare test secrets report a fixed dummy hostname)
    if (TEST_SECRET.test(env.TURNSTILE_SECRET)) return true;
    return env.ALLOWED_ORIGINS.split(',').some((o) => o.replace(/^https?:\/\//, '').replace(/:\d+$/, '') === v.hostname);
  } catch {
    return false; // fail closed if Cloudflare cannot be reached
  }
}

export const gate = (env: Env, name: string) => env.AUTH.get(env.AUTH.idFromName(name));

// Throttling policy (PROVISIONAL values)
export const WINDOW = 15 * 60_000;
export const USER_LIMIT = { captchaAfter: 3, lockAfter: 10, lockMs: 15 * 60_000 };
export const IP_LIMIT = { captchaAfter: 10, lockAfter: 30, lockMs: 15 * 60_000 };
export const REGISTER_LIMIT = { perHour: 5 };

export const RECOVERY_LEN = 20;
export function newRecoveryCode(alphabet: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(RECOVERY_LEN));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join(''); // 256 % 32 === 0: no bias
}
export const formatRecovery = (code: string) => code.match(/.{1,5}/g)!.join('-');
