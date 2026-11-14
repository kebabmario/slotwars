import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MACHINE_SPRITES, STRUCTURE_SPRITES, STRUCTURE_FRAME2, DRONE_SPRITE, MINE_BURST_SPRITE, PORTAL_SPRITE, DIM_PORTAL_SPRITE, ICONS, cityTile, CITY_LAYOUT, drawIndustrialMap, INDUSTRIAL_FRAMES } from './sprites/index.ts';
import { validateSprite } from './render.ts';

test('every sprite is rectangular and uses known colors', () => {
  for (const s of [...Object.values(MACHINE_SPRITES), ...Object.values(STRUCTURE_SPRITES), PORTAL_SPRITE, DIM_PORTAL_SPRITE, DRONE_SPRITE, MINE_BURST_SPRITE, ...Object.values(ICONS)])
    validateSprite(s);
  for (const f of Object.values(STRUCTURE_FRAME2)) if (f && 'pixels' in f) validateSprite(f as never);
  for (const s of [...Object.values(MACHINE_SPRITES), ...Object.values(STRUCTURE_SPRITES)])
    if (s.pixels.length !== 16 || s.pixels[0].length !== 16) throw new Error(`${s.name} must be 16x16`);
});

test('main battlefield is 12x12 and every city tile resolves', () => {
  assert.equal(CITY_LAYOUT.length, 12);
  CITY_LAYOUT.forEach((row) => assert.equal(row.length, 12));
  for (const frame of [0, 1] as const)
    for (let r = 0; r < 12; r++) for (let c = 0; c < 12; c++) validateSprite(cityTile(r, c, frame));
});

/** Paints the industrial map into a 192x192 color buffer. */
function paintIndustrial(frame: number) {
  const px = new Array<string>(192 * 192).fill('');
  let outOfBounds = 0;
  const g = {
    fillStyle: '' as string,
    fillRect(x: number, y: number, w: number, h: number) {
      for (let j = y; j < y + h; j++)
        for (let i = x; i < x + w; i++) {
          if (i < 0 || j < 0 || i >= 192 || j >= 192) { outOfBounds++; continue; }
          px[j * 192 + i] = this.fillStyle;
        }
    },
  };
  drawIndustrialMap(g, frame);
  return { px, outOfBounds };
}

test('industrial map covers every pixel, stays in bounds, and animates', () => {
  const frames = Array.from({ length: INDUSTRIAL_FRAMES }, (_, f) => paintIndustrial(f));
  for (const { px, outOfBounds } of frames) {
    assert.equal(px.filter((c) => !c).length, 0, 'unpainted pixels');
    assert.equal(outOfBounds, 0, 'drawing must be clipped to the map');
    assert.ok(new Set(px).size >= 25, 'palette too flat');
  }
  for (let f = 1; f < INDUSTRIAL_FRAMES; f++) {
    const diff = frames[f].px.filter((c, i) => c !== frames[0].px[i]).length;
    assert.ok(diff > 200 && diff < 192 * 192 * 0.25, `frame ${f} changes ${diff} px`);
  }
});
