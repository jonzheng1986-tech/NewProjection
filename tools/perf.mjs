// Rough performance probe: measures average frame duration in headless Chromium.
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const PORT = process.env.PORT || 5199;
const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  headless: true,
  env: { ...process.env, LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH || '/tmp/al2023/lib' },
  args: [...chromium.args, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 500));
await page.evaluate(() => window.__game.newGame(1234));
await new Promise((r) => setTimeout(r, 1500));
const stats = await page.evaluate(async () => {
  const g = window.__game;
  const samples = [];
  await new Promise((resolve) => {
    let last = performance.now();
    let n = 0;
    const tick = () => {
      const now = performance.now();
      samples.push(now - last);
      last = now;
      if (++n < 120) requestAnimationFrame(tick); else resolve();
    };
    requestAnimationFrame(tick);
  });
  samples.sort((a, b) => a - b);
  return {
    avg: samples.reduce((a, b) => a + b, 0) / samples.length,
    p50: samples[Math.floor(samples.length * 0.5)],
    p95: samples[Math.floor(samples.length * 0.95)],
    units: g.world.units.length,
  };
});
console.log(`frames: avg ${stats.avg.toFixed(1)}ms  p50 ${stats.p50.toFixed(1)}ms  p95 ${stats.p95.toFixed(1)}ms  (units ${stats.units}, software rasteriser)`);
await browser.close();
