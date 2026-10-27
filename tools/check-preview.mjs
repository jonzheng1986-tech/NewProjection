import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(), headless: true,
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/al2023/lib' },
  args: [...chromium.args,'--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1440, height: 810 },
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
await page.goto('http://127.0.0.1:5173/index.html', { waitUntil: 'networkidle0' });
await new Promise(r=>setTimeout(r,600));
const ok = await page.evaluate(() => !!window.__game && window.__game.mode === 'menu');
await page.evaluate(() => window.__game.newGame(31337));
await new Promise(r=>setTimeout(r,1200));
await page.screenshot({ path: '/home/user/NewProjection/shots/40-live-preview.png' });
console.log('boot ok:', ok, 'errors:', errs.slice(0,3));
await browser.close();
