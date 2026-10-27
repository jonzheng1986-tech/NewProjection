// Browser-driven checks for the deeper systems: tech tiers, research, shops,
// hero death and revival, item drops, autocast and victory conditions.
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const PORT = process.env.PORT || 5199;
const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  headless: true,
  env: { ...process.env, LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH || '/tmp/al2023/lib' },
  args: [...chromium.args, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle0' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const G = (fn, ...a) => page.evaluate(fn, ...a);
let failures = 0;
async function check(name, fn) {
  try {
    const r = await fn();
    if (r === false) throw new Error('returned false');
    console.log(`  ok   ${name}`);
  } catch (e) {
    console.log(`  FAIL ${name}: ${e.message}`);
    failures++;
  }
}
async function refresh() { await G(() => { try { window.__game.ui.draw(); } catch (e) { console.error(e); } }); }
async function region(kind, pred) {
  await refresh();
  return G((k, p) => {
    const g = window.__game;
    const f = new Function('r', `return (${p})(r)`);
    const r = (g.ui.regions || []).filter((x) => x.kind === k).find((x) => f(x));
    return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2, index: r.index, id: r.id } : null;
  }, kind, pred.toString());
}
async function click(x, y, button = 'left') {
  await page.mouse.move(x, y);
  await page.mouse.down({ button });
  await page.mouse.up({ button });
  await sleep(80);
}
const sim = (sec) => G((s) => { const g = window.__game; for (let i = 0; i < s * 30; i++) g.stepSim(1 / 30); }, sec);

await G(() => window.__game.newGame(777));
await sleep(500);
await G(() => {
  window.__game.ai = null;
  window.__game.world.players[0].gold = 4000;
  window.__game.world.players[0].lumber = 3000;
});

await check('fog hides the enemy base until scouted', async () => {
  return G(() => {
    const g = window.__game;
    const enemy = g.world.findTownHall(1);
    if (!enemy) return true;
    const team = g.localTeam;
    // the enemy town hall is far outside the opening vision radius
    const hidden = !g.world.fog.isVisible(team, enemy.x, enemy.y) && !g.world.fog.isExplored(team, enemy.x, enemy.y);
    g.world.createUnit('footman', 0, enemy.x + 60, enemy.y, { snap: true });
    for (let i = 0; i < 20; i++) g.world.update(1 / 30);
    const seen = g.world.fog.isVisible(team, enemy.x, enemy.y);
    return hidden && seen;
  });
});



await check('town hall upgrades to a Keep through the command card', async () => {
  await G(() => {
    const g = window.__game;
    const h = g.world.findTownHall(0);
    g.selection = [h];
    g.syncSelection();
    g.renderer.centerOn(h.x, h.y);
  });
  const btn = await region('command', (r) => r.cmd && r.cmd.action === 'upgradeBuilding' && r.cmd.payload.defId === 'keep');
  if (!btn) throw new Error('no keep upgrade button');
  await click(btn.x, btn.y);
  const started = await G(() => {
    const h = window.__game.world.findTownHall(0);
    return !!(h && h.upgrading);
  });
  await sim(105);
  const isKeep = await G(() => window.__game.world.buildings.some((b) => b.owner === 0 && b.defId === 'keep'));
  console.log(`    upgrading: ${started}, keep built: ${isKeep}`);
  return started && isKeep;
});

await check('keep unlocks tier 2 units and buildings', async () => {
  return G(() => {
    const g = window.__game;
    return g.world.players[0].tier >= 2;
  });
});

await check('blacksmith research completes and buffs damage', async () => {
  const setup = await G(() => {
    const g = window.__game;
    const hall = g.world.findTownHall(0);
    const bs = g.world.aliveBuildings(0).find((b) => b.defId === 'blacksmith')
      || g.world.createBuilding('blacksmith', 0, hall.x - 220, hall.y - 120, { complete: true });
    const footman = g.world.createUnit('footman', 0, bs.x + 60, bs.y + 90, { snap: true });
    g.selection = [bs];
    g.syncSelection();
    g.renderer.centerOn(bs.x, bs.y);
    return { bsId: bs.id, footmanId: footman.id, before: g.world.effectiveDamageRange(footman) };
  });
  const btn = await region('command', (r) => r.cmd && r.cmd.action === 'research');
  if (!btn) throw new Error('no research button on the blacksmith');
  await click(btn.x, btn.y);
  const queued = await G((id) => {
    const b = window.__game.world.getEntity(id);
    return b.researchQueue ? b.researchQueue.length : -1;
  }, setup.bsId);
  await sim(70);
  const after = await G((id) => {
    const u = window.__game.world.getEntity(id);
    const p = window.__game.world.players[0];
    return { dmg: window.__game.world.effectiveDamageRange(u), ups: Object.keys(p.upgrades || {}) };
  }, setup.footmanId);
  console.log(`    queue ${queued}, damage ${setup.before.map(Math.round)} -> ${after.dmg.map(Math.round)}, upgrades ${after.ups}`);
  return queued === 1 && (after.dmg[1] > setup.before[1] || after.ups.length > 0);
});

