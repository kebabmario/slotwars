// Play Online: sign in, create an account, recover with the one-time code, sign out.
import { api, TURNSTILE_SITE_KEY, type Me } from '../net/api.ts';
import { passwordError, PASSWORD_MAX, usernameError } from '../net/account-rules.ts';
import { CODE_RE } from '../net/protocol.ts';
import { MACHINE_SPRITES } from '../assets/sprites/index.ts';
import { spriteUrl } from '../assets/render.ts';
import { messageBox, windowHtml } from './chrome.ts';
import { esc } from './game.ts';

type Go = (screen: string, data?: unknown) => void;
type Tab = 'login' | 'register' | 'recover';
let tab: Tab = 'login';

// ---------- Turnstile (only when a site key is configured) ----------
interface TurnstileApi {
  render(el: HTMLElement, o: { sitekey: string; callback: (t: string) => void; 'expired-callback': () => void }): string;
  reset(id: string): void;
}
let tsScript: Promise<TurnstileApi> | null = null;
function turnstile(): Promise<TurnstileApi> {
  return (tsScript ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => resolve((window as unknown as { turnstile: TurnstileApi }).turnstile);
    s.onerror = () => { tsScript = null; reject(new Error('Turnstile failed to load')); };
    document.head.append(s);
  }));
}
/** Renders the check into `el`; returns a getter for the current token. */
function captcha(el: HTMLElement) {
  let token = '';
  el.hidden = false;
  void turnstile().then((t) => t.render(el, { sitekey: TURNSTILE_SITE_KEY, callback: (v) => (token = v), 'expired-callback': () => (token = '') }))
    .catch(() => (el.textContent = 'The security check could not load. Check your connection.'));
  return () => token;
}

const recoveryBox = (code: string) =>
  messageBox(
    'Save Your Recovery Code',
    `<p>This is the only way back into your account if you forget your password. It is shown <b>once</b>, and we cannot recover it for you.</p>
     <p class="recovery-code">${esc(code)}</p><p>Write it down or store it in a password manager.</p>`,
    ['I saved it'],
    spriteUrl(MACHINE_SPRITES.sludgy, 0),
  );

export async function accountScreen(root: HTMLElement, go: Go) {
  root.innerHTML = windowHtml('Play Online', '<p class="note">Checking your sign-in…</p>', { cls: 'account', close: true });
  root.querySelector('[data-act="close"]')!.addEventListener('click', () => go('menu'));
  const me = await api.me();
  if (!root.querySelector('.account')) return; // the player left while we waited
  if (me.ok) signedIn(root, go, me);
  else if (me.status === 401) signedOut(root, go);
  else {
    root.querySelector('.note')!.textContent = me.error;
  }
}

function signedIn(root: HTMLElement, go: Go, me: Me) {
  root.innerHTML = windowHtml(
    'Play Online',
    `<div class="msg"><img src="${spriteUrl(MACHINE_SPRITES.sludgy, 0)}" alt="" />
       <div>Signed in as <b>${esc(me.username)}</b><br /><small>Member since ${new Date(me.createdAt).toLocaleDateString()}</small></div></div>
     <div class="group"><span class="legend">Private match</span>
       <div class="row-end start"><button class="btn big" id="create">Create Match</button></div>
       <form class="join" id="join"><label class="field">Join with a code<input class="text" id="code" maxlength="6" autocomplete="off" spellcheck="false" placeholder="ABC123" /></label>
         <button class="btn" type="submit">Join Match</button></form>
       <p class="form-error" role="alert"></p></div>
     <div class="row-end"><button class="btn" data-go="menu">Back</button><button class="btn" id="out-all">Log Out Everywhere</button><button class="btn" id="out">Log Out</button></div>`,
    { cls: 'account', close: true },
  );
  root.querySelector('[data-act="close"]')!.addEventListener('click', () => go('menu'));
  root.querySelector('[data-go="menu"]')!.addEventListener('click', () => go('menu'));
  const out = (all: boolean) => void api.logout(all).then(() => signedOut(root, go));
  root.querySelector('#out')!.addEventListener('click', () => out(false));
  root.querySelector('#out-all')!.addEventListener('click', () => out(true));
  const error = (t: string) => (root.querySelector('.form-error')!.textContent = t);
  root.querySelector<HTMLButtonElement>('#create')!.addEventListener('click', async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    b.disabled = true;
    const r = await api.createRoom();
    b.disabled = false;
    if (r.ok) go('online-match', r.code);
    else error(r.error);
  });
  root.querySelector('#join')!.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = root.querySelector<HTMLInputElement>('#code')!.value.trim().toUpperCase();
    if (!CODE_RE.test(code)) return error('Codes are 6 letters and digits, like K7MPQ2.');
    go('online-match', code);
  });
}

