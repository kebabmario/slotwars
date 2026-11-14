// Small UI sprites: counters, HP, destruction effect.
import type { Sprite } from '../../render.ts';

export const pointIcon: Sprite = {
  name: 'point',
  pixels: [
    '..kkkk..',
    '.kyyyYk.',
    'kyywyyYk',
    'kyyYyyYk',
    'kyyYyyYk',
    'kyyyyYYk',
    '.kYYYYk.',
    '..kkkk..',
  ],
};

export const spIcon: Sprite = {
  name: 'sp',
  pixels: [
    '....kkk.',
    '...kcck.',
    '..kcck..',
    '.kccckk.',
    '.kkccck.',
    '..kcck..',
    '.kcck...',
    '.kkk....',
  ],
};

export const heartIcon: Sprite = {
  name: 'heart',
  pixels: [
    '.kk.kk..',
    'krrkrrk.',
    'krwrrRk.',
    'krrrrRk.',
    '.krrRk..',
    '..kRk...',
    '...k....',
    '........',
  ],
};

export const explosionIcon: Sprite = {
  name: 'explosion',
  pixels: [
    '................',
    '......o...y.....',
    '...y..oo.oo.....',
    '....ooyyoyo..o..',
    '..o.oyyyyyyoo...',
    '...oywwwwyyyo...',
    '..ooyywwwwyyo.o.',
    '.o.oyywwwwwyoo..',
    '..ooyyywwwyyyo..',
    '...oyyyywyyyoo..',
    '..o.ooyyyyyoo...',
    '....o.ooyoo..o..',
    '...o...oo.o.....',
    '.......o........',
    '................',
    '................',
  ],
};


export const lockIcon: Sprite = {
  name: 'lock',
  pixels: [
    '..kkkk..',
    '.kk..kk.',
    '.k....k.',
    'kkkkkkkk',
    'kyyyyyyk',
    'kyykkyyk',
    'kyyyyyyk',
    'kkkkkkkk',
  ],
};

export const researchIcon: Sprite = {
  name: 'research',
  pixels: [
    '..k..k..',
    '.kooook.',
    'koo..ook',
    '.o.kk.o.',
    '.o.kk.o.',
    'koo..ook',
    '.kooook.',
    '..k..k..',
  ],
};
