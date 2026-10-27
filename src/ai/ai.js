// A computer opponent that plays the human tech tree with the same rules and
// the same information limits as the player (it only targets what its team
// currently sees, apart from remembered building positions).

import { dist, TILE } from '../core/util.js';
import { UNITS, BUILDINGS, UPGRADES, ALL_DEFS } from '../data/human.js';
import { ABILITIES } from '../data/abilities.js';

const BUILD_ORDER = [
  { id: 'farm', max: 8, priority: 1, check: (ai, w, p) => p.foodCap - p.foodUsed <= 6 },
  { id: 'barracks', max: 2, priority: 2, check: (ai, w, p) => ai.countBuildings('barracks') < 1 || (p.tier >= 2 && ai.countBuildings('barracks') < 2) },
  { id: 'altar', max: 2, priority: 3, check: (ai, w, p) => ai.countBuildings('altar') < 1 },
  { id: 'lumbermill', max: 1, priority: 4, check: (ai, w, p) => ai.countBuildings('lumbermill') < 1 },
  { id: 'blacksmith', max: 1, priority: 5, check: (ai, w, p) => ai.countBuildings('blacksmith') < 1 },
  { id: 'vault', max: 1, priority: 6, check: (ai, w, p) => ai.countBuildings('vault') < 1 && p.gold > 400 },
  { id: 'guardtower', max: 3, priority: 7, check: (ai, w, p) => ai.underThreat() && ai.countBuildings('guardtower') < 3 },
  { id: 'sanctum', max: 1, priority: 8, check: (ai, w, p) => p.tier >= 2 && ai.countBuildings('sanctum') < 1 },
  { id: 'farm', max: 14, priority: 9, check: (ai, w, p) => p.foodCap - p.foodUsed <= 4, force: true },
  { id: 'cannontower', max: 2, priority: 10, check: (ai, w, p) => p.tier >= 2 && ai.countBuildings('blacksmith') > 0 && ai.countBuildings('cannontower') < 2 && ai.underThreat() },
];

const ARMY_PRIORITY = ['rifleman', 'footman', 'priest', 'knight', 'sorceress', 'mortar'];

export class AIController {
  constructor(world, playerId, opts = {}) {
    this.world = world;
    this.playerId = playerId;
    this.player = world.players[playerId];
    this.thinkTimer = 0;
    this.attackTimer = 0;
    this.expandTimer = 0;
    this.heroTimer = 0;
    this.heroPick = opts.hero || 'archmage';
    this.aggression = opts.aggression !== undefined ? opts.aggression : 1;
    this.difficulty = opts.difficulty || 'normal';
    this.targetBase = this.findEnemyStart();
    this.attackWave = 0;
    this.lastWaveSize = 0;
    this.baseSpot = this.findHomeSpot();
    this.scoutSent = false;
    this.mode = 'buildUp';
    this.workerJobs = new Map();
    this.rallySet = false;
  }

  findHomeSpot() {
    const hall = this.world.findTownHall(this.playerId);
    if (hall) return { x: hall.x, y: hall.y };
    const p = this.player;
    return { x: p.startX || 0, y: p.startY || 0 };
  }

  findEnemyStart() {
    for (const p of this.world.players) {
      if (p.id === this.playerId) continue;
      if (p.team === this.player.team) continue;
      if (p.startX !== undefined) return { x: p.startX, y: p.startY };
    }
    return null;
  }

  countBuildings(defId) {
    let n = 0;
    for (const b of this.world.buildings) {
      if (b.dead || b.owner !== this.playerId || b.kind === 'mine') continue;
      if (b.defId === defId) n++;
    }
    return n;
  }

  countUnits(defId) {
    let n = 0;
    for (const u of this.world.units) {
      if (u.dead || u.owner !== this.playerId) continue;
      if (u.defId === defId) n++;
    }
    return n;
  }

  army() {
    const out = [];
    for (const u of this.world.units) {
      if (u.dead || u.owner !== this.playerId) continue;
      if (u.def.canGather) continue;
      if (u.summonDuration) continue;
      out.push(u);
    }
    return out;
  }

  workers() {
    return this.world.units.filter((u) => !u.dead && u.owner === this.playerId && u.def.canGather);
  }

  idleWorkers() {
    return this.workers().filter((u) => u.order.type === 'idle');
  }

