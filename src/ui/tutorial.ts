// Interactive tutorial: an isolated GameScreen driven by lesson scripts, with a coach window.
// Nothing here touches match configuration or real matches; only tutorial progress is saved.
import { applyAction } from '../game/actions.ts';
import { MACHINE_SPRITES, STRUCTURE_SPRITES } from '../assets/sprites/index.ts';
import { spriteUrl, type Sprite } from '../assets/render.ts';
import type { Settings } from '../settings.ts';
import { GameScreen, type GuidedAction, type TutorialHooks } from './game.ts';
import { LESSONS, type Step } from './tutorial-lessons.ts';
import { messageBox, windowHtml } from './chrome.ts';
import { audio } from '../audio/audio.ts';

const KEY = 'slotwars.tutorial';
type Go = (screen: string, data?: unknown) => void;

export function loadTutorialProgress(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return Array.isArray(v.completed) ? v.completed.filter((x: unknown) => LESSONS.some((l) => l.id === x)) : [];
  } catch {
    return [];
  }
}
function saveTutorialProgress(completed: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ completed: [...new Set(completed)] }));
  } catch {
    /* storage blocked */
  }
}

/** Tutorial home: introduction, lesson list with completion marks, replay and restart. */
export function tutorialMenu(root: HTMLElement, go: Go) {
  const done = loadTutorialProgress();
  root.innerHTML = windowHtml(
    'Tutorial · Slot Wars',
    `<div class="msg"><img src="${spriteUrl(MACHINE_SPRITES.sludgy, 0)}" alt="" />
       <div>Learn Slot Wars by playing. Each lesson sets up a small practice battlefield and walks you through real moves.
       Nothing you do here affects your matches or saved match setup.</div></div>
     <div class="group"><span class="legend">Lessons · ${done.length}/${LESSONS.length} completed</span>
       <ol class="lesson-list">${LESSONS.map(
         (l, i) => `<li><span class="mark">${done.includes(l.id) ? '✔' : '·'}</span><b>${l.title}</b><small>${l.steps.length} steps</small>
           <button class="btn" data-lesson="${i}">${done.includes(l.id) ? 'Replay' : 'Start'}</button></li>`,
       ).join('')}</ol></div>
     <div class="row-end"><button class="btn" data-go="menu">Skip Tutorial</button><button class="btn" id="reset-tut">Restart Tutorial</button>
       <button class="btn big" id="start-tut">${done.length && done.length < LESSONS.length ? 'Continue' : 'Start Lesson 1'}</button></div>`,
    { cls: 'tutorial-menu', close: true },
  );
  root.querySelectorAll<HTMLElement>('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go!)));
  root.querySelector('[data-act="close"]')!.addEventListener('click', () => go('menu'));
  root.querySelectorAll<HTMLButtonElement>('[data-lesson]').forEach((b) => b.addEventListener('click', () => go('tutorial-run', Number(b.dataset.lesson))));
  root.querySelector('#start-tut')!.addEventListener('click', () => {
    const next = LESSONS.findIndex((l) => !done.includes(l.id));
    go('tutorial-run', next < 0 ? 0 : next);
  });
  root.querySelector('#reset-tut')!.addEventListener('click', () => {
    saveTutorialProgress([]);
    go('tutorial-run', 0);
  });
  root.querySelector<HTMLButtonElement>('#start-tut')!.focus();
}

/** One tutorial session. Implements the GameScreen hooks that gate and observe player actions. */
export class TutorialRun implements TutorialHooks {
  private game: GameScreen;
  private panel: HTMLElement;
  private lesson = 0;
  private step = 0;
  private completedSteps = new Set<string>();
  private advancing = false;
  private go: Go;

  constructor(root: HTMLElement, settings: Settings, go: Go, lesson: number) {
    this.go = go;
    // isolated copy of the settings: no pass-device screen in a solo lesson
    const local = { ...settings, passScreen: false };
    this.panel = document.createElement('section');
    this.panel.className = 'window coach';
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-label', 'Tutorial');
    this.panel.addEventListener('click', (e) => this.onPanel(e));
    this.game = new GameScreen(root, { kings: ['guardian', 'overcharge'], names: ['Mr. Sludgy', 'Mr. Sludgy'], fog: false }, local, go, this);
    // docked in the game window where the log normally sits, so it never covers the board or End Turn
    this.game.element.querySelector('.game .log')!.after(this.panel);
    this.startLesson(lesson);
  }

  destroy() {
    this.panel.remove();
    this.game.destroy();
  }

  private get current(): Step {
    return LESSONS[this.lesson].steps[this.step];
  }
  private stepKey(l = this.lesson, s = this.step) {
    return `${l}:${s}`;
  }

  private startLesson(i: number) {
    this.lesson = Math.max(0, Math.min(LESSONS.length - 1, i));
    this.step = 0;
    this.game.loadState(LESSONS[this.lesson].setup(), 0);
    this.enterStep();
  }

  private enterStep() {
    const st = this.current;
    if (st.view !== undefined) this.game.setView(st.view);
    this.renderPanel();
    this.afterRender();
    this.panel.scrollIntoView({ block: 'nearest' }); // keep the instructions on screen with minimal scrolling
  }

  // ---------- GameScreen hooks ----------
  allow(a: GuidedAction): boolean {
    const st = this.current, s = this.game.state;
    if (this.completedSteps.has(this.stepKey())) return false; // step already done: wait for Next
    return !!(st.expect?.(a, s) || st.allow?.(a, s));
  }

  done(a: GuidedAction) {
    const st = this.current, s = this.game.state;
    if (!st.expect?.(a, s) || this.completedSteps.has(this.stepKey())) return;
    this.completedSteps.add(this.stepKey());
    if (st.passOpponent && s.current === 1 && s.winner === null) {
      applyAction(s, 1, { t: 'endTurn' }); // the tutorial rival passes its turn, using the normal turn rules
      this.game.refresh();
    }
    audio.play('unlock', { volume: 0.5 });
    this.renderPanel();
    // move on automatically after a beat; Next works too
    const key = this.stepKey();
    setTimeout(() => {
      if (this.stepKey() === key) this.next();
    }, 900);
  }

  afterRender() {
    if (!this.game) return; // GameScreen renders once inside its own constructor
    const root = this.game.element;
    root.querySelectorAll('.tut-hl, .tut-arrow').forEach((e) => e.classList.remove('tut-hl', 'tut-arrow'));
    const st = LESSONS[this.lesson]?.steps[this.step];
    if (!st || this.completedSteps.has(this.stepKey())) return;
    const targets: Element[] = [];
    const showTiles = st.view === undefined || st.view === this.game.view;
    if (showTiles) for (const p of st.tiles?.(this.game.state) ?? []) {
      const t = root.querySelector(`.tile[data-r="${p.r}"][data-c="${p.c}"]`);
      if (t) targets.push(t);
    }
    for (const sel of st.ui ?? []) root.querySelectorAll(sel).forEach((e) => targets.push(e));
    targets.forEach((e) => e.classList.add('tut-hl'));
    targets[0]?.classList.add('tut-arrow');
  }

  exit() {
    void messageBox('Exit Tutorial', 'Leave the tutorial? Lessons you finished stay marked as complete.', ['Exit', 'Stay']).then((i) => {
      if (i === 0) this.go('tutorial');
    });
  }

  // ---------- coach window ----------
  private next() {
    if (this.advancing) return;
    const lesson = LESSONS[this.lesson];
    if (this.current.expect && !this.completedSteps.has(this.stepKey())) return;
    if (this.step < lesson.steps.length - 1) {
      this.step++;
      return this.enterStep();
    }
    // lesson finished
    this.advancing = true;
    const done = loadTutorialProgress();
    saveTutorialProgress([...done, lesson.id]);
    const last = this.lesson === LESSONS.length - 1;
    void messageBox(
      last ? 'Tutorial Complete' : 'Lesson Complete',
      last ? '<b>You finished every lesson.</b> You are ready for a real match.' : `<b>${lesson.title}</b> complete! Next: <b>${LESSONS[this.lesson + 1].title}</b>.`,
      last ? ['Main Menu', 'Tutorial Menu'] : ['Next Lesson', 'Tutorial Menu'],
      spriteUrl(MACHINE_SPRITES.sludgy, 0),
    ).then((i) => {
      this.advancing = false;
      if (last) return this.go(i === 0 ? 'menu' : 'tutorial');
      if (i === 0) this.startLesson(this.lesson + 1);
      else this.go('tutorial');
    });
  }

  private back() {
    if (this.step === 0) return;
    this.step--;
    this.enterStep();
  }

  private onPanel(e: Event) {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b || b.disabled || this.game.isBusy) return;
    const act = b.dataset.coach;
    if (act === 'next') this.next();
    if (act === 'back') this.back();
    if (act === 'skip') {
      if (this.lesson < LESSONS.length - 1) this.startLesson(this.lesson + 1);
      else this.go('tutorial');
    }
    if (act === 'exit') this.exit();
  }

  private renderPanel() {
    const lesson = LESSONS[this.lesson], st = this.current, n = lesson.steps.length;
    const interactive = !!st.expect, done = this.completedSteps.has(this.stepKey());
    const iconSprite = st.icon ? ((MACHINE_SPRITES as Record<string, Sprite>)[st.icon] ?? (STRUCTURE_SPRITES as Record<string, Sprite>)[st.icon]) : undefined;
    const dots = lesson.steps
      .map((_, i) => `<i class="${i < this.step || this.completedSteps.has(this.stepKey(this.lesson, i)) ? 'done' : ''} ${i === this.step ? 'cur' : ''}"></i>`)
      .join('');
    this.panel.innerHTML = `
      <div class="titlebar"><img src="${spriteUrl(MACHINE_SPRITES.sludgy, 0)}" alt="" />
        <span class="title">Tutorial · Lesson ${this.lesson + 1}/${LESSONS.length}: ${lesson.title}</span>
        <button class="tb-btn" data-coach="exit" aria-label="Exit tutorial">×</button></div>
      <div class="body">
        <div class="coach-progress" aria-label="Step ${this.step + 1} of ${n}"><span class="dots">${dots}</span><small>Step ${this.step + 1}/${n}</small></div>
        <div class="coach-text">${iconSprite ? `<img src="${spriteUrl(iconSprite, 0)}" alt="" />` : ''}<p>${st.text}</p></div>
        ${interactive ? `<div class="coach-task ${done ? 'ok' : ''}" aria-live="polite">${done ? '✔ Well done!' : `▶ ${st.task}`}</div>` : ''}
        <div class="row-end coach-buttons">
          <button class="btn" data-coach="back" ${this.step === 0 ? 'disabled' : ''}>◀ Back</button>
          <button class="btn" data-coach="skip">Skip Lesson</button>
          <button class="btn" data-coach="exit">Exit Tutorial</button>
          <button class="btn big" data-coach="next" ${interactive && !done ? 'disabled' : ''}>${this.step === n - 1 ? 'Finish ✔' : 'Next ▶'}</button>
        </div>
      </div>`;
  }
}
