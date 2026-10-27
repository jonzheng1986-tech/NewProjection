// End-to-end interaction test in a real (headless) browser: drives the game
// with genuine mouse and keyboard events and asserts on simulation state.
// Requires: npm i -D puppeteer-core @sparticuz/chromium
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
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));

await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle0' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
async function check(name, fn) {
  try {
    const res = await fn();
    if (res === false) throw new Error('returned false');
    console.log(`  ok   ${name}`);
  } catch (err) {
    console.log(`  FAIL ${name}: ${err.message}`);
    failures++;
  }
}
const evalGame = (fn, ...args) => page.evaluate(fn, ...args);

async function refreshUi() {
  // force a UI rebuild so hit regions match the current state
  await evalGame(() => { try { window.__game.ui.draw(); } catch (err) { console.error(err); } });
}

async function regionPoint(kind, pred = () => true) {
  await refreshUi();
  return evalGame((k, p) => {
    const g = window.__game;
    const src = (g.ui.regions || []).filter((r) => r.kind === k);
    // rebuild the predicate in page context
    const match = src.find((r) => (new Function('r', `return (${p})(r)`))(r));
    if (!match) return null;
    return { x: match.x + match.w / 2, y: match.y + match.h / 2, id: match.id, index: match.index };
  }, kind, pred.toString());
}

async function clickAt(x, y, button = 'left') {
  await page.mouse.move(x, y);
  await page.mouse.down({ button });
  await page.mouse.up({ button });
  await sleep(90);
}

await check('main menu -> new game', async () => {
  await sleep(400);
  const btn = await regionPoint('menu', (r) => r.id === 'start');
  if (!btn) throw new Error('no start button');
  await clickAt(btn.x, btn.y);
  await sleep(600);
  const started = await evalGame(() => !!window.__game.world && window.__game.mode === 'playing');
  if (!started) throw new Error('game did not start');
});

await check('click a peasant selects it', async () => {
  const pos = await evalGame(() => {
    const g = window.__game;
    const w = g.world.units.find((u) => u.owner === 0 && u.def.canGather);
    const [sx, sy] = g.renderer.project(w.x, w.y);
    g.renderer.centerOn(w.x, w.y);
    return { sx, sy, id: w.id };
  });
  await sleep(200);
  const pos2 = await evalGame((id) => {
    const g = window.__game;
    const w = g.world.getEntity(id);
    const [sx, sy] = g.renderer.project(w.x, w.y);
    return { sx, sy };
  }, pos.id);
  await clickAt(pos2.sx, pos2.sy - 12);
  return evalGame((id) => window.__game.selection.length === 1 && window.__game.selection[0].id === id, pos.id);
});

await check('right click gold mine orders gathering', async () => {
  const mine = await evalGame(() => {
    const g = window.__game;
    const m = g.world.buildings.find((b) => b.isMine);
    const [sx, sy] = g.renderer.project(m.x, m.y);
    g.renderer.centerOn(m.x, m.y);
    return { id: m.id, sx, sy };
  });
  await sleep(200);
  const p = await evalGame((id) => {
    const g = window.__game;
    const m = g.world.getEntity(id);
    const [sx, sy] = g.renderer.project(m.x, m.y);
    return { sx, sy };
  }, mine.id);
  await clickAt(p.sx, p.sy - 10, 'right');
  await sleep(200);
  return evalGame((id) => {
    const g = window.__game;
    const sel = g.selection[0];
    return sel && sel.order.type === 'gather' && sel.order.targetId === id;
  }, mine.id);
});

await check('peasants deliver gold after simulated time', async () => {
  const before = await evalGame(() => window.__game.world.players[0].gold);
  await evalGame(() => { const g = window.__game; for (let i = 0; i < 30 * 70; i++) g.stepSim(1 / 30); });
  const after = await evalGame(() => window.__game.world.players[0].gold);
  console.log(`    gold ${before} -> ${after}`);
  return after > before;
});

await check('box select grabs several units', async () => {
  const box = await evalGame(() => {
    const g = window.__game;
    const hall = g.world.findTownHall(0);
    g.renderer.centerOn(hall.x, hall.y);
    return { x: 600, y: 300, x2: 1000, y2: 620 };
  });
  await sleep(200);
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move((box.x + box.x2) / 2, (box.y + box.y2) / 2);
  await page.mouse.move(box.x2, box.y2);
  await page.mouse.up();
  await sleep(150);
  const n = await evalGame(() => window.__game.selection.length);
  console.log(`    selected ${n}`);
  return n >= 2;
});

