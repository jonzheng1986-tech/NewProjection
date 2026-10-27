// Game shell: boot, loop, input, selection, orders, camera, audio wiring.

import { generateMap } from './sim/mapgen.js';
import { World } from './sim/world.js';
import { AIController } from './ai/ai.js';
import { GameRenderer } from './render/renderer.js';
import { GameUI } from './ui/ui.js';
import { AudioEngine } from './audio/audio.js';
import { TILE, clamp, dist, pointInPoly } from './core/util.js';
import { PAL } from './render/palette.js';
import { BUILDINGS } from './data/human.js';
import { ABILITIES } from './data/abilities.js';
import { ITEMS } from './data/items.js';

const SIM_STEP = 1 / 30;

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new GameRenderer(canvas);
    this.audio = new AudioEngine();
    this.ui = new GameUI(this);
    this.mouse = { x: -100, y: -100, down: false, worldX: 0, worldY: 0 };
    this.keys = new Set();
    this.time = 0;
    this.mode = 'menu';
    this.world = null;
    this.ai = null;
    this.localPlayer = 0;
    this.localTeam = 0;
    this.selection = [];
    this.selectedSet = new Set();
    this.controlGroups = {};
    this.drag = null;
    this.minimapDrag = false;
    this.cameraDrag = null;
    this.targeting = null;
    this.placingDef = null;
    this.buildMenu = false;
    this.pendingItem = null;
    this.alert = null;
    this.hoverEntity = null;
    this.lastClick = { id: null, time: 0 };
    this.edgeScroll = true;
    this.simAccum = 0;
    this.lastFrame = 0;
    this.fps = 60;
    this.fpsAccum = 0;
    this.fpsFrames = 0;
    this.debug = false;
    this.gameOverShown = false;
    this.raf = null;
  }

  // ------------------------------------------------------------------ boot
  boot() {
    this.attachInput();
    this.ui.menu = 'main';
    this.mode = 'menu';
    const loop = (now) => {
      this.frame(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  newGame(seed) {
    const s = seed === undefined ? Math.floor(Math.random() * 1e9) : seed;
    this.world = new World({
      seed: s,
      map: generateMap(s),
      playerDefs: [
        { name: 'Player', team: 0, isHuman: true },
        { name: 'Computer', team: 1, isHuman: false },
      ],
    });
    this.world.startGame();
    this.renderer.setMap(this.world.map);
    const hall = this.world.findTownHall(0);
    this.renderer.centerOn(hall ? hall.x : this.world.worldWidth / 2, hall ? hall.y : this.world.worldHeight / 2);
    this.ai = new AIController(this.world, 1, { hero: ['archmage', 'mountain_king', 'paladin'][Math.floor(Math.random() * 3)] });
    this.selection = [];
    this.selectedSet.clear();
    this.controlGroups = {};
    this.targeting = null;
    this.placingDef = null;
    this.buildMenu = false;
    this.alert = null;
    this.gameOverShown = false;
    this.mode = 'playing';
    this.ui.menu = 'none';
    this.ui.showHelp = false;
    this.world.alertOwner(0, 'Build a Barracks and an Altar to begin.');
    this.audio.init();
    this.mode = 'playing';
  }

  quitToMenu() {
    this.mode = 'menu';
    this.ui.menu = 'main';
    this.world = null;
    this.ai = null;
    this.selection = [];
    this.selectedSet.clear();
  }

  primaryHero() {
    if (!this.world) return null;
    const p = this.world.players[this.localPlayer];
    if (!p) return null;
    const alive = p.heroes.filter((h) => !h.dead);
    if (alive.length) return alive[0];
    return p.heroes[0] || null;
  }

  // ------------------------------------------------------------------ loop
  frame(now) {
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000 || 0.016);
    this.lastFrame = now;
    this.time += dt;
    this.fpsAccum += dt;
    this.fpsFrames++;
    if (this.fpsAccum > 0.5) {
      this.fps = this.fpsFrames / this.fpsAccum;
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }
    this.renderer.resize();

    if (this.mode === 'playing' || this.mode === 'paused') {
      if (this.mode === 'playing') {
        this.simAccum += dt;
        let steps = 0;
        while (this.simAccum >= SIM_STEP && steps < 5) {
          this.stepSim(SIM_STEP);
          this.simAccum -= SIM_STEP;
          steps++;
        }
        this.updateCamera(dt);
      }
      this.updateSelectionValid();
      this.renderWorld();
      this.ui.draw();
      this.drawCursorMode();
      this.renderer.finish();
    } else {
      this.renderer.beginEmpty();
      this.ui.draw();
      this.renderer.finish();
    }

    // alert fade
    if (this.alert) {
      this.alert.time -= dt;
      if (this.alert.time <= 0) this.alert = null;
    }
  }

  stepSim(dt) {
    const world = this.world;
    if (!world || world.gameOver) return;
    world.update(dt);
    if (this.ai) this.ai.update(dt);
    this.processEvents();
    if (world.gameOver && !this.gameOverShown) {
      this.gameOverShown = true;
      const win = world.winner === this.localTeam;
      this.audio.play(win ? 'victory' : 'defeat');
      setTimeout(() => {
        if (this.world && this.world.gameOver) {
          this.ui.openMenu('gameover');
          this.mode = 'paused';
        }
      }, 1400);
    }
  }

  processEvents() {
    const world = this.world;
    if (!world) return;
    const events = world.drainEvents();
    const cam = this.renderer.cam;
    for (const ev of events) {
      switch (ev.type) {
        case 'attack': {
          const art = ev.art;
          if (art === 'melee' || !art) this.audio.play('sword', 0.9);
          else if (art === 'cannon') this.audio.play('cannon', 0.9);
          else if (art === 'bolt') this.audio.play('magic', 0.6);
          else this.audio.play('bow', 0.8);
          break;
        }
        case 'death':
          this.audio.play('death', 0.8);
          break;
        case 'damage':
          if (ev.owner === this.localPlayer && !this.ping) {
            this.ping = { x: ev.x, y: ev.y, t: this.time };
          }
          break;
        case 'buildingDeath':
          this.audio.play('cannon', 1);
          break;
        case 'cast':
          this.audio.play('magic', 0.7);
          break;
        case 'impact':
          if (ev.art === 'frost') this.audio.play('frost', 0.8);
          else if (ev.art === 'boom') this.audio.play('cannon', 0.5);
          break;
        case 'buildComplete':
          if (ev.owner === this.localPlayer) this.audio.play('ready', 1);
          break;
        case 'unitReady':
          if (ev.owner === this.localPlayer) this.audio.play('ready', 0.7);
          break;
        case 'levelUp':
          if (ev.owner === this.localPlayer) this.audio.play('levelup', 1);
          break;
        case 'message':
          if (ev.owner === this.localPlayer) {
            this.alert = { text: ev.text, time: 3.2 };
          }
          break;
        case 'upgradeDone':
          if (ev.owner === this.localPlayer) this.audio.play('ready', 0.9);
          break;
        case 'itemPickup':
          this.audio.play('gold', 1);
          break;
        case 'mineCollapse':
          this.audio.play('build', 1);
          break;
        default: break;
      }
    }
  }

  // ----------------------------------------------------------------- input
  attachInput() {
    const c = this.canvas;
    window.addEventListener('resize', () => {
      this.renderer.resize();
      this.ui.layout();
    });

    c.addEventListener('mousemove', (e) => {
      const r = c.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      this.mouse.x = x; this.mouse.y = y;
      const w = this.renderer.screenToWorld(x, y);
      this.mouse.worldX = w.x; this.mouse.worldY = w.y;
      if (this.mode !== 'playing') return;
      if (this.cameraDrag) {
        this.renderer.cam.x -= (x - this.cameraDrag.x) / this.renderer.cam.zoom;
        this.renderer.cam.y -= (y - this.cameraDrag.y) / this.renderer.cam.zoom;
        this.cameraDrag.x = x; this.cameraDrag.y = y;
        this.renderer.clampCamera();
      }
      if (this.drag) {
        this.drag.x1 = x; this.drag.y1 = y;
        this.drag.moved = Math.hypot(x - this.drag.x0, y - this.drag.y0) > 5;
      }
      if (this.minimapDrag) this.moveCameraFromMinimap(x, y);
    });

    c.addEventListener('mouseleave', () => {
      this.mouse.x = -100; this.mouse.y = -100;
    });

    c.addEventListener('mousedown', (e) => {
      const r = c.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      this.mouse.x = x; this.mouse.y = y;
      this.audio.init();
      this.audio.resume();
      if (e.button === 1) {
        // middle drag camera
        this.cameraDrag = { x, y };
        e.preventDefault();
        return;
      }
      if (this.mode === 'menu' || this.mode === 'paused') {
        this.handleMenuClick(x, y, e.button);
        return;
      }
      if (this.mode !== 'playing') return;
      const region = this.ui.pick(this.renderer.gl, x, y);
      if (region) {
        if (e.button === 0) this.handleUiClick(region, false);
        else if (e.button === 2) this.handleUiClick(region, true);
        return;
      }
      if (e.button === 0) {
        this.onLeftDown(x, y, e);
      } else if (e.button === 2) {
        this.onRightDown(x, y, e);
      }
    });

    window.addEventListener('mouseup', (e) => {
      const r = c.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      if (e.button === 1) { this.cameraDrag = null; return; }
      if (this.minimapDrag) { this.minimapDrag = false; return; }
      if (this.mode !== 'playing') return;
      if (e.button === 0 && this.drag) {
        const d = this.drag;
        this.drag = null;
        if (d.moved) this.boxSelect(d.x0, d.y0, x, y, e.shiftKey);
        else this.clickSelect(x, y, e.shiftKey);
      }
    });

    c.addEventListener('contextmenu', (e) => e.preventDefault());

    c.addEventListener('wheel', (e) => {
      if (this.mode !== 'playing') return;
      e.preventDefault();
      this.renderer.zoomBy(e.deltaY, this.mouse.x, this.mouse.y);
    }, { passive: false });

    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    });
    window.addEventListener('blur', () => this.keys.clear());
  }

  onKeyDown(e) {
    this.audio.init();
    this.audio.resume();
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    this.keys.add(key);
    if (e.key === 'F1') {
      e.preventDefault();
      this.ui.showHelp = true;
      this.ui.openMenu(this.mode === 'playing' ? 'help' : 'help');
      if (this.mode === 'playing') this.mode = 'paused';
      return;
    }
    if (key === 'Escape') {
      e.preventDefault();
      if (this.ui.menu === 'help') {
        this.ui.openMenu(this.lastMenuType || 'pause');
        return;
      }
      if (this.ui.menu !== 'none') {
        this.ui.closeMenu();
        if (this.mode === 'paused') this.mode = 'playing';
        return;
      }
      if (this.placingDef) { this.cancelPlacement(); return; }
      if (this.targeting) { this.targeting = null; return; }
      if (this.buildMenu) { this.buildMenu = false; return; }
      this.ui.openMenu('pause');
      this.mode = 'paused';
      return;
    }
    if (this.mode !== 'playing') {
      if (key === 'Enter' && this.ui.menu === 'main') this.newGame();
      return;
    }
    if (key === 'Shift') return;
    if (e.ctrlKey && key === 'm') {
      const muted = this.audio.toggleMute();
      this.alert = { text: muted ? 'Sound muted' : 'Sound on', time: 1.5 };
      return;
    }
    // control groups
    if (key >= '1' && key <= '5') {
      const idx = Number(key);
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        this.controlGroups[idx] = { units: this.selection.filter((u) => u.owner === this.localPlayer) };
        this.alert = { text: `Group ${idx} assigned`, time: 1.2 };
      } else {
        this.selectGroup(idx);
      }
      return;
    }
    // command card hotkeys
    const cmds = this.ui.commandsCache || [];
    for (const cmd of cmds) {
      if (cmd && cmd.hotkey && cmd.hotkey.toLowerCase() === key) {
        e.preventDefault();
        this.runCommand(cmd);
        return;
      }
    }
    switch (key) {
      case 'a': this.startTargeting('attackmove'); break;
      case 'm': this.startTargeting('move'); break;
      case 's': this.orderStop(); break;
      case 'h': this.orderHold(); break;
      case 'b': if (this.canBuild()) this.buildMenu = true; break;
      case ' ':
        e.preventDefault();
        if (this.ping && this.time - this.ping.t < 8) this.renderer.centerOn(this.ping.x, this.ping.y);
        else this.centerOnBase();
        break;
      case 'Tab': {
        e.preventDefault();
        if (this.selection.length > 1) {
          const first = this.selection.shift();
          this.selection.push(first);
        }
        break;
      }
      case 'F2': this.selectIdleWorker(); break;
      default: break;
    }
  }

  handleMenuClick(x, y, button) {
    const region = this.ui.pick(this.renderer.gl, x, y);
    if (!region) return;
    if (region.kind !== 'menu') return;
    const id = region.id;
    if (id === 'start') { this.newGame(); return; }
    if (id === 'help') {
      this.lastMenuType = this.ui.menu;
      this.ui.openMenu('help');
      return;
    }
    if (id === 'helpClose') {
      this.ui.openMenu(this.lastMenuType || (this.world ? 'pause' : 'main'));
      return;
    }
    if (id === 'credits') {
      this.alert = { text: 'Made with WebGL2 and no assets.', time: 2.5 };
      return;
    }
    if (id === 'resume') {
      this.ui.closeMenu();
      this.mode = 'playing';
      return;
    }
    if (id === 'restart') { this.newGame(); return; }
    if (id === 'quit') { this.quitToMenu(); return; }
  }

  handleUiClick(region, right) {
    const world = this.world;
    switch (region.kind) {
      case 'command':
        if (right && region.cmd && region.cmd.autocast) {
          const st = region.cmd.abilityState;
          if (st) {
            st.enabled = !st.enabled;
            this.audio.play('click');
            this.alert = { text: `${ABILITIES[st.id] ? ABILITIES[st.id].name : 'Ability'} autocast ${st.enabled ? 'enabled' : 'disabled'}`, time: 1.5 };
          }
          return;
        }
        if (region.cmd) this.runCommand(region.cmd);
        break;
      case 'inventory': {
        const hero = world.getEntity(region.heroId);
        if (!hero) return;
        const item = hero.items[region.index];
        if (!item) return;
        if (right) {
          if (!world.dropItemFromHero(hero, region.index)) this.audio.play('error');
          else this.audio.play('click');
          return;
        }
        const def = ITEMS[item.defId];
        if (def.target === 'ally') {
          this.targeting = { type: 'useitem', hero, slot: region.index, targetKind: 'ally' };
          this.alert = { text: 'Select a target unit', time: 1.5 };
          return;
        }
        const res = world.useItem(hero, region.index);
        if (res.ok) { this.audio.play('gold'); }
        else if (res.reason) { this.audio.play('error'); this.alert = { text: res.reason, time: 2 }; }
        break;
      }
      case 'heroAbility': {
        const hero = this.primaryHero();
        if (!hero) return;
        const st = hero.abilities.find((a) => a.id === region.abilityId);
        const def = ABILITIES[region.abilityId];
        if (!def) return;
        if (region.learn || st.level === 0) {
          const res = world.learnAbility(hero, region.abilityId);
          if (res.ok) this.audio.play('levelup');
          else { this.audio.play('error'); this.alert = { text: res.reason || 'Cannot learn yet.', time: 2 }; }
          return;
        }
        if (st.autocast) {
          st.enabled = !st.enabled;
          this.audio.play('click');
          return;
        }
        if (def.kind === 'none') {
          if (!world.orderCast(hero, st.id, st.level)) this.audio.play('error');
          else this.audio.play('ack');
          return;
        }
        if (def.kind === 'unit' || def.kind === 'autocast') {
          this.targeting = { type: 'cast', hero, abilityId: st.id, level: st.level, targetKind: def.target === 'ally' ? 'ally' : 'enemy' };
          return;
        }
        if (def.kind === 'point') {
          this.targeting = { type: 'cast', hero, abilityId: st.id, level: st.level, targetKind: 'point' };
          return;
        }
        // passive
        this.audio.play('error');
        this.alert = { text: 'This ability is passive.', time: 1.5 };
        break;
      }
      case 'unitIcon': {
        const e = world.getEntity(region.id);
        if (e && !e.dead) {
          this.selection = [e];
          this.syncSelection();
          this.audio.play('select');
        }
        break;
      }
      case 'minimap': {
        this.minimapDrag = true;
        this.moveCameraFromMinimap(this.mouse.x, this.mouse.y);
        break;
      }
      case 'mini':
        if (region.id === 'menu') {
          this.ui.openMenu('pause');
          this.mode = 'paused';
        } else if (region.id === 'help') {
          this.lastMenuType = 'pause';
          this.ui.openMenu('help');
          this.mode = 'paused';
        } else if (region.id === 'idle') {
          this.selectIdleWorker();
        }
        break;
      case 'group':
        this.selectGroup(region.index);
        break;
      case 'queue': {
        const b = this.selection[0];
        if (!b) return;
        if (region.queueKind === 'train') {
          if (world.cancelTrain(b, region.index)) { this.audio.play('click'); this.alert = { text: `${region.title} cancelled`, time: 1.4 }; }
          else this.audio.play('error');
        } else if (region.queueKind === 'research') {
          if (world.cancelResearch(b, region.index)) { this.audio.play('click'); this.alert = { text: `${region.title} cancelled`, time: 1.4 }; }
          else this.audio.play('error');
        }
        break;
      }
      case 'autocast': {
        const u = world.getEntity(region.unitId);
        if (!u) return;
        const st = (u.abilities || []).find((a) => a.id === region.abilityId);
        if (!st) return;
        st.enabled = st.enabled === false;
        this.audio.play('click');
        const def = ABILITIES[st.id];
        this.alert = { text: `${def ? def.name : 'Ability'} autocast ${st.enabled ? 'on' : 'off'}`, time: 1.4 };
        break;
      }
      case 'heroPortrait': {
        const hero = world.getEntity(region.heroId);
        if (hero) {
          this.selection = [hero];
          this.syncSelection();
          if (hero.dead) {
            const revive = (world.players[this.localPlayer].heroRevive || []).find((r) => r.heroId === hero.id);
            this.alert = { text: revive ? `${hero.name} revives in ${Math.ceil(revive.timeLeft)}s` : `${hero.name} is dead`, time: 2 };
          } else {
            this.renderer.centerOn(hero.x, hero.y);
          }
          this.audio.play('select');
        }
        break;
      }
      case 'portrait':
        break;
      default: break;
    }
  }

  moveCameraFromMinimap(mx, my) {
    const mm = this.ui.minimap;
    const world = this.world;
    if (!world) return;
    const fx = clamp((mx - mm.x) / mm.w, 0, 1);
    const fy = clamp((my - mm.y) / mm.h, 0, 1);
    this.renderer.centerOn(fx * world.worldWidth, fy * world.worldHeight);
  }

  // ------------------------------------------------------------- selection
  syncSelection() {
    this.selection = this.selection.filter((e) => e && !e.dead);
    this.selectedSet = new Set(this.selection.map((e) => e.id));
  }

  updateSelectionValid() {
    if (!this.world) return;
    const before = this.selection.length;
    this.syncSelection();
    if (this.selection.length !== before) this.buildMenu = false;
    if (this.selection.length && this.selection[0].owner !== this.localPlayer) this.buildMenu = false;
  }

  selectGroup(idx) {
    const g = this.controlGroups[idx];
    if (!g || !g.units.length) return;
    const alive = g.units.filter((u) => !u.dead);
    if (!alive.length) return;
    this.selection = alive;
    this.syncSelection();
    const c = alive[0];
    if (this.lastGroup === idx && this.time - (this.lastGroupTime || 0) < 0.6) {
      this.renderer.centerOn(c.x, c.y);
    }
    this.lastGroup = idx;
    this.lastGroupTime = this.time;
    this.audio.play('select');
  }

  centerOnBase() {
    const hall = this.world && this.world.findTownHall(this.localPlayer);
    if (hall) this.renderer.centerOn(hall.x, hall.y);
    else if (this.selection.length) this.renderer.centerOn(this.selection[0].x, this.selection[0].y);
  }

  selectIdleWorker() {
    const w = this.world.units.find((u) => !u.dead && u.owner === this.localPlayer && u.def.canGather && u.order.type === 'idle');
    if (w) {
      this.selection = [w];
      this.syncSelection();
      this.renderer.centerOn(w.x, w.y);
      this.audio.play('select');
    } else {
      this.audio.play('error');
      this.alert = { text: 'No idle workers.', time: 1.5 };
    }
  }

  pickEntity(sx, sy) {
    const world = this.world;
    if (!world) return null;
    const team = this.localTeam;
    const zoom = this.renderer.cam.zoom;
    let best = null;
    let bestScore = Infinity;
    const consider = (e, score) => {
      if (score < bestScore) { bestScore = score; best = e; }
    };
    for (const u of world.units) {
      if (u.dead) continue;
      if (!this.isVisibleToPlayer(u)) continue;
      const [ux, uy] = this.renderer.project(u.x, u.y);
      const art = u.def.art || {};
      const H = 38 * zoom * (art.bulk || 1) * (u.hero ? 1.12 : 1);
      const halfW = Math.max(10, H * 0.22);
      if (sx >= ux - halfW && sx <= ux + halfW && sy >= uy - H && sy <= uy + 6 * zoom) {
        const score = Math.abs(sx - ux) + Math.abs(sy - (uy - H * 0.5)) * 0.5;
        consider(u, score);
      }
    }
    for (const b of world.buildings) {
      if (b.dead) continue;
      if (!this.isVisibleToPlayer(b)) continue;
      const fp = b.footprint || [2, 2];
      const corners = [];
      for (const [ox, oy] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
        corners.push(this.renderer.project((b.tx + ox * fp[0]) * TILE, (b.ty + oy * fp[1]) * TILE));
      }
      const poly = [];
      for (const c of corners) poly.push([c[0], c[1]]);
      const inside = pointInPoly(sx, sy, poly);
      // check the extruded body as well
      const top = corners.map((c) => [c[0], c[1] - 46 * zoom]);
      const insideBody = pointInPoly(sx, sy, [corners[0], corners[1], top[1], top[0]]) ||
        pointInPoly(sx, sy, [corners[1], corners[2], top[2], top[1]]) ||
        pointInPoly(sx, sy, [corners[2], corners[3], top[3], top[2]]);
      if (inside || insideBody) {
        consider(b, dist(sx, sy, corners[2][0], corners[2][1]) * 0.2 + 30);
      }
    }
    for (const it of world.items) {
      if (it.dead) continue;
      if (!world.fog.isExplored(team, it.x, it.y)) continue;
      const [ix, iy] = this.renderer.project(it.x, it.y);
      const d = Math.hypot(sx - ix, sy - (iy - 14 * zoom));
      if (d < 18 * zoom) consider(it, d + 5);
    }
    for (const t of world.trees) {
      if (t.dead) continue;
      if (!world.fog.isExplored(team, t.x, t.y)) continue;
      const [tx, ty] = this.renderer.project(t.x, t.y);
      const d = Math.hypot(sx - tx, sy - (ty - 18 * zoom));
      if (d < 14 * zoom) consider(t, d + 25);
    }
    return best;
  }

  isVisibleToPlayer(e) {
    if (e.owner === this.localPlayer) return true;
    if (e.kind === 'tree') return this.world.fog.isExplored(this.localTeam, e.x, e.y);
    if (e.kind === 'mine') return this.world.fog.isExplored(this.localTeam, e.x, e.y);
    return this.world.fog.isVisible(this.localTeam, e.x, e.y);
  }

  clickSelect(x, y, additive) {
    const ent = this.pickEntity(x, y);
    if (!ent) {
      if (!additive) { this.selection = []; this.syncSelection(); }
      return;
    }
    // double click selects all of the same type on screen
    if (this.lastClick.id === ent.defId && this.time - this.lastClick.time < 0.35 && ent.kind === 'unit') {
      this.selectAllOnScreen(ent.defId);
      this.lastClick = { id: null, time: 0 };
      return;
    }
    this.lastClick = { id: ent.defId, time: this.time };
    if (additive) {
      if (this.selectedSet.has(ent.id)) {
        this.selection = this.selection.filter((s) => s.id !== ent.id);
      } else {
        this.selection.push(ent);
      }
    } else {
      this.selection = [ent];
    }
    this.syncSelection();
    this.buildMenu = false;
    this.audio.play('select');
    if (ent.kind === 'building' && ent.owner === this.localPlayer) {
      // rally mode hint
    }
  }

  selectAllOnScreen(defId) {
    const out = [];
    for (const u of this.world.units) {
      if (u.dead || u.owner !== this.localPlayer || u.defId !== defId) continue;
      const [sx, sy] = this.renderer.project(u.x, u.y);
      if (sx >= 0 && sx <= this.renderer.width && sy >= 0 && sy <= this.renderer.height) out.push(u);
    }
    if (out.length) {
      this.selection = out;
      this.syncSelection();
      this.audio.play('select');
    }
  }

  boxSelect(x0, y0, x1, y1, additive) {
    const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
    const found = [];
    for (const u of this.world.units) {
      if (u.dead || u.owner !== this.localPlayer) continue;
      const [sx, sy] = this.renderer.project(u.x, u.y);
      if (sx >= minX && sx <= maxX && sy >= minY - 20 && sy <= maxY + 20) found.push(u);
    }
    // prefer combat units over workers when both are caught in the box
    const combat = found.filter((u) => !u.def.canGather);
    const chosen = combat.length ? combat : found;
    if (!chosen.length) {
      if (!additive) { this.selection = []; this.syncSelection(); }
      return;
    }
    if (additive) {
      for (const u of chosen) if (!this.selectedSet.has(u.id)) this.selection.push(u);
    } else {
      this.selection = chosen;
    }
    this.syncSelection();
    this.audio.play('select');
  }

  // ---------------------------------------------------------------- orders
  onLeftDown(x, y, e) {
    const world = this.world;
    // placement mode
    if (this.placingDef) {
      this.tryPlaceBuilding(x, y);
      return;
    }
    // ability / move targeting
    if (this.targeting) {
      this.executeTargeting(x, y, e);
      return;
    }
    this.drag = { x0: x, y0: y, x1: x, y1: y, moved: false };
  }

  onRightDown(x, y, e) {
    if (this.placingDef) { this.cancelPlacement(); return; }
    if (this.targeting) { this.targeting = null; return; }
    const world = this.world;
    const ent = this.pickEntity(x, y);
    const w = this.renderer.screenToWorld(x, y);
    this.smartOrder(w.x, w.y, ent, e.shiftKey);
  }

  smartOrder(wx, wy, ent, shift) {
    const world = this.world;
    const own = this.selection.filter((u) => u.owner === this.localPlayer && !u.dead);
    if (!own.length) return;

    // buildings: set rally point
    const buildings = own.filter((u) => u.kind === 'building');
    if (buildings.length && !own.some((u) => u.kind === 'unit')) {
      for (const b of buildings) {
        b.rally = { x: wx, y: wy };
        if (ent && (ent.kind === 'tree' || ent.isMine || ent.kind === 'unit')) b.rally.targetId = ent.id;
        else b.rally.targetId = null;
        this.audio.play('ack');
      }
      return;
    }

    const units = own.filter((u) => u.kind === 'unit');
    if (!units.length) return;

    if (ent && ent.kind === 'item') {
      let any = false;
      for (const u of units) {
        if (u.hero) { world.orderPickup(u, ent.id); any = true; }
      }
      if (!any) this.audio.play('error');
      else this.audio.play('ack');
      return;
    }

    if (ent && ent.kind === 'tree') {
      const workers = units.filter((u) => u.def.canGather);
      if (workers.length) {
        for (const u of workers) world.orderGather(u, ent.id);
        this.audio.play('ack');
        return;
      }
      this.moveGroup(units, ent.x, ent.y);
      return;
    }

    if (ent && ent.isMine) {
      const workers = units.filter((u) => u.def.canGather);
      if (workers.length) {
        for (const u of workers) world.orderGather(u, ent.id);
        this.audio.play('ack');
        return;
      }
      this.moveGroup(units, ent.x, ent.y);
      return;
    }

    if (ent && ent.owner !== undefined && ent.owner >= 0 && world.isEnemyEntity({ owner: this.localPlayer }, ent)) {
      for (const u of units) world.orderAttack(u, ent.id);
      this.audio.play('order');
      return;
    }

    if (ent && ent.owner === this.localPlayer) {
      // repair a damaged building with workers, otherwise move
      if (ent.kind === 'building' && ent.hp < ent.maxHp) {
        const workers = units.filter((u) => u.def.canRepair);
        if (workers.length) {
          for (const u of workers) world.orderRepair(u, ent.id);
          this.audio.play('ack');
          return;
        }
      }
      if ((ent.isMine || ent.kind === 'building') && units.some((u) => u.def.canGather)) {
        // return resources / gather
        const goldMine = ent.isMine;
        for (const u of units) {
          if (u.def.canGather) {
            if (goldMine) world.orderGather(u, ent.id);
            else if (u.carry) world.startReturn(u);
          }
        }
        this.audio.play('ack');
        return;
      }
    }

    // neutral creeps are enemies -> handled above by isEnemyEntity
    this.moveGroup(units, wx, wy, shift);
  }

  moveGroup(units, wx, wy, queued) {
    const world = this.world;
    const offsets = formationOffsets(units.length, 34);
    units.forEach((u, i) => {
      const o = offsets[i] || [0, 0];
      const tx = clamp(wx + o[0], 8, world.worldWidth - 8);
      const ty = clamp(wy + o[1], 8, world.worldHeight - 8);
      if (queued) {
        // shift-queued move: the latest waypoint wins (kept lightweight)
      }
      world.orderMove(u, tx, ty);
    });
    this.audio.play('order');
    this.showOrderMarker(wx, wy, 'move');
  }

  showOrderMarker(x, y, kind) {
    this.orderMarker = { x, y, kind, t: 0.6 };
  }

  startTargeting(type) {
    const own = this.selection.filter((u) => u.owner === this.localPlayer && u.kind === 'unit');
    if (!own.length) { this.audio.play('error'); return; }
    this.targeting = { type, targetKind: type === 'attackmove' ? 'enemyOrGround' : 'ground' };
    this.audio.play('click');
  }

  executeTargeting(x, y, e) {
    const t = this.targeting;
    const world = this.world;
    const ent = this.pickEntity(x, y);
    const w = this.renderer.screenToWorld(x, y);
    const own = this.selection.filter((u) => u.owner === this.localPlayer && !u.dead);
    const units = own.filter((u) => u.kind === 'unit');

    if (t.type === 'move') {
      if (units.length) this.moveGroup(units, w.x, w.y);
    } else if (t.type === 'attackmove') {
      for (const u of units) {
        if (ent && ent.kind === 'unit' && world.isEnemyEntity({ owner: this.localPlayer }, ent)) {
          world.orderAttack(u, ent.id);
        } else {
          world.orderAttackMove(u, w.x, w.y);
        }
      }
      this.audio.play('order');
      this.showOrderMarker(w.x, w.y, 'attack');
    } else if (t.type === 'gather') {
      if (ent && (ent.kind === 'tree' || ent.isMine)) {
        for (const u of units) if (u.def.canGather) world.orderGather(u, ent.id);
        this.audio.play('ack');
      } else {
        this.audio.play('error');
      }
    } else if (t.type === 'cast') {
      const hero = t.hero;
      const def = ABILITIES[t.abilityId];
      if (!hero || hero.dead) { this.audio.play('error'); this.targeting = null; return; }
      if (def.target === 'enemy') {
        if (!ent || !world.isEnemyEntity(hero, ent)) { this.audio.play('error'); return; }
        if (!world.orderCast(hero, t.abilityId, t.level, ent.x, ent.y, ent.id)) this.audio.play('error');
        else this.audio.play('ack');
      } else if (def.target === 'ally') {
        if (!ent || !world.isAlly(hero, ent)) { this.audio.play('error'); return; }
        if (!world.orderCast(hero, t.abilityId, t.level, ent.x, ent.y, ent.id)) this.audio.play('error');
        else this.audio.play('ack');
      } else {
        if (!world.orderCast(hero, t.abilityId, t.level, w.x, w.y)) this.audio.play('error');
        else this.audio.play('ack');
      }
    } else if (t.type === 'useitem') {
      const hero = t.hero;
      if (!hero || hero.dead) { this.targeting = null; return; }
      const res = world.useItem(hero, t.slot, ent ? ent.id : null);
      if (res.ok) this.audio.play('gold');
      else { this.audio.play('error'); if (res.reason) this.alert = { text: res.reason, time: 1.8 }; }
    }
    this.targeting = null;
  }

  orderStop() {
    for (const u of this.selection) {
      if (u.owner !== this.localPlayer) continue;
      if (u.kind === 'unit') {
        this.world.orderStop(u);
      } else {
        u.trainQueue = [];
      }
    }
    this.audio.play('click');
  }

  orderHold() {
    for (const u of this.selection) {
      if (u.owner !== this.localPlayer || u.kind !== 'unit') continue;
      this.world.orderHold(u);
    }
    this.audio.play('click');
  }

  canBuild() {
    return this.selection.some((u) => u.owner === this.localPlayer && u.def.canBuild);
  }

  cancelPlacement() {
    this.placingDef = null;
    this.audio.play('click');
  }

  tryPlaceBuilding(sx, sy) {
    const def = this.placingDef;
    const world = this.world;
    if (!def) return;
    const w = this.renderer.screenToWorld(sx, sy);
    const fp = def.footprint || [2, 2];
    const tx = Math.round(w.x / TILE - fp[0] / 2);
    const ty = Math.round(w.y / TILE - fp[1] / 2);
    if (!world.canPlaceBuilding(def, tx, ty)) {
      this.audio.play('error');
      this.alert = { text: 'Cannot build there.', time: 1.6 };
      return;
    }
    if (!world.canAfford(this.localPlayer, def.cost)) {
      this.audio.play('error');
      this.alert = { text: 'Not enough resources.', time: 1.8 };
      this.placingDef = null;
      return;
    }
    if (!world.pay(this.localPlayer, def.cost)) return;
    const b = world.createBuilding(def.id, this.localPlayer, (tx + fp[0] / 2) * TILE, (ty + fp[1] / 2) * TILE, { complete: false, tx, ty });
    const builders = this.selection.filter((u) => u.owner === this.localPlayer && u.def.canBuild);
    for (const u of builders) {
      world.orderStop(u);
      world.orderBuild(u, b.id);
    }
    this.audio.play('build');
    this.placingDef = null;
    this.buildMenu = false;
    this.showOrderMarker((tx + fp[0] / 2) * TILE, (ty + fp[1] / 2) * TILE, 'build');
  }

  runCommand(cmd) {
    const world = this.world;
    if (!cmd || cmd.enabled === false) {
      this.audio.play('error');
      if (cmd && (cmd.reason || cmd.tierBlocked)) {
        this.alert = { text: cmd.tierBlocked ? 'Requires a higher town tier.' : cmd.reason, time: 2.2 };
      }
      return;
    }
    const sel = this.selection.filter((e) => e.owner === this.localPlayer);
    const primary = sel[0];
    switch (cmd.action) {
      case 'move': this.startTargeting('move'); break;
      case 'attackmove': this.startTargeting('attackmove'); break;
      case 'stop': this.orderStop(); break;
      case 'hold': this.orderHold(); break;
      case 'buildMenu': this.buildMenu = true; this.audio.play('click'); break;
      case 'buildBack': this.buildMenu = false; this.audio.play('click'); break;
      case 'gatherMode': this.targeting = { type: 'gather', targetKind: 'resource' }; this.audio.play('click'); break;
      case 'build': {
        const def = BUILDINGS[cmd.payload.defId];
        if (!def) return;
        if (!world.canAfford(this.localPlayer, def.cost)) {
          this.audio.play('error');
          this.alert = { text: 'Not enough resources.', time: 1.8 };
          return;
        }
        this.placingDef = def;
        this.buildMenu = false;
        this.audio.play('click');
        break;
      }
      case 'learn': {
        const hero = world.getEntity(cmd.payload.heroId);
        if (!hero) return;
        const res = world.learnAbility(hero, cmd.payload.abilityId);
        if (res.ok) { this.audio.play('levelup'); this.alert = { text: `${cmd.title} learned.`, time: 1.6 }; }
        else { this.audio.play('error'); this.alert = { text: res.reason || 'Cannot learn yet.', time: 2 }; }
        break;
      }
      case 'cast': {
        const hero = world.getEntity(cmd.payload.heroId);
        const def = cmd.payload.def;
        if (!hero || !def) return;
        if (def.kind === 'none') {
          if (world.orderCast(hero, cmd.payload.abilityId, cmd.payload.level)) this.audio.play('ack');
          else this.audio.play('error');
        } else if (def.kind === 'unit' || def.kind === 'autocast') {
          this.targeting = { type: 'cast', hero, abilityId: cmd.payload.abilityId, level: cmd.payload.level, targetKind: def.target === 'ally' ? 'ally' : 'enemy' };
        } else if (def.kind === 'point') {
          this.targeting = { type: 'cast', hero, abilityId: cmd.payload.abilityId, level: cmd.payload.level, targetKind: 'point' };
        }
        break;
      }
      case 'autocast': {
        const u = world.getEntity(cmd.payload.unitId);
        if (!u) return;
        const st = u.abilities.find((a) => a.id === cmd.payload.abilityId);
        if (st) { st.enabled = !st.enabled; this.audio.play('click'); }
        break;
      }
      case 'train': {
        if (!primary) return;
        const res = world.queueTrain(primary, cmd.payload.defId);
        if (res.ok) { this.audio.play('ack'); }
        else { this.audio.play('error'); if (res.reason) this.alert = { text: res.reason, time: 2.2 }; }
        break;
      }
      case 'research': {
        if (!primary) return;
        const res = world.queueResearch(primary, cmd.payload.upgradeId);
        if (res.ok) this.audio.play('ack');
        else { this.audio.play('error'); if (res.reason) this.alert = { text: res.reason, time: 2.2 }; }
        break;
      }
      case 'upgradeBuilding': {
        if (!primary) return;
        const res = world.startBuildingUpgrade(primary, cmd.payload.defId);
        if (res.ok) this.audio.play('build');
        else { this.audio.play('error'); if (res.reason) this.alert = { text: res.reason, time: 2.2 }; }
        break;
      }
      case 'buy': {
        if (!primary) return;
        const hero = this.primaryHero();
        if (!hero) { this.audio.play('error'); this.alert = { text: 'A hero is required to buy items.', time: 2 }; return; }
        const res = world.buyItem(primary, cmd.payload.itemId, hero.id);
        if (res.ok) this.audio.play('gold');
        else { this.audio.play('error'); if (res.reason) this.alert = { text: res.reason, time: 2.2 }; }
        break;
      }
      case 'none':
        break;
      default: break;
    }
  }

  // ----------------------------------------------------------------- camera
  updateCamera(dt) {
    const cam = this.renderer.cam;
    const speed = 900 / cam.zoom;
    let dx = 0, dy = 0;
    if (this.keys.has('ArrowLeft')) dx -= 1;
    if (this.keys.has('ArrowRight')) dx += 1;
    if (this.keys.has('ArrowUp')) dy -= 1;
    if (this.keys.has('ArrowDown')) dy += 1;
    if (this.edgeScroll && !this.drag && !this.cameraDrag && this.ui.menu === 'none') {
      const m = 8;
      const w = this.renderer.width, h = this.renderer.height;
      if (this.mouse.x >= 0 && this.mouse.y >= 0 && this.mouse.x < w && this.mouse.y < h) {
        if (this.mouse.x < m) dx -= 1;
        if (this.mouse.x > w - m) dx += 1;
        if (this.mouse.y < m) dy -= 1;
        if (this.mouse.y > h - m) dy += 1;
      }
    }
    if (dx || dy) {
      cam.x += dx * speed * dt;
      cam.y += dy * speed * dt;
      this.renderer.clampCamera();
    }
    this.renderer.updateCamera(dt);
    if (this.orderMarker) {
      this.orderMarker.t -= dt;
      if (this.orderMarker.t <= 0) this.orderMarker = null;
    }
  }

  // ----------------------------------------------------------------- render
  renderWorld() {
    const world = this.world;
    const renderer = this.renderer;
    renderer.viewTeam = this.localTeam;
    this.hoverEntity = this.ui.menu === 'none' ? this.pickEntity(this.mouse.x, this.mouse.y) : null;
    const mouseWorld = renderer.screenToWorld(this.mouse.x, this.mouse.y);
    let buildGhost = null;
    if (this.placingDef) {
      const fp = this.placingDef.footprint || [2, 2];
      const tx = Math.round(mouseWorld.x / TILE - fp[0] / 2);
      const ty = Math.round(mouseWorld.y / TILE - fp[1] / 2);
      buildGhost = {
        def: this.placingDef, tx, ty,
        valid: world.canPlaceBuilding(this.placingDef, tx, ty) && world.canAfford(this.localPlayer, this.placingDef.cost),
      };
    }
    renderer.drawWorld(world, {
      team: this.localTeam,
      selectedSet: this.selectedSet,
      selectedUnits: this.selection.filter((e) => e.kind === 'unit' && e.owner === this.localPlayer),
      selectedBuildings: this.selection.filter((e) => e.kind === 'building' && e.owner === this.localPlayer),
      hoverEntity: this.hoverEntity,
      buildGhost,
      showMoveLines: false,
    });
    // drag box
    if (this.drag && this.drag.moved) {
      const gl = renderer.gl;
      const x = Math.min(this.drag.x0, this.drag.x1), y = Math.min(this.drag.y0, this.drag.y1);
      const w = Math.abs(this.drag.x1 - this.drag.x0), h = Math.abs(this.drag.y1 - this.drag.y0);
      gl.rect(x, y, w, h, [1, 1, 1, 0.05]);
      gl.strokeRect(x, y, w, h, 1, PAL.white50);
    }
    // order marker
    if (this.orderMarker) {
      const [mx, my] = renderer.project(this.orderMarker.x, this.orderMarker.y);
      const gl = renderer.gl;
      const p = this.orderMarker.t / 0.6;
      const r = 22 * (1.2 - p * 0.5);
      gl.polyline([
        mx - r, my, mx, my + r * 0.5, mx + r, my, mx, my - r * 0.5,
      ].flatMap((v) => [v]), 1.6, PAL.white50, true, false);
      gl.dashedCircle(mx, my, r, 1, PAL.white30, 4, 5);
    }
    // targeting cursor hint
    if (this.targeting) {
      const gl = renderer.gl;
      const label = this.targeting.type === 'attackmove' ? 'ATTACK MOVE'
        : this.targeting.type === 'move' ? 'MOVE'
          : this.targeting.type === 'gather' ? 'GATHER'
            : 'TARGET';
      gl.text(label, this.mouse.x + 20, this.mouse.y + 8, { size: 10, weight: 700, color: PAL.white70, tracking: 1.5 });
    }
  }

  drawCursorMode() {
    const gl = this.renderer.gl;
    if (this.debug) {
      gl.text(`FPS ${this.fps.toFixed(0)}`, 12, this.renderer.height - 220, { size: 10, color: PAL.white50 });
    }
  }
}

// spread N units around a target point
function formationOffsets(n, spacing) {
  if (n <= 1) return [[0, 0]];
  const out = [];
  const rings = [];
  let placed = 1;
  out.push([0, 0]);
  let ring = 1;
  while (placed < n) {
    const count = Math.min(n - placed, Math.max(4, Math.floor(ring * 6)));
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + ring * 0.7;
      out.push([Math.cos(a) * spacing * ring, Math.sin(a) * spacing * ring]);
      placed++;
    }
    ring++;
  }
  return out;
}
