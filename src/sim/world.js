// The game world: entities, orders, combat, economy, heroes, items, fog.
// Everything here is deterministic given the seed and the command stream, so
// the simulation can be run headlessly for balance testing.

import {
  TILE, dist, dist2, clamp, normalize, angleTo, angleDiff, approach,
  circleOverlap, makeRng, armorMultiplier, forEachTileInCircle, newId,
} from '../core/util.js';
import { FLAG, TERRAIN } from './mapgen.js';
import { Pathfinder } from './pathfinder.js';
import { FogOfWar, FOG_VISIBLE } from './fog.js';
import { UNITS, BUILDINGS, HEROES, UPGRADES, defOf, HERO_XP_TABLE, MAX_FOOD, upkeepFor, MAX_HERO_LEVEL } from '../data/human.js';
import { CREEPS, CAMP_TEMPLATES } from '../data/creeps.js';
import { ABILITIES } from '../data/abilities.js';
import { ITEMS, DROP_TABLES, SHOP_STOCK } from '../data/items.js';

export const NEUTRAL_HOSTILE = -1;
export const NEUTRAL_PASSIVE = -2;

const CREEP_DEFS = CREEPS;
const ALL_DEF = { ...UNITS, ...BUILDINGS, ...HEROES, ...CREEPS };

export function getDef(id) { return ALL_DEF[id] || null; }

// WC3 damage-vs-armour type table (rows: attack type, cols: armour type)
export const ARMOR_TYPES = ['light', 'medium', 'heavy', 'fortified', 'hero'];
const DAMAGE_TABLE = {
  normal: { light: 1.0, medium: 1.5, heavy: 1.0, fortified: 0.7, hero: 1.0 },
  pierce: { light: 2.0, medium: 0.75, heavy: 1.0, fortified: 0.35, hero: 0.5 },
  siege: { light: 1.0, medium: 0.5, heavy: 1.0, fortified: 1.5, hero: 0.5 },
  magic: { light: 1.25, medium: 0.75, heavy: 2.0, fortified: 0.35, hero: 0.5 },
  hero: { light: 1.0, medium: 1.0, heavy: 1.0, fortified: 0.5, hero: 1.0 },
  chaos: { light: 1.0, medium: 1.0, heavy: 1.0, fortified: 1.0, hero: 1.0 },
};

export const GATHER_RANGE = 70;
export const GOLD_PER_TRIP = 10;
export const LUMBER_PER_TRIP = 10;
export const START_GOLD = 500;
export const START_LUMBER = 200;

export const MINE_DEF = {
  id: 'goldmine', name: 'Gold Mine', kind: 'mine', armorType: 'fortified', armor: 0,
  sight: 400, radius: 44, footprint: [2, 2], description: 'A source of gold.',
};

export class World {
  constructor(opts = {}) {
    this.seed = opts.seed || 1;
    this.rng = makeRng(this.seed);
    this.map = opts.map;
    this.width = this.map.width;
    this.height = this.map.height;
    this.terrain = this.map.terrain;
    this.flags = this.map.flags;
    this.tileSize = TILE;
    this.worldWidth = this.width * TILE;
    this.worldHeight = this.height * TILE;

    this.path = new Pathfinder(this.width, this.height, this.flags);
    this.fog = new FogOfWar(this.width, this.height, [0, 1]);

    this.units = [];
    this.buildings = [];
    this.trees = [];
    this.items = [];
    this.corpses = [];
    this.projectiles = [];
    this.effects = [];
    this.events = [];
    this.messages = [];

    this.time = 0;
    this.tickCount = 0;
    this.byIdMap = new Map();
    this.timers = { fog: 0, aura: 0, creep: 0, food: 0, autoCast: 0 };
    this.gameOver = false;
    this.winner = null;

    this.players = (opts.playerDefs || [
      { name: 'Player', team: 0, isHuman: true },
      { name: 'Computer', team: 1, isHuman: false },
    ]).map((p, i) => ({
      id: i, name: p.name, team: p.team, isHuman: !!p.isHuman, race: p.race || 'human',
      gold: START_GOLD, lumber: START_LUMBER, foodUsed: 0, foodCap: 0, tier: 1,
      upgrades: {}, heroes: [], heroRevive: [], defeated: false,
      colorTag: i, stats: {
        unitsTrained: 0, unitsLost: 0, kills: 0, goldGathered: 0, lumberGathered: 0,
        buildingsBuilt: 0, upgradesDone: 0,
      },
    }));

    this.setupMapEntities();
  }

  // ---------------------------------------------------------------- setup
  setupMapEntities() {
    this.neutralHostile = NEUTRAL_HOSTILE;
    for (const t of this.map.trees) {
      const tree = {
        id: newId(), kind: 'tree', x: (t.tx + 0.5) * TILE, y: (t.ty + 0.5) * TILE,
        tx: t.tx, ty: t.ty, size: t.size, lumber: 100, maxLumber: 100,
        dead: false, radius: 14 * t.size, owner: NEUTRAL_PASSIVE,
      };
      this.trees.push(tree);
      this.byIdMap.set(tree.id, tree);
    }
    for (const m of this.map.mines) {
      const e = this.createMine(m.tx, m.ty, m.amount);
      e.natural = m.natural;
    }
  }

  createMine(tx, ty, amount) {
    const def = MINE_DEF;
    const e = {
      id: newId(), defId: 'goldmine', def, name: 'Gold Mine', kind: 'mine',
      owner: NEUTRAL_PASSIVE, x: (tx + 1) * TILE, y: (ty + 1) * TILE,
      tx, ty, radius: 44, gold: amount, maxGold: amount,
      hp: 1, maxHp: 1, dead: false, sight: 400, armorType: 'fortified',
      footprint: [2, 2], selected: false, isMine: true,
    };
    for (let oy = 0; oy < 2; oy++) {
      for (let ox = 0; ox < 2; ox++) {
        const id = (ty + oy) * this.width + (tx + ox);
        if (tx + ox < this.width && ty + oy < this.height) this.flags[id] |= FLAG.BLOCK | FLAG.MINE;
      }
    }
    this.buildings.push(e);
    this.byIdMap.set(e.id, e);
    return e;
  }

  startGame() {
    const starts = this.map.starts;
    this.players.forEach((p, i) => {
      const s = starts[i % starts.length];
      const bx = (s.tx + 0.5) * TILE;
      const by = (s.ty + 0.5) * TILE;
      p.startX = bx; p.startY = by;
      // town hall centered on the start point
      const th = this.createBuilding('townhall', p.id, bx, by, { complete: true, snap: true });
      // a farm beside it
      this.createBuilding('farm', p.id, bx + 4.5 * TILE, by - 1.5 * TILE, { complete: true, snap: true });
      // five peasants around the hall
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        const u = this.createUnit('peasant', p.id, bx + Math.cos(a) * 80, by + Math.sin(a) * 80, { snap: true });
        u.order = { type: 'idle' };
      }
      // second farm for a little more food
      this.createBuilding('farm', p.id, bx - 4.5 * TILE, by + 1.5 * TILE, { complete: true, snap: true });
      p.tier = 1;
    });

    // creeps: camp templates + mine guards
    for (const camp of this.map.camps) {
      const template = camp.template;
      const cx = (camp.x + 0.5) * TILE, cy = (camp.y + 0.5) * TILE;
      template.units.forEach((uid, i) => {
        const a = (i / template.units.length) * Math.PI * 2 + 0.7;
        const u = this.createUnit(uid, NEUTRAL_HOSTILE,
          cx + Math.cos(a) * 44, cy + Math.sin(a) * 44, { snap: true, creepCamp: true });
        u.homeX = cx; u.homeY = cy; u.guardRadius = u.def.guardRadius || 500;
        if (template.drops && i === 0) u.dropTable = template.drops;
        if (camp.guardMine !== null && camp.guardMine !== undefined) u.guardsMineId = camp.guardMine;
      });
    }
    for (const m of this.map.mines) {
      if (!m.unit) continue;
      const e = this.buildings.find((b) => b.isMine && b.tx === m.tx && b.ty === m.ty);
      if (!e) continue;
      for (let i = 0; i < 2; i++) {
        const a = i * Math.PI + 1.2;
        const u = this.createUnit(m.unit, NEUTRAL_HOSTILE,
          e.x + Math.cos(a) * 70, e.y + Math.sin(a) * 70, { snap: true });
        u.homeX = e.x; u.homeY = e.y; u.guardRadius = 500;
        u.dropTable = u.dropTable || 'low';
        u.mineId = e.id;
      }
    }