await check('control group assign and recall', async () => {
  await page.keyboard.down('Control');
  await page.keyboard.press('1');
  await page.keyboard.up('Control');
  await sleep(80);
  const assigned = await evalGame(() => (window.__game.controlGroups[1] || { units: [] }).units.length);
  await evalGame(() => { window.__game.selection = []; window.__game.syncSelection(); });
  await page.keyboard.press('1');
  await sleep(120);
  const recalled = await evalGame(() => window.__game.selection.length);
  return assigned > 0 && recalled === assigned;
});

await check('build menu opens with B and shows farms', async () => {
  const peasantId = await evalGame(() => {
    const g = window.__game;
    const w = g.world.units.find((u) => u.owner === 0 && u.def.canGather);
    g.selection = [w];
    g.syncSelection();
    g.world.players[0].gold = 2000;
    g.world.players[0].lumber = 1500;
    return w.id;
  });
  await page.keyboard.press('b');
  await sleep(120);
  const open = await evalGame(() => window.__game.buildMenu);
  const hasFarm = await evalGame(() => (window.__game.ui.commandsCache || []).some((c) => c && c.action === 'build' && c.payload.defId === 'farm'));
  return open && hasFarm && !!peasantId;
});

await check('placing a farm creates a construction site', async () => {
  const before = await evalGame(() => window.__game.world.buildings.filter((b) => b.owner === 0 && b.defId === 'farm').length);
  const cmd = await regionPoint('command', (r) => r.cmd && r.cmd.action === 'build' && r.cmd.payload.defId === 'farm');
  if (!cmd) throw new Error('no farm command button');
  await clickAt(cmd.x, cmd.y);
  const placing = await evalGame(() => !!window.__game.placingDef);
  if (!placing) throw new Error('placement mode not entered');
  // find a legal tile
  const spot = await evalGame(() => {
    const g = window.__game;
    const def = g.placingDef;
    const hall = g.world.findTownHall(0);
    const TILE = 32;
    for (let r = 2; r < 12; r++) {
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        const tx = Math.round((hall.x + Math.cos(ang) * r * TILE) / TILE);
        const ty = Math.round((hall.y + Math.sin(ang) * r * TILE) / TILE);
        if (g.world.canPlaceBuilding(def, tx, ty)) {
          const [sx, sy] = g.renderer.project((tx + def.footprint[0] / 2) * TILE, (ty + def.footprint[1] / 2) * TILE);
          return { sx, sy };
        }
      }
    }
    return null;
  });
  if (!spot) throw new Error('no valid build spot found');
  await page.mouse.move(spot.sx, spot.sy);
  await sleep(80);
  await clickAt(spot.sx, spot.sy);
  await sleep(150);
  const after = await evalGame(() => window.__game.world.buildings.filter((b) => b.owner === 0 && b.defId === 'farm').length);
  console.log(`    farms ${before} -> ${after}`);
  return after === before + 1;
});

await check('peasants finish the farm when simulated', async () => {
  await evalGame(() => { const g = window.__game; for (let i = 0; i < 30 * 45; i++) g.stepSim(1 / 30); });
  return evalGame(() => window.__game.world.buildings.some((b) => b.owner === 0 && b.defId === 'farm' && b.complete));
});

await check('town hall trains a peasant through the UI', async () => {
  const hall = await evalGame(() => {
    const g = window.__game;
    const h = g.world.findTownHall(0);
    g.world.players[0].gold = 3000;
    g.selection = [h];
    g.syncSelection();
    g.renderer.centerOn(h.x, h.y);
    return h.id;
  });
  await sleep(180);
  const before = await evalGame(() => window.__game.world.units.filter((u) => u.owner === 0 && u.defId === 'peasant' && !u.dead).length);
  const cmd = await regionPoint('command', (r) => r.cmd && r.cmd.action === 'train' && r.cmd.payload.defId === 'peasant');
  if (!cmd) throw new Error('no train peasant command');
  await clickAt(cmd.x, cmd.y);
  const queued = await evalGame((id) => (window.__game.world.getEntity(id).trainQueue || []).length, hall);
  await evalGame(() => { const g = window.__game; for (let i = 0; i < 30 * 30; i++) g.stepSim(1 / 30); });
  const after = await evalGame(() => window.__game.world.units.filter((u) => u.owner === 0 && u.defId === 'peasant' && !u.dead).length);
  console.log(`    peasants ${before} -> ${after} (queued ${queued})`);
  return queued >= 1 && after >= before;
});

await check('queue can be cancelled by clicking the queue chip', async () => {
  const hall = await evalGame(() => {
    const g = window.__game;
    const h = g.world.findTownHall(0);
    g.selection = [h];
    g.syncSelection();
    g.renderer.centerOn(h.x, h.y);
    g.world.players[0].gold = 3000;
    return h.id;
  });
  await sleep(180);
  const cmd = await regionPoint('command', (r) => r.cmd && r.cmd.action === 'train' && r.cmd.payload.defId === 'peasant');
  await clickAt(cmd.x, cmd.y);
  await sleep(120);
  const q1 = await evalGame((id) => window.__game.world.getEntity(id).trainQueue.length, hall);
  const chip = await regionPoint('queue', (r) => r.queueKind === 'train');
  if (!chip) throw new Error('no queue chip drawn');
  await clickAt(chip.x, chip.y);
  await sleep(120);
  const q2 = await evalGame((id) => window.__game.world.getEntity(id).trainQueue.length, hall);
  console.log(`    queue ${q1} -> ${q2}`);
  return q1 > 0 && q2 === q1 - 1;
});

