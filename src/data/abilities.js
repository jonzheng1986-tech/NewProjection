// Ability, aura and buff definitions.
//
// Abilities are data + a small effect closure. Target kinds:
//   'passive'  – always on, resolved by systems (auras, bash)
//   'none'     – instant cast, no target (self AoE / self buff / summon)
//   'point'    – ground target point
//   'unit'     – friendly/enemy unit target
//   'autocast' – automatic, also castable manually on a unit
//
// Levels are arrays; index 0 is level 1.

import { TILE, dist, clamp } from '../core/util.js';

export const BUFF_KINDS = {
  slow: 'slow',
  stun: 'stun',
  root: 'root',
  armor: 'armor',
  damage: 'damage',
  invulnerable: 'invulnerable',
  invisible: 'invisible',
  dot: 'dot',
  hot: 'hot',
};

export const ABILITIES = {
  // ===================== HERO ABILITIES =====================
  blizzard: {
    id: 'blizzard', name: 'Blizzard', icon: 'blizzard', kind: 'point',
    target: 'point', range: 800, radius: 200, iconArt: 'storm',
    description: 'Calls down waves of ice shards on an area, damaging all enemy units in it.',
    levels: 3,
    mana: [75, 75, 75],
    cooldown: [6, 6, 6],
    heroLevelReq: [1, 3, 5],
    ult: false,
    effect(world, caster, lvl, tx, ty) {
      const dmg = [30, 45, 60][lvl - 1];
      world.addEffect({
        type: 'pulse', x: tx, y: ty, radius: 200, owner: caster.owner,
        interval: 0.7, pulses: 3, damage: dmg, damageType: 'magic', casterId: caster.id,
        art: 'blizzard',
      });
    },
    tooltip(world, lvl) {
      return `Blizzard (${['I', 'II', 'III'][lvl - 1]})`;
    },
    stats(lvl) { return `Deals ${[30, 45, 60][lvl - 1]} damage per wave to enemies in a ${200} area.\n3 waves over 2.1 seconds.`; },
  },

  water_elemental: {
    id: 'water_elemental', name: 'Summon Water Elemental', icon: 'elemental',
    kind: 'none', target: 'none', range: 0, radius: 0,
    description: 'Summons a Water Elemental to fight for the Archmage.',
    levels: 3,
    mana: [125, 125, 125],
    cooldown: [20, 20, 20],
    heroLevelReq: [1, 3, 5],
    effect(world, caster, lvl) {
      const dur = [60, 70, 80][lvl - 1];
      const hp = [500, 625, 750][lvl - 1];
      const dmg = [19, 25, 31][lvl - 1];
      world.summonUnit('water_elemental', caster, { duration: dur, hp, damage: [dmg, dmg + 3] });
    },
    stats(lvl) { return `Summons a Water Elemental (${[500, 625, 750][lvl - 1]} HP, ${[19, 25, 31][lvl - 1]}-${[22, 28, 34][lvl - 1]} damage) for ${[60, 70, 80][lvl - 1]} seconds.`; },
  },

  brilliance_aura: {
    id: 'brilliance_aura', name: 'Brilliance Aura', icon: 'aura_brilliance',
    kind: 'passive', target: 'none', range: 900, radius: 900,
    description: 'Restores mana to nearby friendly units.',
    levels: 3, mana: [0, 0, 0], cooldown: [0, 0, 0], heroLevelReq: [1, 3, 5],
    aura: true,
    auraBonus(lvl) { return { manaRegen: [0.75, 1.5, 2.25][lvl - 1] }; },
    stats(lvl) { return `Increases mana regeneration of nearby friendly units by ${[0.75, 1.5, 2.25][lvl - 1]} per second.`; },
  },

  mass_teleport: {
    id: 'mass_teleport', name: 'Mass Teleport', icon: 'teleport', kind: 'point',
    target: 'point', range: 99999, radius: 400, ult: true,
    description: 'Teleports the Archmage and nearby friendly units to a target area.',
    levels: 1, mana: [100], cooldown: [20], heroLevelReq: [6],
    effect(world, caster, lvl, tx, ty) {
      world.teleportGroup(caster, 400, tx, ty);
    },
    stats() { return 'Teleports the Archmage and friendly units within 400 range to the target location.'; },
  },

  storm_bolt: {
    id: 'storm_bolt', name: 'Storm Bolt', icon: 'bolt', kind: 'unit',
    target: 'enemy', range: 600, radius: 0,
    description: 'Hurls a hammer at an enemy unit, dealing damage and stunning it.',
    levels: 3, mana: [75, 75, 75], cooldown: [9, 9, 9], heroLevelReq: [1, 3, 5],
    effect(world, caster, lvl, tx, ty, targetEntity) {
      if (!targetEntity) return;
      const dmg = [100, 225, 350][lvl - 1];
      const stun = [3, 5, 7][lvl - 1];
      world.spawnProjectile({
        x: caster.x, y: caster.y, target: targetEntity, speed: 1100,
        owner: caster.owner, damage: dmg, damageType: 'magic', kind: 'stormbolt',
        height: 28, onHit: (w, tgt) => {
          w.addBuff(tgt, { id: 'stun', name: 'Stunned', duration: stun, stun: true }, caster);
          w.fxBurst(tgt.x, tgt.y, 26, 0.4);
        },
      });
    },
    stats(lvl) { return `Deals ${[100, 225, 350][lvl - 1]} damage and stuns the target for ${[3, 5, 7][lvl - 1]} seconds.`; },
  },

  thunder_clap: {
    id: 'thunder_clap', name: 'Thunder Clap', icon: 'clap', kind: 'none',
    target: 'none', range: 0, radius: 250,
    description: 'Slams the ground, damaging and slowing nearby enemies.',
    levels: 3, mana: [90, 90, 90], cooldown: [6, 6, 6], heroLevelReq: [1, 3, 5],
    effect(world, caster, lvl) {
      const dmg = [60, 100, 140][lvl - 1];
      world.damageArea(caster.owner, caster.x, caster.y, 250, dmg, 'magic', caster, { includeBuildings: false });
      world.addEffect({ type: 'ring', x: caster.x, y: caster.y, radius: 250, life: 0.6, maxLife: 0.6 });
      for (const u of world.unitsInRadius(caster.x, caster.y, 250)) {
        if (u.dead || !world.isEnemyEntity(caster, u)) continue;
        world.addBuff(u, { id: 'slow', name: 'Slowed', duration: 3, slow: 0.5 }, caster);
      }
    },
    stats(lvl) { return `Deals ${[60, 100, 140][lvl - 1]} damage to nearby enemies and slows their movement by 50% for 3 seconds.`; },
  },

  bash: {
    id: 'bash', name: 'Bash', icon: 'bash', kind: 'passive',
    target: 'none', range: 0, radius: 0,
    description: 'Gives a chance to deal bonus damage and stun on attack.',
    levels: 3, mana: [0, 0, 0], cooldown: [0, 0, 0], heroLevelReq: [1, 3, 5],
    passiveAttack: true,
    proc(lvl) { return { chance: [0.20, 0.25, 0.30][lvl - 1], bonus: [25, 40, 55][lvl - 1], stun: [2, 2, 3][lvl - 1] }; },
    stats(lvl) { return `Gives a ${[20, 25, 30][lvl - 1]}% chance to deal ${[25, 40, 55][lvl - 1]} bonus damage and stun the target for ${[2, 2, 3][lvl - 1]} seconds.`; },
  },

  avatar: {
    id: 'avatar', name: 'Avatar', icon: 'avatar', kind: 'none',
    target: 'none', range: 0, radius: 0, ult: true,
    description: 'The Mountain King grows in power, gaining hit points, damage and spell immunity.',
    levels: 1, mana: [150], cooldown: [180], heroLevelReq: [6],
    effect(world, caster) {
      world.addBuff(caster, {
        id: 'avatar', name: 'Avatar', duration: 60,
        bonusHp: 500, damageBonus: 20, magicImmune: true, scale: 1.25,
      }, caster);
    },
    stats() { return 'Grants +500 hit points, +20 damage and spell immunity for 60 seconds.'; },
  },

  holy_light: {
    id: 'holy_light', name: 'Holy Light', icon: 'holy_light', kind: 'unit',
    target: 'ally', range: 800, radius: 0,
    description: 'Heals a friendly unit. Deals damage to undead units.',
    levels: 3, mana: [65, 65, 65], cooldown: [5, 5, 5], heroLevelReq: [1, 3, 5],
    effect(world, caster, lvl, tx, ty, target) {
      if (!target) return;
      const amount = [200, 400, 600][lvl - 1];
      if (target.undead) {
        world.damage(target, amount, caster, 'magic');
      } else {
        world.healUnit(target, amount);
      }
      world.addEffect({ type: 'beam', x: caster.x, y: caster.y, x2: target.x, y2: target.y, life: 0.25, maxLife: 0.25, art: 'holy' });
    },
    stats(lvl) { return `Heals a friendly unit for ${[200, 400, 600][lvl - 1]} HP, or deals that much damage to undead.`; },
  },

  divine_shield: {
    id: 'divine_shield', name: 'Divine Shield', icon: 'shield_holy', kind: 'none',
    target: 'none', range: 0, radius: 0,
    description: 'Makes the Paladin invulnerable for a short time.',
    levels: 3, mana: [75, 75, 75], cooldown: [35, 35, 35], heroLevelReq: [1, 3, 5],
    effect(world, caster, lvl) {
      world.addBuff(caster, { id: 'divine_shield', name: 'Divine Shield', duration: [15, 25, 35][lvl - 1], invulnerable: true }, caster);
    },
    stats(lvl) { return `The Paladin becomes invulnerable for ${[15, 25, 35][lvl - 1]} seconds.`; },
  },

  devotion_aura: {
    id: 'devotion_aura', name: 'Devotion Aura', icon: 'aura_devotion',
    kind: 'passive', target: 'none', range: 900, radius: 900,
    description: 'Increases the armour of nearby friendly units.',
    levels: 3, mana: [0, 0, 0], cooldown: [0, 0, 0], heroLevelReq: [1, 3, 5],
    aura: true,
    auraBonus(lvl) { return { armor: [2, 3.5, 5][lvl - 1] }; },
    stats(lvl) { return `Increases the armour of nearby friendly units by ${[2, 3.5, 5][lvl - 1]}.`; },
  },

  resurrection: {
    id: 'resurrection', name: 'Resurrection', icon: 'resurrect', kind: 'none',
    target: 'none', range: 0, radius: 600, ult: true,
    description: 'Raises up to 3 nearby friendly corpses to fight again.',
    levels: 1, mana: [250], cooldown: [240], heroLevelReq: [6],
    effect(world, caster) {
      const corpses = world.corpses
        .filter((c) => c.owner === caster.owner && dist(c.x, c.y, caster.x, caster.y) <= 600)
        .slice(0, 3);
      for (const c of corpses) {
        world.reviveFromCorpse(c);
      }
      world.addEffect({ type: 'ring', x: caster.x, y: caster.y, radius: 600, life: 0.8, maxLife: 0.8 });
    },
    stats() { return 'Revives up to 3 friendly units that have died nearby within the last 30 seconds.'; },
  },

  // ===================== UNIT ABILITIES =====================
  heal: {
    id: 'heal', name: 'Heal', icon: 'heal', kind: 'autocast',
    target: 'ally', range: 500, radius: 0, autoAcquire: true,
    description: 'Heals a friendly unit. Autocast.',
    levels: 1, mana: [5], cooldown: [1.5], heroLevelReq: [1],
    unitAbility: true, autoCastDefault: true,
    effect(world, caster, lvl, tx, ty, target) {
      if (!target) return;
      world.healUnit(target, 25);
      world.addEffect({ type: 'beam', x: caster.x, y: caster.y, x2: target.x, y2: target.y, life: 0.25, maxLife: 0.25, art: 'holy' });
    },
    autoFilter(world, caster, unit) {
      return unit.hp < unit.maxHp * 0.9;
    },
    stats() { return 'Heals a friendly unit for 25 hit points. 5 mana.'; },
  },

  inner_fire: {
    id: 'inner_fire', name: 'Inner Fire', icon: 'inner_fire', kind: 'autocast',
    target: 'ally', range: 600, radius: 0,
    description: 'Increases a friendly unit\'s armour and damage. Autocast.',
    levels: 1, mana: [35], cooldown: [8], heroLevelReq: [1],
    unitAbility: true, autoCastDefault: true,
    effect(world, caster, lvl, tx, ty, target) {
      if (!target) return;
      world.addBuff(target, { id: 'inner_fire', name: 'Inner Fire', duration: 60, armor: 5, damageBonus: 5, damageScale: 0.1 }, caster);
    },
    autoFilter(world, caster, unit) {
      return !world.hasBuff(unit, 'inner_fire') && unit.def.kind === 'unit';
    },
    stats() { return 'Increases armour by 5 and damage by 10% for 60 seconds.'; },
  },

  slow: {
    id: 'slow', name: 'Slow', icon: 'slow', kind: 'autocast',
    target: 'enemy', range: 600, radius: 0,
    description: 'Slows an enemy unit. Autocast.',
    levels: 1, mana: [25], cooldown: [4], heroLevelReq: [1],
    unitAbility: true, autoCastDefault: true,
    effect(world, caster, lvl, tx, ty, target) {
      if (!target) return;
      world.addBuff(target, { id: 'slow', name: 'Slowed', duration: 15, slow: 0.5 }, caster);
      world.addEffect({ type: 'beam', x: caster.x, y: caster.y, x2: target.x, y2: target.y, life: 0.3, maxLife: 0.3, art: 'frost' });
    },
    autoFilter(world, caster, unit) { return !world.hasBuff(unit, 'slow'); },
    stats() { return 'Slows an enemy unit by 50% for 15 seconds.'; },
  },

  invisibility: {
    id: 'invisibility', name: 'Invisibility', icon: 'invisible', kind: 'unit',
    target: 'ally', range: 500, radius: 0,
    description: 'Turns a friendly unit invisible until it attacks.',
    levels: 1, mana: [35], cooldown: [12], heroLevelReq: [1],
    unitAbility: true,
    effect(world, caster, lvl, tx, ty, target) {
      if (!target) return;
      world.addBuff(target, { id: 'invisible', name: 'Invisible', duration: 30, invisible: true }, caster);
    },
    stats() { return 'Turns a friendly unit invisible for 30 seconds or until it attacks.'; },
  },

  // ===================== CREEP / NEUTRAL ABILITIES =====================
  creep_ensnare: {
    id: 'creep_ensnare', name: 'Ensnare', icon: 'snare', kind: 'unit',
    target: 'enemy', range: 500, radius: 0,
    description: 'Roots an enemy unit in place.',
    levels: 1, mana: [0], cooldown: [12], heroLevelReq: [1],
    unitAbility: true,
    effect(world, caster, lvl, tx, ty, target) {
      if (!target) return;
      world.addBuff(target, { id: 'ensnare', name: 'Ensnared', duration: 3, root: true }, caster);
    },
    stats() { return 'Roots an enemy unit for 3 seconds.'; },
  },
};

// Aura bookkeeping: which aura ids exist and their radius, used by the world tick.
export const AURA_IDS = Object.keys(ABILITIES).filter((k) => ABILITIES[k].aura);

export function abilityDef(id) { return ABILITIES[id]; }

export function abilityLevelCount(def) { return def.levels || 1; }

export function nearestPointOnLine(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const l2 = abx * abx + aby * aby;
  if (l2 < 1e-6) return [ax, ay];
  let t = ((px - ax) * abx + (py - ay) * aby) / l2;
  t = clamp(t, 0, 1);
  return [ax + abx * t, ay + aby * t];
}

export function tilesToWorld(t) { return t * TILE; }