    this.recomputeFood();
    this.updateFog();
    this.updateTiers();
  }

  // ------------------------------------------------------------- entities
  getEntity(id) { return this.byIdMap.get(id) || null; }

  aliveUnits(owner = null) {
    const out = [];
    for (const u of this.units) {
      if (u.dead) continue;
      if (owner !== null && u.owner !== owner) continue;
      out.push(u);
    }
    return out;
  }

  aliveBuildings(owner = null) {
    const out = [];
    for (const b of this.buildings) {
      if (b.dead || b.kind === 'mine') continue;
      if (owner !== null && b.owner !== owner) continue;
      out.push(b);
    }
    return out;
  }

  ownerTeam(owner) {
    if (owner === null || owner === undefined) return -99;
    if (owner === NEUTRAL_HOSTILE) return -1;
    if (owner === NEUTRAL_PASSIVE) return -2;
    const p = this.players[owner];
    return p ? p.team : -99;
  }

  isEnemyEntity(a, b) {
    if (!a || !b || a === b) return false;
    const ta = this.ownerTeam(a.owner), tb = this.ownerTeam(b.owner);
    if (ta === -2 || tb === -2) return false;
    if (ta === -1) return tb >= 0;
    if (tb === -1) return ta >= 0;
    return ta !== tb;
  }

  isAlly(a, b) {
    if (!a || !b) return false;
    const ta = this.ownerTeam(a.owner), tb = this.ownerTeam(b.owner);
    return ta === tb && ta >= 0;
  }

  isOwn(a, b) {
    return a && b && a.owner === b.owner && a.owner >= 0;
  }

  visibleToTeam(team, e) {
    if (e.owner !== undefined && e.owner >= 0 && this.players[e.owner] && this.players[e.owner].team === team) return true;
    return this.fog.isVisible(team, e.x, e.y);
  }

  createUnit(defId, owner, x, y, opts = {}) {
    const def = ALL_DEF[defId];
    if (!def) throw new Error(`unknown unit ${defId}`);
    const e = {
      id: newId(), defId, def, name: def.name, kind: 'unit', owner,
      x, y, facing: this.rng() * Math.PI * 2, radius: def.radius || 10,
      hp: def.hp, maxHp: def.hp, mana: def.mana || 0, maxMana: def.mana || 0,
      dead: false, selected: false,
      attackCd: 0, order: { type: 'idle' }, path: null, pathIndex: 0, dest: null,
      buffs: [], aura: { armor: 0, damage: 0, manaRegen: 0, speed: 0 }, cooldowns: {},
      abilities: (def.abilities || []).map((a) => ({
        id: a.id, level: 1, autocast: a.autocast !== undefined ? a.autocast : true,
        enabled: a.autocast !== undefined ? a.autocast : true,
      })),
      items: null, carry: null, moving: false, attackAnim: 0, castAnim: 0,
      gatherTimer: 0, buildTargetId: null, workers: 0,
      homeX: x, homeY: y, guardRadius: def.guardRadius || 0,
      stunTimerX: 0, lastDamagedBy: null, lastDamagedTime: -99,
      summonTime: 0, summonDuration: 0,
      creep: !!def.creep, hero: false, level: def.level || 1,
      tags: def.tags || [], sight: def.sight || 500,
      speed: def.speed || 270, food: def.food || 0,
      baseArmor: def.armor || 0, armorType: def.armorType || 'light',
      attackType: def.attackType || 'normal', range: def.range || 70,
      cooldown: def.cooldown || 1.5, projectile: def.projectile || null,
      dmgMin: def.damage ? def.damage[0] : 0, dmgMax: def.damage ? def.damage[1] : 0,
      xpValue: def.xp || (def.food ? 12 + def.food * 10 : 10),
      bounty: def.bounty || null, dropTable: opts.dropTable || def.dropTable || null,
      abilityState: {}, _pathRequest: null, _repathTimer: 0, _idleTimer: this.rng() * 0.4,
      _wander: null,
    };
    if (def.kind === 'hero') this.initHero(e, def);
    if (opts.summonDuration) { e.summonDuration = opts.summonDuration; e.summoned = true; }
    if (opts.hp) { e.maxHp = opts.hp; e.hp = opts.hp; }
    if (opts.damage) { e.dmgMin = opts.damage[0]; e.dmgMax = opts.damage[1]; }
    if (opts.snap) {
      const b = this.freePosition(e.x, e.y, e.radius);
      e.x = b[0]; e.y = b[1];
      e.homeX = e.x; e.homeY = e.y;
    }
    if (opts.dropTable) e.dropTable = opts.dropTable;
    if (opts.creepCamp) e.creepCamp = true;
    if (owner >= 0 && !e.hero && e.kind === 'unit') {
      const hpBonus = this.upgradeBonus(e, 'hp');
      if (hpBonus) { e._hpBonus = hpBonus; e.maxHp += hpBonus; e.hp += hpBonus; }
    }

    this.units.push(e);
    this.byIdMap.set(e.id, e);
    if (e.hero) this.players[e.owner].heroes.push(e);
    return e;
  }

  createBuilding(defId, owner, x, y, opts = {}) {
    const def = ALL_DEF[defId];
    if (!def) throw new Error(`unknown building ${defId}`);
    const fp = def.footprint || [2, 2];
    // snap the footprint to the tile grid around the requested centre
    let tx = Math.round(x / TILE - fp[0] / 2);
    let ty = Math.round(y / TILE - fp[1] / 2);
    if (opts.tx !== undefined) { tx = opts.tx; ty = opts.ty; }
    if (opts.tx === undefined && (opts.snap || opts.complete)) {
      const spot = this.findBuildingSpot(tx, ty, fp[0], fp[1]);
      tx = spot[0]; ty = spot[1];
    }
    const e = {
      id: newId(), defId, def, name: def.name, kind: 'building', owner,
      tx, ty, footprint: fp,
      x: (tx + fp[0] / 2) * TILE, y: (ty + fp[1] / 2) * TILE,
      radius: Math.max(fp[0], fp[1]) * TILE * 0.5,
      hp: def.hp, maxHp: def.hp, mana: 0, maxMana: 0,
      dead: false, selected: false, complete: opts.complete !== false,
      buildProgress: opts.complete === false ? 0 : 1,
      constructing: opts.complete === false,
      trainQueue: [], researchQueue: [], rally: null, upgrading: null,
      attackCd: 0, order: { type: 'idle' }, buffs: [],
      aura: { armor: 0, damage: 0, manaRegen: 0, speed: 0 },
      sight: def.sight || 600, armorType: def.armorType || 'fortified',
      baseArmor: def.armor || 0, attackType: def.attackType || 'normal',
      range: def.attack ? def.attack.range : 0,
      cooldown: def.attack ? def.attack.cooldown : 2,
      projectile: def.attack ? def.attack.projectile : null,
      dmgMin: def.attack ? def.attack.damage[0] : 0,
      dmgMax: def.attack ? def.attack.damage[1] : 0,
      builders: new Set(), foodProvided: def.foodProvided || 0,
      isMine: false, actions: {},
    };
    if (opts.complete === false) e.hp = Math.max(1, Math.round(def.hp * 0.1));
    this.markFootprint(e, true);
    this.buildings.push(e);
    this.byIdMap.set(e.id, e);
    return e;
  }

  markFootprint(e, block) {
    for (let oy = 0; oy < e.footprint[1]; oy++) {
      for (let ox = 0; ox < e.footprint[0]; ox++) {
        const tx = e.tx + ox, ty = e.ty + oy;
        if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) continue;
        const id = ty * this.width + tx;
        if (block) this.flags[id] |= FLAG.BLOCK | FLAG.BUILDING;
        else this.flags[id] &= ~(FLAG.BLOCK | FLAG.BUILDING);
      }
    }
  }

  findBuildingSpot(tx, ty, fw, fh, radius = 6) {
    const free = (x, y) => {
      for (let oy = 0; oy < fh; oy++) {
        for (let ox = 0; ox < fw; ox++) {
          const nx = x + ox, ny = y + oy;
          if (nx < 1 || ny < 1 || nx >= this.width - 1 || ny >= this.height - 1) return false;
          if (this.flags[ny * this.width + nx] & FLAG.BLOCK) return false;
        }
      }
      return true;
    };
    if (free(tx, ty)) return [tx, ty];
    for (let r = 1; r <= radius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          if (free(tx + dx, ty + dy)) return [tx + dx, ty + dy];
        }
      }
    }
    return [tx, ty];
  }

  canPlaceBuilding(def, tx, ty) {
    const fp = def.footprint || [2, 2];
    for (let oy = 0; oy < fp[1]; oy++) {
      for (let ox = 0; ox < fp[0]; ox++) {
        const x = tx + ox, y = ty + oy;
        if (x < 1 || y < 1 || x >= this.width - 1 || y >= this.height - 1) return false;
        if (this.flags[y * this.width + x] & FLAG.BLOCK) return false;
      }
    }
    return true;
  }

  freePosition(x, y, radius) {
    for (let i = 0; i < 60; i++) {
      const a = i * 2.399;
      const r = i === 0 ? 0 : 6 + i * 3;
      const nx = x + Math.cos(a) * r, ny = y + Math.sin(a) * r;
      const tx = Math.floor(nx / TILE), ty = Math.floor(ny / TILE);
      if (tx < 1 || ty < 1 || tx >= this.width - 1 || ty >= this.height - 1) continue;
      if (this.flags[ty * this.width + tx] & FLAG.BLOCK) continue;
      return [nx, ny];
    }
    return [x, y];
  }

  // ------------------------------------------------------------- geometry
  unitsInRadius(x, y, r, filter) {
    const out = [];
    const r2 = r * r;
    for (const u of this.units) {
      if (u.dead) continue;
      if (dist2(u.x, u.y, x, y) <= r2 + u.radius * u.radius) {
        if (!filter || filter(u)) out.push(u);
      }
    }
    return out;
  }

  buildingsInRadius(x, y, r, filter) {
    const out = [];
    for (const b of this.buildings) {
      if (b.dead) continue;
      if (dist(b.x, b.y, x, y) <= r + b.radius) {
        if (!filter || filter(b)) out.push(b);
      }
    }
    return out;
  }

  treesInRadius(x, y, r) {
    const out = [];
    for (const t of this.trees) {
      if (t.dead) continue;
      if (dist2(t.x, t.y, x, y) <= (r + t.radius) * (r + t.radius)) out.push(t);
    }
    return out;
  }

  enemiesInRadius(source, x, y, r, opts = {}) {
    let out = this.unitsInRadius(x, y, r, (u) => this.isEnemyEntity(source, u) && !u.dead);
    if (opts.includeBuildings) {
      out = out.concat(this.buildingsInRadius(x, y, r, (b) =>
        !b.dead && b.kind !== 'mine' && this.isEnemyEntity(source, b)));
    }
    return out;
  }

  teamEntities(team) {
    const out = [];
    for (const u of this.units) {
      if (u.dead) continue;
      if (u.owner >= 0 && this.players[u.owner] && this.players[u.owner].team === team) out.push(u);
    }
    for (const b of this.buildings) {
      if (b.dead || b.kind === 'mine') continue;
      if (b.owner >= 0 && this.players[b.owner] && this.players[b.owner].team === team) out.push(b);
    }
    return out;
  }

  // ------------------------------------------------------------- stats
  upgradeLevel(owner, upgradeId) {
    const p = this.players[owner];
    if (!p) return 0;
    return p.upgrades[upgradeId] || 0;
  }

  upgradeBonus(e, key) {
    if (e.owner < 0 || e.kind === 'mine') return 0;
    let total = 0;
    for (const id of Object.keys(this.players[e.owner].upgrades)) {
      const up = UPGRADES[id];
      const lvl = this.players[e.owner].upgrades[id];
      if (!up || !lvl) continue;
      const affects = up.affects || [];
      let match = false;
      if (e.kind === 'building') match = affects.includes('building');
      else match = affects.some((tag) => (e.tags || []).includes(tag));
      if (match && up.bonus[key]) total += up.bonus[key] * lvl;
    }
    return total;
  }

  effectiveArmor(e) {
    if (!e || e.dead) return 0;
    let armor = e.baseArmor || 0;
    if (e.hero) armor = e.baseArmor + Math.floor(e.attributes.agi / 7);
    if (e.owner >= 0) armor += this.upgradeBonus(e, 'armor');
    armor += e.aura ? e.aura.armor : 0;
    if (e.buffs) {
      for (const b of e.buffs) {
        if (b.armor) armor += b.armor;
      }
    }
    if (e.items) {
      for (const it of e.items) {
        if (it && ITEMS[it.defId].passive && ITEMS[it.defId].passive.armor) armor += ITEMS[it.defId].passive.armor;
      }
    }
    return Math.max(-20, armor);
  }

  effectiveDamageRange(e) {
    let min = e.dmgMin || 0, max = e.dmgMax || 0;
    if (e.hero) {
      const primary = e.attributes[e.def.primary];
      const basePrimary = e.def.attributes[e.def.primary];
      const bonus = Math.floor(primary - basePrimary);
      min += bonus; max += bonus;
    }
    let flat = e.aura ? e.aura.damage : 0;
    let scale = 1;
    if (e.buffs) {
      for (const b of e.buffs) {
        if (b.damageBonus) flat += b.damageBonus;
        if (b.damageScale) scale += b.damageScale;
      }
    }
    if (e.items) {
      for (const it of e.items) {
        if (it && ITEMS[it.defId].passive && ITEMS[it.defId].passive.damage) flat += ITEMS[it.defId].passive.damage;
      }
    }
    if (e.owner >= 0) flat += this.upgradeBonus(e, 'damage');
    return [Math.max(1, (min + flat) * scale), Math.max(1, (max + flat) * scale)];
  }

  effectiveSpeed(e) {
    let speed = e.speed || 0;
    if (e.items) {
      for (const it of e.items) {
        if (it && ITEMS[it.defId].passive && ITEMS[it.defId].passive.speed) speed += ITEMS[it.defId].passive.speed;
      }
    }
    speed += e.aura ? (e.aura.speed || 0) : 0;
    let slow = 0;
    if (e.buffs) {
      for (const b of e.buffs) {
        if (b.root) return 0;
        if (b.slow) slow = Math.max(slow, b.slow);
      }
    }
    speed *= (1 - slow);
    return Math.max(0, speed);
  }

  isStunned(e) {
    if (!e.buffs) return false;
    for (const b of e.buffs) if (b.stun) return true;
    return false;
  }

  isRooted(e) {
    if (!e.buffs) return false;
    for (const b of e.buffs) if (b.root) return true;
    return false;
  }

  isInvulnerable(e) {
    if (!e.buffs) return false;
    for (const b of e.buffs) if (b.invulnerable) return true;
    return false;
  }

  isMagicImmune(e) {
    if (!e.buffs) return false;
    for (const b of e.buffs) if (b.magicImmune) return true;
    return false;
  }

  isInvisible(e) {
    if (!e.buffs) return false;
    for (const b of e.buffs) if (b.invisible) return true;
    return false;
  }

  hasBuff(e, id) {
    if (!e.buffs) return false;
    for (const b of e.buffs) if (b.id === id) return true;
    return false;
  }

  canTarget(source, target) {
    if (!target || target.dead) return false;
    if (target.kind === 'mine' || target.kind === 'tree') return false;
    if (!this.isEnemyEntity(source, target)) return false;
    if (target.owner >= 0) {
      const team = this.players[source.owner] ? this.players[source.owner].team : 0;
      if (!this.visibleToTeam(team, target)) return false;
      if (this.isInvisible(target)) return false;
    }
    return true;
  }

  // ------------------------------------------------------------- orders
  clearOrder(e) {
    e.order = { type: 'idle' };
    e.attackTarget = null;
    e.targetId = null;
    e.path = null;
    e.dest = null;
    e.pathIndex = 0;
    e.gatherTimer = 0;
  }

  orderStop(e) {
    if (e.dead) return;
    this.clearOrder(e);
    if (e.kind === 'building') {
      // cancel construction/training when stopped? WC3 stop doesn't cancel training.
    }
  }

  orderMove(e, x, y) {
    if (e.dead) return;
    if (e.kind === 'building') { e.rally = { x, y }; return; }
    e.order = { type: 'move', x, y };
    e.attackTarget = null;
    e.dest = { x, y };
    e.path = null; e.pathIndex = 0;
    this.requestPath(e, x, y);
    if (e.carry && e.carry.amount > 0 && e.order.type === 'move') {
      // moving manually keeps carried resources; they are delivered on next drop-off order
    }
  }

  orderAttack(e, targetId) {
    if (e.dead || e.kind === 'building') return;
    const t = this.getEntity(targetId);
    if (!t) return;
    e.order = { type: 'attack', targetId };
    e.attackTarget = t;
    e.path = null; e.pathIndex = 0; e.dest = null;
  }

  orderAttackMove(e, x, y) {
    if (e.dead || e.kind === 'building') return;
    e.order = { type: 'attackmove', x, y };
    e.attackTarget = null;
    e.dest = { x, y };
    e.path = null; e.pathIndex = 0;
    this.requestPath(e, x, y);
  }

  orderHold(e) {
    if (e.kind === 'building') return;
    e.order = { type: 'hold' };
    e.path = null; e.dest = null;
  }

  orderGather(e, targetId) {
    const t = this.getEntity(targetId);
    if (!t) return;
    const isGold = t.isMine;
    const isTree = t.kind === 'tree';
    if (!isGold && !isTree) return;
    if (!e.def.canGather) return;
    e.order = { type: 'gather', targetId, resource: isGold ? 'gold' : 'lumber', phase: 'travel' };
    e.path = null; e.pathIndex = 0; e.dest = null;
    e.gatherTimer = 0;
  }

  orderBuild(e, buildingId) {
    const b = this.getEntity(buildingId);
    if (!b || e.kind === 'building' || !e.def.canBuild) return;
    if (b.complete) { this.orderRepair(e, buildingId); return; }
    e.order = { type: 'build', targetId: buildingId };
    e.path = null; e.pathIndex = 0; e.dest = null;
  }

  orderRepair(e, targetId) {
    const b = this.getEntity(targetId);
    if (!b || e.kind === 'building' || !e.def.canRepair) return;
    e.order = { type: 'repair', targetId };
    e.path = null; e.pathIndex = 0; e.dest = null;
  }

  orderPickup(e, itemId) {
    const it = this.items.find((i) => i.id === itemId);
    if (!it) return;
    e.order = { type: 'pickup', itemId };
    e.path = null; e.pathIndex = 0;
  }

  orderCast(e, abilityId, level, tx, ty, targetId) {
    if (e.dead) return false;
    const def = ABILITIES[abilityId];
    if (!def) return false;
    const cd = e.cooldowns[abilityId] || 0;
    if (cd > 0) return false;
    const manaCost = def.mana[Math.max(0, level - 1)] || 0;
    if (e.mana < manaCost) {
      this.alertOwner(e.owner, 'Not enough mana.');
      return false;
    }
    const target = targetId ? this.getEntity(targetId) : null;
    e.order = { type: 'cast', abilityId, level, tx, ty, targetId, phase: 'approach' };
    e.path = null; e.pathIndex = 0; e.dest = null;
    if (def.kind === 'none') {
      return this.completeCast(e);
    }
    if (def.kind === 'unit' || def.kind === 'autocast') {
      if (!target) return false;
      e.order.targetId = target.id;
    }
    return true;
  }

  completeCast(e) {
    const o = e.order;
    if (!o || o.type !== 'cast') return false;
    const def = ABILITIES[o.abilityId];
    if (!def) return false;
    const lvl = clamp(o.level || 1, 1, def.levels || 1);
    let target = o.targetId ? this.getEntity(o.targetId) : null;
    if ((def.kind === 'unit' || def.kind === 'autocast') && (!target || target.dead)) return false;
    if (def.kind === 'unit' || def.kind === 'autocast') {
      if (!this.validAbilityTarget(e, def, target)) {
        this.alertOwner(e.owner, 'Invalid target.');
        return false;
      }
    }
    const manaCost = def.mana[lvl - 1] || 0;
    if (e.mana < manaCost) return false;
    e.mana -= manaCost;
    const cd = def.cooldown[lvl - 1] || 0;
    if (cd > 0) e.cooldowns[o.abilityId] = cd;
    e.castAnim = 0.35;
    const tx = o.tx !== undefined && o.tx !== null ? o.tx : (target ? target.x : e.x);
    const ty = o.ty !== undefined && o.ty !== null ? o.ty : (target ? target.y : e.y);
    try {
      def.effect(this, e, lvl, tx, ty, target);
    } catch (err) {
      // A mis-targeted ability must never crash the sim.
      console.warn('ability effect failed', o.abilityId, err);
    }
    this.events.push({ type: 'cast', ability: o.abilityId, x: e.x, y: e.y, owner: e.owner });
    if (def.kind !== 'none' && def.kind !== 'passive') {
      // manual cast from a unit with that ability keeps the order otherwise idle
    }
    e.order = { type: 'idle' };
    return true;
  }

  validAbilityTarget(caster, def, target) {
    if (!target || target.dead) return false;
    if (def.target === 'enemy') return this.canTarget(caster, target) || (target.kind === 'building' && this.isEnemyEntity(caster, target));
    if (def.target === 'ally') return this.isAlly(caster, target) && !target.dead;
    if (def.target === 'point') return true;
    return true;
  }

  // ------------------------------------------------------------- pathing
  requestPath(e, x, y) {
    if (this.path.lineWalkable(e.x, e.y, x, y)) {
      e.path = null;
      e.dest = { x, y };
      return;
    }
    e._pathRequest = { x, y };
    e.dest = { x, y };
  }

  // ------------------------------------------------------------- update
  update(dt) {
    if (this.gameOver) { this.updateEffects(dt); return; }
    dt = Math.min(dt, 0.1);
    this.time += dt;
    this.tickCount++;

    this.path.serviceQueue(this.units, 2);

    for (const e of this.units) {
      if (e.dead) continue;
      this.updateUnit(e, dt);
    }
    for (const b of this.buildings) {
      if (b.dead || b.kind === 'mine') continue;
      this.updateBuilding(b, dt);
    }
    this.updateProjectiles(dt);
    this.updateEffects(dt);
    this.resolveCollisions();

    this.timers.aura += dt;
    if (this.timers.aura >= 0.2) { this.timers.aura = 0; this.updateAuras(); }
    this.timers.autoCast += dt;
    if (this.timers.autoCast >= 0.35) { this.timers.autoCast = 0; this.updateAutoCasts(); }
    this.timers.creep += dt;
    if (this.timers.creep >= 0.4) { this.timers.creep = 0; this.updateCreeps(); }
    this.timers.fog += dt;
    if (this.timers.fog >= 0.15) { this.timers.fog = 0; this.updateFog(); }
    this.timers.food += dt;
    if (this.timers.food >= 0.25) { this.timers.food = 0; this.recomputeFood(); }
    this.cleanup(dt);
    this.checkVictory();
  }

  updateUnit(e, dt) {
    // timers
    e.attackCd = Math.max(0, e.attackCd - dt);
    e.attackAnim = Math.max(0, e.attackAnim - dt);
    e.castAnim = Math.max(0, e.castAnim - dt);
    for (const k in e.cooldowns) {
      e.cooldowns[k] = Math.max(0, e.cooldowns[k] - dt);
    }
    this.tickBuffs(e, dt);
    this.tickRegen(e, dt);
    if (e.summonDuration) {
      e.summonTime += dt;
      if (e.summonTime >= e.summonDuration) { this.killEntity(e, null, true); return; }
    }
    if (e.def.temporary && !e.summoned) {
      e.summonTime += dt;
      if (e.summonTime >= e.def.temporary) {
        // militia reverts to a peasant
        this.transformUnit(e, 'peasant');
        return;
      }
    }
    if (this.isStunned(e)) { e.moving = false; return; }

    const o = e.order;
    switch (o.type) {
      case 'idle': this.doIdle(e, dt); break;
      case 'move': this.doMoveOrder(e, dt); break;
      case 'attack': this.doAttackOrder(e, dt); break;
      case 'attackmove': this.doAttackMove(e, dt); break;
      case 'hold': this.doHold(e, dt); break;
      case 'gather': this.doGather(e, dt); break;
      case 'return': this.doReturn(e, dt); break;
      case 'build': this.doBuild(e, dt); break;
      case 'repair': this.doRepair(e, dt); break;
      case 'cast': this.doCastOrder(e, dt); break;
      case 'pickup': this.doPickup(e, dt); break;
      case 'summoned-anchor': this.doIdle(e, dt); break;
      default: this.doIdle(e, dt); break;
    }
    this.stepMovement(e, dt);
    e.moving = !!e._movingThisFrame;
    e._movingThisFrame = false;
    if (e.moving) {
      // face movement direction
      if (e._moveAngle !== undefined) {
        const d = angleDiff(e.facing, e._moveAngle);
        e.facing += clamp(d, -8 * dt, 8 * dt);
      }
    }
  }

  // movement that respects the blocked grid with simple axis sliding
  stepMovement(e, dt) {
    // units locked in melee (attacking a target in range) hold their ground
    if (e.order && (e.order.type === 'attack' || e.order.type === 'hold') && e.attackTarget && !e.attackTarget.dead) {
      const d = dist(e.x, e.y, e.attackTarget.x, e.attackTarget.y);
      if (d <= (e.range || 70) + (e.attackTarget.radius || 0) + 4 && !e.path) {
        e.dest = null;
        return;
      }
    }
    if (e.moving === false && !e.dest && !e.path) return;
    const speed = this.effectiveSpeed(e);
    if (speed <= 0) return;
    let tx, ty, stopDist = 4;
    if (e.path && e.pathIndex < e.path.length) {
      const wp = e.path[e.pathIndex];
      tx = wp.x; ty = wp.y;
      if (dist(e.x, e.y, tx, ty) < 12) {
        e.pathIndex++;
        if (e.pathIndex >= e.path.length) { e.path = null; }
        return;
      }
    } else if (e.dest) {
      tx = e.dest.x; ty = e.dest.y;
      stopDist = e._stopDist || 4;
    } else return;
    const d = dist(e.x, e.y, tx, ty);
    if (d <= stopDist) {
      if (!e.path || e.pathIndex >= e.path.length) {
        e.dest = null;
        e.path = null;
      }
      return;
    }
    const [dx, dy] = normalize(tx - e.x, ty - e.y);
    const step = Math.min(d, speed * dt);
    const nx = e.x + dx * step, ny = e.y + dy * step;
    this.tryMove(e, nx, ny, dx, dy, step);
    e._movingThisFrame = true;
    e._moveAngle = Math.atan2(dy, dx);
  }

  tryMove(e, nx, ny, dx, dy, step) {
    const blockedAt = (x, y) => {
      const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
      if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return true;
      return (this.flags[ty * this.width + tx] & FLAG.BLOCK) !== 0 && !(e.ignoresBlocking);
    };
    // sample the unit's radius so it doesn't clip into walls
    const r = Math.min(e.radius, 12);
    if (!blockedAt(nx, ny) && !blockedAt(nx + Math.sign(dx) * r, ny + Math.sign(dy) * r)) {
      e.x = nx; e.y = ny;
      return;
    }
    if (!blockedAt(nx, e.y)) { e.x = nx; return; }
    if (!blockedAt(e.x, ny)) { e.y = ny; return; }
    // stuck: request a fresh path if we have a destination
    if (e.dest && !e.path) {
      e._repathTimer = (e._repathTimer || 0) + 1;
      if (e._repathTimer > 6) {
        e._repathTimer = 0;
        this.requestPath(e, e.dest.x, e.dest.y);
      }
    }
  }

  doIdle(e, dt) {
    e.dest = null;
    if (e.def.canGather && e.carry && e.carry.amount > 0) {
      this.startReturn(e);
      return;
    }
    // auto acquire enemies
    e._idleTimer = (e._idleTimer || 0) + dt;
    if (e._idleTimer < 0.3) return;
    e._idleTimer = 0;
    if (e.crewGuard) return;
    const target = this.findAutoTarget(e, e.range + 150);
    if (target) {
      this.orderAttack(e, target.id);
    }
  }

  findAutoTarget(e, radius, opts = {}) {
    if (e.owner < 0 || e.owner === NEUTRAL_PASSIVE) {
      return null;
    }
    const team = this.players[e.owner] ? this.players[e.owner].team : 0;
    let best = null, bestD = Infinity;
    for (const u of this.units) {
      if (u.dead || u === e) continue;
      if (!this.isEnemyEntity(e, u)) continue;
      if (!this.visibleToTeam(team, u)) continue;
      if (this.isInvisible(u)) continue;
      const d = dist(e.x, e.y, u.x, u.y);
      if (d <= radius && d < bestD) { bestD = d; best = u; }
    }
    if (best) return best;
    if (opts.includeBuildings) {
      for (const b of this.buildings) {
        if (b.dead || b.kind === 'mine' || b === e) continue;
        if (!this.isEnemyEntity(e, b)) continue;
        if (!this.visibleToTeam(team, b)) continue;
        const d = this.edgeDistance(e, b);
        if (d <= radius + (e.range || 0) && d < bestD) { bestD = d; best = b; }
      }
    }
    return best;
  }

  doMoveOrder(e, dt) {
    if (!e.dest) { this.clearOrder(e); return; }
    if (dist(e.x, e.y, e.dest.x, e.dest.y) <= 6) { this.clearOrder(e); return; }
  }

  doAttackMove(e, dt) {
    if (!e.attackTarget) {
      const t = this.findAutoTarget(e, e.range + 200, { includeBuildings: true });
      if (t) { e.attackTarget = t; }
    }
    if (e.attackTarget && !e.attackTarget.dead) {
      const keep = this.doAttackOrder(e, dt, true);
      if (keep) return;
    } else {
      e.attackTarget = null;
    }
    if (e.order.type === 'attackmove' && e.order.x !== undefined) {
      e.dest = { x: e.order.x, y: e.order.y };
      if (dist(e.x, e.y, e.order.x, e.order.y) < 8) this.clearOrder(e);
    }
  }

  doHold(e, dt) {
    e.dest = null;
    if (!e.attackTarget) {
      const t = this.findAutoTarget(e, e.range + 60);
      if (t && dist(e.x, e.y, t.x, t.y) <= e.range + t.radius) {
        e.attackTarget = t;
      }
    }
    if (e.attackTarget) this.doAttackOrder(e, dt, true);
  }

  doAttackOrder(e, dt, keepOrder) {
    const target = e.attackTarget && !e.attackTarget.dead ? e.attackTarget : null;
    if (!target) {
      e.attackTarget = null;
      if (!keepOrder) this.clearOrder(e);
      return false;
    }
    if (target.owner >= 0) {
      const team = this.players[e.owner] ? this.players[e.owner].team : 0;
      if (!this.visibleToTeam(team, target) && e.owner >= 0) {
        e.attackTarget = null;
        if (!keepOrder) this.clearOrder(e);
        return false;
      }
    }
    const reach = e.range;
    const d = this.edgeDistance(e, target);
    if (d <= reach) {
      e.dest = null;
      e.path = null;
      e.facing = angleTo(e.x, e.y, target.x, target.y);
      if (e.attackCd <= 0) {
        e.attackCd = this.attackCooldown(e);
        this.performAttack(e, target);
      }
      e._inRange = true;
      return true;
    }
    e._inRange = false;
    // chase: stop just inside weapon range of the target's edge
    e._stopDist = 6;
    const margin = Math.max(4, Math.min(reach * 0.35, 40));
    const [qx, qy] = this.approachPoint(target, e.x, e.y, margin);
    if (target.kind === 'unit' && this.path.lineWalkable(e.x, e.y, target.x, target.y)) {
      e.dest = { x: target.x, y: target.y };
      e.path = null;
    } else if (!e.dest || dist(e.dest.x, e.dest.y, qx, qy) > 28) {
      this.requestPath(e, qx, qy);
    }
    return true;
  }

  rectDistance(b, x, y) {
    const minx = b.tx * TILE, miny = b.ty * TILE;
    const maxx = minx + b.footprint[0] * TILE, maxy = miny + b.footprint[1] * TILE;
    const dx = Math.max(minx - x, 0, x - maxx);
    const dy = Math.max(miny - y, 0, y - maxy);
    return Math.sqrt(dx * dx + dy * dy);
  }

  // Closest point on a building's footprint, pushed outwards by `margin` so a
  // unit can stand next to it without entering the blocked tiles.
  closestPointOnBuilding(b, x, y, margin = 14) {
    const minx = b.tx * TILE, miny = b.ty * TILE;
    const maxx = minx + b.footprint[0] * TILE, maxy = miny + b.footprint[1] * TILE;
    const cx = clamp(x, minx, maxx), cy = clamp(y, miny, maxy);
    let dx = x - cx, dy = y - cy;
    let len = Math.hypot(dx, dy);
    if (len < 1e-3) {
      dx = x - (minx + maxx) / 2; dy = y - (miny + maxy) / 2;
      len = Math.hypot(dx, dy) || 1;
    }
    const px = clamp(cx + (dx / len) * margin, minx - margin, maxx + margin);
    const py = clamp(cy + (dy / len) * margin, miny - margin, maxy + margin);
    return [px, py];
  }

  // Distance from a unit to the *edge* of any target, which is what all of the
  // range/arrival checks use.
  edgeDistance(from, target) {
    if (!target) return Infinity;
    if (target.footprint && target.tx !== undefined) {
      return Math.max(0, this.rectDistance(target, from.x, from.y));
    }
    if (target.radius) return Math.max(0, dist(from.x, from.y, target.x, target.y) - target.radius);
    return dist(from.x, from.y, target.x, target.y);
  }

  approachPoint(target, x, y, margin = 14) {
    if (target.footprint && target.tx !== undefined) return this.closestPointOnBuilding(target, x, y, margin);
    const [dx, dy] = normalize(x - target.x, y - target.y);
    const r = (target.radius || 10) + margin;
    return [target.x + dx * r, target.y + dy * r];
  }

  attackCooldown(e) {
    let cd = e.cooldown || 1.5;
    if (e.buffs) for (const b of e.buffs) if (b.attackSpeed) cd /= (1 + b.attackSpeed);
    return cd;
  }

  performAttack(e, target) {
    e.attackAnim = 0.25;
    const [min, max] = this.effectiveDamageRange(e);
    let dmg = this.rng.range(min, max);
    // bash / crit procs
    if (e.abilities) {
      for (const a of e.abilities) {
        const adef = ABILITIES[a.id];
        if (!adef || !adef.passiveAttack) continue;
        if (a.level > 0 && a.enabled) {
          const proc = adef.proc(a.level);
          if (this.rng() < proc.chance) {
            dmg += proc.bonus;
            if (target.buffs) this.addBuff(target, { id: 'bash_stun', name: 'Stunned', duration: proc.stun, stun: true }, e);
            this.fxBurst(target.x, target.y, 16);
          }
        }
      }
    }
    const isRanged = e.range > 100 || e.projectile;
    const height = isRanged ? 22 : 0;
    if (isRanged) {
      this.spawnProjectile({
        x: e.x, y: e.y, target, speed: e.projectile === 'cannon' ? 500 : 950,
        owner: e.owner, sourceId: e.id, damage: dmg, attackType: e.attackType,
        art: e.projectile || 'arrow', height, splash: e.projectile === 'cannon' ? 90 : 0,
      });
    } else {
      this.applyWeaponDamage(e, target, dmg, e.attackType);
    }
    // attacking breaks invisibility
    if (this.hasBuff(e, 'invisible')) this.removeBuff(e, 'invisible');
    this.events.push({ type: 'attack', x: e.x, y: e.y, art: isRanged ? e.projectile : 'melee', owner: e.owner });
  }

  applyWeaponDamage(source, target, raw, attackType) {
    if (!target || target.dead) return 0;
    if (this.isInvulnerable(target)) return 0;
    const curAttackType = attackType || source.attackType || 'normal';
    if (curAttackType === 'magic' && this.isMagicImmune(target)) return 0;
    const at = DAMAGE_TABLE[curAttackType] || DAMAGE_TABLE.normal;
    const typeMult = at[target.armorType] !== undefined ? at[target.armorType] : 1;
    if (typeMult <= 0) return 0;
    const armor = this.effectiveArmor(target);
    const armorMult = armorMultiplier(armor);
    let dmg = raw * typeMult * armorMult;
    if (curAttackType === 'magic') dmg *= 1.0;
    return this.damage(target, dmg, source, curAttackType);
  }

  damage(target, amount, source, damageType = 'physical') {
    if (!target || target.dead || amount <= 0) return 0;
    if (this.isInvulnerable(target)) return 0;
    if (target.kind === 'tree') {
      target.lumber -= amount;
      if (target.lumber <= 0) this.removeTree(target);
      return amount;
    }
    if (target.kind === 'mine') return 0;
    target.hp -= amount;
    if (source) {
      target.lastDamagedBy = source.id;
      target.lastDamagedTime = this.time;
    }
    this.events.push({ type: 'damage', x: target.x, y: target.y, amount, kind: damageType });
    if (target.owner >= 0 && target.owner < this.players.length && target.isHero) {
      // nothing extra; hero death handled below
    }
    // creeps retaliate
    if (target.kind === 'unit' && target.creep && source && target.order.type === 'idle') {
      this.orderAttack(target, source.id);
    }
    // player units auto-fight back when attacked by creeps
    if (target.kind === 'unit' && target.owner >= 0 && source && target.order.type === 'idle' && this.isEnemyEntity(target, source)) {
      this.orderAttack(target, source.id);
    }
    if (target.hp <= 0) {
      this.killEntity(target, source);
    }
    return amount;
  }

  healUnit(target, amount) {
    if (!target || target.dead) return 0;
    const before = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + amount);
    const healed = target.hp - before;
    if (healed > 0) this.events.push({ type: 'heal', x: target.x, y: target.y, amount: healed });
    return healed;
  }

  killEntity(e, source, silent = false) {
    if (e.dead) return;
    e.dead = true;
    e.hp = 0;
    e.selected = false;
    if (e.kind === 'tree') { this.removeTree(e); return; }
    if (e.kind === 'mine') return;
    if (e.kind === 'building') {
      this.markFootprint(e, false);
      // towers and buildings can be rebuilt after death
      this.events.push({ type: 'buildingDeath', x: e.x, y: e.y, owner: e.owner });
      if (e.owner >= 0) this.players[e.owner].stats.buildingsBuilt = this.players[e.owner].stats.buildingsBuilt;
      const killerPlayer = source && source.owner >= 0 ? this.players[source.owner] : null;
      if (killerPlayer) killerPlayer.stats.kills++;
      // refund nothing; cancel queues
      e.trainQueue = []; e.researchQueue = [];
      return;
    }
    if (silent) { return; }
    // unit death
    e.path = null; e.dest = null;
    if (e.owner >= 0) this.players[e.owner].stats.unitsLost++;
    const killerPlayer = source && source.owner >= 0 ? this.players[source.owner] : null;
    if (killerPlayer) killerPlayer.stats.kills++;

    if (e.hero) {
      this.onHeroDeath(e);
      return;
    }
    // bounty and drops
    if (e.creep && killerPlayer && e.bounty) {
      const gold = this.rng.int(e.bounty[0], e.bounty[1]);
      killerPlayer.gold += gold;
      this.alertOwner(source.owner, `+${gold} gold`);
    }
    if (e.creep && e.dropTable && this.rng.chance(0.75)) {
      const table = DROP_TABLES[e.dropTable] || DROP_TABLES.low;
      this.dropItem(this.rng.pick(table), e.x, e.y);
    }
    // experience to nearby heroes of the killer's team
    this.awardXp(e, source);
    this.corpses.push({
      defId: e.defId, owner: e.owner, x: e.x, y: e.y, ttl: 30, facing: e.facing,
    });
    e.corpseTime = this.time;
    e.removeAt = this.time + 10;
    this.events.push({ type: 'death', x: e.x, y: e.y, owner: e.owner, hero: !!e.hero });
  }

  awardXp(victim, source) {
    if (!source || source.owner < 0 || source.owner === undefined) return;
    const team = this.players[source.owner] ? this.players[source.owner].team : -1;
    const xp = victim.xpValue || (victim.level ? victim.level * 15 : 10);
    if (xp <= 0) return;
    const heroes = [];
    for (const p of this.players) {
      if (p.team !== team) continue;
      for (const h of p.heroes) {
        if (!h.dead && dist(h.x, h.y, victim.x, victim.y) <= 1200) heroes.push(h);
      }
    }
    if (!heroes.length) return;
    const share = Math.max(1, Math.round(xp / Math.max(1, heroes.length)));
    for (const h of heroes) this.gainXp(h, share);
  }

  removeTree(tree) {
    tree.dead = true;
    const id = tree.ty * this.width + tree.tx;
    this.flags[id] &= ~(FLAG.BLOCK | FLAG.TREE);
    const i = this.trees.indexOf(tree);
    if (i >= 0) this.trees.splice(i, 1);
    this.byIdMap.delete(tree.id);
    this.events.push({ type: 'treeDown', x: tree.x, y: tree.y });
  }

  // ------------------------------------------------------------- gathering
  doGather(e, dt) {
    const o = e.order;
    if (e.carry && e.carry.amount > 0) { this.startReturn(e); return; }
    let target = this.getEntity(o.targetId);
    if (!target || target.dead || (target.isMine && target.gold <= 0)) {
      const found = this.findNearestResource(e, o.resource);
      if (!found) { this.clearOrder(e); return; }
      o.targetId = found.id;
      target = found;
    }
    const d = this.edgeDistance(e, target);
    if (d > GATHER_RANGE) {
      e._stopDist = 6;
      const [qx, qy] = this.approachPoint(target, e.x, e.y, 10);
      if (!e.dest || dist(e.dest.x, e.dest.y, qx, qy) > 16) this.requestPath(e, qx, qy);
      return;
    }
    e.dest = null; e.path = null;
    e.facing = angleTo(e.x, e.y, target.x, target.y);
    e.gatherTimer += dt;
    e.attackAnim = 0.15;
    const duration = o.resource === 'gold' ? 0.9 : 1.1;
    if (e.gatherTimer >= duration) {
      e.gatherTimer = 0;
      if (target.isMine) {
        if (target.gold <= 0) { this.clearOrder(e); return; }
        const take = Math.min(GOLD_PER_TRIP, target.gold);
        target.gold -= take;
        e.carry = { type: 'gold', amount: take };
        if (target.gold <= 0) this.depleteMine(target);
      } else if (target.kind === 'tree') {
        const take = Math.min(LUMBER_PER_TRIP, target.lumber);
        target.lumber -= take;
        e.carry = { type: 'lumber', amount: take };
        if (target.lumber <= 0) this.removeTree(target);
      }
      this.startReturn(e);
    }
  }

  startReturn(e) {
    const dropoff = this.findDropoff(e, e.carry ? e.carry.type : 'gold');
    if (!dropoff) {
      this.clearOrder(e);
      this.alertOwner(e.owner, 'No drop-off point available.');
      return;
    }
    e.order = { type: 'return', dropoffId: dropoff.id, resource: e.carry ? e.carry.type : 'gold' };
    e.path = null; e.dest = null; e.gatherTimer = 0;
  }

  doReturn(e, dt) {
    let dropoff = this.getEntity(e.order.dropoffId);
    if (!dropoff || dropoff.dead) {
      dropoff = this.findDropoff(e, e.order.resource);
      if (!dropoff) { this.clearOrder(e); return; }
      e.order.dropoffId = dropoff.id;
    }
    const [qx, qy] = this.closestPointOnBuilding(dropoff, e.x, e.y, 10);
    const d = this.edgeDistance(e, dropoff);
    if (d > 46) {
      e._stopDist = 6;
      if (!e.dest || dist(e.dest.x, e.dest.y, qx, qy) > 16) this.requestPath(e, qx, qy);
      return;
    }
    e.dest = null; e.path = null;
    if (e.carry && e.carry.amount > 0) {
      this.depositResources(e);
    }
    // go back to gathering if we still have a target
    if (e.owner >= 0 && e.def.canGather) {
      const res = e.order.resource;
      const prev = this.getEntity(e.order.dropoffId);
      const target = this.findNearestResource(e, res);
      if (target) {
        this.orderGather(e, target.id);
        return;
      }
    }
    this.clearOrder(e);
  }

  depositResources(e) {
    const p = this.players[e.owner];
    if (!p || !e.carry) return;
    const amount = e.carry.amount;
    const upkeep = upkeepFor(p.foodUsed);
    if (e.carry.type === 'gold') {
      const gained = Math.max(1, Math.round(amount * upkeep.goldFactor));
      p.gold += gained;
      p.stats.goldGathered += gained;
    } else {
      p.lumber += amount;
      p.stats.lumberGathered += amount;
    }
    e.carry = null;
  }

  depleteMine(mine) {
    mine.dead = true;
    for (let oy = 0; oy < 2; oy++) {
      for (let ox = 0; ox < 2; ox++) {
        const id = (mine.ty + oy) * this.width + (mine.tx + ox);
        if (id >= 0 && id < this.flags.length) this.flags[id] &= ~(FLAG.BLOCK | FLAG.MINE);
      }
    }
    this.buildings = this.buildings.filter((b) => b !== mine);
    this.byIdMap.delete(mine.id);
    this.events.push({ type: 'mineCollapse', x: mine.x, y: mine.y });
  }

  findNearestResource(e, resource) {
    let best = null, bestD = Infinity;
    if (resource === 'gold') {
      for (const b of this.buildings) {
        if (!b.isMine || b.gold <= 0) continue;
        const team = e.owner >= 0 ? this.players[e.owner].team : 0;
        if (e.owner >= 0 && this.fog.isExplored(team, b.x, b.y) === false) continue;
        const d = dist(e.x, e.y, b.x, b.y);
        if (d < bestD) { bestD = d; best = b; }
      }
    } else {
      for (const t of this.trees) {
        if (t.dead) continue;
        const d = dist(e.x, e.y, t.x, t.y);
        if (d < bestD) { bestD = d; best = t; }
      }
    }
    return best;
  }

  findDropoff(e, resource) {
    let best = null, bestD = Infinity;
    for (const b of this.buildings) {
      if (b.dead || b.constructing || b.kind === 'mine') continue;
      if (b.owner !== e.owner) continue;
      const isTh = b.def.isTownHall;
      const isLumber = b.def.lumberDropoff;
      if (resource === 'gold' && !isTh) continue;
      if (resource === 'lumber' && !isTh && !isLumber) continue;
      const d = dist(e.x, e.y, b.x, b.y);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  }

  // ------------------------------------------------------------- building
  doBuild(e, dt) {
    const b = this.getEntity(e.order.targetId);
    if (!b || b.dead || b.complete) {
      this.clearOrder(e);
      return;
    }
    const [qx, qy] = this.closestPointOnBuilding(b, e.x, e.y, 10);
    if (this.edgeDistance(e, b) > 70) {
      e._stopDist = 6;
      if (!e.dest || dist(e.dest.x, e.dest.y, qx, qy) > 16) this.requestPath(e, qx, qy);
      return;
    }
    e.dest = null; e.path = null;
    b.builders.add(e.id);
    e.buildAnim = 0.2;
    e.buildTargetId = b.id;
  }

  doRepair(e, dt) {
    const b = this.getEntity(e.order.targetId);
    if (!b || b.dead) { this.clearOrder(e); return; }
    if (b.hp >= b.maxHp) { this.clearOrder(e); return; }
    const [qx, qy] = this.closestPointOnBuilding(b, e.x, e.y, 10);
    if (this.edgeDistance(e, b) > 70) {
      e._stopDist = 6;
      if (!e.dest || dist(e.dest.x, e.dest.y, qx, qy) > 16) this.requestPath(e, qx, qy);
      return;
    }
    e.dest = null; e.path = null;
    const p = this.players[e.owner];
    const healAmt = 12 * dt;
    const cost = healAmt * 0.2 * (b.maxHp / 1000);
    if (b.hp < b.maxHp) {
      if (p.gold >= cost) {
        p.gold -= cost;
        b.hp = Math.min(b.maxHp, b.hp + healAmt);
      } else {
        this.alertOwner(e.owner, 'Not enough gold to repair.');
        this.clearOrder(e);
      }
    } else {
      this.clearOrder(e);
    }
    e.attackAnim = 0.15;
  }

  doPickup(e, dt) {
    const it = this.items.find((i) => i.id === e.order.itemId);
    if (!it) { this.clearOrder(e); return; }
    if (dist(e.x, e.y, it.x, it.y) > 50) {
      e._stopDist = 8;
      if (!e.dest || dist(e.dest.x, e.dest.y, it.x, it.y) > 16) this.requestPath(e, it.x, it.y);
      return;
    }
    e.dest = null; e.path = null;
    if (!e.hero) { this.clearOrder(e); return; }
    if (this.giveItem(e, it.defId, it.charges)) {
      this.items = this.items.filter((x) => x !== it);
      this.events.push({ type: 'itemPickup', x: it.x, y: it.y });
      this.alertOwner(e.owner, `${e.name}: ${ITEMS[it.defId].name}`);
    } else {
      this.alertOwner(e.owner, 'Inventory is full.');
    }
    this.clearOrder(e);
  }

  doCastOrder(e, dt) {
    const o = e.order;
    const def = ABILITIES[o.abilityId];
    if (!def) { this.clearOrder(e); return; }
    let target = o.targetId ? this.getEntity(o.targetId) : null;
    if ((def.kind === 'unit' || def.kind === 'autocast') && (!target || target.dead)) { this.clearOrder(e); return; }
    let tx = o.tx, ty = o.ty;
    if (target) { tx = target.x; ty = target.y; }
    const reach = def.range || 0;
    const d = dist(e.x, e.y, tx, ty);
    if (def.kind === 'none' || d <= reach) {
      const ang = angleTo(e.x, e.y, tx, ty);
      e.facing = ang;
      const ok = this.completeCast(e);
      if (!ok) this.clearOrder(e);
      return;
    }
    e._stopDist = Math.max(8, reach - 20);
    if (!e.dest || dist(e.dest.x, e.dest.y, tx, ty) > 30) this.requestPath(e, tx, ty);
  }

  updateBuilding(b, dt) {
    b.attackCd = Math.max(0, b.attackCd - dt);
    this.tickBuffs(b, dt);
    // construction
    if (b.constructing) {
      let builders = 0;
      for (const id of Array.from(b.builders)) {
        const w = this.getEntity(id);
        if (!w || w.dead || w.order.type !== 'build' || w.order.targetId !== b.id) {
          b.builders.delete(id);
          continue;
        }
        if (this.edgeDistance(w, b) < 90) builders++;
        else b.builders.delete(id);
      }
      if (builders > 0) {
        const speed = builders > 0 ? 1 + (builders - 1) * 0.35 : 0;
        b.buildProgress = clamp(b.buildProgress + (dt / b.def.buildTime) * speed, 0, 1);
        b.hp = Math.max(b.hp, b.maxHp * (0.1 + 0.9 * b.buildProgress));
        if (b.buildProgress >= 1) {
          b.constructing = false;
          b.complete = true;
          b.buildProgress = 1;
          b.hp = b.maxHp;
          if (b.owner >= 0) {
            this.players[b.owner].stats.buildingsBuilt++;
            this.alertOwner(b.owner, `${b.name} complete.`);
          }
          this.events.push({ type: 'buildComplete', x: b.x, y: b.y, owner: b.owner });
          this.updateTiers();
          // rally for trained workers
          if (b.rally && b.def.trains && b.def.trains.includes('peasant')) {
            // nothing
          }
        }
      }
      return;
    }
    // training
    if (b.trainQueue.length) {
      const item = b.trainQueue[0];
      const p = this.players[b.owner];
      const def = ALL_DEF[item.defId];
      if (p && def) {
        const foodOk = this.foodFree(b.owner) >= (def.food || 0);
        const techOk = this.hasRequirements(b.owner, def);
        if (!foodOk) {
          item.blocked = 'food';
          item.timeLeft = Math.max(item.timeLeft, 0.001);
        } else if (!techOk) {
          b.trainQueue.shift();
          this.refund(b.owner, item.cost);
        } else {
          item.timeLeft -= dt;
          item.blocked = null;
          if (item.timeLeft <= 0) {
            b.trainQueue.shift();
            this.spawnTrained(b, item.defId);
          }
        }
      } else {
        b.trainQueue.shift();
      }
    }
    // research
    if (b.researchQueue.length) {
      const item = b.researchQueue[0];
      item.timeLeft -= dt;
      if (item.timeLeft <= 0) {
        b.researchQueue.shift();
        this.finishResearch(b, item.upgradeId);
      }
    }
    // town hall upgrade
    if (b.upgrading) {
      b.upgrading.timeLeft -= dt;
      if (b.upgrading.timeLeft <= 0) {
        this.finishUpgradeBuilding(b);
      }
    }
    // tower attacks
    if (b.def.attack) {
      if (!b.attackTarget || b.attackTarget.dead) b.attackTarget = null;
      if (!b.attackTarget) {
        b.attackTarget = this.findAutoTarget(b, b.range);
      }
      if (b.attackTarget) {
        const t = b.attackTarget;
        if (dist(b.x, b.y, t.x, t.y) <= b.range + (t.radius || 0)) {
          if (b.attackCd <= 0) {
            b.attackCd = b.cooldown;
            const [min, max] = this.effectiveDamageRange(b);
            const dmg = this.rng.range(min, max);
            this.spawnProjectile({
              x: b.x, y: b.y, target: t, speed: 900, owner: b.owner,
              damage: dmg, attackType: b.attackType, art: b.projectile || 'arrow', height: 34,
            });
            this.events.push({ type: 'attack', x: b.x, y: b.y, art: b.projectile || 'arrow', owner: b.owner });
          }
        } else {
          b.attackTarget = null;
        }
      }
    }
    // hero revival at altar
    if (b.def.heroAltar && b.owner >= 0) {
      const p = this.players[b.owner];
      if (p.heroRevive.length) {
        const item = p.heroRevive[0];
        item.timeLeft -= dt;
        if (item.timeLeft <= 0) {
          p.heroRevive.shift();
          this.reviveHero(item, b);
        }
      }
    }
  }

  spawnTrained(b, defId) {
    const def = ALL_DEF[defId];
    if (!def) return;
    let [sx, sy] = this.closestPointOnBuilding(b, b.x + 40, b.y + 40);
    // spawn just outside the footprint
    const ang = this.rng() * Math.PI * 2;
    const px = b.x + Math.cos(ang) * (b.radius + 30);
    const py = b.y + Math.sin(ang) * (b.radius + 30);
    const e = def.kind === 'hero'
      ? this.createUnit(defId, b.owner, px, py, { snap: true })
      : this.createUnit(defId, b.owner, px, py, { snap: true });
    if (b.owner >= 0) this.players[b.owner].stats.unitsTrained++;
    if (b.rally) {
      if (b.rally.targetId) {
        const t = this.getEntity(b.rally.targetId);
        if (t && t.kind === 'tree' && e.def.canGather) this.orderGather(e, t.id);
        else if (t && t.isMine && e.def.canGather) this.orderGather(e, t.id);
        else if (t) this.orderMove(e, t.x, t.y);
      } else if (b.rally.x !== undefined) {
        if (e.def.canGather) {
          const res = this.findNearestResource(e, 'gold');
          if (res && dist(b.rally.x, b.rally.y, res.x, res.y) < 400) this.orderGather(e, res.id);
          else this.orderMove(e, b.rally.x, b.rally.y);
        } else {
          this.orderMove(e, b.rally.x, b.rally.y);
        }
      }
    }
    this.recomputeFood();
    this.events.push({ type: 'unitReady', x: e.x, y: e.y, owner: e.owner, defId });
    if (b.owner >= 0) this.alertOwner(b.owner, `${def.name} ready.`);
    return e;
  }

  // ------------------------------------------------------------- research
  canTrain(playerId, building, defId, ignoreQueue = false) {
    const def = ALL_DEF[defId];
    const p = this.players[playerId];
    if (!def || !p) return { ok: false, reason: 'Unknown unit.' };
    if (def.kind === 'hero') {
      if (p.heroes.filter((h) => !h.dead).length + p.heroRevive.length >= 3) return { ok: false, reason: 'Maximum number of heroes reached.' };
    }
    if (def.tier && def.tier > p.tier) return { ok: false, reason: 'Requires a higher town tier.' };
    if (building && building.def.tiers && building.def.tiers[defId] && building.def.tiers[defId] > p.tier) {
      return { ok: false, reason: 'Requires a higher town tier.' };
    }
    if (!ignoreQueue) {
      const cost = this.queuedCost(playerId, building);
      if (!this.canAfford(playerId, def.cost, cost)) return { ok: false, reason: 'Not enough resources.' };
      if (def.food && this.foodFree(playerId) < def.food) return { ok: false, reason: 'Not enough food.' };
    }
    if (!this.hasRequirements(playerId, def)) return { ok: false, reason: 'Missing prerequisite building.' };
    return { ok: true };
  }

  queuedCost(playerId, building) {
    const total = { gold: 0, lumber: 0 };
    if (!building) return total;
    for (const q of building.trainQueue) {
      const d = ALL_DEF[q.defId];
      if (d && d.cost) { total.gold += d.cost.gold || 0; total.lumber += d.cost.lumber || 0; }
    }
    for (const q of building.researchQueue || []) {
      const up = UPGRADES[q.upgradeId];
      if (up) {
        const lvl = q.costLevelIndex || 0;
        const c = up.cost[Math.min(lvl, up.cost.length - 1)];
        total.gold += c.gold || 0; total.lumber += c.lumber || 0;
      }
    }
    return total;
  }

  canAfford(playerId, cost, extra) {
    const p = this.players[playerId];
    if (!p) return false;
    const e = extra || { gold: 0, lumber: 0 };
    return p.gold >= (cost.gold || 0) + e.gold && p.lumber >= (cost.lumber || 0) + e.lumber;
  }

  pay(playerId, cost) {
    const p = this.players[playerId];
    if (!p) return false;
    if (!this.canAfford(playerId, cost)) return false;
    p.gold -= cost.gold || 0;
    p.lumber -= cost.lumber || 0;
    return true;
  }

  refund(playerId, cost) {
    const p = this.players[playerId];
    if (!p) return;
    p.gold += cost.gold || 0;
    p.lumber += cost.lumber || 0;
  }

  queueTrain(building, defId) {
    if (!building || building.owner < 0) return { ok: false };
    if (!building.def.trains || !building.def.trains.includes(defId)) return { ok: false, reason: 'Cannot train that here.' };
    if (building.trainQueue.length >= 7) return { ok: false, reason: 'Training queue is full.' };
    const check = this.canTrain(building.owner, building, defId);
    if (!check.ok) return check;
    const def = ALL_DEF[defId];
    if (!this.pay(building.owner, def.cost)) return { ok: false, reason: 'Not enough resources.' };
    const buildTime = def.buildTime * (def.kind === 'hero' ? 1 : 1);
    building.trainQueue.push({ defId, timeLeft: buildTime, total: buildTime, cost: { ...def.cost } });
    return { ok: true };
  }

  cancelTrain(building, index = 0) {
    const item = building.trainQueue[index];
    if (!item) return false;
    const refund = index === 0
      ? { gold: item.cost.gold, lumber: item.cost.lumber }
      : { gold: item.cost.gold, lumber: item.cost.lumber };
    this.refund(building.owner, refund);
    building.trainQueue.splice(index, 1);
    return true;
  }

  queueResearch(building, upgradeId) {
    if (!building || building.owner < 0) return { ok: false };
    const up = UPGRADES[upgradeId];
    if (!up) return { ok: false };
    if (!building.def.researches || !building.def.researches.includes(upgradeId)) return { ok: false, reason: 'Cannot research that here.' };
    const p = this.players[building.owner];
    const current = p.upgrades[upgradeId] || 0;
    if (current >= up.maxLevel) return { ok: false, reason: 'Already fully researched.' };
    if (up.tier > p.tier) return { ok: false, reason: 'Requires a higher town tier.' };
    if (!this.hasRequirements(building.owner, { requires: up.requires })) return { ok: false, reason: 'Missing prerequisite building.' };
    if (building.researchQueue.length >= 3) return { ok: false, reason: 'Research queue is full.' };
    const cost = up.cost[current];
    if (!this.canAfford(building.owner, cost)) return { ok: false, reason: 'Not enough resources.' };
    this.pay(building.owner, cost);
    building.researchQueue.push({
      upgradeId, timeLeft: up.buildTime[current], total: up.buildTime[current],
      costLevelIndex: current, cost: { ...cost },
    });
    return { ok: true };
  }

  cancelResearch(building, index = 0) {
    const item = building.researchQueue[index];
    if (!item) return false;
    this.refund(building.owner, item.cost);
    building.researchQueue.splice(index, 1);
    return true;
  }

  finishResearch(b, upgradeId) {
    const p = this.players[b.owner];
    if (!p) return;
    p.upgrades[upgradeId] = (p.upgrades[upgradeId] || 0) + 1;
    p.stats.upgradesDone++;
    this.recomputePlayerUnits(b.owner);
    this.alertOwner(b.owner, `${UPGRADES[upgradeId].name} upgraded.`);
    this.events.push({ type: 'upgradeDone', upgradeId, owner: b.owner });
    this.updateTiers();
  }

  startBuildingUpgrade(building, targetDefId) {
    const def = ALL_DEF[targetDefId];
    if (!def || !building.def.upgradesTo || building.def.upgradesTo !== targetDefId) return { ok: false };
    if (building.upgrading) return { ok: false, reason: 'Already upgrading.' };
    if (!this.canAfford(building.owner, def.cost)) return { ok: false, reason: 'Not enough resources.' };
    this.pay(building.owner, def.cost);
    building.upgrading = { defId: targetDefId, timeLeft: def.buildTime, total: def.buildTime, cost: { ...def.cost } };
    return { ok: true };
  }

  finishUpgradeBuilding(b) {
    const up = b.upgrading;
    b.upgrading = null;
    const def = ALL_DEF[up.defId];
    if (!def) return;
    this.markFootprint(b, false);
    const hpPct = b.hp / b.maxHp;
    b.defId = def.id;
    b.def = def;
    b.name = def.name;
    b.maxHp = def.hp;
    b.hp = Math.max(def.hp * 0.5, def.hp * hpPct);
    b.baseArmor = def.armor;
    b.sight = def.sight;
    b.foodProvided = def.foodProvided || 0;
    b.footprint = def.footprint || b.footprint;
    this.markFootprint(b, true);
    if (b.owner >= 0) this.alertOwner(b.owner, `${def.name} complete.`);
    this.updateTiers();
    this.recomputeFood();
    this.events.push({ type: 'buildComplete', x: b.x, y: b.y, owner: b.owner });
  }

  // ------------------------------------------------------------- resources
  recomputeFood() {
    for (const p of this.players) {
      let used = 0;
      for (const u of this.units) {
        if (u.dead || u.owner !== p.id) continue;
        used += u.food || 0;
      }
      p.foodUsed = used;
      let cap = 0;
      for (const b of this.buildings) {
        if (b.dead || b.owner !== p.id || b.constructing) continue;
        cap += b.foodProvided || 0;
      }
      p.foodCap = Math.min(MAX_FOOD, cap);
    }
  }

  foodFree(playerId) {
    const p = this.players[playerId];
    if (!p) return 0;
    return Math.max(0, p.foodCap - p.foodUsed);
  }

  updateTiers() {
    for (const p of this.players) {
      let tier = 1;
      for (const b of this.buildings) {
        if (b.dead || b.owner !== p.id || b.constructing) continue;
        if (b.def.isTownHall) tier = Math.max(tier, b.def.townTier || 1);
      }
      p.tier = tier;
    }
  }

  hasBuilding(playerId, defId) {
    for (const b of this.buildings) {
      if (b.dead || b.owner !== playerId || b.constructing) continue;
      if (b.defId === defId) return true;
      // castle counts as keep/town hall, keep counts as town hall
      if (defId === 'townhall' && b.def.isTownHall) return true;
      if (defId === 'keep' && b.defId === 'castle') return true;
    }
    return false;
  }

  hasRequirements(playerId, def) {
    const reqs = def.requires || [];
    for (const r of reqs) {
      if (!this.hasBuilding(playerId, r)) return false;
    }
    return true;
  }

  findTownHall(playerId) {
    let best = null;
    for (const b of this.buildings) {
      if (b.dead || b.owner !== playerId || b.kind === 'mine') continue;
      if (b.def.isTownHall && !b.constructing) { best = b; break; }
    }
    return best;
  }

  // ------------------------------------------------------------- combat fx
  spawnProjectile(opts) {
    const p = {
      id: newId(), x: opts.x, y: opts.y, sx: opts.x, sy: opts.y,
      targetId: opts.target ? opts.target.id : null,
      tx: opts.target ? opts.target.x : opts.x, ty: opts.target ? opts.target.y : opts.y,
      damage: opts.damage || 0, attackType: opts.attackType || 'normal',
      owner: opts.owner, sourceId: opts.sourceId || null,
      speed: opts.speed || 800, art: opts.art || 'arrow',
      height: opts.height || 20, splash: opts.splash || 0,
      onHit: opts.onHit || null, life: 0, dead: false,
    };
    this.projectiles.push(p);
    return p;
  }

  updateProjectiles(dt) {
    for (const p of this.projectiles) {
      if (p.dead) continue;
      p.life += dt;
      const target = p.targetId ? this.getEntity(p.targetId) : null;
      if (target && !target.dead) { p.tx = target.x; p.ty = target.y; }
      const d = dist(p.x, p.y, p.tx, p.ty);
      const step = p.speed * dt;
      if (d <= step) {
        p.x = p.tx; p.y = p.ty;
        this.projectileImpact(p, target);
        p.dead = true;
      } else {
        const [dx, dy] = normalize(p.tx - p.x, p.ty - p.y);
        p.x += dx * step; p.y += dy * step;
      }
      if (p.life > 6) p.dead = true;
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead);
  }

  projectileImpact(p, target) {
    if (p.splash > 0) {
      const victims = this.unitsInRadius(p.x, p.y, p.splash, (u) => {
        const dummy = { owner: p.owner };
        return this.isEnemyEntity(dummy, u) && this.ownerTeam(u.owner) !== -2;
      });
      for (const v of victims) {
        const falloff = 1 - 0.4 * (dist(v.x, v.y, p.x, p.y) / p.splash);
        this.applyWeaponDamage({ owner: p.owner, attackType: p.attackType, x: p.x, y: p.y, id: p.sourceId }, v, p.damage * falloff, p.attackType);
      }
      this.fxBurst(p.x, p.y, 20, 0.35);
      this.events.push({ type: 'impact', x: p.x, y: p.y, art: 'boom' });
      return;
    }
    if (target && !target.dead) {
      const source = p.sourceId ? this.getEntity(p.sourceId) : null;
      this.applyWeaponDamage(source || { owner: p.owner, attackType: p.attackType, x: p.x, y: p.y }, target, p.damage, p.attackType);
      this.fxBurst(target.x, target.y, 8, 0.2);
      if (p.onHit) p.onHit(this, target);
    } else {
      this.fxBurst(p.tx, p.ty, 6, 0.2);
    }
  }

  addEffect(eff) {
    const e = { life: 0, maxLife: 0.5, ...eff };
    this.effects.push(e);
    return e;
  }

  fxBurst(x, y, count = 10, life = 0.3) {
    this.addEffect({ type: 'burst', x, y, count, life, maxLife: life });
  }

  updateEffects(dt) {
    for (const e of this.effects) {
      e.life += dt;
      if (e.type === 'pulse') {
        e.timer = (e.timer || 0) + dt;
        if (e.timer >= (e.interval || 0.7) && e.pulses > 0) {
          e.timer = 0;
          e.pulses--;
          this.damageArea(e.owner, e.x, e.y, e.radius, e.damage, e.damageType || 'magic', e.casterId ? this.getEntity(e.casterId) : null, { includeBuildings: false });
          this.fxBurst(e.x, e.y, 22, 0.4);
          this.events.push({ type: 'impact', x: e.x, y: e.y, art: 'frost' });
        }
        if (e.pulses <= 0) e.life = e.maxLife;
      }
    }
    this.effects = this.effects.filter((e) => e.life < e.maxLife);
  }

  damageArea(owner, x, y, radius, damage, damageType, source, opts = {}) {
    const dummy = { owner };
    const victims = this.enemiesInRadius(dummy, x, y, radius, { includeBuildings: !!opts.includeBuildings });
    let total = 0;
    for (const v of victims) {
      if (v.dead) continue;
      if (damageType === 'magic' && this.isMagicImmune(v)) continue;
      let dmg = damage;
      if (damageType === 'magic' && v.armorType === 'hero') dmg *= 0.75;
      this.damage(v, dmg, source || dummy, damageType);
      total += dmg;
    }
    return total;
  }

  // ------------------------------------------------------------- buffs
  addBuff(target, buff, source) {
    if (!target || target.dead || !target.buffs) return;
    if (buff.invulnerable) {
      // replace existing
      this.removeBuff(target, buff.id);
    }
    const existing = target.buffs.find((b) => b.id === buff.id);
    if (existing) {
      // refresh, keep the stronger slow/armor
      existing.duration = Math.max(existing.duration, buff.duration);
      existing.timeLeft = Math.max(existing.timeLeft || 0, buff.duration);
      if (buff.armor) existing.armor = Math.max(existing.armor || 0, buff.armor);
      if (buff.slow) existing.slow = Math.max(existing.slow || 0, buff.slow);
      if (buff.damageBonus) existing.damageBonus = Math.max(existing.damageBonus || 0, buff.damageBonus);
      return existing;
    }
    const b = { ...buff, timeLeft: buff.duration, sourceId: source ? source.id : null };
    target.buffs.push(b);
    this.events.push({ type: 'buff', id: buff.id, x: target.x, y: target.y });
    return b;
  }

  removeBuff(target, id) {
    if (!target.buffs) return;
    target.buffs = target.buffs.filter((b) => b.id !== id);
  }

  tickBuffs(e, dt) {
    if (!e.buffs || !e.buffs.length) return;
    let removed = false;
    for (const b of e.buffs) {
      if (b.duration === Infinity) continue;
      b.timeLeft -= dt;
      if (b.hot) this.healUnit(e, b.hot * dt);
      if (b.dot) this.damage(e, b.dot * dt, null, 'magic');
      if (b.timeLeft <= 0) removed = true;
    }
    if (removed) e.buffs = e.buffs.filter((b) => b.duration === Infinity || b.timeLeft > 0);
  }

  tickRegen(e, dt) {
    if (e.dead) return;
    if (e.hp < e.maxHp) {
      let regen = e.hero ? (0.6 + e.attributes.str * 0.035) : (e.creep ? 0.6 : 0.35);
      if (this.time - (e.lastDamagedTime || -99) > 4) regen *= e.hero ? 1 : 1;
      e.hp = Math.min(e.maxHp, e.hp + regen * dt);
    }
    if (e.maxMana > 0) {
      let regen = e.hero ? 0.6 + e.attributes.int * 0.02 : 0.5;
      regen += e.aura ? e.aura.manaRegen : 0;
      if (this.hasBuff(e, 'brilliance')) regen += 1.5;
      e.mana = Math.min(e.maxMana, e.mana + regen * dt);
    }
  }

  updateAuras() {
    // reset
    for (const u of this.units) {
      if (u.dead) continue;
      u.aura.armor = 0; u.aura.damage = 0; u.aura.manaRegen = 0; u.aura.speed = 0;
      u._auraSources = null;
    }
    const auraProviders = [];
    const all = this.units.concat(this.buildings);
    for (const e of all) {
      if (e.dead || !e.abilities) continue;
      for (const a of e.abilities) {
        const def = ABILITIES[a.id];
        if (!def || !def.aura) continue;
        if (!a.level || !a.enabled) continue;
        auraProviders.push({ src: e, ability: def, key: a.id, level: a.level });
      }
    }
    for (const { src, ability, key, level } of auraProviders) {
      const bonus = ability.auraBonus(level);
      const radius = ability.radius || ability.range || 900;
      const team = src.owner >= 0 ? this.players[src.owner].team : -1;
      for (const u of this.units) {
        if (u.dead) continue;
        if (u.owner >= 0 && this.players[u.owner].team !== team) continue;
        if (src.owner >= 0 && u.owner < 0) continue;
        if (dist(u.x, u.y, src.x, src.y) > radius) continue;
        u._auraSources = u._auraSources || {};
        // strongest aura of each kind wins
        const tag = key;
        if (!u._auraSources[tag] || u._auraSources[tag] < level) {
          const old = u._auraSources[tag];
          u._auraSources[tag] = level;
          if (old) {
            const oldBonus = ability.auraBonus(old);
            if (oldBonus.armor) u.aura.armor -= oldBonus.armor;
            if (oldBonus.damage) u.aura.damage -= oldBonus.damage;
            if (oldBonus.manaRegen) u.aura.manaRegen -= oldBonus.manaRegen;
          }
          if (bonus.armor) u.aura.armor += bonus.armor;
          if (bonus.damage) u.aura.damage += bonus.damage;
          if (bonus.manaRegen) u.aura.manaRegen += bonus.manaRegen;
        }
      }
    }
  }

  // ------------------------------------------------------------- scheduling
  updateFog() {
    for (const team of [0, 1]) {
      const sources = this.teamEntities(team);
      this.fog.recompute(team, sources);
    }
  }

  updateAutoCasts() {
    for (const e of this.units) {
      if (e.dead || e.owner < 0) continue;
      if (!e.abilities || !e.abilities.length) continue;
      if (this.isStunned(e)) continue;
      for (const a of e.abilities) {
        if (!a.autocast || !a.enabled) continue;
        const def = ABILITIES[a.id];
        if (!def || !def.autoFilter) continue;
        if ((e.cooldowns[a.id] || 0) > 0) continue;
        const lvl = a.level || 1;
        const manaCost = def.mana[lvl - 1] || 0;
        if (e.mana < manaCost) continue;
        if (def.target === 'ally') {
          let best = null, bestScore = -1;
          const candidates = this.unitsInRadius(e.x, e.y, def.range || 500, (u) =>
            !u.dead && this.isAlly(e, u) && u !== e && def.autoFilter(this, e, u));
          for (const c of candidates) {
            const score = (c.maxHp - c.hp) / c.maxHp;
            if (score > bestScore) { bestScore = score; best = c; }
          }
          if (!best && def.id === 'inner_fire') {
            const list = this.unitsInRadius(e.x, e.y, def.range || 500, (u) =>
              !u.dead && this.isAlly(e, u) && u !== e && def.autoFilter(this, e, u));
            if (list.length) best = list[0];
          }
          if (best) this.tryAutoCast(e, a, best);
        } else if (def.target === 'enemy') {
          const candidates = this.unitsInRadius(e.x, e.y, def.range || 500, (u) =>
            !u.dead && this.isEnemyEntity(e, u) && def.autoFilter(this, e, u) &&
            (u.owner < 0 || this.visibleToTeam(this.players[e.owner].team, u)));
          if (candidates.length) {
            candidates.sort((x, y) => dist(e.x, e.y, x.x, x.y) - dist(e.x, e.y, y.x, y.y));
            this.tryAutoCast(e, a, candidates[0]);
          }
        }
      }
    }
  }

  tryAutoCast(caster, abilityState, target) {
    const def = ABILITIES[abilityState.id];
    const lvl = abilityState.level || 1;
    const manaCost = def.mana[lvl - 1] || 0;
    if (caster.mana < manaCost || (caster.cooldowns[abilityState.id] || 0) > 0) return false;
    if (dist(caster.x, caster.y, target.x, target.y) > (def.range || 500) + target.radius) return false;
    caster.mana -= manaCost;
    const cd = def.cooldown[lvl - 1] || 0;
    if (cd > 0) caster.cooldowns[abilityState.id] = cd;
    caster.castAnim = 0.3;
    def.effect(this, caster, lvl, target.x, target.y, target);
    this.events.push({ type: 'cast', ability: abilityState.id, x: caster.x, y: caster.y, owner: caster.owner });
    return true;
  }

  updateCreeps() {
    for (const e of this.units) {
      if (e.dead || !e.creep) continue;
      const distFromHome = dist(e.x, e.y, e.homeX || e.x, e.homeY || e.y);
      if (distFromHome > (e.guardRadius || 500) * 1.7) {
        // leash home
        e.order = { type: 'move', x: e.homeX, y: e.homeY };
        e.attackTarget = null;
        e.dest = { x: e.homeX, y: e.homeY };
        e.path = null;
        if (distFromHome > 1000) {
          // teleport back if the player kited them far away
          e.x = e.homeX; e.y = e.homeY; e.path = null; e.dest = null;
          e.order = { type: 'idle' };
          e.hp = e.maxHp;
        }
        continue;
      }
      if (e.order.type === 'attack' && e.attackTarget && !e.attackTarget.dead) continue;
      if (e.order.type === 'idle' || (e.order.type === 'move' && e.order.x === e.homeX)) {
        let best = null, bestD = Infinity;
        for (const u of this.units) {
          if (u.dead || u.owner < 0 || u === e) continue;
          if (!this.isEnemyEntity(e, u)) continue;
          const d = dist(e.x, e.y, u.x, u.y);
          if (d <= (e.guardRadius || 500) && d < bestD) { bestD = d; best = u; }
        }
        if (best) {
          this.orderAttack(e, best.id);
        } else if (distFromHome > 40) {
          e.order = { type: 'move', x: e.homeX, y: e.homeY };
          e.dest = { x: e.homeX, y: e.homeY };
          e.path = null;
        }
      }
    }
  }

  resolveCollisions() {
    const units = this.units;
    const n = units.length;
    for (let i = 0; i < n; i++) {
      const a = units[i];
      if (a.dead || a.kind !== 'unit') continue;
      for (let j = i + 1; j < n; j++) {
        const b = units[j];
        if (b.dead || b.kind !== 'unit') continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const minD = (a.radius + b.radius) * 0.85;
        const d2 = dx * dx + dy * dy;
        if (d2 > minD * minD || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const push = (minD - d) * 0.5;
        const ux = dx / d, uy = dy / d;
        const aStunned = this.isRooted(a) || this.isStunned(a);
        const bStunned = this.isRooted(b) || this.isStunned(b);
        if (!aStunned) { a.x -= ux * push; a.y -= uy * push; }
        if (!bStunned) { b.x += ux * push; b.y += uy * push; }
      }
      // keep units out of blocked tiles after pushes
      const tx = Math.floor(a.x / TILE), ty = Math.floor(a.y / TILE);
      if (tx < 1 || ty < 1 || tx >= this.width - 1 || ty >= this.height - 1 ||
          (this.flags[ty * this.width + tx] & FLAG.BLOCK)) {
        // nudge toward the nearest open neighbour
        const open = this.path.nearestFree(tx, ty, 3);
        if (open) { a.x = (open[0] + 0.5) * TILE; a.y = (open[1] + 0.5) * TILE; }
      }
    }
  }

  cleanup(dt) {
    for (const e of this.units) {
      if (e.dead && e.removeAt && this.time > e.removeAt && !e.hero) {
        this.byIdMap.delete(e.id);
      }
    }
    this.units = this.units.filter((e) => !(e.dead && !e.hero && e.removeAt && this.time > e.removeAt));
    this.buildings = this.buildings.filter((b) => !(b.dead && b.kind !== 'mine' && b.removeAt && this.time > b.removeAt));
    // corpses
    for (const c of this.corpses) c.ttl -= dt;
    this.corpses = this.corpses.filter((c) => c.ttl > 0);
    // dead buildings linger briefly for art
    for (const b of this.buildings) {
      if (b.dead && !b.removeAt) b.removeAt = this.time + 6;
    }
    // clear dead from id map
    for (const b of this.buildings) {
      if (b.dead && this.time > (b.removeAt || 0)) this.byIdMap.delete(b.id);
    }
  }

  checkVictory() {
    if (this.gameOver) return;
    if (this.tickCount % 60 !== 0) return;
    for (const p of this.players) {
      if (p.defeated) continue;
      const hasBuilding = this.buildings.some((b) => !b.dead && b.owner === p.id && b.kind !== 'mine');
      const hasUnit = this.units.some((u) => !u.dead && u.owner === p.id);
      if (!hasBuilding && !hasUnit && this.time > 30) {
        p.defeated = true;
        this.events.push({ type: 'defeat', owner: p.id });
      }
    }
    const alive = this.players.filter((p) => !p.defeated);
    const teams = new Set(alive.map((p) => p.team));
    if (teams.size <= 1 && this.players.length > 1) {
      this.gameOver = true;
      this.winner = alive.length ? alive[0].team : null;
      this.events.push({ type: 'gameOver', winner: this.winner });
    }
  }

  // ------------------------------------------------------------- heroes
  initHero(e, def) {
    e.hero = true;
    e.isHero = true;
    e.attributes = { ...def.attributes };
    e.heroLevel = 1;
    e.xp = 0;
    e.skillPoints = 1;
    e.abilityLevels = {};
    e.abilities = def.abilityIds.map((id) => ({ id, level: 0, autocast: false, enabled: false, heroAbility: true }));
    e.items = new Array(6).fill(null);
    e.baseArmor = 2 + Math.floor(e.attributes.agi / 7);
    this.applyHeroStats(e, true);
    e.mana = e.maxMana;
    e.hp = e.maxHp;
    e.heroName = def.name;
  }

  applyHeroStats(e, full = false) {
    const def = e.def;
    const strDelta = e.attributes.str - def.attributes.str;
    const intDelta = e.attributes.int - def.attributes.int;
    const agiDelta = e.attributes.agi - def.attributes.agi;
    const newMaxHp = Math.round(def.hpBase + strDelta * 25);
    const newMaxMana = Math.round(def.manaBase + intDelta * 15);
    const hpGain = newMaxHp - e.maxHp;
    const manaGain = newMaxMana - e.maxMana;
    e.maxHp = newMaxHp;
    e.maxMana = newMaxMana;
    e.baseArmor = 2 + Math.floor(e.attributes.agi / 7);
    if (full) {
      e.hp = e.maxHp; e.mana = e.maxMana;
    } else {
      e.hp = clamp(e.hp + Math.max(0, hpGain), 1, e.maxHp);
      e.mana = clamp(e.mana + Math.max(0, manaGain), 0, e.maxMana);
    }
    e.sight = def.sight;
    e.speed = def.speed;
    e.range = def.range;
    e.cooldown = def.cooldown;
    e.attackType = def.attackType;
    e.armorType = def.armorType;
    e.projectile = def.projectile || null;
    e.dmgMin = def.damage[0]; e.dmgMax = def.damage[1];
    e.xpValue = 0;
  }

  recomputeHero(hero) {
    this.applyHeroStats(hero, false);
  }

  // Apply/refresh upgrade-derived base stats (max HP bonuses) to a player's army.
  recomputePlayerUnits(owner) {
    for (const e of this.units) {
      if (e.owner !== owner || e.kind !== 'unit' || e.dead) continue;
      const bonus = e.hero ? 0 : this.upgradeBonus(e, 'hp');
      const prev = e._hpBonus || 0;
      if (bonus !== prev) {
        const delta = bonus - prev;
        e._hpBonus = bonus;
        e.maxHp += delta;
        e.hp = clamp(e.hp + Math.max(0, delta), 1, e.maxHp);
      }
    }
  }

  gainXp(hero, amount) {
    if (!hero || hero.dead || hero.heroLevel >= MAX_HERO_LEVEL) return;
    hero.xp += amount;
    let leveled = false;
    while (hero.heroLevel < MAX_HERO_LEVEL) {
      const next = HERO_XP_TABLE[hero.heroLevel]; // cumulative xp needed for next level
      if (next === undefined || hero.xp < next) break;
      hero.heroLevel++;
      leveled = true;
      hero.skillPoints++;
      const g = hero.def.growth;
      hero.attributes.str += g.str;
      hero.attributes.agi += g.agi;
      hero.attributes.int += g.int;
      this.applyHeroStats(hero, false);
      this.events.push({ type: 'levelUp', x: hero.x, y: hero.y, owner: hero.owner, level: hero.heroLevel });
    }
    if (leveled) {
      this.alertOwner(hero.owner, `${hero.def.name} has reached level ${hero.heroLevel}!`);
    }
  }

  learnAbility(hero, abilityId) {
    if (!hero || hero.dead) return { ok: false };
    const state = hero.abilities.find((a) => a.id === abilityId);
    const def = ABILITIES[abilityId];
    if (!state || !def) return { ok: false };
    const nextLevel = state.level + 1;
    if (nextLevel > (def.levels || 1)) return { ok: false, reason: 'Ability is already at maximum level.' };
    if (hero.skillPoints <= 0) return { ok: false, reason: 'No skill points available.' };
    const req = (def.heroLevelReq || [1, 1, 1])[nextLevel - 1] || 1;
    if (hero.heroLevel < req) return { ok: false, reason: `Requires hero level ${req}.` };
    state.level = nextLevel;
    state.enabled = true;
    hero.skillPoints--;
    this.events.push({ type: 'abilityLearned', owner: hero.owner, abilityId, level: nextLevel });
    return { ok: true };
  }

  onHeroDeath(hero) {
    hero.dead = true;
    hero.corpseTime = this.time;
    hero.buffs = [];
    // drop items on the ground
    if (hero.items) {
      for (let i = 0; i < hero.items.length; i++) {
        const it = hero.items[i];
        if (!it) continue;
        hero.items[i] = null;
        const a = this.rng() * Math.PI * 2;
        this.dropItem(it.defId, hero.x + Math.cos(a) * 34, hero.y + Math.sin(a) * 34, it.charges);
      }
    }
    const p = this.players[hero.owner];
    const reviveTime = 8 + hero.heroLevel * 4;
    p.heroRevive.push({ heroId: hero.id, timeLeft: reviveTime, total: reviveTime });
    this.alertOwner(hero.owner, `${hero.def.name} has fallen. Revive in ${Math.round(reviveTime)}s.`);
    this.events.push({ type: 'heroDeath', x: hero.x, y: hero.y, owner: hero.owner });
  }

  reviveHero(item, altar) {
    const hero = this.getEntity(item.heroId);
    if (!hero) return;
    const [px, py] = this.closestPointOnBuilding(altar, altar.x, altar.y + 90);
    hero.dead = false;
    hero.hp = hero.maxHp;
    hero.mana = hero.maxMana;
    hero.buffs = [];
    hero.x = px; hero.y = py;
    hero.order = { type: 'idle' };
    hero.path = null; hero.dest = null;
    this.byIdMap.set(hero.id, hero);
    this.events.push({ type: 'heroRevive', x: hero.x, y: hero.y, owner: hero.owner });
    this.alertOwner(hero.owner, `${hero.def.name} has been revived.`);
  }

  reviveFromCorpse(corpse) {
    const idx = this.corpses.indexOf(corpse);
    if (idx >= 0) this.corpses.splice(idx, 1);
    const u = this.createUnit(corpse.defId, corpse.owner, corpse.x, corpse.y, { snap: true });
    u.hp = u.maxHp * 0.5;
    this.fxBurst(corpse.x, corpse.y, 18, 0.5);
    return u;
  }

  // ------------------------------------------------------------- items
  dropItem(defId, x, y, charges) {
    const def = ITEMS[defId];
    if (!def) return null;
    const spot = this.freePosition(x, y, 12);
    const item = {
      id: newId(), defId, x: spot[0], y: spot[1],
      charges: charges !== undefined ? charges : (def.charges || 0),
      def, dead: false,
    };
    this.items.push(item);
    this.byIdMap.set(item.id, item);
    return item;
  }

  giveItem(hero, defId, charges) {
    if (!hero.items) return false;
    const def = ITEMS[defId];
    if (!def) return false;
    const stackable = def.kind === 'consumable';
    if (stackable && charges > 0) {
      for (let i = 0; i < hero.items.length; i++) {
        const it = hero.items[i];
        if (it && it.defId === defId && it.charges + charges <= 5) {
          it.charges += charges;
          return true;
        }
      }
    }
    for (let i = 0; i < hero.items.length; i++) {
      if (!hero.items[i]) {
        hero.items[i] = { defId, charges: charges || (def.charges || 0) };
        return true;
      }
    }
    return false;
  }

  useItem(hero, slot, targetId) {
    const it = hero && hero.items ? hero.items[slot] : null;
    if (!it) return { ok: false };
    const def = ITEMS[it.defId];
    if (!def) return { ok: false };
    if (def.kind !== 'consumable') return { ok: false, reason: 'This item cannot be used.' };
    if (it.charges <= 0) return { ok: false, reason: 'No charges left.' };
    if (def.target === 'ally' && !targetId) return { ok: false, reason: 'Needs a target.' };
    const target = targetId ? this.getEntity(targetId) : null;
    const ok = def.use(this, hero, target);
    if (ok) {
      it.charges--;
      if (it.charges <= 0) hero.items[slot] = null;
      this.events.push({ type: 'itemUse', owner: hero.owner, itemId: def.id });
    }
    return { ok: !!ok };
  }

  dropItemFromHero(hero, slot) {
    const it = hero.items ? hero.items[slot] : null;
    if (!it) return false;
    hero.items[slot] = null;
    this.dropItem(it.defId, hero.x, hero.y, it.charges);
    return true;
  }

  buyItem(shop, itemId, heroId) {
    const p = this.players[shop.owner];
    const def = ITEMS[itemId];
    if (!p || !def) return { ok: false };
    if (!shop.def.sells || !shop.def.sells.includes(itemId)) return { ok: false, reason: 'Not sold here.' };
    if (p.gold < def.cost) return { ok: false, reason: 'Not enough gold.' };
    const hero = this.getEntity(heroId);
    if (!hero || !hero.hero) return { ok: false, reason: 'A hero must make the purchase.' };
    if (dist(hero.x, hero.y, shop.x, shop.y) > 350) return { ok: false, reason: 'The hero is too far from the shop.' };
    if (!this.giveItem(hero, itemId, def.charges || 1)) return { ok: false, reason: 'The hero\'s inventory is full.' };
    p.gold -= def.cost;
    this.events.push({ type: 'itemBought', owner: shop.owner, itemId });
    return { ok: true };
  }

  // ------------------------------------------------------------- misc
  teleportGroup(caster, radius, tx, ty) {
    const group = [caster].concat(this.unitsInRadius(caster.x, caster.y, radius, (u) =>
      !u.dead && u.owner === caster.owner && u.kind === 'unit' && u !== caster));
    for (const u of group) {
      const spot = this.freePosition(tx + (this.rng() - 0.5) * 60, ty + (this.rng() - 0.5) * 60, u.radius);
      u.x = spot[0]; u.y = spot[1];
      u.path = null; u.dest = null;
      u.order = { type: 'idle' };
      this.fxBurst(u.x, u.y, 10, 0.35);
    }
  }

  summonUnit(defId, caster, opts = {}) {
    const u = this.createUnit(defId, caster.owner, caster.x + 40, caster.y + 40, {
      snap: true, summonDuration: opts.duration || 60, hp: opts.hp, damage: opts.damage,
    });
    u.order = { type: 'idle' };
    this.fxBurst(u.x, u.y, 16, 0.5);
    return u;
  }

  transformUnit(e, defId) {
    const def = ALL_DEF[defId];
    if (!def) return;
    e.defId = defId;
    e.def = def;
    e.name = def.name;
    e.maxHp = def.hp;
    e.hp = Math.min(def.hp, Math.max(e.hp, 1));
    e.baseArmor = def.armor;
    e.dmgMin = def.damage[0];
    e.dmgMax = def.damage[1];
    e.range = def.range;
    e.cooldown = def.cooldown;
    e.tags = def.tags;
    e.speed = def.speed;
    e.summonTime = 0;
  }

  alertOwner(owner, text) {
    if (owner === undefined || owner === null || owner < 0) return;
    const p = this.players[owner];
    if (!p) return;
    p.lastAlert = text;
    this.messages.push({ owner, text, time: this.time });
    if (this.messages.length > 200) this.messages.shift();
    this.events.push({ type: 'message', owner, text });
  }

  pushEvent(ev) { this.events.push(ev); }

  drainEvents() {
    const ev = this.events;
    this.events = [];
    return ev;
  }
}
