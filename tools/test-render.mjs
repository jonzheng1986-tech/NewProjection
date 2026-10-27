// Headless render smoke test. Provides a fake WebGL2 context and canvas so the
// real GLRenderer, GameRenderer and GameUI code paths execute in Node. This
// catches typos and bad property access without needing a browser.

let constants = 100;
const calls = { drawArrays: 0, texImage2D: 0 };

const gl = new Proxy({
  getShaderParameter: () => true,
  getProgramParameter: () => true,
  getShaderInfoLog: () => '',
  getProgramInfoLog: () => '',
  getAttribLocation: () => 0,
  getUniformLocation: () => ({}),
  createShader: () => ({}),
  createProgram: () => ({}),
  createBuffer: () => ({}),
  createVertexArray: () => ({}),
  createTexture: () => ({}),
  drawArrays: () => { calls.drawArrays++; },
  texImage2D: () => { calls.texImage2D++; },
  getExtension: () => null,
}, {
  get(target, prop) {
    if (prop in target) return target[prop];
    if (typeof prop === 'string' && /^[A-Z][A-Z0-9_]*$/.test(prop)) {
      target[prop] = constants++;
      return target[prop];
    }
    target[prop] = () => null;
    return target[prop];
  },
});

const canvas2d = {
  font: '', textBaseline: '', fillStyle: '',
  measureText: (s) => ({ width: s.length * 6 + 2, fontBoundingBoxAscent: 12, fontBoundingBoxDescent: 3 }),
  fillText: () => {},
  clearRect: () => {},
};

const fakeDocument = {
  createElement: () => ({
    width: 1024, height: 1024,
    getContext: () => canvas2d,
  }),
  getElementById: () => null,
};

globalThis.document = fakeDocument;
globalThis.window = { devicePixelRatio: 1, addEventListener: () => {}, AudioContext: undefined };

function makeCanvas() {
  return {
    clientWidth: 1600,
    clientHeight: 900,
    width: 1600,
    height: 900,
    getContext: (type) => (type === 'webgl2' ? gl : canvas2d),
    addEventListener: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1600, height: 900 }),
  };
}

const { Game } = await import('../src/game.js');
const { drawIcon } = await import('../src/render/art.js');
const { ALL_DEFS } = await import('../src/data/human.js');
const { ABILITIES } = await import('../src/data/abilities.js');
const { ITEMS } = await import('../src/data/items.js');
const { TILE } = await import('../src/core/util.js');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    console.log(`  FAIL ${name}: ${err && err.stack ? err.stack.split('\n').slice(0, 4).join('\n         ') : err}`);
    failures++;
  }
}

const canvas = makeCanvas();
const game = new Game(canvas);

check('new game boots', () => game.newGame(99));
const world = game.world;
console.log(`world ready: ${world.units.length} units, ${world.buildings.length} buildings, ${world.trees.length} trees`);

// give the player a hero with items and abilities for UI coverage
const hall = world.findTownHall(0);
const hero = world.createUnit('archmage', 0, hall.x + 200, hall.y + 200, { snap: true });
world.gainXp(hero, 1200);
world.learnAbility(hero, 'blizzard');
world.learnAbility(hero, 'water_elemental');
world.giveItem(hero, 'potion_healing', 2);
world.giveItem(hero, 'ring_protection', 1);
world.giveItem(hero, 'scroll_town_portal', 1);
const knight = world.createUnit('knight', 0, hall.x + 260, hall.y + 200, { snap: true });
const priest = world.createUnit('priest', 0, hall.x + 300, hall.y + 240, { snap: true });
world.createBuilding('vault', 0, hall.x - 300, hall.y + 120, { complete: true });
world.createBuilding('guardtower', 0, hall.x - 380, hall.y - 40, { complete: true });
const shop = world.buildings.find((b) => b.defId === 'vault');
const site = world.createBuilding('barracks', 0, hall.x + 380, hall.y + 300, { complete: false });
const mine = world.buildings.find((b) => b.isMine);

// a few simulation steps so animations and orders exist
for (let i = 0; i < 120; i++) game.stepSim(1 / 30);

