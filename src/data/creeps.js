// Neutral hostile creeps. They guard gold mines and item camps, grant experience
// and bounty gold when killed, and drop items from their level's drop table.

const C = (o) => ({
  kind: 'unit', race: 'creep', armorType: 'medium', attackType: 'normal',
  range: 70, cooldown: 1.6, speed: 240, sight: 450, food: 0,
  cost: { gold: 0, lumber: 0 }, buildTime: 0, radius: 10, tier: 0,
  requires: [], abilities: [], hostile: true, creep: true, bounty: [5, 10],
  xp: 10, dropTable: null, guardRadius: 320,
  art: { weapon: 'club', shield: false, helmet: false, robe: false, mount: false, bulk: 1, hat: null, creep: true },
  ...o,
});

export const CREEPS = {
  kobold: C({
    id: 'kobold', name: 'Kobold', hp: 240, armor: 0, armorType: 'light',
    damage: [8, 10], cooldown: 1.6, speed: 230, sight: 450, radius: 8,
    level: 1, xp: 12, bounty: [6, 9], dropTable: null, guardRadius: 300,
    art: { weapon: 'pick', shield: false, helmet: false, robe: false, mount: false, bulk: 0.85, hat: 'candle', creep: true },
    description: 'A cowardly tunnel-dweller.',
  }),
  gnoll: C({
    id: 'gnoll', name: 'Gnoll Brute', hp: 340, armor: 1, armorType: 'medium',
    damage: [13, 16], cooldown: 1.5, speed: 250, sight: 480, radius: 10,
    level: 2, xp: 25, bounty: [10, 16], dropTable: 'low', guardRadius: 320,
    art: { weapon: 'club', shield: false, helmet: false, robe: false, mount: false, bulk: 1.05, hat: 'mane', creep: true },
    description: 'A hyena-headed marauder.',
  }),
  forest_troll: C({
    id: 'forest_troll', name: 'Forest Troll', hp: 400, armor: 1, armorType: 'light',
    damage: [15, 20], attackType: 'pierce', range: 260, cooldown: 1.9, speed: 235,
    sight: 500, radius: 10, level: 3, xp: 40, bounty: [16, 24], dropTable: 'low',
    guardRadius: 340, projectile: 'spear',
    art: { weapon: 'spear', shield: false, helmet: false, robe: false, mount: false, bulk: 1.05, hat: 'troll', creep: true },
    description: 'A jungle troll that throws spears.',
  }),
  ogre_warrior: C({
    id: 'ogre_warrior', name: 'Ogre Warrior', hp: 750, armor: 3, armorType: 'heavy',
    damage: [26, 33], cooldown: 1.9, speed: 220, sight: 480, radius: 14,
    level: 4, xp: 70, bounty: [30, 45], dropTable: 'mid', guardRadius: 360,
    art: { weapon: 'club', shield: false, helmet: false, robe: false, mount: false, bulk: 1.35, hat: 'ogre', creep: true },
    description: 'A hulking two-headed brute.',
  }),
  troll_shaman: C({
    id: 'troll_shaman', name: 'Troll Shaman', hp: 420, armor: 1, armorType: 'light',
    damage: [14, 18], attackType: 'magic', range: 260, cooldown: 2.0, speed: 235,
    sight: 500, radius: 9, level: 4, xp: 60, bounty: [24, 34], dropTable: 'mid',
    guardRadius: 360, projectile: 'bolt',
    abilities: [{ id: 'creep_ensnare', autocast: true }],
    art: { weapon: 'staff', shield: false, helmet: false, robe: true, mount: false, bulk: 1, hat: 'hood', creep: true },
    description: 'A shaman who snares his prey.',
  }),
  ancient_wendigo: C({
    id: 'ancient_wendigo', name: 'Ancient Wendigo', hp: 1900, armor: 5, armorType: 'heavy',
    damage: [42, 54], cooldown: 1.8, speed: 260, sight: 700, radius: 18,
    level: 8, xp: 260, bounty: [120, 180], dropTable: 'high', guardRadius: 420, boss: true,
    art: { weapon: 'claw', shield: false, helmet: false, robe: false, mount: false, bulk: 1.7, hat: 'horns', creep: true },
    description: 'A monstrous beast of the frozen north. Guards great treasure.',
  }),
};

export const CREEP_LEVELS = Object.fromEntries(Object.values(CREEPS).map((c) => [c.id, c.level]));

export const ALL_CREEP_IDS = Object.keys(CREEPS);

// Camps placed around the map. `tier` drives unit composition.
export const CAMP_TEMPLATES = [
  { tier: 1, units: ['kobold', 'kobold'], gold: 0, drops: null, guardsMine: false },
  { tier: 1, units: ['kobold', 'kobold', 'kobold'], gold: 0, drops: 'low', guardsMine: false },
  { tier: 2, units: ['gnoll', 'gnoll'], gold: 0, drops: 'low', guardsMine: true },
  { tier: 2, units: ['gnoll', 'gnoll', 'gnoll'], gold: 0, drops: 'low', guardsMine: false },
  { tier: 3, units: ['forest_troll', 'forest_troll', 'gnoll'], gold: 0, drops: 'low', guardsMine: true },
  { tier: 3, units: ['forest_troll', 'troll_shaman'], gold: 0, drops: 'mid', guardsMine: true },
  { tier: 4, units: ['ogre_warrior', 'forest_troll'], gold: 0, drops: 'mid', guardsMine: true },
  { tier: 4, units: ['ogre_warrior', 'troll_shaman', 'forest_troll'], gold: 0, drops: 'mid', guardsMine: true },
  { tier: 8, units: ['ancient_wendigo', 'ogre_warrior'], gold: 0, drops: 'high', guardsMine: true, boss: true },
];

export function defOfCreep(id) { return CREEPS[id]; }
