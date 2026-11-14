import type { Sprite } from '../../render.ts';

export const droneDock: Sprite = {
  name: 'Drone Dock',
  pixels: [
    '.......c........',
    '.......k........',
    '.......k........',
    '...kkkkkkkkkk...',
    '..kllllllllllk..',
    '.kllkkkkkkkkllk.',
    '.klkTTddddTTklk.',
    '.klkTddyyddTklk.',
    '.klkddyddyddklk.',
    '.klkddyddyddklk.',
    '.klkTddyyddTklk.',
    '.klkTTddddTTklk.',
    '.kllkkkkkkkkllk.',
    '.kmmmmmmmmmmmmk.',
    '..kddddddddddk..',
    '...kkkkkkkkkk...',
  ],
};

// The repair drone, drawn hovering over the machine it follows.
export const drone: Sprite = {
  name: 'Repair Drone',
  pixels: [
    '................',
    '.kkk........kkk.',
    'kmmmk......kmmmk',
    '.kkk.k....k.kkk.',
    '......k..k......',
    '.....kkkkkk.....',
    '....kTTTTTTk....',
    '....kTccccTk....',
    '....kTcwwcTk....',
    '....kTTTTTTk....',
    '.....kkkkkk.....',
    '......k..k......',
    '.kkk.k....k.kkk.',
    'kmmmk......kmmmk',
    '.kkk........kkk.',
    '......g..g......',
  ],
};