await check('altar summons a hero via the command card', async () => {
  const altarId = await evalGame(() => {
    const g = window.__game;
    const hall = g.world.findTownHall(0);
    const altar = g.world.createBuilding('altar', 0, hall.x + 240, hall.y + 60, { complete: true });
    g.world.players[0].gold = 3000;
    g.selection = [altar];
    g.syncSelection();
    g.renderer.centerOn(altar.x, altar.y);
    return altar.id;
  });
  await sleep(200);
  const cmds = await evalGame(() => (window.__game.ui.commandsCache || []).map((c) => c.action + ':' + (c.payload ? c.payload.defId : '')).slice(0, 8));
  console.log(`    altar commands ${cmds.join(', ')}`);
  const heroCmd = await regionPoint('command', (r) => r.cmd && r.cmd.action === 'train' && /archmage|mountain_king|paladin/.test(r.cmd.payload.defId));
  if (!heroCmd) throw new Error('no hero summon command');
  await clickAt(heroCmd.x, heroCmd.y);
  await evalGame(() => { const g = window.__game; for (let i = 0; i < 30 * 75; i++) g.stepSim(1 / 30); });
  const heroes = await evalGame(() => window.__game.world.players[0].heroes.length);
  console.log(`    heroes ${heroes}`);
  return heroes >= 1 && !!altarId;
});

await check('hero ability can be learned from the hero panel', async () => {
  const info = await evalGame(() => {
    const g = window.__game;
    const hero = g.primaryHero();
    g.world.gainXp(hero, 300);
    g.selection = [hero];
    g.syncSelection();
    g.renderer.centerOn(hero.x, hero.y);
    return { id: hero.id, points: hero.skillPoints, level: hero.heroLevel };
  });
  await sleep(200);
  const learn = await regionPoint('heroAbility', (r) => r.learn === true);
  if (!learn) throw new Error('no learnable ability icon');
  await clickAt(learn.x, learn.y);
  await sleep(150);
  const after = await evalGame((id) => {
    const h = window.__game.world.getEntity(id);
    return { points: h.skillPoints, learned: h.abilities.filter((a) => a.level > 0).length };
  }, info.id);
  console.log(`    skill points ${info.points} -> ${after.points}, learned ${after.learned}`);
  return after.learned >= 1 && after.points === info.points - 1;
});

await check('point ability casts at the cursor', async () => {
  const before = await evalGame(() => {
    const g = window.__game;
    const hero = g.primaryHero();
    hero.mana = hero.maxMana;
    g.selection = [hero];
    g.syncSelection();
    g.renderer.centerOn(hero.x, hero.y);
    const st = hero.abilities.find((a) => a.level > 0);
    return { id: hero.id, mana: hero.mana, ability: st ? st.id : null };
  });
  await sleep(200);
  // find the hero command button that maps to a point cast
  const btn = await regionPoint('command', (r) => r.cmd && r.cmd.action === 'cast');
  if (!btn) throw new Error('no cast command on the command card');
  await clickAt(btn.x, btn.y);
  const targeting = await evalGame(() => window.__game.targeting && window.__game.targeting.type);
  if (targeting !== 'cast') throw new Error(`targeting was ${targeting}`);
  const ground = await evalGame(() => {
    const g = window.__game;
    const hero = g.primaryHero();
    const [sx, sy] = g.renderer.project(hero.x + 180, hero.y + 60);
    return { sx, sy };
  });
  await page.mouse.move(ground.sx, ground.sy);
  await clickAt(ground.sx, ground.sy);
  await sleep(150);
  const after = await evalGame((id) => {
    const h = window.__game.world.getEntity(id);
    return { mana: h.mana, order: h.order.type };
  }, before.id);
  console.log(`    mana ${before.mana} -> ${after.mana} (ability ${before.ability})`);
  return after.mana < before.mana || after.order === 'cast';
});

