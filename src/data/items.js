// Item definitions. Items can be carried by heroes (6 slots), dropped by creeps,
// sold by shops and picked up from the ground.

export const ITEMS = {
  potion_healing: {
    id: 'potion_healing', name: 'Potion of Healing', icon: 'potion_heal',
    cost: 100, target: 'none', kind: 'consumable', charges: 1, cooldown: 0,
    description: 'Use to instantly restore 250 hit points to the hero.',
    use(world, hero) {
      world.healUnit(hero, 250);
      world.addEffect({ type: 'ring', x: hero.x, y: hero.y, radius: 40, life: 0.4, maxLife: 0.4 });
      return true;
    },
  },
  potion_mana: {
    id: 'potion_mana', name: 'Potion of Mana', icon: 'potion_mana',
    cost: 200, target: 'none', kind: 'consumable', charges: 1, cooldown: 0,
    description: 'Use to instantly restore 150 mana to the hero.',
    use(world, hero) {
      hero.mana = Math.min(hero.maxMana, hero.mana + 150);
      world.addEffect({ type: 'ring', x: hero.x, y: hero.y, radius: 40, life: 0.4, maxLife: 0.4 });
      return true;
    },
  },
  scroll_town_portal: {
    id: 'scroll_town_portal', name: 'Scroll of Town Portal', icon: 'scroll',
    cost: 350, target: 'none', kind: 'consumable', charges: 1, cooldown: 0,
    description: 'Teleports the hero and nearby friendly units to the nearest friendly town hall.',
    use(world, hero) {
      const hall = world.findTownHall(hero.owner);
      if (!hall) { world.alertOwner(hero.owner, 'No town hall to teleport to.'); return false; }
      world.teleportGroup(hero, 400, hall.x + 80, hall.y + 100);
      return true;
    },
  },
  ring_protection: {
    id: 'ring_protection', name: 'Ring of Protection +2', icon: 'ring',
    cost: 400, target: 'none', kind: 'passive', charges: 0,
    description: 'Increases the hero\'s armour by 2.',
    passive: { armor: 2 },
  },
  boots_speed: {
    id: 'boots_speed', name: 'Boots of Speed', icon: 'boots',
    cost: 350, target: 'none', kind: 'passive', charges: 0,
    description: 'Increases the hero\'s movement speed by 60.',
    passive: { speed: 60 },
  },
  claws_attack: {
    id: 'claws_attack', name: 'Claws of Attack +9', icon: 'claw',
    cost: 400, target: 'none', kind: 'passive', charges: 0,
    description: 'Increases the hero\'s attack damage by 9.',
    passive: { damage: 9 },
  },
  tome_strength: {
    id: 'tome_strength', name: 'Tome of Strength +2', icon: 'tome_str',
    cost: 300, target: 'none', kind: 'consumable', charges: 1, cooldown: 0,
    description: 'Permanently increases the hero\'s Strength by 2.',
    use(world, hero) {
      hero.attributes.str += 2;
      world.recomputeHero(hero);
      world.alertOwner(hero.owner, `${hero.def.name} gains 2 Strength.`);
      return true;
    },
  },
  tome_agility: {
    id: 'tome_agility', name: 'Tome of Agility +2', icon: 'tome_agi',
    cost: 300, target: 'none', kind: 'consumable', charges: 1, cooldown: 0,
    description: 'Permanently increases the hero\'s Agility by 2.',
    use(world, hero) {
      hero.attributes.agi += 2;
      world.recomputeHero(hero);
      return true;
    },
  },
  tome_intelligence: {
    id: 'tome_intelligence', name: 'Tome of Intelligence +2', icon: 'tome_int',
    cost: 300, target: 'none', kind: 'consumable', charges: 1, cooldown: 0,
    description: 'Permanently increases the hero\'s Intelligence by 2.',
    use(world, hero) {
      hero.attributes.int += 2;
      world.recomputeHero(hero);
      return true;
    },
  },
  healing_salve: {
    id: 'healing_salve', name: 'Healing Salve', icon: 'salve',
    cost: 100, target: 'ally', kind: 'consumable', charges: 1, cooldown: 0,
    description: 'Restores 100 hit points to a target friendly unit.',
    use(world, hero, target) {
      if (!target) return false;
      world.healUnit(target, 100);
      return true;
    },
  },
};

export const SHOP_STOCK = [
  'potion_healing', 'potion_mana', 'scroll_town_portal',
  'ring_protection', 'boots_speed', 'claws_attack',
  'tome_strength', 'tome_agility', 'tome_intelligence',
];

// Creep drop tables, loosely WC3-flavoured: low level creeps drop minor items.
export const DROP_TABLES = {
  low: ['potion_healing', 'potion_mana', 'tome_strength', 'tome_agility', 'tome_intelligence'],
  mid: ['ring_protection', 'boots_speed', 'healing_salve', 'potion_healing', 'claws_attack'],
  high: ['claws_attack', 'ring_protection', 'boots_speed', 'scroll_town_portal', 'potion_mana'],
};