  underThreat() {
    const base = this.baseSpot;
    if (!base) return false;
    for (const u of this.world.units) {
      if (u.dead || u.owner < 0) continue;
      if (this.world.players[u.owner] && this.world.players[u.owner].team === this.player.team) continue;
      if (dist(u.x, u.y, base.x, base.y) < 850) return true;
    }
    return false;
  }

  townHall() {
    return this.world.findTownHall(this.playerId);
  }

  update(dt) {
    this.thinkTimer -= dt;
    this.attackTimer += dt;
    if (this.thinkTimer > 0) return;
    this.thinkTimer = this.difficulty === 'easy' ? 0.9 : 0.45;
    try {
      this.think();
    } catch (err) {
      console.warn('AI error', err);
    }
  }

  think() {
    const w = this.world;
    const p = this.player;
    if (p.defeated || w.gameOver) return;
    this.baseSpot = this.findHomeSpot();
    this.manageEconomy();
    this.manageHero();
    this.manageTech();
    this.manageUpgrades();
    this.manageArmy();
    this.manageBuild();
    this.manageExpansion();
    this.manageAttack();
    this.manageIdleWorkers();
  }

  // ------------------------------------------------------------- economy
  manageEconomy() {
    const w = this.world;
    const p = this.player;
    const workers = this.workers();
    const desiredPeasants = p.tier >= 2 ? 12 : p.foodCap >= 24 ? 10 : 8;
    const hall = this.townHall();
    if (hall && workers.length < desiredPeasants && p.foodCap - p.foodUsed >= 1) {
      if (hall.trainQueue.length < 2 && p.gold >= UNITS.peasant.cost.gold + 60) {
        w.queueTrain(hall, 'peasant');
      }
    }
    const assigned = workers.filter((u) => u.order.type === 'gather');
    const onGold = assigned.filter((u) => u.order.resource === 'gold').length;
    const onLumber = assigned.filter((u) => u.order.resource === 'lumber').length;
    const wantLumber = p.lumber < 400 ? Math.max(3, Math.round(workers.length * 0.4)) : 3;
    // assign idle workers
    for (const u of workers) {
      if (u.order.type !== 'idle') continue;
      if (u.carry && u.carry.amount > 0) { w.startReturn(u); continue; }
      const needGold = onGold < Math.max(4, workers.length - wantLumber);
      if (!needGold || this.treesNearWorker(u) === 0) {
        const tree = this.findTreeNear(u);
        if (tree) { w.orderGather(u, tree.id); continue; }
      }
      const mine = w.findNearestResource(u, 'gold');
      if (mine) { w.orderGather(u, mine.id); continue; }
      const tree = this.findTreeNear(u);
      if (tree) w.orderGather(u, tree.id);
    }
    // gently rebalance excess lumberjacks back to gold once lumber is healthy
    if (p.lumber > 260 && onLumber > 2 && onGold < 6) {
      const lumberjack = workers.find((u) => u.order.type === 'gather' && u.order.resource === 'lumber');
      if (lumberjack) {
        const mine = w.findNearestResource(lumberjack, 'gold');
        if (mine) w.orderGather(lumberjack, mine.id);
      }
    }
  }

  treesNearWorker(u) {
    const w = this.world;
    let n = 0;
    for (const t of w.trees) {
      if (t.dead) continue;
      if (dist(u.x, u.y, t.x, t.y) < 500) n++;
      if (n > 3) break;
    }
    return n;
  }

  needsLumber() {
    const p = this.player;
    // keep enough lumber in the bank for the next building
    return p.lumber < 220;
  }

  findTreeNear(u) {
    const w = this.world;
    let best = null, bestD = Infinity;
    const team = this.player.team;
    for (const t of w.trees) {
      if (t.dead) continue;
      if (!w.fog.isExplored(team, t.x, t.y)) continue;
      // don't send gatherers into creep territory
      if (dist(t.x, t.y, this.baseSpot.x, this.baseSpot.y) > 900) continue;
      const d = dist(u.x, u.y, t.x, t.y);
      if (d < bestD) { bestD = d; best = t; }
    }
    return best;
  }

