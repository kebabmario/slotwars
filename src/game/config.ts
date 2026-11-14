// Slot Wars rules configuration.
// Values marked CONFIRMED come from the design brief.
// Values marked PROVISIONAL are placeholders: tune them here, nothing else needs to change.

import type { KingAbility, MachineKind, StructureKind } from './types.ts';

export const BOARD_SIZE = 12; // CONFIRMED: 12x12
export const QUADRANT_SIZE = 6; // CONFIRMED: four 6x6 quadrants

export const RULES = {
  startingPoints: 3, // CONFIRMED
  startingSp: 0, // CONFIRMED
  spPerTurn: 2, // CONFIRMED, granted at the start of each of your turns
  pointsPerTurn: 1, // CONFIRMED by design owner: +1 point at the end of each turn
  machineHp: 50, // CONFIRMED
  attackDamage: 25, // CONFIRMED
  attackRange: 2, // CONFIRMED: diagonal, up to 2 squares
  fogOfWar: true, // PROVISIONAL: implied by Scout's Spotter ability. Toggle in Settings.
  // PROVISIONAL: SP abilities do not use the turn's one action (the brief only says move OR attack).
  spAbilitiesUseAction: false,
  // PROVISIONAL: Medic's Repair is a targeted ability, so it uses the turn's action.
  repairUsesAction: true,
  // PROVISIONAL: machines can attack enemy turrets and repair stations. Barricades need a Breacher (CONFIRMED).
  structuresAttackable: true,
  // PROVISIONAL: area abilities (2x2, 3x3, 4x4) must include the caster's own tile.
  areaMustContainCaster: true,
  // PROVISIONAL: overcharge applies to the player's next attack with any machine.
  overchargeScope: 'player' as 'player' | 'self',
  // PROVISIONAL: starting tile of each Mr. Sludgy. [row, col]
  portalPos: [0, 11] as [number, number], // CONFIRMED: farthest corner of Q2
  kingStart: [
    [1, 1],
    [10, 10],
  ] as [number, number][],
};

export const KING_DEFAULT_NAME = 'Mr. Sludgy';
export const KING_NAME_MAX = 16;

// Industrial dimension: a second 12x12 battlefield reached through the portal.
export const DIMENSION = {
  portalPos: [11, 0] as [number, number], // PROVISIONAL: dimension-side portal tile (bottom-left corner)
  summonAfterTurns: 3, // CONFIRMED: opponent is pulled in after 3 turns
  summonArrival: [0, 11] as [number, number], // PROVISIONAL: summoned machines appear near the opposite corner
  fog: false, // PROVISIONAL: the dimension is always fully visible
};

export interface MachineDef {
  name: string;
  cost: number | null; // null = cannot be purchased
  hp?: number; // defaults to RULES.machineHp
  industrial?: boolean; // must be unlocked through Industrial research
  passive: { name: string; text: string };
  special: { key: string; name: string; sp: number; text: string; target: AbilityTarget } | null;
}

export type AbilityTarget =
  | { type: 'instant' }
  | { type: 'area'; size: number }
  | { type: 'tile' } // Phantom: pick a free tile
  | { type: 'quadrant' } // Spotter: pick a quadrant
  | { type: 'ally'; range: number }; // Repair: pick a friendly machine

