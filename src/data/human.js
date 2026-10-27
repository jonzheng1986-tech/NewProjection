import { SHOP_STOCK } from './items.js';

// Human Alliance definitions, following Warcraft III stats closely.
// Distances are in world units (32 per terrain tile); ranges have been scaled
// from WC3's units to the tile scale used here.

const U = (o) => ({
  kind: 'unit', race: 'human', armorType: 'light', attackType: 'normal',
  range: 70, cooldown: 1.5, speed: 270, sight: 500, food: 1,
  cost: { gold: 0, lumber: 0 }, buildTime: 20, radius: 10, tier: 1,
  requires: [], abilities: [], tags: [], projectile: null, hero: false,
  art: { weapon: 'sword', shield: false, helmet: false, robe: false, mount: false, bulk: 1, hat: null },
  ...o,
});

export const UNITS = {
  peasant: U({
    id: 'peasant', name: 'Peasant', hp: 220, armor: 0, armorType: 'light',
    damage: [4, 5], attackType: 'normal', cooldown: 1.5, speed: 240, sight: 500,
    food: 1, cost: { gold: 75, lumber: 0 }, buildTime: 12, radius: 9,
    tags: ['worker'], canGather: true, canBuild: true, canRepair: true,
    art: { weapon: 'pick', shield: false, helmet: false, robe: false, mount: false, bulk: 0.9, hat: 'straw' },
    description: 'Gathers gold and lumber, constructs buildings and repairs them. Can be converted into a Militia.',
  }),

  militia: U({
    id: 'militia', name: 'Militia', hp: 240, armor: 1, armorType: 'medium',
    damage: [7, 9], attackType: 'normal', cooldown: 1.2, speed: 290, sight: 500,
    food: 1, cost: { gold: 0, lumber: 0 }, buildTime: 0, radius: 9,
    tags: ['worker', 'soldier'], temporary: 45,
    art: { weapon: 'pick', shield: false, helmet: true, robe: false, mount: false, bulk: 0.95, hat: null },
    description: 'A peasant called to arms. Returns to work after a short time.',
  }),

  footman: U({
    id: 'footman', name: 'Footman', hp: 420, armor: 2, armorType: 'heavy',
    damage: [11, 13], attackType: 'normal', cooldown: 1.35, speed: 270, sight: 500,
    food: 2, cost: { gold: 135, lumber: 0 }, buildTime: 18, radius: 10,
    tags: ['melee', 'soldier'], requires: ['barracks'],
    art: { weapon: 'sword', shield: true, helmet: true, robe: false, mount: false, bulk: 1, hat: null },
    description: 'Sturdy front-line infantry, trained at the Barracks.',
  }),

  rifleman: U({
    id: 'rifleman', name: 'Rifleman', hp: 520, armor: 0, armorType: 'medium',
    damage: [17, 23], attackType: 'pierce', range: 300, cooldown: 1.5, speed: 260,
    sight: 550, food: 3, cost: { gold: 205, lumber: 30 }, buildTime: 22, radius: 10,
    tags: ['ranged', 'soldier'], requires: ['barracks', 'blacksmith'], projectile: 'bullet',
    art: { weapon: 'gun', shield: false, helmet: true, robe: false, mount: false, bulk: 1, hat: null },
    description: 'Ranged infantry with a long rifle. Effective against light armour.',
  }),

  knight: U({
    id: 'knight', name: 'Knight', hp: 800, armor: 5, armorType: 'heavy',
    damage: [24, 28], attackType: 'normal', cooldown: 1.4, speed: 310, sight: 500,
    food: 4, cost: { gold: 245, lumber: 60 }, buildTime: 30, radius: 13,
    tags: ['melee', 'soldier', 'mounted'], requires: ['barracks', 'blacksmith'], tier: 2,
    art: { weapon: 'sword', shield: true, helmet: true, robe: false, mount: true, bulk: 1.15, hat: null },
    description: 'Heavily armoured cavalry. Requires a Keep and a Blacksmith.',
  }),

  mortar: U({
    id: 'mortar', name: 'Mortar Team', hp: 400, armor: 0, armorType: 'medium',
    damage: [42, 58], attackType: 'siege', range: 420, cooldown: 3.4, speed: 220,
    sight: 550, food: 3, cost: { gold: 180, lumber: 70 }, buildTime: 26, radius: 12,
    tags: ['ranged', 'soldier', 'siege'], requires: ['barracks', 'blacksmith'], tier: 2,
    projectile: 'cannon',
    art: { weapon: 'cannon', shield: false, helmet: true, robe: false, mount: false, bulk: 1.05, hat: null },
    description: 'Long-range siege infantry. Devastating against buildings and fortified armour.',
  }),

  priest: U({
    id: 'priest', name: 'Priest', hp: 290, armor: 0, armorType: 'light',
    damage: [8, 10], attackType: 'magic', range: 260, cooldown: 1.8, speed: 250,
    sight: 550, food: 2, cost: { gold: 135, lumber: 10 }, buildTime: 24, radius: 9, mana: 200,
    tags: ['caster', 'soldier'], requires: ['sanctum'], tier: 2, projectile: 'bolt',
    abilities: [{ id: 'heal', autocast: true }, { id: 'inner_fire', autocast: true }],
    art: { weapon: 'staff', shield: false, helmet: false, robe: true, mount: false, bulk: 0.95, hat: 'hood' },
    description: 'Support caster. Heals friendly units and casts Inner Fire automatically.',
  }),

  sorceress: U({
    id: 'sorceress', name: 'Sorceress', hp: 265, armor: 0, armorType: 'light',
    damage: [7, 9], attackType: 'magic', range: 260, cooldown: 1.8, speed: 250,
    sight: 550, food: 2, cost: { gold: 155, lumber: 20 }, buildTime: 26, radius: 9, mana: 200,
    tags: ['caster', 'soldier'], requires: ['sanctum'], tier: 2, projectile: 'bolt',
    abilities: [{ id: 'slow', autocast: true }, { id: 'invisibility', autocast: false }],
    art: { weapon: 'staff', shield: false, helmet: false, robe: true, mount: false, bulk: 0.9, hat: 'hood' },
    description: 'Battle caster. Automatically casts Slow on enemies and can turn allies invisible.',
  }),

  water_elemental: U({
    id: 'water_elemental', name: 'Water Elemental', hp: 500, armor: 1, armorType: 'heavy',
    damage: [19, 22], attackType: 'pierce', range: 260, cooldown: 1.5, speed: 270,
    sight: 600, food: 0, cost: { gold: 0, lumber: 0 }, buildTime: 0, radius: 12,
    tags: ['summon'], projectile: 'water', summoned: true,
    art: { weapon: 'none', shield: false, helmet: false, robe: false, mount: false, bulk: 1.3, hat: null, ethereal: true },
    description: 'A summoned servant of water.',
  }),
};

