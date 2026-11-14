import type { Sprite } from '../../render.ts';

export const portal: Sprite = {
  name: 'Portal',
  pixels: [
    '................',
    '.....kkkkkk.....',
    '...kkppppppkk...',
    '..kppPPPPPPppk..',
    '.kpPPccccccPPpk.',
    '.kpPcwwwwwwcPpk.',
    'kpPcwwkkkkwwcPpk',
    'kpPcwkPPPPkwcPpk',
    'kpPcwkPPPPkwcPpk',
    'kpPcwwkkkkwwcPpk',
    '.kpPcwwwwwwcPpk.',
    '.kpPPccccccPPpk.',
    '..kppPPPPPPppk..',
    '...kkppppppkk...',
    '.....kkkkkk.....',
    '................',
  ],
};

// Same ring, re-glazed in molten orange for the industrial side.
export const industrialPortal: Sprite = {
  ...portal,
  name: 'Industrial Portal',
  colors: { p: '#ff9a3c', P: '#9e3a12', c: '#ffd23f', w: '#fff2b0' },
};
