import { DurableObject } from 'cloudflare:workers';
import { argon2id } from '@noble/hashes/argon2.js';

export interface Env {
  PEPPER: string; // Worker secret mixed into every hash; never stored in D1
}

// OWASP minimum for Argon2id. Durable Objects allow 30 s CPU per request; one hash costs about 0.2–1 s.
const PARAMS = { t: 2, m: 19456, p: 1, dkLen: 32 } as const;
export const PASS_ALGO = 'argon2id-pepper-v1';

const enc = new TextEncoder();
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
function equal(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

/**
 * One instance per name (`u:<username>`, `ip:<address>`, `reg:<address>`): hashing runs in parallel across
 * users, and each instance keeps its own failure counter in memory. Counters reset if the object is evicted,
 * which is acceptable at this scale.
 */
export class AuthGate extends DurableObject<Env> {
  private fails: number[] = [];
  private lockedUntil = 0;

  private derive(password: string, salt: Uint8Array) {
    if (!this.env.PEPPER || this.env.PEPPER.length < 32) throw new Error('PEPPER secret missing or too short');
    return argon2id(enc.encode(password), salt, { ...PARAMS, key: enc.encode(this.env.PEPPER) });
  }

  async hash(password: string): Promise<{ hash: string; algo: string }> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    return { algo: PASS_ALGO, hash: `argon2id$m=${PARAMS.m},t=${PARAMS.t},p=${PARAMS.p}$${b64(salt)}$${b64(this.derive(password, salt))}` };
  }

  /** `stored` null (unknown user) still costs one hash, so response time does not reveal which usernames exist. */
  async verify(password: string, stored: string | null): Promise<boolean> {
    const parts = stored?.split('$');
    if (!parts || parts.length !== 4 || parts[0] !== 'argon2id' || parts[1] !== `m=${PARAMS.m},t=${PARAMS.t},p=${PARAMS.p}`) {
      this.derive(password, new Uint8Array(16));
      return false;
    }
    return equal(this.derive(password, unb64(parts[2])), unb64(parts[3]));
  }

  /** Failures within `windowMs`, and whether this name is locked out. */
  async peek(windowMs: number): Promise<{ fails: number; retryAfter: number }> {
    const now = Date.now();
    this.fails = this.fails.filter((t) => now - t < windowMs);
    return { fails: this.fails.length, retryAfter: Math.max(0, Math.ceil((this.lockedUntil - now) / 1000)) };
  }

  /** Records a failure (or a counted event such as a registration); locks for `lockMs` once `limit` is reached. */
  async fail(limit: number, windowMs: number, lockMs: number): Promise<void> {
    const now = Date.now();
    this.fails = this.fails.filter((t) => now - t < windowMs);
    this.fails.push(now);
    if (this.fails.length >= limit) this.lockedUntil = now + lockMs;
  }

  async reset(): Promise<void> {
    this.fails = [];
    this.lockedUntil = 0;
  }
}