const B = (o) => ({
  kind: 'building', race: 'human', armorType: 'fortified', armor: 5,
  cost: { gold: 100, lumber: 0 }, buildTime: 30, footprint: [3, 3], sight: 600,
  foodProvided: 0, trains: [], researches: [], sells: [], tier: 1, requires: [],
  art: { kind: 'house', banner: false }, description: '',
  ...o,
});

export const BUILDINGS = {
  townhall: B({
    id: 'townhall', name: 'Town Hall', hp: 1500, armor: 5, cost: { gold: 385, lumber: 205 },
    buildTime: 90, footprint: [4, 4], sight: 800, foodProvided: 12,
    trains: ['peasant'], upgradesTo: 'keep', isTownHall: true, townTier: 1,
    isDropoff: true, art: { kind: 'townhall', banner: true }, tier: 1,
    description: 'The heart of the settlement. Trains Peasants, accepts gold and lumber, and upgrades to a Keep.',
  }),
  keep: B({
    id: 'keep', name: 'Keep', hp: 2000, armor: 6, cost: { gold: 320, lumber: 210 },
    buildTime: 90, footprint: [4, 4], sight: 800, foodProvided: 12,
    trains: ['peasant'], upgradesTo: 'castle', isTownHall: true, townTier: 2,
    isDropoff: true, art: { kind: 'townhall', banner: true, big: true }, tier: 2, requires: ['townhall'],
    description: 'A fortified town centre. Unlocks tier 2 buildings and units.',
  }),
  castle: B({
    id: 'castle', name: 'Castle', hp: 2500, armor: 7, cost: { gold: 360, lumber: 240 },
    buildTime: 100, footprint: [4, 4], sight: 800, foodProvided: 12,
    trains: ['peasant'], isTownHall: true, townTier: 3, isDropoff: true,
    art: { kind: 'townhall', banner: true, big: true, castle: true }, tier: 3, requires: ['keep'],
    description: 'The mightiest human stronghold. Unlocks tier 3 upgrades.',
  }),
  farm: B({
    id: 'farm', name: 'Farm', hp: 500, armor: 5, cost: { gold: 80, lumber: 0 },
    buildTime: 22, footprint: [2, 2], sight: 500, foodProvided: 6,
    art: { kind: 'farm' }, description: 'Provides 6 food.',
  }),
  altar: B({
    id: 'altar', name: 'Altar of Kings', hp: 900, armor: 5, cost: { gold: 180, lumber: 50 },
    buildTime: 40, footprint: [3, 3], sight: 600,
    trains: ['archmage', 'mountain_king', 'paladin'], heroAltar: true,
    art: { kind: 'altar' }, requires: [], tier: 1,
    description: 'Summons human heroes and revives fallen ones.',
  }),
  barracks: B({
    id: 'barracks', name: 'Barracks', hp: 1200, armor: 5, cost: { gold: 140, lumber: 60 },
    buildTime: 35, footprint: [3, 3], sight: 600,
    trains: ['footman', 'rifleman', 'knight', 'mortar'], tiers: { knight: 2, mortar: 2 },
    art: { kind: 'barracks', banner: true }, tier: 1,
    description: 'Trains Footmen, Riflemen, Knights and Mortar Teams.',
  }),
  blacksmith: B({
    id: 'blacksmith', name: 'Blacksmith', hp: 1100, armor: 5, cost: { gold: 140, lumber: 60 },
    buildTime: 35, footprint: [3, 3], sight: 600,
    researches: ['iron_forging', 'black_gunpowder', 'plated_armor', 'masonry', 'animal_war_training'],
    art: { kind: 'blacksmith', banner: false }, tier: 1,
    description: 'Researches weapon and armour upgrades.',
  }),
  lumbermill: B({
    id: 'lumbermill', name: 'Lumber Mill', hp: 800, armor: 5, cost: { gold: 120, lumber: 0 },
    buildTime: 25, footprint: [2, 2], sight: 600, lumberDropoff: true,
    art: { kind: 'lumbermill' }, tier: 1,
    description: 'Drop-off point for lumber and a prerequisite for advanced structures.',
  }),
  sanctum: B({
    id: 'sanctum', name: 'Arcane Sanctum', hp: 1000, armor: 5, cost: { gold: 150, lumber: 80 },
    buildTime: 40, footprint: [3, 3], sight: 600,
    trains: ['priest', 'sorceress'], requires: ['keep'], tier: 2,
    art: { kind: 'sanctum' }, description: 'Trains Priests and Sorceresses.',
  }),
  vault: B({
    id: 'vault', name: 'Arcane Vault', hp: 700, armor: 5, cost: { gold: 130, lumber: 30 },
    buildTime: 28, footprint: [2, 2], sight: 500, shop: true, sells: SHOP_STOCK,
    art: { kind: 'vault' }, tier: 1,
    description: 'Sells potions, scrolls and magical items.',
  }),
  guardtower: B({
    id: 'guardtower', name: 'Guard Tower', hp: 600, armor: 8, cost: { gold: 130, lumber: 60 },
    buildTime: 30, footprint: [2, 2], sight: 800, requires: ['barracks'], tier: 1,
    attack: { damage: [20, 24], attackType: 'pierce', range: 360, cooldown: 1.5, projectile: 'arrow' },
    art: { kind: 'tower' }, description: 'Defensive tower with a long-ranged piercing attack.',
  }),
  cannontower: B({
    id: 'cannontower', name: 'Cannon Tower', hp: 700, armor: 8, cost: { gold: 150, lumber: 80 },
    buildTime: 36, footprint: [2, 2], sight: 800, requires: ['guardtower', 'blacksmith'], tier: 2,
    attack: { damage: [35, 45], attackType: 'siege', range: 400, cooldown: 2.6, projectile: 'cannon' },
    art: { kind: 'cannon' }, description: 'Heavy defensive tower that hurls shells at ground targets.',
  }),
};