  manageIdleWorkers() {
    const w = this.world;
    const enemies = this.enemyUnitsNear(this.baseSpot, 900);
    for (const u of this.workers()) {
      // workers that got dragged into a fight should go back to work unless the
      // enemy is right on top of them
      if (u.order.type === 'attack') {
        const t = u.attackTarget;
        const threat = t && !t.dead && dist(u.x, u.y, t.x, t.y) < 220;
        if (!threat || u.hp < u.maxHp * 0.45) {
          u.attackTarget = null;
          w.clearOrder(u);
        } else continue;
      }
      if (u.order.type !== 'idle') continue;
      if (u.carry && u.carry.amount > 0) { w.startReturn(u); continue; }
      // hide at home while enemies are in the base
      if (enemies.length && dist(u.x, u.y, this.baseSpot.x, this.baseSpot.y) > 400) {
        w.orderMove(u, this.baseSpot.x + ((u.id % 6) - 3) * 40, this.baseSpot.y + 120);
        continue;
      }
      const mine = w.findNearestResource(u, 'gold');
      if (mine) w.orderGather(u, mine.id);
      else {
        const tree = this.findTreeNear(u);
        if (tree) w.orderGather(u, tree.id);
      }
    }
  }

  // ------------------------------------------------------------- hero
  manageHero() {
    const w = this.world;
    const p = this.player;
    const aliveHeroes = p.heroes.filter((h) => !h.dead);
    if (aliveHeroes.length === 0) {
      if (p.heroRevive.length) return;
      const altar = w.buildings.find((b) => !b.dead && b.owner === this.playerId && b.def.heroAltar && !b.constructing);
      if (altar && altar.trainQueue.length === 0 && this.countHeroesEver() < 1) {
        const res = w.queueTrain(altar, this.heroPick);
        if (!res.ok) {
          // fall back to whatever hero we can afford
          for (const hid of ['mountain_king', 'paladin']) {
            if (w.queueTrain(altar, hid).ok) break;
          }
        }
      }
    }
    // spend skill points
    for (const hero of aliveHeroes) {
      let guard = 0;
      while (hero.skillPoints > 0 && guard++ < 6) {
        const pick = this.chooseAbility(hero);
        if (!pick) break;
        const res = w.learnAbility(hero, pick);
        if (!res.ok) break;
      }
      // use items when low
      if (hero.items) {
        const hpRatio = hero.hp / hero.maxHp;
        if (hpRatio < 0.5) {
          const slot = hero.items.findIndex((it) => it && it.defId === 'potion_healing');
          if (slot >= 0) w.useItem(hero, slot);
        }
        const manaRatio = hero.maxMana ? hero.mana / hero.maxMana : 1;
        if (manaRatio < 0.3) {
          const slot = hero.items.findIndex((it) => it && it.defId === 'potion_mana');
          if (slot >= 0) w.useItem(hero, slot);
        }
      }
      // cast spells when enemies are nearby
      const enemies = w.enemiesInRadius(hero, hero.x, hero.y, 460, {});
      if (enemies.length >= 2) {
        for (const a of hero.abilities) {
          if (a.level <= 0) continue;
          const ab = ABILITIES[a.id];
          if (!ab || ab.aura || ab.kind === 'passive') continue;
          if ((hero.cooldowns[a.id] || 0) > 0) continue;
          if (hero.mana < (ab.mana[a.level - 1] || 0) + 25) continue;
          let ok = false;
          if (ab.kind === 'none') {
            ok = w.orderCast(hero, a.id, a.level);
          } else if (ab.kind === 'point') {
            const t = enemies[0];
            ok = w.orderCast(hero, a.id, a.level, t.x, t.y);
          } else if (ab.kind === 'unit') {
            if (ab.target === 'ally') {
              const wounded = w.unitsInRadius(hero.x, hero.y, ab.range, (u) =>
                !u.dead && u.hero && u !== hero && w.isAlly(hero, u) && u.hp < u.maxHp * 0.6);
              if (wounded.length) ok = w.orderCast(hero, a.id, a.level, wounded[0].x, wounded[0].y, wounded[0].id);
            } else {
              const t = enemies[0];
              ok = w.orderCast(hero, a.id, a.level, t.x, t.y, t.id);
            }
          }
          if (ok) break;
        }
      }
      // pick up items on the ground
      if (hero.order.type === 'idle' || hero.order.type === 'move') {
        for (const it of w.items) {
          if (dist(hero.x, hero.y, it.x, it.y) < 260) {
            w.orderPickup(hero, it.id);
            break;
          }
        }
      }
    }
  }

  chooseAbility(hero) {
    const reqs = (id) => ABIL_REQS[id] || [1, 3, 5];
    const maxLvl = (id) => ABIL_LEVELS[id] || 1;
    const available = hero.abilities.filter((a) =>
      a.level < maxLvl(a.id) && hero.heroLevel >= (reqs(a.id)[a.level] || 1));
    if (!available.length) return null;
    // grab the ultimate as soon as it unlocks
    const ult = available.find((a) => maxLvl(a.id) === 1);
    if (ult) return ult.id;
    // otherwise round-robin the basic skills, favouring the lowest level
    available.sort((a, b) => a.level - b.level);
    return available[0].id;
  }

