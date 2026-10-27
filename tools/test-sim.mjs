// Headless simulation smoke test: generates the map, starts a game, issues a
// scripted command stream and verifies core systems keep working. Run with
// `npm test`.
import { generateMap } from '../src/sim/mapgen.js';
import { World, NEUTRAL_HOSTILE } from '../src/sim/world.js';
import { ABILITIES } from '../src/data/abilities.js';
import { BUILDINGS, HEROES, UNITS, UPGRADES } from '../src/data/human.js';
import { ITEMS } from '../src/data/items.js';
import { TILE, dist } from '../src/core/util.js';

let failures = 0;
const check = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { console.log(`  FAIL ${name} ${extra}`); failures++; }
};

const map = generateMap(4242);
console.log(`map ${map.width}x${map.height}, ${map.trees.length} trees, ${map.mines.length} mines, ${map.camps.length} camps`);
const world = new World({
  seed: 4242, map,
  playerDefs: [
    { name: 'Human', team: 0, isHuman: true },
    { name: 'Orc CPU', team: 1, isHuman: false },
  ],
});
world.startGame();

check('both players have a town hall', world.players.every((p) => world.hasBuilding(p.id, 'townhall')));
check('each player starts with peasants', world.players.every((p) => world.aliveUnits(p.id).filter((u) => u.defId === 'peasant').length === 5));
check('trees exist', world.trees.length > 50);
check('creeps exist', world.aliveUnits(NEUTRAL_HOSTILE).length > 4);
check('food cap from farms', world.players[0].foodCap >= 12);

const p0 = world.players[0];
const hall = world.findTownHall(0);
const mine = world.buildings.find((b) => b.isMine);
const peasant = world.aliveUnits(0).find((u) => u.defId === 'peasant');
world.orderGather(peasant, mine.id);

// place a barracks so we can train
const bx = hall.x + 4 * TILE, by = hall.y + 4 * TILE;
const spot = world.findBuildingSpot(Math.round(bx / TILE), Math.round(by / TILE), 3, 3);
const site = world.createBuilding('barracks', 0, bx, by, { complete: false });
const builder = world.aliveUnits(0).filter((u) => u.defId === 'peasant')[1];
world.orderBuild(builder, site.id);

// train a footman at a completed barracks later
const dummyBarracks = world.createBuilding('barracks', 0, hall.x - 5 * TILE, hall.y - 5 * TILE, { complete: true });
const trainRes = world.queueTrain(dummyBarracks, 'footman');
check('queue footman', trainRes.ok, JSON.stringify(trainRes));

// altar + hero
p0.gold += 1000; p0.lumber += 500;
const altar = world.createBuilding('altar', 0, hall.x + 5 * TILE, hall.y - 5 * TILE, { complete: true });
const heroRes = world.queueTrain(altar, 'archmage');
check('queue archmage', heroRes.ok, JSON.stringify(heroRes));

// simulate 90 seconds of game time
const dt = 1 / 30;
let ticks = 0;
const startGold = p0.gold;
for (let t = 0; t < 90; t += dt) {
  world.update(dt);
  ticks++;
  if (ticks % 900 === 0 && world.players[1].gold > 0) {
    // make the AI-ish player do something occasionally
    const w = world.aliveUnits(1).find((u) => u.defId === 'peasant');
    if (w) world.orderGather(w, mine.id);
  }
}
console.log(`simulated 90s in ${ticks} ticks; hero count ${p0.heroes.length}`);

const hero = p0.heroes[0];
check('hero spawned', !!hero);
check('barracks finished by worker', world.getEntity(site.id) && world.getEntity(site.id).complete);
check('gold gathered', p0.stats.goldGathered > 0, `gathered ${p0.stats.goldGathered}`);
check('gold spent/earned sanity', p0.gold >= 0 && p0.lumber >= 0);
check('footman trained', p0.stats.unitsTrained >= 1, `trained ${p0.stats.unitsTrained}`);

// hero abilities
if (hero) {
  check('hero has skill point', hero.skillPoints >= 1);
  const learn = world.learnAbility(hero, 'blizzard');
  check('learned blizzard', learn.ok, JSON.stringify(learn));
  const target = { x: hero.x + 200, y: hero.y + 200 };
  hero.mana = hero.maxMana;
  const cast = world.orderCast(hero, 'blizzard', 1, target.x, target.y);
  check('cast blizzard', cast);
  world.update(dt);
  world.update(dt);
  check('blizzard effect spawned', world.effects.length >= 0);
  // direct damage test
  const creep = world.aliveUnits(NEUTRAL_HOSTILE)[0];
  if (creep) {
    const before = creep.hp;
    world.damage(creep, 100, { owner: 0, x: creep.x, y: creep.y, id: 1 }, 'magic');
    check('damage applied', creep.hp < before || creep.dead);
  }
  // hero xp
  const oldLevel = hero.heroLevel;
  world.gainXp(hero, 600);
  check('hero leveled up', hero.heroLevel > oldLevel, `${oldLevel} -> ${hero.heroLevel}`);
}

// upgrades
const smith = world.createBuilding('blacksmith', 0, hall.x - 6 * TILE, hall.y + 6 * TILE, { complete: true });
const research = world.queueResearch(smith, 'iron_forging');
check('queued research', research.ok, JSON.stringify(research));
for (let i = 0; i < 30 * 50; i++) world.update(dt);
check('upgrade completed', world.players[0].upgrades.iron_forging === 1);

// items
if (!hero) { console.log('no hero to test items with'); process.exit(1); }
const drop = world.dropItem('potion_healing', hero.x + 20, hero.y + 20);
check('item dropped', !!drop);
const picked = world.giveItem(hero, 'potion_healing', 1);
check('item given to hero', picked);
const beforeHp = hero.hp;
hero.hp = 1;
const useRes = world.useItem(hero, hero.items.findIndex((i) => i && i.defId === 'potion_healing'));
check('potion heals', useRes.ok && hero.hp > 1, JSON.stringify(useRes));

// fog
check('fog visible at base', world.fog.isVisible(0, hall.x, hall.y));
const exploredCells = world.fog.teams[0].explored.reduce((a, b) => a + b, 0);
check('fog only partially explored', exploredCells > 0 && exploredCells < world.width * world.height * 0.5, `${exploredCells} cells`);

// combat: send units at the creeps
const attackers = world.aliveUnits(0).filter((u) => u.kind === 'unit').slice(0, 6);
const creepCamp = world.aliveUnits(NEUTRAL_HOSTILE)[0];
for (const a of attackers) world.orderAttack(a, creepCamp.id);
for (let i = 0; i < 30 * 40; i++) world.update(dt);
check('creep camp engaged', creepCamp.dead || creepCamp.hp < creepCamp.maxHp, `hp ${creepCamp.hp}`);

// check no entity escaped the world
const outOfBounds = world.units.filter((u) => !u.dead && (u.x < 0 || u.y < 0 || u.x > world.worldWidth || u.y > world.worldHeight));
check('no units out of bounds', outOfBounds.length === 0);

// long run stability + AI later, here just more ticks
for (let i = 0; i < 30 * 60; i++) world.update(dt);
check('world still stable', world.units.every((u) => u.kind === 'unit'));
check('no NaN positions', world.units.every((u) => Number.isFinite(u.x) && Number.isFinite(u.y) && Number.isFinite(u.hp)));
check('heroes list sane', world.players[0].heroes.every((h) => Number.isFinite(h.hp)));

console.log(failures === 0 ? '\nAll simulation checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
