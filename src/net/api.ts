// Browser client for the Slot Wars account API (same origin, cookie session).

export interface ApiError {
  error: string;
  status: number;
  captcha?: boolean;
  retryAfter?: number;
}
export type ApiResult<T> = ({ ok: true } & T) | ({ ok: false } & ApiError);
export interface Me {
  username: string;
  createdAt: number;
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const r = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) return { ok: true, ...data };
    // 1027 / 503 etc.: free daily limit reached or server down; local play keeps working
    return { ok: false, status: r.status, error: data.error ?? (r.status >= 500 ? 'Online services are unavailable right now. Local play still works.' : 'Request failed.'), captcha: data.captcha, retryAfter: data.retryAfter };
  } catch {
    return { ok: false, status: 0, error: 'Cannot reach the server. Check your connection. Local play still works.' };
  }
}

export const api = {
  me: () => call<Me>('GET', '/api/me'),
  register: (username: string, password: string, turnstile?: string) => call<{ username: string; recoveryCode: string }>('POST', '/api/register', { username, password, turnstile }),
  login: (username: string, password: string, turnstile?: string) => call<{ username: string }>('POST', '/api/login', { username, password, turnstile }),
  recover: (username: string, recoveryCode: string, newPassword: string, turnstile?: string) =>
    call<{ username: string; recoveryCode: string }>('POST', '/api/recover', { username, recoveryCode, newPassword, turnstile }),
  logout: (all = false) => call<object>('POST', '/api/logout', { all }),
  createRoom: () => call<{ code: string }>('POST', '/api/rooms', {}),
  profile: (username: string) => call<Me>('GET', `/api/profile?u=${encodeURIComponent(username)}`),
};

/** Turnstile site key baked in at build time; empty means Turnstile is off. */
export const TURNSTILE_SITE_KEY: string = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '';