  countHeroesEver() {
    return this.player.heroes.length;
  }

  // ------------------------------------------------------------- tech
  manageTech() {
    const w = this.world;
    const p = this.player;
    if (p.tier < 3) {
      const hall = this.townHall();
      if (!hall || hall.upgrading) return;
      const target = hall.defId === 'townhall' ? 'keep' : hall.defId === 'keep' ? 'castle' : null;
      if (!target) return;
      const cost = BUILDINGS[target].cost;
      const reserve = 300;
      if (p.gold >= cost.gold + reserve && p.lumber >= cost.lumber + 60) {
        w.startBuildingUpgrade(hall, target);
      }
    }
  }

  manageUpgrades() {
    const w = this.world;
    const p = this.player;
    const smith = w.buildings.find((b) => !b.dead && b.owner === this.playerId && b.defId === 'blacksmith' && !b.constructing);
    if (!smith || smith.researchQueue.length > 0) return;
    for (const id of ['iron_forging', 'black_gunpowder', 'plated_armor', 'masonry', 'animal_war_training']) {
      const up = UPGRADES[id];
      const lvl = p.upgrades[id] || 0;
      if (lvl >= up.maxLevel) continue;
      const cost = up.cost[lvl];
      if (p.gold >= cost.gold + 100 && p.lumber >= cost.lumber + 50) {
        const res = w.queueResearch(smith, id);
        if (res.ok) return;
      }
    }
  }

  // ------------------------------------------------------------- army
  manageArmy() {
    const w = this.world;
    const p = this.player;
    const buildings = w.buildings.filter((b) => !b.dead && b.owner === this.playerId && !b.constructing);
    const barracks = buildings.filter((b) => b.defId === 'barracks');
    const sanctum = buildings.find((b) => b.defId === 'sanctum');
    const armyCount = this.army().length;
    const desired = p.tier >= 3 ? 20 : p.tier >= 2 ? 14 : 9;
    if (armyCount >= desired) return;
    const reserve = 120;
    for (const b of barracks) {
      if (b.trainQueue.length >= 2) continue;
      const pick = this.chooseArmyUnit(p);
      if (!pick) continue;
      const def = ALL_DEFS[pick];
      if (p.gold < def.cost.gold + reserve) continue;
      w.queueTrain(b, pick);
    }
    if (sanctum && sanctum.trainQueue.length < 2) {
      const wantPriest = this.countUnits('priest') < 2;
      const pick = wantPriest ? 'priest' : 'sorceress';
      const def = ALL_DEFS[pick];
      if (p.gold >= def.cost.gold + reserve && p.lumber >= def.cost.lumber) w.queueTrain(sanctum, pick);
    }
  }

  chooseArmyUnit(p) {
    const options = [];
    if (this.countUnits('footman') < 5) options.push('footman');
    if (this.countUnits('rifleman') < 6) options.push('rifleman');
    if (p.tier >= 2 && this.countUnits('knight') < 3) options.push('knight');
    if (p.tier >= 2 && this.countUnits('mortar') < 1) options.push('mortar');
    if (!options.length) options.push('footman');
    const affordable = options.filter((id) => {
      const d = ALL_DEFS[id];
      return this.player.gold >= d.cost.gold + 60 && this.player.lumber >= d.cost.lumber;
    });
    return affordable[0] || null;
  }

