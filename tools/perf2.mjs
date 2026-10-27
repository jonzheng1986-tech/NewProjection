// Per-layer timing probe (software rasteriser). Each configuration runs on a
// fresh page so the WebGL queue state can't leak between measurements.
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

const configs = [
  ['everything', ''],
  ['no minimap', 'g.ui.drawMinimap = () => {};'],
  ['no ui', 'g.ui.draw = () => {};'],
  ['ui only', 'g.renderer.drawWorld = () => {};'],
  ['world only', 'g.ui.draw = () => {}; g.renderer.beginFrame = () => {};'],
];

for (const [label, patch] of configs) {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(() => window.__game.newGame(1234));
  await new Promise((r) => setTimeout(r, 600));
  const ms = await page.evaluate((src) => {
    const g = window.__game;
    if (src) new Function('g', src)(g);
    const gl = g.renderer.gl.gl;
    const t0 = performance.now();
    for (let i = 0; i < 15; i++) {
      g.renderWorld();
      g.ui.draw();
      g.renderer.finish();
      gl.finish();
    }
    return (performance.now() - t0) / 15;
  }, patch);
  console.log(`${label.padEnd(14)} ${ms.toFixed(1)}ms`);
  await page.close();
}
await browser.close();
