import type { Sprite } from '../../render.ts';

// Armed state; the core blinks with MINE_BLINK. Activated state is the burst.
export const overloadMine: Sprite = {
  name: 'Overload Mine',
  pixels: [
    '................',
    '................',
    '................',
    '.......kk.......',
    '......kkkk......',
    '....kkmllmkk....',
    '...kmlTTTTlmk...',
    '..kmlTkrrkTlmk..',
    '..kmlTkrrkTlmk..',
    '...kmlTTTTlmk...',
    '....kkmddmkk....',
    '......kkkk......',
    '.......kk.......',
    '................',
    '................',
    '................',
  ],
};

export const MINE_BLINK = { r: 'R' };

export const mineBurst: Sprite = {
  name: 'Overload Mine (activated)',
  pixels: [
    '.......cc.......',
    '.......cc.......',
    '...c...cc...c...',
    '..cc.w.o.o..cc..',
    '...wo.oyy.oy....',
    '.....yyyyyyow...',
    '....oywwwwy.o...',
    'cccoyywwwwyy.ccc',
    'ccc.yywwwwyyoccc',
    '...owywwwwyo....',
    '..w.oyyyyyy..w..',
    '....yo.yyo.o....',
    '..cc..o.ow..cc..',
    '...c...cc...c...',
    '.......cc.......',
    '.......cc.......',
  ],
};