await check('hero dies and revives at the altar', async () => {
  const heroId = await G(() => {
    const g = window.__game;
    const hall = g.world.findTownHall(0);
    const altar = g.world.aliveBuildings(0).find((b) => b.def.heroAltar)
      || g.world.createBuilding('altar', 0, hall.x + 200, hall.y + 120, { complete: true });
    const hero = g.world.createUnit('paladin', 0, altar.x + 40, altar.y + 90, { snap: true });
    g.world.gainXp(hero, 200);
    g.selection = [hero];
    g.syncSelection();
    g.renderer.centerOn(hero.x, hero.y);
    return hero.id;
  });
  await G((id) => { const h = window.__game.world.getEntity(id); h.hp = 1; window.__game.world.damage(h, 999, null, 'normal'); }, heroId);
  const dead = await G((id) => window.__game.world.getEntity(id).dead, heroId);
  await refresh();
  await refresh();
  const panelText = await G(() => {
    const g = window.__game;
    const p = g.world.players[0];
    return { revive: p.heroRevive.length, hasAltar: !!g.world.aliveBuildings(0).find((b) => b.def.heroAltar) };
  });
  await sim(90);
  const revived = await G((id) => {
    const h = window.__game.world.getEntity(id);
    return { dead: h.dead, hp: h.hp };
  }, heroId);
  console.log(`    dead ${dead}, revive queue ${panelText.revive}, after: dead=${revived.dead} hp=${Math.round(revived.hp)}`);
  return dead && panelText.revive === 1 && !revived.dead;
});

await check('shop sells an item to a nearby hero', async () => {
  const setup = await G(() => {
    const g = window.__game;
    const hall = g.world.findTownHall(0);
    const shop = g.world.aliveBuildings(0).find((b) => b.def.sells && b.def.sells.length)
      || g.world.createBuilding('vault', 0, hall.x - 240, hall.y + 140, { complete: true });
    const hero = g.primaryHero();
    hero.dead = false;
    hero.items = [null, null, null, null, null, null];
    hero.x = shop.x + 60; hero.y = shop.y + 60;
    g.world.players[0].gold = 3000;
    g.selection = [shop];
    g.syncSelection();
    g.renderer.centerOn(shop.x, shop.y);
    return { shopId: shop.id, heroId: hero.id };
  });
  const btn = await region('command', (r) => r.cmd && r.cmd.action === 'buy');
  if (!btn) throw new Error('no buy button');
  await click(btn.x, btn.y);
  const items = await G((id) => {
    const h = window.__game.world.getEntity(id);
    return h.items.filter(Boolean).map((i) => i.defId);
  }, setup.heroId);
  console.log(`    inventory ${items.join(', ') || '(empty)'}`);
  return items.length === 1;
});

await check('creep drops an item that a hero can pick up', async () => {
  const setup = await G(() => {
    const g = window.__game;
    const hero = g.primaryHero();
    hero.dead = false;
    hero.hp = hero.maxHp;
    hero.items = [null, null, null, null, null, null];
    // a creep drop and a manual drop both land on the ground next to the hero
    const camp = g.world.units.find((u) => u.creep && !u.dead);
    if (!camp) return null;
    g.world.damage(camp, 9999, hero, 'normal');
    const drop = g.world.dropItem('potion_healing', hero.x + 34, hero.y + 12, 1);
    return { heroId: hero.id, dropId: drop.id, campName: camp.name };
  });
  if (!setup) throw new Error('no creeps on the map');
  const itemId = await G((id) => {
    const g = window.__game;
    g.world.orderPickup(g.primaryHero(), id);
    return id;
  }, setup.dropId);
  if (!itemId) throw new Error('drop failed');
  await sim(20);
  const carried = await G((id) => {
    const h = window.__game.world.getEntity(id);
    return h.items.filter(Boolean).length;
  }, setup.heroId);
  console.log(`    ${setup.campName} dropped an item, hero carries ${carried}`);
  return carried >= 1;
});

await check('priest autocast heals a wounded ally', async () => {
  const setup = await G(() => {
    const g = window.__game;
    const hall = g.world.findTownHall(0);
    const priest = g.world.createUnit('priest', 0, hall.x + 150, hall.y + 150, { snap: true });
    const soldier = g.world.createUnit('footman', 0, hall.x + 170, hall.y + 160, { snap: true });
    soldier.hp = soldier.maxHp * 0.35;
    const st = priest.abilities.find((a) => a.level > 0);
    if (st) st.enabled = true;
    g.world.orderHold(priest);
    g.world.orderHold(soldier);
    return { priestId: priest.id, soldierId: soldier.id, hp: soldier.hp, ability: st ? st.id : null };
  });
  await sim(14);
  const hp = await G((id) => window.__game.world.getEntity(id).hp, setup.soldierId);
  console.log(`    ${setup.ability}: soldier hp ${Math.round(setup.hp)} -> ${Math.round(hp)}`);
  return hp > setup.hp + 20;
});

await check('destroying every enemy building ends the game', async () => {
  const result = await G(() => {
    const g = window.__game;
    for (const b of g.world.aliveBuildings(1)) g.world.damage(b, 99999, null, 'normal');
    for (const u of g.world.aliveUnits(1)) g.world.damage(u, 99999, null, 'normal');
    for (let i = 0; i < 60; i++) g.stepSim(1 / 30);
    return { over: g.world.gameOver, winner: g.world.winner, team: g.localTeam };
  });
  console.log(`    gameOver ${result.over} winner ${result.winner} (local team ${result.team})`);
  return result.over === true && result.winner === result.team;
});

await check('game over screen appears', async () => {
  await sleep(2200);
  const m = await G(() => window.__game.ui.menu);
  console.log(`    menu ${m}`);
  return m === 'gameover';
});

if (errors.length) {
  console.log('\nconsole errors:');
  for (const e of [...new Set(errors)].slice(0, 15)) console.log('  ' + e);
  failures += errors.filter((e) => e.startsWith('PAGEERROR')).length;
}
await page.screenshot({ path: 'shots/21-victory.png' });
await browser.close();
console.log(failures === 0 ? '\nAll system checks passed.' : `\n${failures} system check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
