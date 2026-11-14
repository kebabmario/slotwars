// Menu, setup, how-to-play, settings and asset viewer screens.
import { ABILITY_VALUES, DIMENSION, INDUSTRIAL, KING_ABILITIES, KING_NAME_MAX, MACHINES, REPAIR_STATION, RULES, SHOCK_TRAP, STRUCTURES, TURRET } from '../game/config.ts';
import type { KingAbility, MachineKind, StructureKind } from '../game/types.ts';
import { CITY_TILES, DIM_PORTAL_SPRITE, DRONE_SPRITE, MINE_BURST_SPRITE, STRUCTURE_FRAME2, ICONS, INDUSTRIAL_FRAMES, MACHINE_SPRITES, PORTAL_FRAME2, PORTAL_SPRITE, STRUCTURE_SPRITES, cityTile } from '../assets/sprites/index.ts';
import { boardMapUrl } from '../assets/map.ts';
import { spriteUrl } from '../assets/render.ts';
import { drawLogo } from './logo.ts';
import { messageBox, windowHtml } from './chrome.ts';
import {
  DEFAULT_MATCH, DEFAULT_SETTINGS, PLAYER_NAME_MAX, STARTING_POINTS_RANGE, loadMatchConfig, sanitizeMatch, saveMatchConfig,
  type Level, type MatchConfig, type Settings, type Speed,
} from '../settings.ts';
import { esc } from './game.ts';
import { loadTutorialProgress } from './tutorial.ts';

export const VERSION = 'v0.1.0 prototype';
const PROV = '<span class="prov">PROVISIONAL</span>';

type Go = (screen: string, data?: unknown) => void;

export function menuScreen(root: HTMLElement, go: Go) {
  const kinds: MachineKind[] = ['scout', 'defender', 'striker', 'sludgy', 'saboteur', 'breacher', 'medic', 'taxer'];
  root.innerHTML = `
    <div class="menu">
      <div class="logo-wrap">
        <div id="logo"></div>
      </div>
      <div class="mascots">${kinds.map((k, i) => `<img src="${spriteUrl(MACHINE_SPRITES[k], i < 4 ? 0 : 1)}" alt="" />`).join('')}</div>
      ${windowHtml(
        'Slot Wars',
        `<div class="menu-buttons">
          <button class="btn big" data-go="setup">▶ Play</button>
          <button class="btn" data-go="online">Play Online</button>
          <button class="btn" data-go="tutorial">Tutorial${loadTutorialProgress().length ? '' : ' <span class="new-badge">NEW</span>'}</button>
          <button class="btn" data-go="howto">How to Play</button>
          <button class="btn" data-go="settings">Settings</button>
        </div>`,
      )}
    </div>
    <div class="version">${VERSION}</div>`;
  const logo = drawLogo(window.innerWidth < 600 ? 5 : window.innerWidth < 1000 ? 8 : 11);
  root.querySelector('#logo')!.appendChild(logo);
  wireGo(root, go);
  root.querySelector<HTMLButtonElement>('[data-go="setup"]')!.focus();
}