  // ------------------------------------------------------------- building
  manageBuild() {
    const w = this.world;
    const p = this.player;
    const workers = this.workers();
    if (!workers.length) return;
    // finish abandoned construction sites first (builder died or was pulled away)
    const abandoned = w.buildings.find((b) => !b.dead && b.owner === this.playerId && b.constructing &&
      b.builders.size === 0);
    if (abandoned) {
      const builder = workers.find((u) => u.order.type === 'idle') ||
        workers.find((u) => u.order.type === 'gather') || workers[0];
      if (builder) { w.orderStop(builder); w.orderBuild(builder, abandoned.id); }
      return;
    }
    // only one construction at a time, and only build with surplus resources
    if (workers.some((u) => u.order.type === 'build')) return;
    if (this.countUnderConstruction() >= 1) return;
    for (const entry of BUILD_ORDER) {
      const def = BUILDINGS[entry.id];
      if (!def) continue;
      const built = this.countBuildings(entry.id);
      if (built >= entry.max) continue;
      if (!entry.check(this, w, p)) continue;
      if (def.tier > p.tier) continue;
      if (!w.hasRequirements(this.playerId, def)) continue;
      const reserve = entry.force ? 0 : 80;
      if (p.gold < def.cost.gold + reserve) continue;
      if (p.lumber < def.cost.lumber) continue;
      const spot = this.findBuildSpot(def);
      if (!spot) continue;
      if (!w.pay(this.playerId, def.cost)) continue;
      const b = w.createBuilding(entry.id, this.playerId,
        (spot[0] + def.footprint[0] / 2) * TILE, (spot[1] + def.footprint[1] / 2) * TILE, { complete: false });
      const builder = workers.find((u) => u.order.type === 'idle' || (u.order.type === 'gather' && u.order.resource === 'lumber')) || workers[0];
      if (builder) {
        w.orderStop(builder);
        w.orderBuild(builder, b.id);
      }
      return;
    }
  }

  countUnderConstruction() {
    let n = 0;
    for (const b of this.world.buildings) {
      if (!b.dead && b.owner === this.playerId && b.constructing) n++;
    }
    return n;
  }

