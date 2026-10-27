// Builds the 3x4 command card for the current selection, WC3 style.

import { ABILITIES } from '../data/abilities.js';
import { ITEMS } from '../data/items.js';
import { UNITS, BUILDINGS, UPGRADES, ALL_DEFS } from '../data/human.js';
import { defOf } from '../data/human.js';
import { costShort, fmtCost } from './theme.js';

export const HOTKEYS = ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'Z', 'X', 'C', 'V'];
const UNIT_KEYS = ['M', 'A', 'S', 'H', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I'];

const BUILDABLE = ['farm', 'barracks', 'altar', 'lumbermill', 'blacksmith', 'vault', 'guardtower', 'sanctum', 'cannontower', 'townhall'];

export function buildCommands(game) {
  const world = game.world;
  const sel = game.selection;
  const cmds = [];
  const push = (c) => { if (cmds.length < 12) cmds.push(c); else if (c) cmds[11] = c; };

  if (!sel.length) {
    return [];
  }
  const primary = sel[0];
  const player = world.players[game.localPlayer];
  if (primary.owner !== game.localPlayer) {
    return [{
      icon: 'info', title: primary.name, subtitle: 'Enemy', hotkey: 'I',
      body: primary.def.description || '', action: 'none', enabled: false,
    }];
  }

  // build submenu for workers
  if (game.buildMenu && primary.def.canBuild) {
    for (const id of BUILDABLE) {
      const def = BUILDINGS[id];
      if (!def) continue;
      if (def.tier > player.tier) continue;
      if (!world.hasRequirements(game.localPlayer, def)) continue;
      push({
        icon: def.id,
        title: def.name,
        cost: def.cost,
        costLine: fmtCost(def.cost),
        body: def.description,
        hint: `${def.buildTime}s build time.`,
        enabled: world.canAfford(game.localPlayer, def.cost) && !game.placingDef,
        action: 'build',
        payload: { defId: id },
      });
    }
    push({
      icon: 'cancel', title: 'Back', body: 'Return to the standard command card.',
      action: 'buildBack', enabled: true,
    });
    cmds.forEach((c, i) => { if (!c.hotkey) c.hotkey = HOTKEYS[i]; });
    return cmds;
  }

  if (primary.kind === 'building') {
    return buildingCommands(game, primary, player);
  }

  // ---- units ----
  const isWorker = primary.def.canGather;
  const hero = sel.find((u) => u.hero) || null;

  push({
    icon: 'move', title: 'Move', body: 'Move to the target location.',
    hint: 'Hotkey M or right-click.', action: 'move', enabled: true, hotkey: 'M',
  });
  push({
    icon: 'attack', title: 'Attack', body: 'Attack a target, or attack-move to a location.',
    hint: 'Hotkey A.', action: 'attackmove', enabled: true, hotkey: 'A',
  });
  push({
    icon: 'stop', title: 'Stop', body: 'Stop the current order.',
    hint: 'Hotkey S.', action: 'stop', enabled: true, hotkey: 'S',
  });
  push({
    icon: 'hold', title: 'Hold Position', body: 'Hold this position and attack enemies in range.',
    hint: 'Hotkey H.', action: 'hold', enabled: true, hotkey: 'H',
  });

  if (isWorker) {
    push({
      icon: 'build', title: 'Build Structure', body: 'Choose a building to construct.',
      hint: 'Hotkey B.', action: 'buildMenu', enabled: true, hotkey: 'B',
    });
    const target = game.gatherTarget;
    push({
      icon: 'gather', title: 'Gather', body: 'Select a gold mine or tree, then right-click it. Use this button and click a resource to harvest.',
      action: 'gatherMode', enabled: true, hotkey: 'G',
    });
  }

  if (hero) {
    for (const st of hero.abilities) {
      const def = ABILITIES[st.id];
      if (!def) continue;
      const canLearn = hero.skillPoints > 0 && st.level < (def.levels || 1);
      const nextLevel = st.level + 1;
      const req = (def.heroLevelReq || [1])[Math.min(st.level, (def.heroLevelReq || [1]).length - 1)] || 1;
      const learnable = canLearn && hero.heroLevel >= req;
      const learned = st.level > 0;
      const mana = def.mana[Math.max(0, (learned ? st.level : 1) - 1)] || 0;
      const cd = def.cooldown[Math.max(0, (learned ? st.level : 1) - 1)] || 0;
      const cdLeft = learned ? (hero.cooldowns[st.id] || 0) : 0;
      push({
        icon: def.icon,
        title: `${def.name}${learned ? ` (${'I'.repeat(st.level)})` : ''}`,
        subtitle: def.aura ? 'Passive aura' : def.kind === 'passive' ? 'Passive' : `${mana} mana · ${cd}s`,
        costLine: !learned ? `Requires hero level ${req}` : '',
        body: learned ? def.stats(st.level) : `${def.description}\nLearn at hero level ${req}.`,
        hint: def.autoCastDefault && learned ? 'Right-click to toggle autocast.' : (learnable ? 'Click to learn.' : ''),
        enabled: learned ? (cdLeft <= 0 && hero.mana >= mana && !def.aura && def.kind !== 'passive') : learnable,
        active: learned && st.autocast && st.enabled,
        learning: learnable,
        level: learned ? 'I'.repeat(st.level) : '',
        charges: cdLeft > 0 ? Math.ceil(cdLeft) : undefined,
        action: learned ? 'cast' : 'learn',
        payload: { abilityId: st.id, level: st.level, heroId: hero.id, def },
        autocast: !!def.autoCastDefault,
        abilityState: st,
      });
    }
  } else {
    // unit autocast abilities (priest heal / sorceress slow)
    for (const st of primary.abilities) {
      const def = ABILITIES[st.id];
      if (!def) continue;
      const lvl = st.level || 1;
      const mana = def.mana[lvl - 1] || 0;
      push({
        icon: def.icon,
        title: def.name,
        subtitle: `${mana} mana`,
        body: def.stats(lvl),
        hint: 'Right-click to toggle autocast.',
        enabled: st.level > 0,
        active: st.autocast && st.enabled,
        action: 'autocast',
        payload: { unitId: primary.id, abilityId: st.id },
        autocast: true,
        abilityState: st,
      });
    }
  }

  if (sel.length > 1 && !hero) {
    const types = new Set(sel.map((u) => u.defId));
    if (types.size > 1) {
      push({
        icon: 'info', title: `${sel.length} units selected`, body: 'Multiple unit types are selected. Hold Shift while selecting to add units, Tab to cycle.',
        action: 'none', enabled: false,
      });
    }
  }

  cmds.forEach((c, i) => { if (!c.hotkey) c.hotkey = UNIT_KEYS[i]; });
  return cmds;
}

function buildingCommands(game, b, player) {
  const world = game.world;
  const cmds = [];
  const push = (c) => { if (cmds.length < 12) cmds.push(c); };
  const def = b.def;

  if (def.trains) {
    for (const unitId of def.trains) {
      const udef = ALL_DEFS[unitId];
      if (!udef) continue;
      const check = world.canTrain(game.localPlayer, b, unitId);
      const tierBlocked = (b.def.tiers && b.def.tiers[unitId] && b.def.tiers[unitId] > player.tier) ||
        (udef.tier && udef.tier > player.tier);
      const queued = b.trainQueue.filter((q) => q.defId === unitId).length;
      push({
        icon: udef.kind === 'hero' ? (unitId === 'archmage' ? 'hero' : unitId === 'mountain_king' ? 'avatar' : 'shield_holy') : udef.id,
        title: udef.name,
        subtitle: `${udef.food || 0} food · ${udef.buildTime}s`,
        cost: udef.cost,
        costLine: fmtCost(udef.cost),
        body: udef.description,
        hint: queued ? `${queued} queued` : '',
        charges: queued || undefined,
        enabled: check.ok,
        action: 'train',
        payload: { defId: unitId },
        reason: check.reason,
        tierBlocked,
      });
    }
  }

  if (def.researches) {
    for (const upId of def.researches) {
      const up = UPGRADES[upId];
      if (!up) continue;
      const lvl = player.upgrades[upId] || 0;
      if (up.tier > player.tier) continue;
      const maxed = lvl >= up.maxLevel;
      const cost = up.cost[Math.min(lvl, up.cost.length - 1)];
      push({
        icon: up.icon,
        title: `${up.name}${lvl ? ` ${'I'.repeat(lvl)}` : ''}`,
        subtitle: maxed ? 'Fully researched' : `Level ${lvl + 1} of ${up.maxLevel}`,
        cost,
        costLine: maxed ? 'Research complete' : fmtCost(cost),
        body: up.description,
        enabled: !maxed && world.canAfford(game.localPlayer, cost) && world.hasRequirements(game.localPlayer, { requires: up.requires }),
        action: 'research',
        payload: { upgradeId: upId },
        level: lvl ? 'I'.repeat(lvl) : '',
      });
    }
  }

  if (def.upgradesTo) {
    const target = BUILDINGS[def.upgradesTo];
    if (target) {
      push({
        icon: target.id,
        title: `Upgrade to ${target.name}`,
        subtitle: `${target.buildTime}s`,
        cost: target.cost,
        costLine: fmtCost(target.cost),
        body: target.description,
        enabled: !b.upgrading && world.canAfford(game.localPlayer, target.cost),
        action: 'upgradeBuilding',
        payload: { defId: target.id },
      });
    }
  }

  if (def.sells) {
    for (const itemId of def.sells) {
      const item = ITEMS[itemId];
      if (!item) continue;
      push({
        icon: item.icon,
        title: item.name,
        cost: { gold: item.cost },
        costLine: `${item.cost} gold`,
        body: item.description,
        enabled: player.gold >= item.cost,
        action: 'buy',
        payload: { itemId },
      });
    }
  }

  if (cmds.length === 0) {
    push({
      icon: 'info', title: b.name, body: def.description || 'No actions available.',
      action: 'none', enabled: false,
    });
  }
  cmds.forEach((c, i) => { if (!c.hotkey) c.hotkey = HOTKEYS[i]; });
  return cmds;
}

// Item slot tooltip / data
export function itemInfo(defId) {
  const it = ITEMS[defId];
  if (!it) return null;
  return {
    title: it.name,
    subtitle: it.kind === 'consumable' ? 'Consumable' : 'Passive',
    costLine: it.cost ? `${it.cost} gold` : '',
    body: it.description,
    hint: it.kind === 'consumable' ? 'Left-click to use. Right-click to drop.' : 'Grants its bonus while carried.',
  };
}

// Ability tooltip for the hero panel
export function abilityInfo(hero, abilityId) {
  const def = ABILITIES[abilityId];
  const st = hero.abilities.find((a) => a.id === abilityId);
  if (!def || !st) return null;
  const learned = st.level > 0;
  const nextReq = (def.heroLevelReq || [1])[Math.min(st.level, (def.heroLevelReq || [1]).length - 1)] || 1;
  return {
    title: def.name,
    subtitle: learned ? `Level ${'I'.repeat(st.level)}` : 'Not learned',
    costLine: learned ? `${def.mana[st.level - 1] || 0} mana · ${def.cooldown[st.level - 1] || 0}s cooldown` : `Requires hero level ${nextReq}`,
    body: learned ? def.stats(st.level) : def.description,
    hint: learned ? '' : 'Click the + to spend a skill point.',
  };
}