function wireGo(root: HTMLElement, go: Go, closeTo = 'menu') {
  root.querySelectorAll<HTMLElement>('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go!)));
  root.querySelector('[data-act="close"]')?.addEventListener('click', () => go(closeTo));
}

export function setupScreen(root: HTMLElement, go: Go) {
  let cfg: MatchConfig = loadMatchConfig();
  const keys = Object.keys(KING_ABILITIES) as KingAbility[];
  const card = (p: 0 | 1) => `
    <div class="group player-card"><span class="legend">Player ${p + 1} · ${p ? 'Q4' : 'Q1'}</span>
      <div class="king-preview">
        <div class="portrait big"><img src="${spriteUrl(MACHINE_SPRITES.sludgy, p)}" alt="" /></div>
        <div><div class="plate p${p + 1}" id="plate${p}"></div><small id="plate-sub${p}"></small></div>
      </div>
      <label class="field">Player name
        <input type="text" class="text" data-field="playerNames" data-p="${p}" maxlength="${PLAYER_NAME_MAX}" autocomplete="off" spellcheck="false" /></label>
      <label class="field">King name
        <input type="text" class="text" data-field="kingNames" data-p="${p}" maxlength="${KING_NAME_MAX}" autocomplete="off" spellcheck="false" /></label>
      <div>King ability:</div>
      ${keys
        .map(
          (k) => `<label class="radio"><input type="radio" name="king${p}" value="${k}" data-p="${p}" />
          <span><b>${KING_ABILITIES[k].name}</b> · ${KING_ABILITIES[k].sp} SP<small>${KING_ABILITIES[k].text}</small></span></label>`,
        )
        .join('')}
    </div>`;
  root.innerHTML = windowHtml(
    'New Match · Local Hot-Seat',
    `<div class="setup-cols">${card(0)}${card(1)}</div>
     <div class="setup-cols">
       <div class="group"><span class="legend">Match Options</span>
         <label class="radio"><input type="checkbox" id="fog" />
           <span><b>Fog of war</b> ${PROV}<small>You only see your home quadrant and quadrants your machines occupy.</small></span></label>
         <label class="field">Starting points <small>(standard: ${RULES.startingPoints})</small>
           <span class="spin"><button class="btn" data-step="-1" aria-label="Fewer starting points">−</button>
           <input type="number" class="text" id="points" min="${STARTING_POINTS_RANGE[0]}" max="${STARTING_POINTS_RANGE[1]}" step="1" />
           <button class="btn" data-step="1" aria-label="More starting points">+</button></span></label>
       </div>
       <div class="group"><span class="legend">Match Summary</span><div class="well summary" id="summary" aria-live="polite"></div></div>
     </div>
     <div class="row-end"><button class="btn" data-go="menu">Back</button><button class="btn" id="standard">Reset to Standard</button><button class="btn big" id="start">Start Match</button></div>`,
    { cls: 'setup', close: true },
  );
  wireGo(root, go);
  const $ = <T extends HTMLElement>(q: string) => root.querySelector<T>(q)!;
  const fill = () => {
    root.querySelectorAll<HTMLInputElement>('input[data-field]').forEach((i) => (i.value = cfg[i.dataset.field as 'playerNames' | 'kingNames'][+i.dataset.p!]));
    root.querySelectorAll<HTMLInputElement>('input[type=radio]').forEach((i) => (i.checked = cfg.kings[+i.dataset.p!] === i.value));
    $<HTMLInputElement>('#fog').checked = cfg.fog;
    $<HTMLInputElement>('#points').value = String(cfg.startingPoints);
    show();
  };
  const read = () => {
    const raw = {
      playerNames: [0, 1].map((p) => $<HTMLInputElement>(`input[data-field=playerNames][data-p="${p}"]`).value),
      kingNames: [0, 1].map((p) => $<HTMLInputElement>(`input[data-field=kingNames][data-p="${p}"]`).value),
      kings: [0, 1].map((p) => root.querySelector<HTMLInputElement>(`input[name=king${p}]:checked`)?.value),
      fog: $<HTMLInputElement>('#fog').checked,
      startingPoints: Number($<HTMLInputElement>('#points').value),
    };
    cfg = sanitizeMatch(raw);
  };
  const show = () => {
    for (const p of [0, 1] as const) {
      $(`#plate${p}`).textContent = cfg.kingNames[p];
      $(`#plate-sub${p}`).textContent = `${cfg.playerNames[p]}'s King · ${KING_ABILITIES[cfg.kings[p]].name}`;
    }
    const custom = cfg.startingPoints !== RULES.startingPoints;
    $('#summary').innerHTML = `
      <table>
        ${([0, 1] as const)
          .map(
            (p) => `<tr><th style="color:var(--p${p + 1})">${esc(cfg.playerNames[p])}</th><td>King <b>${esc(cfg.kingNames[p])}</b> · ${KING_ABILITIES[cfg.kings[p]].name} (${KING_ABILITIES[cfg.kings[p]].sp} SP) · home ${p ? 'Q4' : 'Q1'}</td></tr>`,
          )
          .join('')}
        <tr><th>Fog of war</th><td>${cfg.fog ? 'On' : 'Off'}</td></tr>
        <tr><th>Starting points</th><td>${cfg.startingPoints}${custom ? ' <span class="prov">CUSTOM</span>' : ' (standard)'}</td></tr>
        <tr><th>Fixed rules</th><td>${RULES.startingSp} SP to start, +${RULES.spPerTurn} SP and +${RULES.pointsPerTurn} point per turn, one action per turn</td></tr>
      </table>`;
  };
  root.querySelectorAll('input').forEach((i) => i.addEventListener('input', () => { read(); show(); }));
  root.querySelectorAll('input[type=radio], #fog').forEach((i) => i.addEventListener('change', () => { read(); show(); }));
  root.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((b) =>
    b.addEventListener('click', () => {
      const i = $<HTMLInputElement>('#points');
      i.value = String(Math.min(STARTING_POINTS_RANGE[1], Math.max(STARTING_POINTS_RANGE[0], (Number(i.value) || 0) + Number(b.dataset.step))));
      read();
      show();
    }),
  );
  $('#standard').addEventListener('click', () => { cfg = { ...DEFAULT_MATCH, playerNames: [...DEFAULT_MATCH.playerNames], kingNames: [...DEFAULT_MATCH.kingNames], kings: [...DEFAULT_MATCH.kings] }; fill(); });
  $('#start').addEventListener('click', () => {
    read();
    saveMatchConfig(cfg);
    go('game', { kings: cfg.kings, names: cfg.kingNames, fog: cfg.fog, playerNames: cfg.playerNames, startingPoints: cfg.startingPoints });
  });
  fill();
}

export function howToScreen(root: HTMLElement, go: Go) {
  const machineRows = (Object.keys(MACHINES) as MachineKind[])
    .map((k) => {
      const d = MACHINES[k];
      return `<tr><td><img src="${spriteUrl(MACHINE_SPRITES[k], 0)}" alt="" /></td>
        <td><b>${d.name}</b><br/>${d.cost === null ? 'Free · King' : `${d.cost} pt`}${d.industrial ? `<br/><small>Industrial · R${INDUSTRIAL.unlocks[k]}</small> ${PROV}` : ''}</td>
        <td><b>${d.passive.name}</b>: ${d.passive.text}</td>
        <td>${d.special ? `<b>${d.special.name}</b> (${d.special.sp} SP): ${d.special.text}` : Object.values(KING_ABILITIES).map((a) => `<b>${a.name}</b> (${a.sp} SP): ${a.text}`).join('<br/>')}</td></tr>`;
    })
    .join('');
  const structRows = (Object.keys(STRUCTURES) as StructureKind[])
    .map((k) => {
      const d = STRUCTURES[k];
      return `<tr><td><img src="${spriteUrl(STRUCTURE_SPRITES[k], 0)}" alt="" /></td><td><b>${d.name}</b><br/>${d.cost} pt ${PROV}${d.industrial ? `<br/><small>Industrial · R${INDUSTRIAL.unlocks[k]}</small>` : ''}</td><td>${d.text}</td></tr>`;
    })
    .join('');
  root.innerHTML = windowHtml(
    'How to Play · Slot Wars',
    `<div class="well">
      <h2>Goal</h2>
      <p>Each player commands a squad of machines led by their King, <b>Mr. Sludgy</b> (you can rename yours at setup). Destroy the enemy King to win. Lose yours and you lose immediately.</p>
      <h2>The Battlefield</h2>
      <p>A 12×12 grid split into four 6×6 quadrants. <b>Q1</b> (top-left) is Player 1's home, <b>Q4</b> (bottom-right) is Player 2's home.
      <b>Q2</b> (top-right) holds the portal in its far corner. <b>Q3</b> (bottom-left) is open street.</p>
      <h2>The Portal & Industrial Dimension</h2>
      <ul>
        <li>Move a machine onto the portal to warp it to the <b>Industrial Dimension</b>, a second 12×12 battlefield. It keeps its HP, statuses and owner.</li>
        <li>Inside, the same rules apply: move, attack diagonally, abilities. Areas only reach machines on the same battlefield.</li>
        <li>Step on the dimension's portal (bottom-left) to return. Use the tabs above the board to switch views.</li>
        <li>If a player keeps machines in the dimension for <b>${DIMENSION.summonAfterTurns} turns</b> while the opponent has none there, the opponent must send machines in. They choose which ones.</li>
        <li>Spawning, turrets, repair stations and traps exist only on the main battlefield ${PROV}. The dimension has no fog ${PROV}.</li>
      </ul>
      <h2>Industrial Research & Unlocks</h2>
      <ul>
        <li>End your turn with at least one machine in the Industrial Dimension to earn <b>${INDUSTRIAL.researchPerTurn} research</b> ${PROV}.</li>
        <li>Research unlocks Industrial machines (Welder, Juggernaut, Crusher) and spawnables (Conveyor Belt, Tesla Generator, Drone Dock, Overload Mine) for the rest of the match. Thresholds are in the tables below ${PROV}.</li>
        <li>Unlocked items appear in the <b>Industrial</b> section of the spawn menu and are placed in your home quadrant on the main battlefield, never inside the dimension.</li>
        <li>Conveyor Belt: pick its direction before placing (arrow buttons or the R key). Drone Dock: select it to reassign its drone.</li>
      </ul>
      <h2>Your Turn</h2>
      <ul>
        <li>Gain <b>${RULES.spPerTurn} SP</b> at the start of your turn. You start with <b>${RULES.startingPoints} points</b> and 0 SP.</li>
        <li>Gain <b>${RULES.pointsPerTurn} point</b> at the end of your turn.</li>
        <li>Take <b>one action</b>: move one machine or attack with one machine.</li>
        <li><b>Spawning is free</b>: buy machines and spawnables with points, anytime, on empty tiles of your home quadrant.</li>
        <li>SP abilities do not use your action ${PROV}. Medic's Repair does ${PROV}.</li>
        <li>Press <b>End Turn</b>. With fog of war on, pass the device when prompted.</li>
      </ul>
      <h2>Movement & Combat</h2>
      <ul>
        <li>Machines move <b>1 square orthogonally</b>. Scouts move up to ${ABILITY_VALUES.quickstepRange}.</li>
        <li>Machines attack <b>diagonally</b>, up to <b>${RULES.attackRange} squares</b> away. A hit deals <b>${RULES.attackDamage}</b>. Machines have <b>${RULES.machineHp} HP</b>.</li>
        <li>Click a machine, then a cyan tile to move or a red crosshair to attack. Right-click or Esc cancels.</li>
      </ul>
      <h2>Machines</h2>
      <table><tr><th></th><th>Machine</th><th>Regular ability</th><th>SP ability</th></tr>${machineRows}</table>
      <h2>Spawnables</h2>
      <table><tr><th></th><th>Object</th><th>Effect</th></tr>${structRows}</table>
      <p>Turret: range ${TURRET.range}, ${TURRET.damage} damage. Repair Station: range ${REPAIR_STATION.range}, +${REPAIR_STATION.heal} HP. Shock Trap: ${SHOCK_TRAP.damage} damage. All ${PROV}.</p>
      <h2>Provisional Rules</h2>
      <p>Values marked ${PROV} are not final. Area abilities must include the caster's tile. Overcharge powers your next attack with any machine. Summoned machines arrive near the top-right corner of the dimension. Phantom always lands on the main battlefield.</p>
    </div>
    <div class="row-end"><button class="btn" data-go="menu">Back</button></div>`,
    { cls: 'help', close: true },
  );
  wireGo(root, go);
}

let settingsTab = 'audio';
const TABS: [string, string][] = [['audio', 'Audio'], ['animation', 'Animation'], ['display', 'Display'], ['gameplay', 'Gameplay']];

export function settingsScreen(root: HTMLElement, go: Go, settings: Settings, save: (s: Settings) => void) {
  const vol = (key: keyof Settings, label: string) => `
    <label class="slider"><span>${label}</span>
      <input type="range" min="0" max="100" step="1" value="${settings[key]}" data-vol="${key}" aria-label="${label} volume" />
      <output>${settings[key]}</output></label>`;
  const opt = (key: keyof Settings, label: string, hint: string) => `
    <label class="radio"><input type="checkbox" data-key="${key}" ${settings[key] ? 'checked' : ''} />
      <span><b>${label}</b><small>${hint}</small></span></label>`;
  const choice = (key: keyof Settings, legend: string, items: [Level | Speed, string, string][]) => `
    <fieldset class="choice"><legend>${legend}</legend>${items
      .map(([v, label, hint]) => `<label class="radio"><input type="radio" name="${key}" value="${v}" data-enum="${key}" ${settings[key] === v ? 'checked' : ''} />
        <span><b>${label}</b><small>${hint}</small></span></label>`)
      .join('')}</fieldset>`;
  const panels: Record<string, () => string> = {
    audio: () => `${vol('masterVolume', 'Master')}${vol('musicVolume', 'Music')}${vol('sfxVolume', 'Sound effects')}${vol('ambienceVolume', 'Ambience')}
      ${opt('muted', 'Mute all', 'Silence every sound without losing your volume levels.')}`,
    animation: () => `
      ${opt('reducedMotion', 'Reduced motion', 'Turn off effect animations, screen shake, banners, portal transitions and moving backgrounds. Damage numbers still show.')}
      ${matchMedia('(prefers-reduced-motion: reduce)').matches ? '<p class="note">Your system asks for reduced motion, so effects stay off regardless of this switch.</p>' : ''}
      ${choice('animQuality', 'Animation quality', [
        ['high', 'High', 'Every effect: muzzle flashes, sparkles, armour glints, afterimages.'],
        ['medium', 'Medium', 'Destruction, impacts, spawns and abilities without the secondary flourishes.'],
        ['low', 'Low', 'Primary effects only, at half frame rate. Attacks land without a flying projectile.'],
      ])}
      ${choice('animSpeed', 'Animation speed', [
        ['slow', 'Slow', 'Effects play at 0.6×.'],
        ['normal', 'Normal', 'Effects play at 1×.'],
        ['fast', 'Fast', 'Effects play at 1.6×.'],
      ])}
      <p class="note">Animation settings never change turns, damage or any other rule.</p>`,
    display: () => `
      ${opt('crt', 'CRT scanlines', 'Subtle monitor lines over the screen.')}
      ${opt('ambientBackground', 'Ambient background animation', 'City traffic, flickering windows and the passing train behind the windows.')}
      ${opt('decorativeFx', 'Decorative effects', 'Screen shake, board flashes, turn and victory banners, fireworks.')}
      ${choice('boardDetail', 'Battlefield detail', [
        ['high', 'High', 'Animated battlefield art, structures and drones.'],
        ['medium', 'Medium', 'Animated battlefield art; structures hold still.'],
        ['low', 'Low', 'Static battlefield art.'],
      ])}
      <p class="note">Display options only change presentation. What you can see on the board, and fog of war, never change.</p>`,
    gameplay: () => `
      ${opt('passScreen', 'Pass-device screen', 'Cover the board between turns in hot-seat play (with fog of war on).')}
      <p class="note">Player names, King names, King abilities, fog of war and starting points are set on the New Match screen and remembered separately.</p>`,
  };
  const render = () => {
    root.innerHTML = windowHtml(
      'Settings',
      `<div class="tabs" role="tablist">${TABS.map(
        ([id, label]) => `<button class="tab ${settingsTab === id ? 'on' : ''}" role="tab" aria-selected="${settingsTab === id}" data-tab="${id}">${label}</button>`,
      ).join('')}</div>
       <div class="tabpanel" role="tabpanel">${panels[settingsTab]()}</div>
       <div class="row-end"><button class="btn" id="restore">Restore Defaults</button><button class="btn" data-go="gallery">Asset Viewer</button><button class="btn" data-go="menu">OK</button></div>`,
      { cls: 'settings-win', close: true },
    );
    root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) =>
      b.addEventListener('click', () => {
        settingsTab = b.dataset.tab!;
        render();
        root.querySelector<HTMLButtonElement>(`[data-tab="${settingsTab}"]`)?.focus();
      }),
    );
    root.querySelectorAll<HTMLInputElement>('input[data-vol]').forEach((i) =>
      i.addEventListener('input', () => {
        (settings as unknown as Record<string, number>)[i.dataset.vol!] = Number(i.value);
        i.parentElement!.querySelector('output')!.textContent = i.value;
        save(settings);
      }),
    );
    root.querySelectorAll<HTMLInputElement>('input[data-key]').forEach((i) =>
      i.addEventListener('change', () => {
        (settings as unknown as Record<string, boolean>)[i.dataset.key!] = i.checked;
        save(settings);
      }),
    );
    root.querySelectorAll<HTMLInputElement>('input[data-enum]').forEach((i) =>
      i.addEventListener('change', () => {
        (settings as unknown as Record<string, string>)[i.dataset.enum!] = i.value;
        save(settings);
      }),
    );
    root.querySelector('#restore')!.addEventListener('click', async () => {
      const ok = await messageBox('Restore Defaults', 'Reset every setting (audio, animation, display, gameplay) to its default?<br/><small>Your last match setup is kept.</small>', ['Restore', 'Cancel']);
      if (ok !== 0) return;
      save({ ...DEFAULT_SETTINGS });
      render();
    });
    wireGo(root, go);
  };
  render();
}