export const MACHINES: Record<MachineKind, MachineDef> = {
  sludgy: {
    name: 'Mr. Sludgy', // canonical King; players may rename theirs (cosmetic only)
    cost: null,
    passive: { name: 'King', text: 'If your King is destroyed, you lose.' },
    special: null, // comes from the King ability chosen at setup
  },
  scout: {
    name: 'Scout',
    cost: 1,
    passive: { name: 'Quickstep', text: 'Moves up to 2 squares instead of 1.' },
    special: {
      key: 'spotter',
      name: 'Spotter',
      sp: 4,
      text: 'Reveals one quadrant you cannot see, traps included, for this turn.',
      target: { type: 'quadrant' },
    },
  },
  defender: {
    name: 'Defender',
    cost: 2,
    passive: { name: 'Fortify', text: 'Takes 5 less damage from every hit.' },
    special: {
      key: 'shieldwall',
      name: 'Shield Wall',
      sp: 5,
      text: 'Friendly machines in a 2x2 area take 10 less damage until your next turn.',
      target: { type: 'area', size: 2 },
    },
  },
  striker: {
    name: 'Striker',
    cost: 3,
    passive: { name: 'Heavy Hit', text: 'Attacks deal 30 damage instead of 25.' },
    special: {
      key: 'doublestrike',
      name: 'Double Strike',
      sp: 6,
      text: 'This Striker may attack twice this turn.',
      target: { type: 'instant' },
    },
  },
  saboteur: {
    name: 'Saboteur',
    cost: 5,
    passive: { name: 'Jammer', text: "Hits disable the target's regular ability for 1 turn." },
    special: {
      key: 'systemfailure',
      name: 'System Failure',
      sp: 7,
      text: 'Enemy machines in a 3x3 area cannot act on their next turn.',
      target: { type: 'area', size: 3 },
    },
  },
  breacher: {
    name: 'Breacher',
    cost: 6,
    passive: { name: 'Breaching', text: 'Can attack and destroy barricades.' },
    special: {
      key: 'hulksmash',
      name: 'Hulk Smash',
      sp: 6,
      text: 'Deals 10 damage to every other machine in a 4x4 area. Friendly fire applies.',
      target: { type: 'area', size: 4 },
    },
  },
  medic: {
    name: 'Medic',
    cost: 7,
    passive: { name: 'Repair', text: 'Uses the action: restore 5 HP to a friendly machine within 1 square.' },
    special: {
      key: 'massrepair',
      name: 'Mass Repair',
      sp: 6,
      text: 'Restores 15 HP to all friendly machines in a 3x3 area.',
      target: { type: 'area', size: 3 },
    },
  },
  taxer: {
    name: 'Taxer',
    cost: 8,
    passive: { name: 'Interest', text: '+1 point at the end of your turn.' },
    special: {
      key: 'robbery',
      name: 'Point Robbery',
      sp: 6,
      text: 'Steals 1 point from the opponent.',
      target: { type: 'instant' },
    },
  },
  // ---- Industrial machines. Every number here is PROVISIONAL (see INDUSTRIAL_VALUES). ----
  juggernaut: {
    name: 'Juggernaut',
    cost: 6, // PROVISIONAL
    hp: 60, // PROVISIONAL
    industrial: true,
    passive: { name: 'Reinforced Plating', text: 'Takes 8 less damage from every hit.' },
    special: {
      key: 'barrier',
      name: 'Protective Barrier',
      sp: 6, // PROVISIONAL
      text: 'Friendly machines in a 3x3 area take 8 less damage until your next turn.',
      target: { type: 'area', size: 3 },
    },
  },
  welder: {
    name: 'Welder',
    cost: 4, // PROVISIONAL
    industrial: true,
    passive: { name: 'Repair', text: 'Uses the action: restore 8 HP to an orthogonally adjacent friendly machine.' },
    special: {
      key: 'reconstruct',
      name: 'Emergency Reconstruction',
      sp: 5, // PROVISIONAL
      text: 'Rebuilds a destroyed friendly barricade or repair station on its original tile, if that tile is free.',
      target: { type: 'tile' },
    },
  },
  crusher: {
    name: 'Crusher',
    cost: 7, // PROVISIONAL
    industrial: true,
    passive: { name: 'Demolition', text: 'Attacks deal +15 damage to enemy structures.' },
    special: {
      key: 'groundbreaker',
      name: 'Groundbreaker',
      sp: 6, // PROVISIONAL
      text: 'Deals 15 damage to every enemy machine around the Crusher (3x3).',
      target: { type: 'instant' },
    },
  },
};

// Every value below is PROVISIONAL.
export const INDUSTRIAL_VALUES = {
  platingReduction: 8,
  barrierReduction: 8,
  weldAmount: 8,
  weldUsesAction: true,
  reconstructNeedsMainBoard: true, // the Welder must stand on the main battlefield to rebuild
  demolitionBonus: 15,
  groundbreakerDamage: 15,
  groundbreakerFriendlyFire: false,
};

// Industrial research: unlocks industrial machines and spawnables for the rest of the match.
// Every value is PROVISIONAL. Unlocks last for the current match only (there is no save system yet).
export const INDUSTRIAL = {
  researchPerTurn: 1, // earned at the end of each own turn with at least one machine in the dimension
  unlocks: {
    welder: 1,
    conveyor: 1,
    mine: 2,
    tesla: 2,
    juggernaut: 3,
    dock: 3,
    crusher: 4,
  } as Record<string, number>,
};

