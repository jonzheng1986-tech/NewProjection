import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  headless: true,
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/al2023/lib' },
  args: [...chromium.args, '--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto('http://127.0.0.1:5199/index.html', { waitUntil: 'networkidle0' });
await new Promise(r=>setTimeout(r,400));
await page.evaluate(() => window.__game.newGame(4242));
await new Promise(r=>setTimeout(r,300));
await page.evaluate(() => {
  const g = window.__game;
  const w = g.world;
  const hall = w.findTownHall(0);
  w.players[0].gold = 5000; w.players[0].lumber = 4000;
  const enemyHall = w.findTownHall(1);
  const cx = (hall.x + enemyHall.x)/2, cy = (hall.y+enemyHall.y)/2;
  const kinds = ['footman','rifleman','knight','priest','sorceress','footman','rifleman'];
  for (let i=0;i<7;i++) w.createUnit(kinds[i], 0, cx - 90 + i*26, cy + 40, {snap:true});
  const hero = w.createUnit('mountain_king', 0, cx - 130, cy + 10, {snap:true});
  w.gainXp(hero, 2000);
  w.learnAbility(hero, 'storm_bolt'); w.learnAbility(hero, 'thunder_clap'); w.learnAbility(hero, 'bash');
  hero.mana = hero.maxMana;
  for (let i=0;i<8;i++) w.createUnit(['footman','rifleman','knight'][i%3], 1, cx + 110 + (i%3)*24, cy - 40 + Math.floor(i/3)*26, {snap:true});
  const enemyHero = w.createUnit('archmage', 1, cx + 170, cy - 60, {snap:true});
  w.gainXp(enemyHero, 1500);
  g.selection = [hero];
  g.syncSelection();
  g.renderer.centerOn(cx, cy);
  g.renderer.cam.zoom = g.renderer.cam.targetZoom = 1.15;
  // cast a spell for the visual
  w.orderCast(hero, 'storm_bolt', 2, null, null, w.units.filter(u=>u.owner===1)[0].id);
  w.addEffect({ type:'ring', x: cx, y: cy, radius: 160, life: 1.2, maxLife: 1.2 });
  w.fxBurst(cx - 40, cy + 20, 24, 0.5);
});
await new Promise(r=>setTimeout(r,1400));
await page.screenshot({ path: '/home/user/NewProjection/shots/30-battle.png' });
await page.evaluate(() => { const g=window.__game; for (let i=0;i<30*6;i++) g.stepSim(1/30); });
await new Promise(r=>setTimeout(r,600));
await page.screenshot({ path: '/home/user/NewProjection/shots/31-battle-later.png' });
// different resolution
await page.setViewport({ width: 1280, height: 720 });
await new Promise(r=>setTimeout(r,700));
await page.screenshot({ path: '/home/user/NewProjection/shots/32-1280.png' });
await browser.close();
console.log('done');