const H = (o) => ({
  kind: 'hero', race: 'human', armorType: 'hero', attackType: 'hero',
  range: 70, cooldown: 1.8, speed: 280, sight: 700, food: 5,
  cost: { gold: 425, lumber: 0 }, buildTime: 55, radius: 12, tier: 1,
  maxLevel: 10, abilityIds: [], armorBase: 2,
  ...o,
});

export const HEROES = {
  archmage: H({
    id: 'archmage', name: 'Archmage', hpBase: 450, manaBase: 315, primary: 'int',
    attributes: { str: 14, agi: 15, int: 21 },
    growth: { str: 1.5, agi: 1.5, int: 3 },
    damage: [21, 27], range: 300, cooldown: 1.9, projectile: 'bolt',
    abilityIds: ['blizzard', 'water_elemental', 'brilliance_aura', 'mass_teleport'],
    art: { weapon: 'staff', shield: false, helmet: false, robe: true, mount: false, bulk: 1, hat: 'wizard', hero: true, cape: true },
    description: 'Master of the arcane. Blizzard, Water Elementals and the Brilliance Aura.',
  }),
  mountain_king: H({
    id: 'mountain_king', name: 'Mountain King', hpBase: 700, manaBase: 225, primary: 'str',
    attributes: { str: 24, agi: 11, int: 15 },
    growth: { str: 3, agi: 1.5, int: 1.5 },
    damage: [26, 32], range: 70, cooldown: 1.8,
    abilityIds: ['storm_bolt', 'thunder_clap', 'bash', 'avatar'],
    art: { weapon: 'hammer', shield: false, helmet: true, robe: false, mount: false, bulk: 1.35, hat: 'horned', hero: true, cape: false },
    description: 'A dwarven warrior. Storm Bolt, Thunder Clap, Bash and Avatar.',
  }),
  paladin: H({
    id: 'paladin', name: 'Paladin', hpBase: 650, manaBase: 255, primary: 'str',
    attributes: { str: 22, agi: 13, int: 17 },
    growth: { str: 2.5, agi: 1, int: 2 },
    damage: [24, 30], range: 70, cooldown: 1.8,
    abilityIds: ['holy_light', 'divine_shield', 'devotion_aura', 'resurrection'],
    art: { weapon: 'hammer', shield: true, helmet: true, robe: true, mount: false, bulk: 1.1, hat: 'helm', hero: true, cape: true },
    description: 'Holy warrior. Holy Light, Divine Shield, Devotion Aura and Resurrection.',
  }),
};