function signedOut(root: HTMLElement, go: Go) {
  const TABS: [Tab, string][] = [['login', 'Log In'], ['register', 'Create Account'], ['recover', 'Recover']];
  const field = (id: string, label: string, type: string, auto: string) =>
    `<label class="field">${label}<input class="text" id="${id}" type="${type}" autocomplete="${auto}" maxlength="${type === 'password' ? PASSWORD_MAX : 40}" spellcheck="false" required /></label>`;
  const body = {
    login: field('user', 'Username', 'text', 'username') + field('pass', 'Password', 'password', 'current-password'),
    register: field('user', 'Username <small>(3–16 letters, digits or _)</small>', 'text', 'username') +
      field('pass', 'Password <small>(at least 10 characters)</small>', 'password', 'new-password') + field('pass2', 'Repeat password', 'password', 'new-password'),
    recover: field('user', 'Username', 'text', 'username') + field('code', 'Recovery code', 'text', 'off') + field('pass', 'New password', 'password', 'new-password'),
  }[tab];
  root.innerHTML = windowHtml(
    'Play Online',
    `<div class="tabs" role="tablist">${TABS.map(([id, label]) => `<button class="tab ${tab === id ? 'on' : ''}" role="tab" aria-selected="${tab === id}" data-tab="${id}">${label}</button>`).join('')}</div>
     <form class="tabpanel" role="tabpanel" novalidate>${body}
       <div class="captcha" hidden></div>
       <p class="form-error" role="alert"></p>
       ${tab === 'register' ? '<p class="note">No email needed. You get a one-time recovery code instead.</p>' : ''}
       <div class="row-end"><button type="button" class="btn" data-go="menu">Back</button>
         <button type="submit" class="btn big">${TABS.find(([id]) => id === tab)![1]}</button></div>
     </form>`,
    { cls: 'account', close: true },
  );
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  root.querySelector('[data-act="close"]')!.addEventListener('click', () => go('menu'));
  $('[data-go="menu"]').addEventListener('click', () => go('menu'));
  root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => ((tab = b.dataset.tab as Tab), signedOut(root, go))));
  const val = (id: string) => root.querySelector<HTMLInputElement>(`#${id}`)?.value ?? '';
  const error = (t: string) => ($('.form-error').textContent = t);
  let token: (() => string) | null = TURNSTILE_SITE_KEY && tab !== 'login' ? captcha($('.captcha')) : null;
  $('#user').focus();

  $<HTMLFormElement>('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = val('user').trim(), pass = val('pass');
    const local = tab === 'login' ? (usernameError(user) || !pass ? 'Enter your username and password.' : null)
      : usernameError(user) ?? passwordError(pass, user) ?? (tab === 'register' && pass !== val('pass2') ? 'The passwords do not match.' : null);
    if (local) return error(local);
    const submit = $<HTMLButtonElement>('button[type="submit"]');
    submit.disabled = true;
    error('');
    const t = token?.() || undefined;
    const r = tab === 'login' ? await api.login(user, pass, t) : tab === 'register' ? await api.register(user, pass, t) : await api.recover(user, val('code'), pass, t);
    submit.disabled = false;
    if (!r.ok) {
      error(r.retryAfter ? `${r.error} (${Math.ceil(r.retryAfter / 60)} min)` : r.error);
      if (r.captcha && TURNSTILE_SITE_KEY && !token) token = captcha($('.captcha'));
      return;
    }
    const code = (r as { recoveryCode?: string }).recoveryCode;
    if (code) await recoveryBox(code);
    tab = 'login';
    void accountScreen(root, go);
  });
}
