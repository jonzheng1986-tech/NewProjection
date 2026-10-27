// Dev-only visual harness: launches headless Chromium with SwiftShader, drives
// the game through scripted states and writes PNGs to shots/.
// Requires: npm i -D puppeteer-core @sparticuz/chromium
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { mkdir } from 'node:fs/promises';

const PORT = process.env.PORT || 5199;
const OUT = 'shots';
await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  headless: true,
  env: { ...process.env, LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH || '/tmp/al2023/lib' },
  args: [...chromium.args, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => logs.push(`PAGEERROR: ${e.message}`));

await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 500));
const shot = async (name) => {
  await new Promise((r) => setTimeout(r, 220));
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('shot', name);
};

await shot('01-menu');

await page.evaluate(() => window.__game.newGame(2024));
await new Promise((r) => setTimeout(r, 900));
await shot('02-game-start');

// select the starting peasants and look at the base
await page.evaluate(() => {
  const g = window.__game;
  const mine = g.world.buildings.find((b) => b.isMine);
  g.renderer.centerOn(mine.x, mine.y);
});
await new Promise((r) => setTimeout(r, 400));
await shot('03-base');

// select one peasant -> command card
await page.evaluate(() => {
  const g = window.__game;
  const w = g.world.units.filter((u) => u.owner === 0 && u.def.canGather);
  g.selection = [w[0]];
  g.syncSelection();
  g.renderer.centerOn(w[0].x, w[0].y);
});
await shot('04-worker-selected');

// build menu open
await page.evaluate(() => { window.__game.buildMenu = true; });
await shot('05-build-menu');
await page.evaluate(() => { window.__game.buildMenu = false; });

// spawn a hero, give items and abilities
await page.evaluate(() => {
  const g = window.__game;
  const w = g.world;
  const hall = w.findTownHall(0);
  w.players[0].gold = 2000;
  w.players[0].lumber = 1200;
  w.createBuilding('altar', 0, hall.x + 220, hall.y + 120, { complete: true });
  w.createBuilding('vault', 0, hall.x - 220, hall.y + 260, { complete: true });
  const hero = w.createUnit('mountain_king', 0, hall.x + 120, hall.y + 200, { snap: true });
  w.gainXp(hero, 1600);
  w.learnAbility(hero, 'storm_bolt');
  w.learnAbility(hero, 'thunder_clap');
  w.learnAbility(hero, 'bash');
  w.giveItem(hero, 'potion_healing', 2);
  w.giveItem(hero, 'ring_protection', 1);
  w.giveItem(hero, 'scroll_town_portal', 1);
  w.giveItem(hero, 'boots_speed', 1);
  g.selection = [hero];
  g.syncSelection();
  g.renderer.centerOn(hero.x, hero.y);
  g.ui.commandsCache = null;
});
await shot('06-hero-selected');

// hover a command button to show the tooltip
const hoverPoint = await page.evaluate(() => {
  const g = window.__game;
  const r = (g.ui.regions || []).find((x) => x.kind === 'command' && x.index === 0);
  return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : null;
});
if (hoverPoint) {
  await page.mouse.move(hoverPoint.x, hoverPoint.y);
  await new Promise((r) => setTimeout(r, 300));
}
await shot('07-tooltip');

// building selected (town hall)
await page.evaluate(() => {
  const g = window.__game;
  const hall = g.world.findTownHall(0);
  g.selection = [hall];
  g.syncSelection();
  g.renderer.centerOn(hall.x, hall.y);
  g.mouse.x = -100; g.mouse.y = -100;
});
await shot('08-hall-selected');

// shop selected
await page.evaluate(() => {
  const g = window.__game;
  const shop = g.world.buildings.find((b) => b.owner === 0 && b.def.sells);
  if (shop) { g.selection = [shop]; g.syncSelection(); g.renderer.centerOn(shop.x, shop.y); }
});
await shot('09-shop');

// hover the town hall stats / upkeep readout for a tooltip
await page.evaluate(() => {
  const g = window.__game;
  const hall = g.world.findTownHall(0);
  g.selection = [hall];
  g.syncSelection();
});
await new Promise((r) => setTimeout(r, 250));
await page.mouse.move(1400, 30);
await shot('09b-upkeep-tooltip');

// mid-game: run simulation with AI for 90s then look at the AI base region
await page.evaluate(() => {
  const g = window.__game;
  g.selection = [];
  g.syncSelection();
  for (let i = 0; i < 30 * 120; i++) g.stepSim(1 / 30);
  const enemy = g.world.findTownHall(1);
  if (enemy) g.renderer.centerOn(enemy.x, enemy.y);
});
await new Promise((r) => setTimeout(r, 500));
await shot('10-enemy-base');

await page.evaluate(() => {
  const g = window.__game;
  const hall = g.world.findTownHall(0);
  if (hall) g.renderer.centerOn(hall.x, hall.y);
});
await shot('11-own-base-later');

// help screen
await page.evaluate(() => { window.__game.lastMenuType = 'pause'; window.__game.ui.openMenu('help'); window.__game.mode = 'paused'; });
await shot('12-help');

// pause menu
await page.evaluate(() => { window.__game.ui.openMenu('pause'); });
await shot('13-pause');

await page.evaluate(() => { window.__game.ui.closeMenu(); window.__game.mode = 'playing'; });
await shot('14-back');

console.log('\n--- console ---');
console.log(logs.slice(0, 60).join('\n'));
await browser.close();
