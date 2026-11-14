// Account rules shared by the browser (instant feedback) and the server (enforcement).

export const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

// A short list of the most common passwords at or above the minimum length.
const COMMON = new Set([
  '1234567890', '0123456789', '1111111111', '0000000000', 'qwertyuiop', 'password12', 'password123', 'password1234',
  'iloveyou12', 'qwerty1234', 'qwerty123456', '1q2w3e4r5t', 'asdfghjkl1', 'abcdefghij', 'abc1234567', 'football12',
  'baseball12', 'princess12', 'sunshine12', 'welcome123', 'letmein123', 'admin12345', 'passw0rd12', 'starwars12',
  'dragon1234', 'monkey1234', 'zaq12wsxcde', '123qweasdzxc', '9876543210', 'slotwars12', 'slotwars123',
]);

export function usernameError(name: unknown): string | null {
  if (typeof name !== 'string' || !USERNAME_RE.test(name)) return 'Username: 3–16 letters, digits or _.';
  return null;
}

export function passwordError(pw: unknown, username?: string): string | null {
  if (typeof pw !== 'string' || pw.length < PASSWORD_MIN) return `Password: at least ${PASSWORD_MIN} characters.`;
  if (pw.length > PASSWORD_MAX) return `Password: at most ${PASSWORD_MAX} characters.`;
  const lc = pw.toLowerCase();
  if (COMMON.has(lc) || /^(.)\1+$/.test(pw)) return 'That password is too common. Pick something harder to guess.';
  if (username && lc.includes(username.toLowerCase())) return 'Password must not contain your username.';
  return null;
}

/** Recovery codes: 20 characters from an alphabet without look-alikes (≈100 bits), shown as 4 groups of 5. */
export const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const normalizeRecoveryCode = (code: unknown) =>
  typeof code === 'string' ? code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 40) : '';
