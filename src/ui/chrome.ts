// Win95-style window chrome shared by every screen.
import { MACHINE_SPRITES } from '../assets/sprites/index.ts';
import { spriteUrl } from '../assets/render.ts';

export function windowHtml(title: string, body: string, opts: { cls?: string; close?: boolean; menubar?: string; status?: string } = {}) {
  return `
  <section class="window ${opts.cls ?? ''}" role="dialog" aria-label="${title}">
    <div class="titlebar">
      <img src="${spriteUrl(MACHINE_SPRITES.sludgy, 0)}" alt="" />
      <span class="title">${title}</span>
      ${opts.close ? '<button class="tb-btn" data-act="close" aria-label="Close">×</button>' : ''}
    </div>
    ${opts.menubar ? `<nav class="menubar">${opts.menubar}</nav>` : ''}
    <div class="body">${body}</div>
    ${opts.status ? `<div class="statusbar">${opts.status}</div>` : ''}
  </section>`;
}

/** Message box with buttons. Resolves with the clicked button index (-1 if dismissed). */
export function messageBox(title: string, html: string, buttons: string[], icon?: string): Promise<number> {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = windowHtml(
      title,
      `<div class="msg">${icon ? `<img src="${icon}" alt="" />` : ''}<div>${html}</div></div>
       <div class="row-end">${buttons.map((b, i) => `<button class="btn" data-i="${i}">${b}</button>`).join('')}</div>`,
      { close: true },
    );
    const done = (i: number) => {
      back.remove();
      removeEventListener('keydown', onKey);
      resolve(i);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && done(-1);
    back.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('button');
      if (!t) return;
      done(t.dataset.act === 'close' ? -1 : Number(t.dataset.i));
    });
    addEventListener('keydown', onKey);
    document.body.appendChild(back);
    back.querySelector<HTMLButtonElement>('[data-i="0"]')?.focus();
  });
}