await check('inventory item can be used by clicking its slot', async () => {
  const setup = await evalGame(() => {
    const g = window.__game;
    const hero = g.primaryHero();
    hero.items = [null, null, null, null, null, null];
    g.world.giveItem(hero, 'potion_healing', 1);
    hero.hp = Math.max(1, hero.maxHp * 0.4);
    g.selection = [hero];
    g.syncSelection();
    g.renderer.centerOn(hero.x, hero.y);
    return { id: hero.id, hp: hero.hp };
  });
  await sleep(200);
  const slot = await regionPoint('inventory', (r) => r.index === 0);
  if (!slot) throw new Error('no item slot region');
  await clickAt(slot.x, slot.y);
  await sleep(150);
  const hp = await evalGame((id) => window.__game.world.getEntity(id).hp, setup.id);
  console.log(`    hp ${Math.round(setup.hp)} -> ${Math.round(hp)}`);
  return hp > setup.hp;
});

await check('attack-move via A + click issues the order', async () => {
  const setup = await evalGame(() => {
    const g = window.__game;
    const hall = g.world.findTownHall(0);
    g.world.players[0].gold = 3000;
    g.world.players[0].lumber = 2000;
    if (!g.world.units.some((u) => u.owner === 0 && !u.def.canGather)) {
      for (let i = 0; i < 3; i++) g.world.createUnit('footman', 0, hall.x + 90 + i * 40, hall.y + 120, { snap: true });
    }
    const units = g.world.units.filter((u) => u.owner === 0 && !u.def.canGather).slice(0, 3);
    g.selection = units;
    g.syncSelection();
    g.renderer.centerOn(hall.x, hall.y);
    return units.map((u) => u.id);
  });
  if (!setup.length) throw new Error('no combat units available yet');
  await page.keyboard.press('a');
  await sleep(80);
  const t = await evalGame(() => window.__game.targeting && window.__game.targeting.type);
  if (t !== 'attackmove') throw new Error(`targeting ${t}`);
  await clickAt(900, 240);
  await sleep(120);
  return evalGame((ids) => ids.every((id) => {
    const u = window.__game.world.getEntity(id);
    return u && (u.order.type === 'attackmove' || u.order.type === 'attack' || u.order.type === 'move');
  }), setup);
});

await check('minimap click moves the camera', async () => {
  const before = await evalGame(() => ({ x: window.__game.renderer.cam.x, y: window.__game.renderer.cam.y }));
  const mm = await evalGame(() => {
    const m = window.__game.ui.minimap;
    return { x: m.x + m.w * 0.75, y: m.y + m.h * 0.3 };
  });
  await clickAt(mm.x, mm.y);
  await sleep(150);
  const after = await evalGame(() => ({ x: window.__game.renderer.cam.x, y: window.__game.renderer.cam.y }));
  return Math.hypot(after.x - before.x, after.y - before.y) > 100;
});

await check('wheel zooms the camera', async () => {
  const before = await evalGame(() => window.__game.renderer.cam.targetZoom);
  await page.mouse.move(800, 400);
  await page.mouse.wheel({ deltaY: -240 });
  await sleep(250);
  const after = await evalGame(() => window.__game.renderer.cam.targetZoom);
  console.log(`    zoom ${before.toFixed(2)} -> ${after.toFixed(2)}`);
  return after > before;
});

await check('escape opens pause menu and resume returns to play', async () => {
  await evalGame(() => { window.__game.targeting = null; window.__game.placingDef = null; window.__game.buildMenu = false; });
  await page.keyboard.press('Escape');
  await sleep(140);
  const paused = await evalGame(() => window.__game.mode === 'paused' && window.__game.ui.menu === 'pause');
  const btn = await regionPoint('menu', (r) => r.id === 'resume');
  if (!btn) throw new Error('no resume button');
  await clickAt(btn.x, btn.y);
  await sleep(140);
  const resumed = await evalGame(() => window.__game.mode === 'playing' && window.__game.ui.menu === 'none');
  return paused && resumed;
});

await check('game keeps running for 20 real seconds without errors', async () => {
  await evalGame(() => window.__game.renderer.centerOn(window.__game.world.findTownHall(0).x, window.__game.world.findTownHall(0).y));
  await sleep(20000);
  const alive = await evalGame(() => !!window.__game.world && !window.__game.world.gameOver);
  return alive;
});

const stats = await evalGame(() => ({
  time: Math.round(window.__game.world.time),
  units: window.__game.world.units.length,
  buildings: window.__game.world.buildings.length,
  gold: Math.round(window.__game.world.players[0].gold),
  kills: window.__game.world.players[0].stats && window.__game.world.players[0].stats.kills,
  messages: window.__game.world.messages.length,
}));
console.log('state:', JSON.stringify(stats));

if (errors.length) {
  console.log('\nconsole problems:');
  for (const e of [...new Set(errors)].slice(0, 20)) console.log('  ' + e);
  failures += errors.filter((e) => e.startsWith('PAGEERROR')).length;
}

await page.screenshot({ path: 'shots/20-after-playtest.png' });
await browser.close();
console.log(failures === 0 ? '\nAll interaction checks passed.' : `\n${failures} interaction check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