export function galleryScreen(root: HTMLElement, go: Go) {
  const fig = (label: string, ...urls: string[]) => `<figure>${urls.map((u) => `<img src="${u}" alt="" />`).join('')}<figcaption>${label}</figcaption></figure>`;
  const machines = (Object.keys(MACHINE_SPRITES) as MachineKind[]).map((k) => fig(MACHINES[k].name, spriteUrl(MACHINE_SPRITES[k], 0), spriteUrl(MACHINE_SPRITES[k], 1))).join('');
  const structs = (Object.keys(STRUCTURE_SPRITES) as StructureKind[]).map((k) => fig(STRUCTURES[k].name, spriteUrl(STRUCTURE_SPRITES[k], 0), spriteUrl(STRUCTURE_SPRITES[k], 1))).join('');
  const env = fig('Portal', spriteUrl(PORTAL_SPRITE), spriteUrl(PORTAL_SPRITE, 'neutral', PORTAL_FRAME2)) +
    fig('Industrial Portal', spriteUrl(DIM_PORTAL_SPRITE), spriteUrl(DIM_PORTAL_SPRITE, 'neutral', PORTAL_FRAME2)) +
    fig('Repair Drone', spriteUrl(DRONE_SPRITE, 0), spriteUrl(DRONE_SPRITE, 1)) +
    fig('Overload Mine (activated)', spriteUrl(MINE_BURST_SPRITE)) +
    (Object.entries(STRUCTURE_FRAME2) as [StructureKind, object][])
      .map(([k, f]) => fig(`${STRUCTURES[k].name} · frames`, spriteUrl(STRUCTURE_SPRITES[k], 0), 'pixels' in f ? spriteUrl(f as never, 0) : spriteUrl(STRUCTURE_SPRITES[k], 0, f as Record<string, string>)))
      .join('') +
    Object.entries(ICONS).map(([k, s]) => fig(k, spriteUrl(s))).join('');
  const maps = `<h2>Battlefields</h2><figure class="mapfig"><img src="${boardMapUrl(0, 0)}" alt="" /><figcaption>Main Battlefield</figcaption></figure>
    <figure class="mapfig"><img src="${boardMapUrl(1, 0)}" alt="" /><figcaption>Industrial Dimension</figcaption></figure>
    <h2>Industrial Dimension · animation frames</h2>${Array.from({ length: INDUSTRIAL_FRAMES }, (_, f) => `<figure class="mapfig small"><img src="${boardMapUrl(1, f)}" alt="" /><figcaption>Frame ${f + 1}</figcaption></figure>`).join('')}`;
  const tileFig = (set: Record<string, string[]>, colors: Record<string, string>, prefix: string) =>
    Object.keys(set).filter((k) => !k.endsWith('_2')).map((k) => fig(k, spriteUrl({ name: `${prefix}:${k}:g`, pixels: set[k], colors }))).join('');
  const tiles = `<h2>City tiles</h2>${tileFig(CITY_TILES, cityTile(0, 0, 0).colors!, 'gc')}`;
  root.innerHTML = windowHtml(
    'Asset Viewer · src/assets',
    `<div class="well"><h2>Machines (P1 / P2)</h2>${machines}<h2>Spawnables</h2>${structs}<h2>Environment & UI</h2>${env}${maps}${tiles}</div>
     <div class="row-end"><button class="btn" data-go="settings">Back</button></div>`,
    { cls: 'gallery', close: true },
  );
  wireGo(root, go, 'settings');
}