// Upgrades: per-level cost/time. Bonuses are applied per completed level.
export const UPGRADES = {
  iron_forging: {
    id: 'iron_forging', name: 'Iron Forging', icon: 'anvil', maxLevel: 2,
    cost: [{ gold: 100, lumber: 50 }, { gold: 150, lumber: 100 }],
    buildTime: [30, 40], requires: ['blacksmith'], tier: 1,
    affects: ['melee'], bonus: { damage: 3 },
    description: 'Increases the attack damage of melee units by 3 per level.',
  },
  black_gunpowder: {
    id: 'black_gunpowder', name: 'Black Gunpowder', icon: 'powder', maxLevel: 2,
    cost: [{ gold: 100, lumber: 50 }, { gold: 150, lumber: 100 }],
    buildTime: [30, 40], requires: ['blacksmith'], tier: 1,
    affects: ['ranged'], bonus: { damage: 3 },
    description: 'Increases the attack damage of ranged units by 3 per level.',
  },
  plated_armor: {
    id: 'plated_armor', name: 'Plated Armor', icon: 'plate', maxLevel: 2,
    cost: [{ gold: 125, lumber: 75 }, { gold: 175, lumber: 125 }],
    buildTime: [35, 45], requires: ['blacksmith'], tier: 1,
    affects: ['soldier'], bonus: { armor: 2 },
    description: 'Increases the armour of soldiers by 2 per level.',
  },
  masonry: {
    id: 'masonry', name: 'Improved Masonry', icon: 'masonry', maxLevel: 2,
    cost: [{ gold: 125, lumber: 50 }, { gold: 175, lumber: 100 }],
    buildTime: [35, 45], requires: ['blacksmith'], tier: 1,
    affects: ['building'], bonus: { armor: 3 },
    description: 'Increases the armour of all buildings by 3 per level.',
  },
  animal_war_training: {
    id: 'animal_war_training', name: 'Animal War Training', icon: 'training', maxLevel: 1,
    cost: [{ gold: 150, lumber: 100 }], buildTime: [45], requires: ['keep', 'blacksmith'], tier: 2,
    affects: ['soldier'], bonus: { hp: 100 },
    description: 'Increases the maximum hit points of soldiers by 100.',
  },
};

export const HERO_XP_TABLE = [0, 200, 500, 900, 1400, 2000, 2700, 3500, 4400, 5400];
export const MAX_HERO_LEVEL = 10;
export const MAX_FOOD = 100;
export const MAX_LEVEL = 10;
export const HERO_ABILITY_LEVEL_REQ = [1, 3, 5];

export const UPKEEP = [
  { maxFood: 49, goldFactor: 1.0, name: 'No Upkeep' },
  { maxFood: 79, goldFactor: 0.7, name: 'Low Upkeep' },
  { maxFood: 100, goldFactor: 0.4, name: 'High Upkeep' },
];

export function upkeepFor(foodUsed) {
  if (foodUsed < 50) return UPKEEP[0];
  if (foodUsed < 80) return UPKEEP[1];
  return UPKEEP[2];
}

export const ALL_DEFS = { ...UNITS, ...BUILDINGS, ...HEROES };

export function defOf(id) {
  return UNITS[id] || BUILDINGS[id] || HEROES[id] || null;
}

export function isBuildingDef(def) { return def && def.kind === 'building'; }
export function isHeroDef(def) { return def && def.kind === 'hero'; }