export const ABILITY_VALUES = {
  quickstepRange: 2, // CONFIRMED
  fortifyReduction: 5, // CONFIRMED
  shieldWallReduction: 10, // CONFIRMED
  heavyHitDamage: 30, // CONFIRMED
  overchargeDamage: 50, // CONFIRMED
  hulkSmashDamage: 10, // CONFIRMED
  repairAmount: 5, // CONFIRMED
  repairRange: 1, // CONFIRMED
  massRepairAmount: 15, // CONFIRMED
  interestPoints: 1, // CONFIRMED
  robberyPoints: 1, // CONFIRMED
};

export interface KingDef {
  name: string;
  sp: number;
  text: string;
  target: AbilityTarget;
}

export const KING_ABILITIES: Record<KingAbility, KingDef> = {
  guardian: { name: 'Guardian', sp: 9, text: 'Your King blocks the next incoming attack.', target: { type: 'instant' } },
  overcharge: { name: 'Overcharge', sp: 9, text: 'Your next attack deals 50 damage instead of 25.', target: { type: 'instant' } },
  phantom: { name: 'Phantom', sp: 9, text: 'Your King teleports to a free square in your home quadrant (main battlefield).', target: { type: 'tile' } },
};

export interface StructureDef {
  name: string;
  industrial?: boolean; // must be unlocked through Industrial research
  attackable?: boolean; // machines can target it (barricades are handled by Breaching)
  hidden?: boolean; // invisible to the enemy, like traps
  cost: number; // PROVISIONAL for every structure
  hp: number; // PROVISIONAL
  solid: boolean; // blocks machine movement
  text: string;
}

// Every value in this table is PROVISIONAL.
export const STRUCTURES: Record<StructureKind, StructureDef> = {
  barricade: { name: 'Barricade', cost: 1, hp: 1, solid: false, text: 'Machines pass through. Absorbs one turret bullet. Only Breachers can destroy it.' },
  turret: { name: 'Turret', cost: 3, hp: 40, solid: true, attackable: true, text: 'Shoots the nearest enemy in range at the end of your turn.' },
  repair: { name: 'Repair Station', cost: 3, hp: 40, solid: true, attackable: true, text: 'Heals nearby friendly machines at the start of your turn.' },
  trap: { name: 'Shock Trap', cost: 2, hp: 1, solid: false, hidden: true, text: 'Hidden. Shocks the first enemy machine that enters its tile.' },
  // ---- Industrial spawnables ----
  conveyor: { name: 'Conveyor Belt', cost: 1, hp: 1, solid: false, industrial: true, text: 'At the end of every turn, pushes the machine on it one square in its direction.' },
  tesla: { name: 'Tesla Generator', cost: 4, hp: 30, solid: true, attackable: true, industrial: true, text: 'Generates +1 SP at the start of your turn while standing.' },
  dock: { name: 'Drone Dock', cost: 4, hp: 30, solid: true, attackable: true, industrial: true, text: 'Its drone follows a friendly machine and repairs it at the start of your turn.' },
  mine: { name: 'Overload Mine', cost: 3, hp: 1, solid: false, hidden: true, industrial: true, text: 'Hidden. Damages and jams the first enemy machine that enters, then disappears.' },
};

// Every value below is PROVISIONAL.
export const TURRET = {
  range: 3, // Chebyshev distance (square area around the turret)
  damage: 10,
  shotsPerTurn: 1,
  ownBarricadesBlock: false, // only enemy barricades stop a turret's bullet
  // Target order: closest first, then lowest HP, then oldest machine.
};

export const REPAIR_STATION = {
  range: 1, // Chebyshev distance
  heal: 5,
};

// Every value below is PROVISIONAL.
export const CONVEYOR = { pushEveryTurn: true }; // pushes at the end of each player's turn
export const TESLA = { spPerTurn: 1 };
export const DRONE = { heal: 5, followsIntoDimension: true };
export const OVERLOAD_MINE = { damage: 15, jamTurns: 1, singleUse: true };

export const SHOCK_TRAP = {
  damage: 20,
  singleUse: true,
  hiddenFromEnemy: true,
  stopsMovement: true, // a Scout passing through stops on the trap
};