check('icons render', () => {
  const ids = Object.keys(ALL_DEFS).concat(Object.values(ABILITIES).map((a) => a.icon), Object.values(ITEMS).map((i) => i.icon));
  for (const id of ids) drawIcon(gl, id, 100, 100, 32, [1, 1, 1, 1], 1.5);
});

check('render: no selection', () => {
  game.selection = [];
  game.syncSelection();
  game.renderWorld();
  game.ui.draw();
  game.renderer.finish();
});

check('render: single unit', () => {
  game.selection = [knight];
  game.syncSelection();
  game.renderWorld();
  game.ui.draw();
  game.renderer.finish();
});

check('render: hero + items + abilities', () => {
  game.selection = [hero];
  game.syncSelection();
  game.renderWorld();
  game.ui.draw();
  game.renderer.finish();
});

check('render: mixed selection', () => {
  game.selection = [hero, knight, priest];
  game.syncSelection();
  game.renderWorld();
  game.ui.draw();
  game.renderer.finish();
});

check('render: building selection', () => {
  game.selection = [hall];
  game.syncSelection();
  game.renderWorld();
  game.ui.draw();
  game.renderer.finish();
});

check('render: construction site', () => {
  game.selection = [site];
  game.syncSelection();
  game.renderWorld();
  game.ui.draw();
  game.renderer.finish();
});

check('render: shop selection', () => {
  game.selection = [shop];
  game.syncSelection();
  game.renderWorld();
  game.ui.draw();
  game.renderer.finish();
});

check('render: mine and worker orders', () => {
  const worker = world.units.find((u) => u.owner === 0 && u.def.canGather);
  world.orderGather(worker, mine.id);
  game.selection = [worker];
  game.syncSelection();
  game.renderWorld();
  game.ui.draw();
  game.renderer.finish();
});

check('render: build menu open', () => {
  const worker = world.units.find((u) => u.owner === 0 && u.def.canGather);
  game.selection = [worker];
  game.syncSelection();
  game.buildMenu = true;
  game.ui.wrapText = null;
  game.renderWorld();
  game.ui.draw();
  game.renderer.finish();
  game.buildMenu = false;
});

check('render: placement ghost', () => {
  game.placingDef = ALL_DEFS.farm;
  game.mouse.x = 700; game.mouse.y = 400;
  game.renderWorld();
  game.ui.draw();
  game.renderer.finish();
  game.placingDef = null;
});

check('render: targeting overlay', () => {
  game.selection = [hero];
  game.syncSelection();
  game.targeting = { type: 'attackmove' };
  game.renderWorld();
  game.ui.draw();
  game.renderer.finish();
  game.targeting = null;
});

check('render: drag box', () => {
  game.drag = { x0: 200, y0: 200, x1: 600, y1: 500, moved: true };
  game.renderWorld();
  game.ui.draw();
  game.renderer.finish();
  game.drag = null;
});

check('render: every command tooltip', () => {
  game.selection = [hero];
  game.syncSelection();
  game.ui.draw();
  const cmds = game.ui.commandsCache || [];
  for (let i = 0; i < cmds.length; i++) {
    const r = game.ui.regions.find((rg) => rg.kind === 'command' && rg.index === i);
    if (!r) continue;
    game.mouse.x = r.x + 4; game.mouse.y = r.y + 4;
    game.ui.draw();
  }
});

check('menus render', () => {
  for (const mode of ['main', 'help', 'pause', 'gameover']) {
    game.ui.openMenu(mode);
    game.mode = 'menu';
    game.renderer.beginEmpty();
    game.ui.draw();
    game.renderer.finish();
  }
  game.ui.closeMenu();
  game.mode = 'playing';
});

check('render terrain + fog upload', () => {
  game.renderer.updateFogTexture(world);
  game.renderWorld();
  game.renderer.finish();
});

check('render after 5 more seconds of sim', () => {
  for (let i = 0; i < 150; i++) game.stepSim(1 / 30);
  game.selection = [];
  game.renderWorld();
  game.ui.draw();
  game.renderer.finish();
});

console.log(`draw calls: ${calls.drawArrays}, textures: ${calls.texImage2D}`);
check('rendered frames', () => {
  if (calls.drawArrays < 10) throw new Error('no draw calls recorded');
});

console.log(failures === 0 ? '\nAll render checks passed.' : `\n${failures} render check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
