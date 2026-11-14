import './style.css';
import { Cityscape } from './ui/cityscape.ts';
import { GameScreen, type MatchOptions } from './ui/game.ts';
import { galleryScreen, howToScreen, menuScreen, settingsScreen, setupScreen } from './ui/screens.ts';
import { loadSettings, saveSettings, type Settings } from './settings.ts';
import { audio } from './audio/audio.ts';
import { motion, setMotion } from './ui/motion.ts';
import { TutorialRun, tutorialMenu } from './ui/tutorial.ts';
import { accountScreen } from './ui/account.ts';
import { onlineMatch } from './ui/lobby.ts';

const root = document.getElementById('app')!;
const city = new Cityscape(document.getElementById('city') as HTMLCanvasElement);
const settings = loadSettings();
let game: GameScreen | null = null;
let tutorial: TutorialRun | null = null;
let match: { destroy(): void } | null = null;

function applySettings(s: Settings) {
  setMotion({ quality: s.animQuality, speed: s.animSpeed, reduced: s.reducedMotion, decorative: s.decorativeFx });
  const b = document.body;
  b.classList.toggle('crt', s.crt);
  b.classList.toggle('reduce-motion', motion.reduced());
  for (const d of ['low', 'medium', 'high']) b.classList.toggle(`detail-${d}`, s.boardDetail === d);
  b.style.setProperty('--fx-speed', String(motion.speed()));
  city.animate = s.ambientBackground && !motion.reduced();
  audio.setPrefs({ master: s.masterVolume / 100, music: s.musicVolume / 100, sfx: s.sfxVolume / 100, ambience: s.ambienceVolume / 100, muted: s.muted });
}

// UI feedback for every Win95 button outside the board (board tiles have their own game sounds).
const UI_BUTTONS = '.btn, .menubar button, .tb-btn, .dimtab';
document.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>(UI_BUTTONS);
  // navigation buttons get the ui_nav sound from go() instead
  if (b && !b.disabled && !b.closest('.board') && !b.matches('[data-go], [data-act="close"]')) audio.play('ui_click');
});
let hovered: Element | null = null;
document.addEventListener('pointerover', (e) => {
  const b = (e.target as HTMLElement).closest(UI_BUTTONS);
  if (b !== hovered) {
    hovered = b;
    if (b && !(b as HTMLButtonElement).disabled) audio.play('ui_hover');
  }
});
let screen = '';
applySettings(settings);

function go(next: string, data?: unknown) {
  if (screen && next !== screen) audio.play('ui_nav');
  screen = next;
  game?.destroy();
  game = null;
  match?.destroy();
  match = null;
  tutorial?.destroy();
  tutorial = null;
  if (next !== 'game' && next !== 'tutorial-run') {
    // Menu screens share the menu theme over the city ambience.
    audio.setMusic('music_menu');
    audio.setAmbience('amb_city');
  }
  route(next, data);
}

function route(screen: string, data?: unknown) {
  city.dim = screen !== 'menu';
  if (screen === 'menu') menuScreen(root, go);
  else if (screen === 'setup') setupScreen(root, go);
  else if (screen === 'howto') howToScreen(root, go);
  else if (screen === 'tutorial') tutorialMenu(root, go);
  else if (screen === 'tutorial-run') tutorial = new TutorialRun(root, settings, go, Number(data) || 0);
  else if (screen === 'gallery') galleryScreen(root, go);
  else if (screen === 'online') void accountScreen(root, go);
  else if (screen === 'online-match') match = onlineMatch(root, go, settings, String(data));
  else if (screen === 'settings')
    settingsScreen(root, go, settings, (s) => {
      Object.assign(settings, s); // restore-defaults hands over a fresh object
      saveSettings(settings);
      applySettings(settings);
    });
  else if (screen === 'game') {
    const opts = data as MatchOptions;
    game = new GameScreen(root, opts, settings, go);
  }
}

go('menu');
