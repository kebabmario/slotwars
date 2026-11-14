// Private online match: lobby (invite code, King choice, ready), then the game itself.
import { KING_ABILITIES } from '../game/config.ts';
import type { KingAbility, PlayerId } from '../game/types.ts';
import { KING_NAME_MAX } from '../game/config.ts';
import { MACHINE_SPRITES } from '../assets/sprites/index.ts';
import { spriteUrl } from '../assets/render.ts';
import type { Settings } from '../settings.ts';
import type { ServerMsg } from '../net/protocol.ts';
import { GameSocket } from '../net/socket.ts';
import { OnlineController } from '../net/online-controller.ts';
import { messageBox, windowHtml } from './chrome.ts';
import { esc, GameScreen } from './game.ts';

type Go = (screen: string, data?: unknown) => void;
type LobbyMsg = Extract<ServerMsg, { t: 'lobby' }>;

/** Runs one online match; `destroy()` closes the connection when the player navigates away. */
export function onlineMatch(root: HTMLElement, go: Go, settings: Settings, code: string) {
  let game: GameScreen | null = null;
  let left = false;
  const leave = () => {
    left = true;
    sock.close();
    go('online');
  };
  const fail = (title: string, text: string) => {
    if (left) return;
    left = true;
    sock.close();
    void messageBox(title, text, ['OK']).then(() => go('online'));
  };

  const sock = new GameSocket(
    code,
    (m) => {
      if (left) return;
      if (m.t === 'lobby') return renderLobby(m);
      if (m.t === 'state') {
        if (!game) {
          const names = m.view.players.map((p) => p.kingName) as [string, string];
          const kings = m.view.players.map((p) => p.king) as [KingAbility, KingAbility];
          game = new GameScreen(root, { kings, names, fog: m.view.fog }, { ...settings, passScreen: false }, go, undefined, {
            ctl: new OnlineController(sock, m.you),
            initial: m.view,
            resign: () => sock.send({ t: 'resign' }),
            claim: () => sock.send({ t: 'claim' }),
            leave,
          });
          if (m.result) game.receive(m); // joined a finished match: show the result
        } else game.receive(m);
        return game.setPresence(m.away);
      }
      if (m.t === 'presence') return game?.setPresence(m.away);
      if (m.t === 'rejected') return game?.notify(m.reason);
      if (m.t === 'paused') return game ? game.setNetNote(m.reason) : undefined;
      if (m.t === 'closed') return fail('Match Closed', esc(m.reason));
    },
    (status) => {
      if (status === 'failed') fail('Could Not Join', 'The code may be wrong or expired, the match may be full, or you may be signed out.');
      if (status === 'reconnecting') game?.setNetNote('Connection lost. Reconnecting…');
      if (status === 'open') game?.setNetNote('');
    },
  );

  root.innerHTML = windowHtml('Online Match', '<p class="note">Connecting…</p>', { cls: 'lobby', close: true });
  root.querySelector('[data-act="close"]')!.addEventListener('click', leave);

  function renderLobby(m: LobbyMsg) {
    const me = m.seats[m.you]!, opp = m.seats[(1 - m.you) as PlayerId];
    const isHost = m.you === m.host;
    const seat = (s: LobbyMsg['seats'][number], i: number) =>
      s
        ? `<li><img src="${spriteUrl(MACHINE_SPRITES.sludgy, i as PlayerId)}" alt="" /><b>${esc(s.username)}</b>
             <small>${esc(KING_ABILITIES[s.king].name)} · ${esc(s.kingName)}</small>
             <span class="${s.ready ? 'good' : ''}">${!s.online ? 'offline' : s.ready ? '✔ Ready' : 'choosing…'}</span></li>`
        : '<li class="empty">Waiting for an opponent… share the code below.</li>';
    root.innerHTML = windowHtml(
      'Online Match · Lobby',
      `<div class="group"><span class="legend">Invite code</span>
         <div class="invite"><span class="code" aria-label="Invite code">${esc(m.code)}</span><button class="btn" id="copy">Copy</button></div>
         <p class="note">Your opponent opens Play Online, picks Join Match and types this code.</p></div>
       <div class="group"><span class="legend">Players</span><ul class="seats">${m.seats.map(seat).join('')}</ul></div>
       <div class="group"><span class="legend">Your King</span>
         ${(Object.keys(KING_ABILITIES) as KingAbility[]).map((k) =>
           `<label class="radio"><input type="radio" name="king" value="${k}" ${me.king === k ? 'checked' : ''} ${me.ready ? 'disabled' : ''} />
              <b>${KING_ABILITIES[k].name}</b> <small>${esc(KING_ABILITIES[k].text)}</small></label>`).join('')}
         <label class="field">King name<input class="text" id="kname" maxlength="${KING_NAME_MAX}" value="${esc(me.kingName)}" ${me.ready ? 'disabled' : ''} spellcheck="false" /></label></div>
       <div class="group"><span class="legend">Match</span>
         <label class="radio"><input type="checkbox" id="fog" ${m.fog ? 'checked' : ''} ${isHost && !me.ready ? '' : 'disabled'} /> Fog of war ${isHost ? '' : '<small>(the host decides)</small>'}</label>
         <p class="note">Standard rules, 3 starting points. Who moves first is random. Private matches are not rated.</p></div>
       <div class="row-end"><button class="btn" id="leave">Leave</button>
         <button class="btn big" id="ready" ${opp ? '' : 'disabled'}>${me.ready ? 'Not Ready' : 'Ready'}</button></div>`,
      { cls: 'lobby', close: true },
    );
    const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
    $('[data-act="close"]').addEventListener('click', leave);
    $('#leave').addEventListener('click', leave);
    $('#copy').addEventListener('click', () => void navigator.clipboard?.writeText(m.code).then(() => ($('#copy').textContent = 'Copied')));
    root.querySelectorAll<HTMLInputElement>('input[name="king"]').forEach((r) => r.addEventListener('change', () => sock.send({ t: 'lobby', king: r.value as KingAbility })));
    $<HTMLInputElement>('#kname').addEventListener('change', (e) => sock.send({ t: 'lobby', kingName: (e.target as HTMLInputElement).value }));
    $<HTMLInputElement>('#fog').addEventListener('change', (e) => sock.send({ t: 'lobby', fog: (e.target as HTMLInputElement).checked }));
    $('#ready').addEventListener('click', () => {
      sock.send({ t: 'lobby', kingName: $<HTMLInputElement>('#kname').value, ready: !me.ready });
    });
  }

  return {
    destroy() {
      left = true;
      sock.close();
      game?.destroy();
    },
  };
}
