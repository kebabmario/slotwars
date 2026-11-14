// Asset registry. Swap any sprite file to restyle a piece without touching game code.
import type { MachineKind, StructureKind } from '../../game/types.ts';
import type { Sprite } from '../render.ts';
import { sludgy } from './machines/sludgy.ts';
import { scout } from './machines/scout.ts';
import { defender } from './machines/defender.ts';
import { striker } from './machines/striker.ts';
import { saboteur } from './machines/saboteur.ts';
import { breacher } from './machines/breacher.ts';
import { medic } from './machines/medic.ts';
import { taxer } from './machines/taxer.ts';
import { juggernaut } from './machines/juggernaut.ts';
import { welder } from './machines/welder.ts';
import { crusher } from './machines/crusher.ts';
import { conveyor, conveyorFrame2 } from './structures/conveyor.ts';
import { teslaGenerator, teslaFrame2 } from './structures/tesla-generator.ts';
import { droneDock, drone } from './structures/drone-dock.ts';
import { overloadMine, mineBurst, MINE_BLINK } from './structures/overload-mine.ts';
import { barricade } from './structures/barricade.ts';
import { turret } from './structures/turret.ts';
import { repairStation } from './structures/repair-station.ts';
import { shockTrap } from './structures/shock-trap.ts';
import { portal, industrialPortal } from './environment/portal.ts';
import { explosionIcon, heartIcon, pointIcon, spIcon, lockIcon, researchIcon } from './ui/icons.ts';

export const MACHINE_SPRITES: Record<MachineKind, Sprite> = { sludgy, scout, defender, striker, saboteur, breacher, medic, taxer, juggernaut, welder, crusher };
export const STRUCTURE_SPRITES: Record<StructureKind, Sprite> = {
  barricade, turret, repair: repairStation, trap: shockTrap,
  conveyor, tesla: teslaGenerator, dock: droneDock, mine: overloadMine,
};
/** Second animation frame per structure: a full sprite, or a colour swap applied to the first frame. */
export const STRUCTURE_FRAME2: Partial<Record<StructureKind, Sprite | Record<string, string>>> = {
  conveyor: conveyorFrame2, tesla: teslaFrame2, mine: MINE_BLINK,
};
export const DRONE_SPRITE = drone;
export const MINE_BURST_SPRITE = mineBurst;
export const PORTAL_SPRITE = portal;
export const DIM_PORTAL_SPRITE = industrialPortal;
// Second portal frame: swap glow letters for a swirl effect.
export const PORTAL_FRAME2 = { c: 'p', p: 'c', w: 'P', P: 'w' };
export const ICONS = { point: pointIcon, sp: spIcon, heart: heartIcon, explosion: explosionIcon, lock: lockIcon, research: researchIcon };
export { CITY_TILES } from './environment/city-tiles.ts';
export { cityTile, CITY_LAYOUT, CITY_QUADRANT_COLORS } from './environment/maps.ts';
export { drawIndustrialMap, INDUSTRIAL_FRAMES, IND } from './environment/industrial-map.ts';
