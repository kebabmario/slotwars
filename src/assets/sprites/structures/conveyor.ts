import type { Sprite } from '../../render.ts';

// Faces east; the board rotates it for other directions. Team-coloured chevrons show the flow.
export const conveyor: Sprite = {
  name: 'Conveyor Belt',
  pixels: [
    'kkkkkkkkkkkkkkkk',
    'lmlmlmlmlmlmlmlm',
    'kkkkkkkkkkkkkkkk',
    'dddkdddkdddkdddk',
    'dTLkdddkdTLkdddk',
    'ddTLdddkddTLdddk',
    'dddTLddkdddTLddk',
    'dddkTLdkdddkTLdk',
    'dddkTLdkdddkTLdk',
    'dddTLddkdddTLddk',
    'ddTLdddkddTLdddk',
    'dTLkdddkdTLkdddk',
    'dddkdddkdddkdddk',
    'kkkkkkkkkkkkkkkk',
    'lmlmlmlmlmlmlmlm',
    'kkkkkkkkkkkkkkkk',
  ],
};

export const conveyorFrame2: Sprite = {
  name: 'Conveyor Belt (frame 2)',
  pixels: [
    'kkkkkkkkkkkkkkkk',
    'lmlmlmlmlmlmlmlm',
    'kkkkkkkkkkkkkkkk',
    'dkdddkdddkdddkdd',
    'dkdTLkdddkdTLkdd',
    'dkddTLdddkddTLdd',
    'dkdddTLddkdddTLd',
    'dkdddkTLdkdddkTL',
    'dkdddkTLdkdddkTL',
    'dkdddTLddkdddTLd',
    'dkddTLdddkddTLdd',
    'dkdTLkdddkdTLkdd',
    'dkdddkdddkdddkdd',
    'kkkkkkkkkkkkkkkk',
    'lmlmlmlmlmlmlmlm',
    'kkkkkkkkkkkkkkkk',
  ],
};