  findBuildSpot(def) {
    const w = this.world;
    const base = this.baseSpot;
    const fp = def.footprint || [2, 2];
    const team = this.player.team;
    const hall = this.townHall();
    if (!hall) return null;
    const candidates = [];
    for (let r = 5; r <= 13; r++) {
      const steps = Math.max(8, Math.floor(r * 5));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const tx = Math.round(hall.tx + Math.cos(a) * r);
        const ty = Math.round(hall.ty + Math.sin(a) * r);
        candidates.push([tx, ty, Math.abs(r - 7)]);
      }
    }
    candidates.sort((a, b) => a[2] - b[2]);
    for (const [tx, ty] of candidates) {
      const spot = this.adjustSpot(def, tx, ty);
      if (!spot) continue;
      if (!w.fog.isExplored(team, (spot[0] + 1) * TILE, (spot[1] + 1) * TILE)) continue;
      if (!w.canPlaceBuilding(def, spot[0], spot[1])) continue;
      return spot;
    }
    return null;
  }

  adjustSpot(def, tx, ty) {
    const fp = def.footprint || [2, 2];
    const w = this.world;
    for (let oy = 0; oy < fp[1]; oy++) {
      for (let ox = 0; ox < fp[0]; ox++) {
        const x = tx + ox, y = ty + oy;
        if (x < 2 || y < 2 || x >= w.width - 2 || y >= w.height - 2) return null;
      }
    }
    return [tx, ty];
  }

  // ------------------------------------------------------------- expansion
  manageExpansion() {
    const w = this.world;
    const p = this.player;
    if (this.expandTimer > 0) return;
    if (p.gold < 700) return;
    const halls = w.buildings.filter((b) => !b.dead && b.owner === this.playerId && b.def.isTownHall);
    if (halls.length >= 2) return;
    // grab the nearest unclaimed gold mine
    let best = null, bestD = Infinity;
    for (const m of w.buildings) {
      if (!m.isMine || m.gold <= 0) continue;
      let claimed = false;
      for (const h of halls) if (dist(h.x, h.y, m.x, m.y) < 500) claimed = true;
      if (claimed) continue;
      const d = dist(this.baseSpot.x, this.baseSpot.y, m.x, m.y);
      if (d < 1600 && d < bestD) { bestD = d; best = m; }
    }
    if (!best) return;
    this.expandTimer = 45;
    const def = BUILDINGS.townhall;
    if (p.gold < def.cost.gold + 100 || p.lumber < def.cost.lumber) return;
    // build a town hall next to the mine
    const spot = w.findBuildingSpot(
      Math.round(best.tx) - 5, Math.round(best.ty) + 1, 4, 4, 8,
    );
    if (!w.canPlaceBuilding(def, spot[0], spot[1])) return;
    const workers = this.workers();
    if (!workers.length) return;
    if (!w.pay(this.playerId, def.cost)) return;
    const b = w.createBuilding('townhall', this.playerId, (spot[0] + 2) * TILE, (spot[1] + 2) * TILE, { complete: false });
    const builder = workers.find((u) => u.order.type === 'idle') || workers[0];
    w.orderStop(builder);
    w.orderBuild(builder, b.id);
  }

  // ------------------------------------------------------------- combat
  manageAttack() {
    const w = this.world;
    const army = this.army();
    if (!army.length) return;
    const enemyNearBase = this.enemyUnitsNear(this.baseSpot, 800);
    if (enemyNearBase.length) {
      for (const u of army) {
        if (u.order.type === 'attack' && u.attackTarget && !u.attackTarget.dead) continue;
        const target = enemyNearBase[0];
        if (u.order.type === 'idle' || u.order.type === 'hold' || u.order.type === 'move') {
          w.orderAttack(u, target.id);
        }
      }
      this.mode = 'defend';
      return;
    }
    // creeps: send the hero and a couple of units to clear nearby camps while building up
    const hero = this.player.heroes.find((h) => !h.dead);
    if (hero && hero.order.type === 'idle' && army.length >= 3) {
      const camp = this.findCreepCamp(hero, 1400);
      if (camp) {
        w.orderAttackMove(hero, camp.x, camp.y);
        const escorts = army.filter((u) => u !== hero).slice(0, 3);
        for (const e of escorts) if (e.order.type === 'idle') w.orderAttackMove(e, camp.x, camp.y);
        return;
      }
    }
    // main attack wave
    const threshold = this.attackThreshold();
    if (army.length >= threshold && this.attackTimer > 24 && this.targetBase) {
      this.attackTimer = 0;
      this.attackWave++;
      this.lastWaveSize = army.length;
      const target = this.pickAttackTarget();
      if (target) {
        for (const u of army) {
          if (u.order.type === 'attack') continue;
          w.orderAttackMove(u, target.x, target.y);
        }
        this.mode = 'attack';
      }
    }
    // rally idle units near home
    const hall = this.townHall();
    if (hall && this.mode !== 'attack') {
      for (const u of army) {
        if (u.order.type === 'idle') {
          const a = (u.id % 8) / 8 * Math.PI * 2;
          w.orderAttackMove(u, this.baseSpot.x + Math.cos(a) * 220, this.baseSpot.y + Math.sin(a) * 220);
        }
      }
    }
  }

  attackThreshold() {
    const base = this.player.tier >= 3 ? 12 : this.player.tier >= 2 ? 9 : 6;
    return Math.max(4, Math.round(base * this.aggression));
  }

  pickAttackTarget() {
    const w = this.world;
    // prefer visible enemy buildings, else remembered base
    const visible = w.buildings.filter((b) => !b.dead && b.owner >= 0 &&
      w.players[b.owner] && w.players[b.owner].team !== this.player.team &&
      w.fog.isVisible(this.player.team, b.x, b.y));
    if (visible.length) return visible[0];
    return this.targetBase;
  }

  enemyUnitsNear(point, radius) {
    const w = this.world;
    const out = [];
    for (const u of w.units) {
      if (u.dead || u.owner < 0) continue;
      if (w.players[u.owner] && w.players[u.owner].team === this.player.team) continue;
      if (dist(u.x, u.y, point.x, point.y) <= radius) out.push(u);
    }
    out.sort((a, b) => dist(a.x, a.y, point.x, point.y) - dist(b.x, b.y, point.x, point.y));
    return out;
  }

  findCreepCamp(hero, radius) {
    const w = this.world;
    let best = null, bestD = Infinity;
    for (const u of w.units) {
      if (u.dead || !u.creep) continue;
      const d = dist(hero.x, hero.y, u.x, u.y);
      if (d < radius && d < bestD && u.hp > 0) { bestD = d; best = u; }
    }
    return best;
  }
}

// Ability metadata used by the ability-choosing heuristic.
const ABIL_LEVELS = {
  blizzard: 3, water_elemental: 3, brilliance_aura: 3, mass_teleport: 1,
  storm_bolt: 3, thunder_clap: 3, bash: 3, avatar: 1,
  holy_light: 3, divine_shield: 3, devotion_aura: 3, resurrection: 1,
};
const ABIL_REQS = {
  blizzard: [1, 3, 5], water_elemental: [1, 3, 5], brilliance_aura: [1, 3, 5], mass_teleport: [6],
  storm_bolt: [1, 3, 5], thunder_clap: [1, 3, 5], bash: [1, 3, 5], avatar: [6],
  holy_light: [1, 3, 5], divine_shield: [1, 3, 5], devotion_aura: [1, 3, 5], resurrection: [6],
};
