// WC3-style console UI: resource bar, hero panel, minimap, selection info,
// inventory, command card, tooltips, message log and menus.
//
// All drawing goes through the GLRenderer primitive API, so the UI is rendered
// by the same WebGL2 pass as the game.

import { PAL } from '../render/palette.js';
import { drawIcon, drawFigure, groundEllipse } from '../render/art.js';
import { FONT_SANS, FONT_SERIF, FONT_MONO } from '../gl/font.js';
import { T, panel, cornerTicks, label, title, commandButton, bar, tooltip, fmtCost, costShort, divider } from './theme.js';
import { buildCommands, HOTKEYS, itemInfo, abilityInfo } from './commands.js';
import { ITEMS } from '../data/items.js';
import { ABILITIES } from '../data/abilities.js';
import { UPGRADES, BUILDINGS, UNITS, ALL_DEFS, MAX_FOOD, upkeepFor, HERO_XP_TABLE } from '../data/human.js';
import { clamp, fmtTime, fmtNum, dist, TAU } from '../core/util.js';
import { FOG_VISIBLE, FOG_EXPLORED } from '../sim/fog.js';
import { TERRAIN } from '../sim/mapgen.js';

const MM_COLORS = {
  [TERRAIN.GRASS]: [0.10, 0.11, 0.12, 1],
  [TERRAIN.DIRT]: [0.13, 0.125, 0.12, 1],
  [TERRAIN.ROCK]: [0.16, 0.165, 0.17, 1],
  [TERRAIN.WATER]: [0.06, 0.075, 0.09, 1],
  [TERRAIN.SNOW]: [0.2, 0.2, 0.2, 1],
};

export class GameUI {
  constructor(game) {
    this.game = game;
    this.regions = [];
    this.hover = null;
    this.menu = 'none';       // 'main' | 'help' | 'pause' | 'gameover'
    this.showHelp = false;
    this.layout();
  }

  layout() {
    const g = this.game.renderer.gl;
    const W = g.width, H = g.height;
    this.W = W; this.H = H;
    const ch = 172;
    const cy = H - ch;
    this.console = { x: 0, y: cy, w: W, h: ch };
    this.minimap = { x: 20, y: cy + 26, w: 186, h: 142 };
    this.portrait = { x: 222, y: cy + 24, w: 88, h: 88 };
    this.info = { x: 326, y: cy + 22, w: 330, h: 100 };
    const cell = 46, gap = 5, cols = 4, rows = 3;
    const cw = cols * cell + (cols - 1) * gap;
    const chh = rows * cell + (rows - 1) * gap;
    this.commands = { x: W - 22 - cw, y: cy + 26, w: cw, h: chh, cell, gap, cols, rows };
    this.inventory = { x: this.commands.x - 20 - (6 * 38 + 5 * 4), y: cy + 26, w: 6 * 38 + 5 * 4, h: 38, slot: 38, gap: 4 };
    this.statRow = { x: 326, y: cy + 96, w: this.inventory.x - 326 - 16, h: 36 };
    this.resources = { x: W - 20 - 468, y: 14, w: 468, h: 40 };
    this.heroPanel = { x: 20, y: 14, w: 312, h: 136 };
    this.miniButtons = { y: cy - 34, size: 26 };
    this.messages = { x: 22, y: cy - 170, w: 380, h: 130 };
  }

  // ------------------------------------------------------------------ draw
  draw() {
    this.layout();
    const { game } = this;
    const gl = game.renderer.gl;
    // hit-test against the regions built in the previous frame, then rebuild them
    this.hover = this.pick(gl, game.mouse.x, game.mouse.y);
    this.regions.length = 0;

    if (this.menu !== 'none') {
      this.drawMenu();
      return;
    }

    this.drawMessages();
    this.drawHeroPanel();
    this.drawResources();
    this.drawConsole();
    this.drawMiniButtons();
    this.drawAlerts();
    this.drawTooltip();
    if (game.placingDef) this.drawPlacementHint();
  }

  // ------------------------------------------------------------- resources
  drawResources() {
    const gl = this.game.renderer.gl;
    const { x, y, w, h } = this.resources;
    const p = this.game.world.players[this.game.localPlayer];
    panel(gl, x, y, w, h, { opacity: 0.92, corners: 7 });
    let cx = x + 14;
    const iy = y + h / 2;
    const ink = PAL.inkSoft;

    const item = (icon, value, suffix) => {
      drawIcon(gl, icon, cx + 8, iy, 20, ink, 1.2);
      gl.text(String(value), cx + 24, iy + 1, { size: 15, weight: 600, color: PAL.ink, family: FONT_MONO, baseline: 'middle' });
      const wdt = gl.textWidth(String(value), 15, 600, FONT_MONO);
      if (suffix) gl.text(suffix, cx + 26 + wdt, iy + 1, { size: 12, weight: 500, color: PAL.inkDim, baseline: 'middle', family: FONT_MONO });
      cx += 30 + wdt + (suffix ? gl.textWidth(suffix, 12, 500, FONT_MONO) : 0) + 24;
    };
    item('gold', Math.floor(p.gold));
    item('lumber', Math.floor(p.lumber));
    item('food', `${p.foodUsed}/${p.foodCap}`);

    // upkeep + clock
    const upkeep = upkeepFor(p.foodUsed);
    const ux = x + w - 168;
    gl.text(upkeep.name, ux, iy + 1, { size: 12, weight: 500, color: PAL.inkDim, baseline: 'middle' });
    gl.text(fmtTime(this.game.world.time), x + w - 74, iy + 1, { size: 14, weight: 600, color: PAL.ink, family: FONT_MONO, baseline: 'middle' });
    gl.seg(x + w - 176, y + 8, x + w - 176, y + h - 8, 1, PAL.white08);
    this.addRegion({ kind: 'upkeep', x: ux - 4, y, w: 74, h });
  }

  // -------------------------------------------------------------- messages
  drawMessages() {
    const gl = this.game.renderer.gl;
    const world = this.game.world;
    const msgs = world.messages.filter((m) => m.owner === this.game.localPlayer).slice(-7);
    if (!msgs.length) return;
    const { x, y, w } = this.messages;
    let yy = y + 70;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      const age = world.time - m.time;
      const a = clamp(1 - (age - 8) / 4, 0, 1);
      if (a <= 0) continue;
      gl.text(m.text, x, yy, { size: 12, weight: 500, color: [0.9, 0.92, 0.94, 0.8 * a], family: FONT_SANS });
      gl.seg(x - 6, yy + 12, x - 6, yy + 12, 1, PAL.white20);
      yy -= 19;
    }
  }

  drawAlerts() {
    const gl = this.game.renderer.gl;
    const a = this.game.alert;
    if (!a || a.time <= 0) return;
    const alpha = clamp(a.time / 1.5, 0, 1);
    const w = gl.textWidth(a.text, 15, 600) + 40;
    const x = this.W / 2 - w / 2;
    const y = 96;
    panel(gl, x, y, w, 34, { opacity: 0.94 * alpha, borderColor: [0.6, 0.63, 0.66, alpha], corners: 6 });
    gl.text(a.text, this.W / 2, y + 17, { size: 15, weight: 600, color: [0.95, 0.96, 0.97, alpha], align: 'center', baseline: 'middle', family: FONT_SERIF });
  }

  // ------------------------------------------------------------ hero panel
  drawHeroPanel() {
    const gl = this.game.renderer.gl;
    const world = this.game.world;
    const p = world.players[this.game.localPlayer];
    const hero = this.game.primaryHero();
    const { x, y, w, h } = this.heroPanel;

    if (!hero) {
      panel(gl, x, y, 250, 58, { opacity: 0.9, corners: 7 });
      gl.text('NEW PROJECTION', x + 14, y + 12, { size: 16, weight: 600, color: PAL.ink, family: FONT_SERIF, tracking: 1.2 });
      gl.text('Monochrome Warfare', x + 14, y + 34, { size: 10, weight: 500, color: PAL.inkFaint, tracking: 1.8 });
      return;
    }

    panel(gl, x, y, w, h, { opacity: 0.94, corners: 8 });
    const revive = !hero.dead ? (world.players[this.game.localPlayer].heroRevive || []).find((r) => r.heroId === hero.id) : null;
    const fallen = hero.dead;
    // portrait
    const px = x + 12, py = y + 12, ps = 82;
    gl.rect(px, py, ps, ps, [0.065, 0.07, 0.08, 1]);
    gl.strokeRect(px, py, ps, ps, 1, PAL.panelInk);
    cornerTicks(gl, px - 2, py - 2, ps + 4, ps + 4, 6, PAL.panelInkBright);
    const cx = px + ps / 2, cy = py + ps - 8;
    drawFigure(gl, cx, cy, 1.55, {
      ink: fallen ? PAL.inkGhost : PAL.ink,
      t: world.time,
      weapon: hero.def.art.weapon,
      shield: hero.def.art.shield,
      helmet: hero.def.art.helmet,
      robe: hero.def.art.robe,
      hat: hero.def.art.hat,
      cape: hero.def.art.cape,
      bulk: hero.def.art.bulk,
      hero: true,
    });
    // clicking the hero portrait selects the hero and brings it into view
    this.addRegion({ kind: 'heroPortrait', heroId: hero.id, x: px, y: py, w: ps, h: ps });
    // level badge
    gl.rect(px, py + ps - 18, 26, 18, [0.06, 0.065, 0.075, 0.95]);
    gl.strokeRect(px, py + ps - 18, 26, 18, 1, PAL.panelInkBright);
    gl.text(String(hero.heroLevel), px + 13, py + ps - 9, { size: 13, weight: 700, color: PAL.ink, align: 'center', baseline: 'middle', family: FONT_MONO });

    const tx = px + ps + 14;
    const tw = x + w - tx - 12;
    gl.text(hero.def.name, tx, y + 10, { size: 15, weight: 600, color: fallen ? PAL.inkDim : PAL.ink, family: FONT_SERIF });
    const curXp = HERO_XP_TABLE[hero.heroLevel - 1] || 0;
    const nextXp = hero.heroLevel >= 10 ? curXp + 1 : (HERO_XP_TABLE[hero.heroLevel] || curXp + 1);
    const xpPct = hero.heroLevel >= 10 ? 1 : clamp((hero.xp - curXp) / Math.max(1, nextXp - curXp), 0, 1);
    bar(gl, tx, y + 32, tw, 10, hero.hp / hero.maxHp, { fg: PAL.ink, bg: [0.1, 0.11, 0.12, 1] });
    gl.text(`${Math.ceil(hero.hp)} / ${hero.maxHp}`, tx + 4, y + 37, { size: 9, weight: 600, color: PAL.bg, baseline: 'middle', family: FONT_MONO });
    bar(gl, tx, y + 45, tw, 8, hero.mana / Math.max(1, hero.maxMana), { fg: PAL.inkSoft, bg: [0.1, 0.11, 0.12, 1] });
    gl.text(`${Math.floor(hero.mana)} / ${hero.maxMana}`, tx + 4, y + 49, { size: 8, weight: 600, color: PAL.bg, baseline: 'middle', family: FONT_MONO });
    // xp bar
    gl.rect(tx, y + 56, tw, 5, [0.1, 0.11, 0.12, 1]);
    gl.rect(tx, y + 56, tw * xpPct, 5, PAL.inkDim);
    gl.strokeRect(tx, y + 56, tw, 5, 1, PAL.panelInk);

    // ability icons with learn afforance
    const ic = 30, gapx = 5;
    let ax = tx;
    const ay = y + 70;
    for (const st of hero.abilities) {
      const def = ABILITIES[st.id];
      if (!def) continue;
      const learned = st.level > 0;
      const req = (def.heroLevelReq || [1])[Math.min(st.level, (def.heroLevelReq || [1]).length - 1)] || 1;
      const canLearn = hero.skillPoints > 0 && st.level < (def.levels || 1) && hero.heroLevel >= req;
      const rect = { x: ax, y: ay, w: ic, h: ic };
      const hovered = this.hover && this.hover.kind === 'heroAbility' && this.hover.abilityId === st.id;
      gl.rect(ax, ay, ic, ic, [0.07, 0.076, 0.087, 1]);
      if (hovered) gl.rect(ax, ay, ic, ic, [1, 1, 1, 0.07]);
      gl.strokeRect(ax, ay, ic, ic, 1, learned ? (hovered ? PAL.ink : PAL.panelInkBright) : PAL.panelInk);
      drawIcon(gl, def.icon, ax + ic / 2, ay + ic / 2, ic * 0.62, learned ? PAL.inkSoft : PAL.inkGhost, 1.1);
      if (learned) {
        gl.text('I'.repeat(st.level), ax + 3, ay + ic - 11, { size: 8, weight: 700, color: PAL.inkDim });
      }
      if (canLearn) {
        gl.ring(ax + ic - 6, ay + 6, 5.5, 1, PAL.ink, 10);
        gl.seg(ax + ic - 9, ay + 6, ax + ic - 3, ay + 6, 1.3, PAL.ink);
        gl.seg(ax + ic - 6, ay + 3, ax + ic - 6, ay + 9, 1.3, PAL.ink);
        this.addRegion({ kind: 'heroAbility', abilityId: st.id, x: ax, y: ay, w: ic, h: ic, learn: true });
      } else {
        this.addRegion({ kind: 'heroAbility', abilityId: st.id, x: ax, y: ay, w: ic, h: ic });
      }
      ax += ic + gapx;
    }
    if (fallen) {
      const altar = world.aliveBuildings(0).find((b) => b.def.heroAltar);
      gl.rect(px, py, ps, ps, [0.02, 0.022, 0.026, 0.55]);
      gl.text('FALLEN', px + ps / 2, py + ps / 2 - 6, { size: 10, weight: 700, color: PAL.inkSoft, align: 'center', tracking: 2 });
      if (revive) {
        const p = 1 - revive.timeLeft / Math.max(0.001, revive.total);
        gl.rect(px + 6, py + ps / 2 + 4, ps - 12, 4, [0.1, 0.11, 0.12, 1]);
        gl.rect(px + 6, py + ps / 2 + 4, (ps - 12) * clamp(p, 0, 1), 4, PAL.inkSoft);
        gl.text(`Reviving in ${Math.ceil(revive.timeLeft)}s`, tx, y + 32, { size: 11, weight: 500, color: PAL.inkDim });
      } else {
        gl.text(altar ? 'Ready to revive at the Altar.' : 'Build an Altar to revive.', tx, y + 32, { size: 11, weight: 500, color: PAL.inkDim });
      }
      return;
    }
    if (hero.skillPoints > 0) {
      gl.text(`+${hero.skillPoints} skill point${hero.skillPoints > 1 ? 's' : ''}`, x + w - 12, y + 8, {
        size: 9, weight: 600, color: PAL.inkSoft, align: 'right', tracking: 0.8,
      });
    }
  }

  // -------------------------------------------------------------- console
  drawConsole() {
    const gl = this.game.renderer.gl;
    const { x, y, w, h } = this.console;
    gl.rect(x, y, w, h, [0.043, 0.047, 0.055, 0.97]);
    gl.seg(x, y, x + w, y, 1.5, PAL.panelInkBright);
    gl.seg(x, y + 4, x + w, y + 4, 1, PAL.white05);
    // subtle vertical rails
    for (let i = 1; i < 8; i++) {
      gl.seg(x + (w * i) / 8, y + 10, x + (w * i) / 8, y + h - 10, 1, PAL.white05);
    }
    this.drawMinimap();
    this.drawSelectionPanel();
    this.drawInfoDetails();
    this.drawInventory();
    this.drawCommandCard();
    this.drawStatsRow();
  }

  drawMinimap() {
    const gl = this.game.renderer.gl;
    const world = this.game.world;
    const { x, y, w, h } = this.minimap;
    panel(gl, x - 6, y - 22, w + 12, h + 30, { opacity: 0.9, corners: 7 });
    gl.text('MINIMAP', x, y - 12, { size: 9, weight: 600, color: PAL.inkFaint, tracking: 2.4 });
    gl.rect(x, y, w, h, [0.02, 0.022, 0.026, 1]);

    const mw = world.width, mh = world.height;
    const scaleX = w / mw, scaleY = h / mh;
    const toMap = (wx, wy) => [x + (wx / world.worldWidth) * w, y + (wy / world.worldHeight) * h];
    const team = this.game.localTeam;
    const fog = world.fog.teams[team];

    // terrain blocks (2x2 tiles)
    const step = 2;
    for (let ty = 0; ty < mh; ty += step) {
      for (let tx = 0; tx < mw; tx += step) {
        const t = world.terrain[ty * mw + tx];
        const c = MM_COLORS[t] || MM_COLORS[0];
        gl.rect(x + tx * scaleX, y + ty * scaleY, scaleX * step + 0.5, scaleY * step + 0.5, c);
      }
    }
    // fog
    for (let ty = 0; ty < mh; ty += step) {
      for (let tx = 0; tx < mw; tx += step) {
        const st = fog.state[ty * mw + tx];
        if (st === FOG_VISIBLE) continue;
        gl.rect(x + tx * scaleX, y + ty * scaleY, scaleX * step + 0.5, scaleY * step + 0.5,
          st === FOG_EXPLORED ? [0.02, 0.022, 0.026, 0.55] : [0.02, 0.022, 0.026, 0.94]);
      }
    }
    // trees as faint dots
    for (const t of world.trees) {
      if (t.dead) continue;
      if (!world.fog.isExplored(team, t.x, t.y)) continue;
      const [mx, my] = toMap(t.x, t.y);
      gl.rect(mx, my, 1.2, 1.2, [0.45, 0.48, 0.5, 0.5]);
    }
    // mines
    for (const b of world.buildings) {
      if (!b.isMine) continue;
      const [mx, my] = toMap(b.x, b.y);
      gl.polyline([mx, my - 3, mx + 3, my, mx, my + 3, mx - 3, my], 1, PAL.inkSoft, true, false);
    }
    // buildings + units
    for (const b of world.buildings) {
      if (b.isMine || b.dead) continue;
      if (b.owner >= 0 && world.players[b.owner] && world.players[b.owner].team === team) {
        const [mx, my] = toMap(b.x, b.y);
        gl.rect(mx - 2, my - 2, 4.5, 4.5, PAL.ink);
      } else if (world.fog.isVisible(team, b.x, b.y)) {
        const [mx, my] = toMap(b.x, b.y);
        gl.strokeRect(mx - 2, my - 2, 4.5, 4.5, 1, PAL.inkSoft);
      }
    }
    for (const u of world.units) {
      if (u.dead) continue;
      const friendly = u.owner >= 0 && world.players[u.owner] && world.players[u.owner].team === team;
      if (!friendly && !world.fog.isVisible(team, u.x, u.y)) continue;
      const [mx, my] = toMap(u.x, u.y);
      if (friendly) gl.rect(mx - 1, my - 1, 2.4, 2.4, u.hero ? PAL.ink : PAL.inkSoft);
      else gl.rect(mx - 1, my - 1, 2.2, 2.2, u.creep ? PAL.inkFaint : PAL.inkDim);
    }
    // camera frustum
    const corners = [
      this.game.renderer.screenToWorld(0, 0),
      this.game.renderer.screenToWorld(this.game.renderer.width, 0),
      this.game.renderer.screenToWorld(this.game.renderer.width, this.game.renderer.height),
      this.game.renderer.screenToWorld(0, this.game.renderer.height),
    ];
    const pts = [];
    for (const c of corners) {
      const [mx, my] = toMap(clamp(c.x, 0, world.worldWidth), clamp(c.y, 0, world.worldHeight));
      pts.push(mx, my);
    }
    gl.polyline(pts, 1, PAL.white50, true, false);
    gl.strokeRect(x, y, w, h, 1, PAL.panelInk);
    this.addRegion({ kind: 'minimap', x, y, w, h });
  }

  drawSelectionPanel() {
    const gl = this.game.renderer.gl;
    const world = this.game.world;
    const { x, y, w, h } = this.portrait;
    const sel = this.game.selection;
    panel(gl, x - 8, y - 26, this.inventory.x - x - 8, h + 68, { opacity: 0.55, inset: false, borderColor: PAL.white05 });
    gl.rect(x, y, w, h, [0.06, 0.065, 0.075, 1]);
    gl.strokeRect(x, y, w, h, 1, PAL.panelInk);
    cornerTicks(gl, x - 2, y - 2, w + 4, h + 4, 6, PAL.panelInkBright);

    if (!sel.length) {
      gl.text('NO SELECTION', x + w / 2, y + h / 2 - 8, { size: 9, weight: 600, color: PAL.inkGhost, align: 'center', tracking: 2 });
      gl.text('Drag to select units', x + w / 2, y + h / 2 + 8, { size: 10, weight: 400, color: PAL.inkGhost, align: 'center' });
      return;
    }
    const e = sel[0];
    const cx = x + w / 2, cy = y + h - 8;
    const art = (e.def && e.def.art) || {};
    if (e.kind === 'building') {
      // draw the building's icon large
      drawIcon(gl, e.defId, cx, cy - 22, 58, PAL.inkSoft, 1.6);
    } else if (e.hero) {
      drawFigure(gl, cx, cy, 1.65, {
        ink: PAL.ink, t: world.time, weapon: art.weapon, shield: art.shield, helmet: art.helmet,
        robe: art.robe, hat: art.hat, cape: art.cape, bulk: art.bulk, hero: true,
      });
    } else {
      drawFigure(gl, cx, cy, 1.55, {
        ink: PAL.ink, t: world.time, weapon: art.weapon, shield: art.shield, helmet: art.helmet,
        robe: art.robe, mount: art.mount, hat: art.hat, bulk: art.bulk, ethereal: art.ethereal,
        moving: false,
      });
    }

    // name + hp/mana
    const tx = x + w + 14;
    const tw = Math.min(250, this.inventory.x - tx - 90);
    gl.text(e.name + (e.hero ? ` · Level ${e.heroLevel}` : ''), tx, y + 2, {
      size: 15, weight: 600, color: PAL.ink, family: FONT_SERIF,
      align: 'left',
    });
    bar(gl, tx, y + 24, tw, 11, e.hp / e.maxHp, { fg: PAL.ink, bg: [0.1, 0.11, 0.12, 1] });
    gl.text(`${Math.ceil(e.hp)} / ${Math.round(e.maxHp)}`, tx + 5, y + 30, { size: 9, weight: 600, color: PAL.bg, baseline: 'middle', family: FONT_MONO });
    if (e.maxMana > 0) {
      bar(gl, tx, y + 38, tw, 9, e.mana / e.maxMana, { fg: PAL.inkSoft, bg: [0.1, 0.11, 0.12, 1] });
      gl.text(`${Math.floor(e.mana)} / ${e.maxMana}`, tx + 5, y + 43, { size: 9, weight: 600, color: PAL.bg, baseline: 'middle', family: FONT_MONO });
    }
    if (e.items) {
      const n = e.items.filter(Boolean).length;
      gl.text(`${n}/6`, tx + tw + 46, y + 24, { size: 9, weight: 500, color: PAL.inkFaint });
    }
    if (e.def && e.def.food) {
      gl.text(`food ${e.def.food}`, tx + tw + 46, y + 40, { size: 9, weight: 500, color: PAL.inkFaint });
    }

    // group icons for multi selection
    if (sel.length > 1) {
      const gx = x + w + 14 + 264;
      const gy = y + 4;
      const iconSize = 24, gap = 3;
      const maxCols = Math.max(1, Math.floor((this.inventory.x - 8 - gx) / (iconSize + gap)));
      sel.slice(0, 24).forEach((u, i) => {
        const col = i % maxCols, row = Math.floor(i / maxCols);
        const ux = gx + col * (iconSize + gap);
        const uy = gy + row * (iconSize + gap);
        if (uy + iconSize > y + h + 76) return;
        gl.rect(ux, uy, iconSize, iconSize, u.hp / u.maxHp < 0.35 ? [0.16, 0.16, 0.17, 1] : [0.085, 0.09, 0.1, 1]);
        gl.strokeRect(ux, uy, iconSize, iconSize, 1, PAL.panelInk);
        drawIcon(gl, u.hero ? 'hero' : (u.def.art.weapon === 'staff' ? 'priest' : u.defId), ux + iconSize / 2, uy + iconSize / 2, iconSize * 0.7, u.hero ? PAL.ink : PAL.inkSoft, 1);
        // hp sliver
        gl.rect(ux + 1, uy + iconSize - 3, (iconSize - 2) * clamp(u.hp / u.maxHp, 0, 1), 2, PAL.inkSoft);
        this.addRegion({ kind: 'unitIcon', id: u.id, x: ux, y: uy, w: iconSize, h: iconSize });
      });
    }
    this.addRegion({ kind: 'portrait', x, y, w, h });
  }

  drawStatsRow() {
    const gl = this.game.renderer.gl;
    const sel = this.game.selection;
    const { x, y, w } = this.statRow;
    gl.seg(x, y - 2, x + w, y - 2, 1, PAL.white05);
    if (!sel.length) return;
    const e = sel[0];
    const stats = [];
    if (e.kind === 'building') {
      stats.push(['Armour', `${Math.round(this.game.world.effectiveArmor(e))}`]);
      if (e.def.attack) stats.push(['Attack', `${e.dmgMin}-${e.dmgMax}`]);
      if (e.def.foodProvided) stats.push(['Food', `+${e.def.foodProvided}`]);
      if (e.def.trains) stats.push(['Trains', e.def.trains.length ? '' : '—']);
      const prod = e.trainQueue.length ? `${1 - e.trainQueue[0].timeLeft / e.trainQueue[0].total}` : 0;
      if (e.trainQueue.length) stats.push(['Progress', `${Math.round(prod * 100)}%`]);
    } else {
      const [min, max] = this.game.world.effectiveDamageRange(e);
      stats.push(['Damage', `${Math.round(min)}-${Math.round(max)}`]);
      stats.push(['Armour', `${Math.round(this.game.world.effectiveArmor(e))}`]);
      stats.push(['Range', e.range > 120 ? 'Ranged' : 'Melee']);
      if (e.hero) stats.push(['Str/Agi/Int', `${Math.floor(e.attributes.str)}/${Math.floor(e.attributes.agi)}/${Math.floor(e.attributes.int)}`]);
    }
    let sx = x;
    for (const [k, v] of stats) {
      gl.text(k.toUpperCase(), sx, y + 6, { size: 8, weight: 600, color: PAL.inkGhost, tracking: 1.2 });
      gl.text(v, sx, y + 20, { size: 12, weight: 600, color: PAL.inkDim, family: FONT_MONO });
      sx += Math.max(58, gl.textWidth(v, 12, 600, FONT_MONO) + 30);
      if (sx > x + w - 40) break;
    }
    // selection count badge
    if (sel.length > 1) {
      gl.text(`${sel.length} SELECTED`, x + w, y + 6, { size: 9, weight: 600, color: PAL.inkFaint, align: 'right', tracking: 1 });
    }
  }

  // Production queues, construction progress and unit order details.
  drawInfoDetails() {
    const gl = this.game.renderer.gl;
    const world = this.game.world;
    const sel = this.game.selection;
    if (!sel.length) return;
    const e = sel[0];
    const x0 = this.portrait.x + this.portrait.w + 14;
    const x1 = this.inventory.x - 14;
    const w = x1 - x0;
    const y0 = this.statRow.y + this.statRow.h - 6;
    gl.seg(x0, y0 - 6, x1, y0 - 6, 1, PAL.white05);

    if (e.kind === 'building' && e.owner === this.game.localPlayer) {
      const chips = [];
      if (e.constructing) {
        chips.push({ icon: e.defId, label: `${Math.round((e.buildProgress || 0) * 100)}%`, progress: e.buildProgress || 0 });
      }
      if (e.upgrading) {
        const tgt = BUILDINGS[e.upgrading.defId];
        const p = 1 - e.upgrading.timeLeft / Math.max(0.001, e.upgrading.total);
        chips.push({ icon: tgt ? tgt.id : 'upgrade', label: `${Math.round(clamp(p, 0, 1) * 100)}%`, progress: p });
      }
      e.trainQueue.forEach((item, i) => {
        const def = ALL_DEFS[item.defId];
        const p = i === 0 ? 1 - item.timeLeft / Math.max(0.001, item.total) : 0;
        chips.push({
          icon: def ? def.id : 'unit', label: String(i + 1), progress: p,
          kind: 'train', index: i, title: def ? def.name : item.defId,
        });
      });
      e.researchQueue.forEach((item, i) => {
        const up = UPGRADES[item.upgradeId];
        const p = i === 0 ? 1 - item.timeLeft / Math.max(0.001, item.total) : 0;
        chips.push({
          icon: up ? up.icon : 'upgrade', label: 'R', progress: p,
          kind: 'research', index: i, title: up ? up.name : item.upgradeId,
        });
      });
      if (!chips.length) {
        if (e.rally) {
          gl.text('Rally point set', x0, y0 + 12, { size: 10, weight: 500, color: PAL.inkFaint, tracking: 0.6 });
        }
        const desc = e.def.description || '';
        if (desc) gl.text(desc, x0, y0 + 12, { size: 11, weight: 400, color: PAL.inkDim });
        return;
      }
      let cx = x0;
      const size = 30, gap = 5;
      for (const chip of chips.slice(0, 14)) {
        if (cx + size > x1) break;
        gl.rect(cx, y0, size, size, [0.07, 0.075, 0.085, 1]);
        gl.strokeRect(cx, y0, size, size, 1, chip.progress > 0 ? PAL.panelInkBright : PAL.panelInk);
        drawIcon(gl, chip.icon, cx + size / 2, y0 + size / 2 - 1, size * 0.62, PAL.inkSoft, 1);
        if (chip.progress > 0) {
          gl.rect(cx + 1, y0 + size - 4, (size - 2) * clamp(chip.progress, 0, 1), 3, PAL.ink);
        }
        if (chip.kind) {
          this.addRegion({
            kind: 'queue', x: cx, y: y0, w: size, h: size,
            queueKind: chip.kind, index: chip.index, title: chip.title,
          });
        }
        cx += size + gap;
      }
      return;
    }

    if (e.kind === 'unit') {
      const orderText = describeOrder(e, world);
      gl.text(orderText, x0, y0 + 12, { size: 11, weight: 500, color: PAL.inkDim });
      if (e.carry && e.carry.amount > 0) {
        const what = e.carry.type === 'gold' ? 'gold' : 'lumber';
        gl.text(`Carrying ${Math.floor(e.carry.amount)} ${what}`, x0 + 180, y0 + 12, { size: 10, weight: 400, color: PAL.inkFaint });
      }
      // autocast toggles for casters
      const castables = (e.abilities || []).filter((st) => {
        const def = ABILITIES[st.id];
        return def && st.level > 0 && st.autocast;
      });
      let ax = x1 - (castables.length * 26);
      for (const st of castables) {
        const def = ABILITIES[st.id];
        const on = st.enabled !== false;
        gl.rect(ax, y0 + 2, 22, 22, on ? [0.13, 0.14, 0.15, 1] : [0.07, 0.075, 0.085, 1]);
        gl.strokeRect(ax, y0 + 2, 22, 22, 1, on ? PAL.inkSoft : PAL.panelInk);
        drawIcon(gl, def.icon, ax + 11, y0 + 13, 15, on ? PAL.ink : PAL.inkGhost, 1);
        this.addRegion({ kind: 'autocast', unitId: e.id, abilityId: st.id, x: ax, y: y0 + 2, w: 22, h: 22 });
        ax += 26;
      }
    }
  }

  drawInventory() {
    const gl = this.game.renderer.gl;
    const hero = this.game.primaryHero();
    const { x, y, slot, gap } = this.inventory;
    gl.text('INVENTORY', x, y - 12, { size: 9, weight: 600, color: PAL.inkGhost, tracking: 2 });
    const heroSelected = this.game.selection.find((u) => u.hero) || hero;
    for (let i = 0; i < 6; i++) {
      const sx = x + i * (slot + gap);
      gl.rect(sx, y, slot, slot, [0.062, 0.067, 0.077, 1]);
      gl.strokeRect(sx, y, slot, slot, 1, PAL.panelInk);
      const it = heroSelected && heroSelected.items ? heroSelected.items[i] : null;
      if (it) {
        const itemDef = ITEMS[it.defId];
        const hovered = this.hover && this.hover.kind === 'inventory' && this.hover.index === i;
        if (hovered) gl.rect(sx, y, slot, slot, [1, 1, 1, 0.07]);
        drawIcon(gl, itemDef.icon, sx + slot / 2, y + slot / 2, slot * 0.62, PAL.inkSoft, 1.2);
        if (it.charges > 1) {
          gl.text(String(it.charges), sx + slot - 4, y + slot - 12, { size: 9, weight: 700, color: PAL.inkDim, align: 'right' });
        }
        this.addRegion({ kind: 'inventory', index: i, heroId: heroSelected.id, x: sx, y, w: slot, h: slot });
      }
    }
  }

  drawCommandCard() {
    const gl = this.game.renderer.gl;
    const { x, y, w, h, cell, gap, cols } = this.commands;
    const cmds = buildCommands(this.game);
    this.commandsCache = cmds;
    for (let i = 0; i < 12; i++) {
      const col = i % cols, row = Math.floor(i / cols);
      const bx = x + col * (cell + gap);
      const by = y + row * (cell + gap);
      const cmd = cmds[i];
      if (!cmd) {
        gl.rect(bx, by, cell, cell, [0.052, 0.056, 0.064, 0.85]);
        gl.strokeRect(bx, by, cell, cell, 1, [0.16, 0.17, 0.19, 1]);
        continue;
      }
      const hovered = this.hover && this.hover.kind === 'command' && this.hover.index === i;
      commandButton(gl, bx, by, cell, cell, cmd, { hover: hovered });
      this.addRegion({ kind: 'command', index: i, cmd, x: bx, y: by, w: cell, h: cell });
    }
    gl.text(this.game.buildMenu ? 'BUILD' : 'COMMANDS', x, y + h + 6, {
      size: 8, weight: 600, color: PAL.inkGhost, tracking: 2,
    });
  }

  drawMiniButtons() {
    const gl = this.game.renderer.gl;
    const size = 26;
    const labels = [['menu', 'MENU'], ['help', 'HELP'], ['idle', 'IDLE']];
    let x = 20;
    for (const [id, text] of labels) {
      const y = this.miniButtons.y;
      const w = gl.textWidth(text, 9, 600) + 16;
      const hovered = this.hover && this.hover.kind === 'mini' && this.hover.id === id;
      gl.rect(x, y, w, size, [0.06, 0.065, 0.075, 0.9]);
      gl.strokeRect(x, y, w, size, 1, hovered ? PAL.ink : PAL.panelInk);
      gl.text(text, x + w / 2, y + size / 2 + 1, { size: 9, weight: 700, color: hovered ? PAL.ink : PAL.inkDim, align: 'center', baseline: 'middle', tracking: 1.4 });
      this.addRegion({ kind: 'mini', id, x, y, w, h: size });
      x += w + 6;
    }
    // control group chips
    let gx = x + 10;
    for (let i = 1; i <= 5; i++) {
      const group = this.game.controlGroups[i];
      const active = group && group.units.length;
      const hovered = this.hover && this.hover.kind === 'group' && this.hover.index === i;
      gl.rect(gx, this.miniButtons.y, 22, 26, [0.06, 0.065, 0.075, active ? 0.95 : 0.6]);
      gl.strokeRect(gx, this.miniButtons.y, 22, 26, 1, hovered ? PAL.ink : PAL.panelInk);
      gl.text(String(i), gx + 11, this.miniButtons.y + 13, { size: 10, weight: 700, color: active ? PAL.ink : PAL.inkGhost, align: 'center', baseline: 'middle' });
      if (active) gl.rect(gx + 4, this.miniButtons.y + 21, 14, 2, PAL.inkSoft);
      this.addRegion({ kind: 'group', index: i, x: gx, y: this.miniButtons.y, w: 22, h: 26 });
      gx += 26;
    }
  }

  drawPlacementHint() {
    const gl = this.game.renderer.gl;
    const def = this.game.placingDef;
    const text = `Placing ${def.name} — left click to build, right click or Esc to cancel`;
    const w = gl.textWidth(text, 13, 600) + 30;
    const x = this.W / 2 - w / 2;
    const y = this.H - 250;
    panel(gl, x, y, w, 30, { opacity: 0.95, borderColor: PAL.inkSoft, corners: 6 });
    gl.text(text, this.W / 2, y + 15, { size: 13, weight: 600, color: PAL.ink, align: 'center', baseline: 'middle' });
  }

  // ------------------------------------------------------------- tooltips
  drawTooltip() {
    const gl = this.game.renderer.gl;
    const h = this.hover;
    if (!h) return;
    const mx = this.game.mouse.x, my = this.game.mouse.y;
    if (h.kind === 'command') {
      const cmd = h.cmd;
      if (!cmd) return;
      let extra = '';
      if (cmd.reason && cmd.enabled === false) extra = cmd.reason;
      if (cmd.tierBlocked) extra = 'Requires a higher town tier.';
      tooltip(gl, mx, my, {
        title: cmd.title || '',
        subtitle: cmd.subtitle,
        costLine: cmd.costLine,
        body: cmd.body,
        hint: [cmd.hint, extra].filter(Boolean).join('  '),
        width: 300,
      });
    } else if (h.kind === 'heroAbility') {
      const hero = this.game.primaryHero();
      if (!hero) return;
      const info = abilityInfo(hero, h.abilityId);
      if (info) tooltip(gl, mx, my, { ...info, width: 300 });
    } else if (h.kind === 'inventory') {
      const hero = this.game.world.getEntity(h.heroId);
      const it = hero && hero.items ? hero.items[h.index] : null;
      if (it) {
        const info = itemInfo(it.defId);
        if (info) tooltip(gl, mx, my, { ...info, width: 280, hint: `${info.hint}${it.charges > 1 ? `  (${it.charges} charges)` : ''}` });
      }
    } else if (h.kind === 'unitIcon') {
      const e = this.game.world.getEntity(h.id);
      if (e) {
        tooltip(gl, mx, my, {
          title: e.name,
          subtitle: e.hero ? `Level ${e.heroLevel} Hero` : e.creep ? 'Creep' : 'Unit',
          costLine: `HP ${Math.ceil(e.hp)} / ${e.maxHp}`,
          body: e.def.description || '',
          width: 260,
        });
      }
    } else if (h.kind === 'mini') {
      const texts = {
        menu: ['Menu', 'Open the game menu (Esc).'],
        help: ['Help', 'Show controls and rules (F1).'],
        idle: ['Idle Worker', 'Select and centre on the next idle worker.'],
      };
      const tx = texts[h.id];
      if (tx) tooltip(gl, mx, my, { title: tx[0], body: tx[1], width: 240 });
    } else if (h.kind === 'upkeep') {
      const p = this.game.world.players[this.game.localPlayer];
      const up = upkeepFor(p.foodUsed);
      tooltip(gl, mx, my, {
        title: up.name,
        body: up.goldFactor === 1
          ? 'You keep all the gold you mine. Upkeep begins above 50 food.'
          : `You are paying upkeep: only ${Math.round(up.goldFactor * 100)}% of mined gold is delivered.`,
        width: 260,
      });
    }
  }

  // ----------------------------------------------------------------- menus
  openMenu(mode) {
    this.menu = mode;
    this.regions.length = 0;
  }

  closeMenu() {
    this.menu = 'none';
  }

  drawMenu() {
    const gl = this.game.renderer.gl;
    const W = this.W, H = this.H;
    gl.rect(0, 0, W, H, [0.03, 0.034, 0.04, 0.94]);
    // decorative iso grid
    for (let i = -12; i < 26; i++) {
      gl.seg(W / 2 + i * 90, H * 0.75, W / 2 + i * 90 + 380, H * 0.75 + 220, 1, PAL.white05);
      gl.seg(W / 2 + i * 90, H * 0.75 + 220, W / 2 + i * 90 + 380, H * 0.75, 1, PAL.white05);
    }
    // decorative figures
    drawFigure(gl, W * 0.16, H * 0.82, 2.6, { ink: PAL.inkGhost, t: this.game.time, weapon: 'sword', helmet: true, shield: true, moving: false });
    drawFigure(gl, W * 0.84, H * 0.82, 2.6, { ink: PAL.inkGhost, t: this.game.time + 1, weapon: 'staff', robe: true, hat: 'wizard', hero: true, moving: false });

    if (this.menu === 'main') {
      const cw = 420;
      const cx = W / 2 - cw / 2;
      const cy = Math.max(60, H * 0.22);
      gl.text('NEW PROJECTION', W / 2, cy, { size: 54, weight: 600, color: PAL.ink, align: 'center', family: FONT_SERIF, tracking: 3 });
      gl.seg(cx, cy + 68, cx + cw, cy + 68, 1, PAL.panelInkBright);
      gl.text('A MONOCHROME REAL-TIME STRATEGY GAME', W / 2, cy + 84, {
        size: 11, weight: 600, color: PAL.inkFaint, align: 'center', tracking: 3.4,
      });
      const buttons = [
        ['start', 'New Game', 'Human Alliance versus the computer'],
        ['help', 'How to Play', 'Controls, economy and combat'],
        ['credits', 'Credits', ''],
      ];
      let by = cy + 136;
      for (const [id, text, sub] of buttons) {
        const hovered = this.hover && this.hover.kind === 'menu' && this.hover.id === id;
        const bw = 320, bh = 54;
        const bx = W / 2 - bw / 2;
        gl.rect(bx, by, bw, bh, hovered ? [0.10, 0.11, 0.125, 0.95] : [0.06, 0.066, 0.076, 0.9]);
        gl.strokeRect(bx, by, bw, bh, 1, hovered ? PAL.ink : PAL.panelInk);
        if (hovered) {
          gl.seg(bx + 10, by + bh / 2, bx + 18, by + bh / 2, 1.4, PAL.ink);
          gl.seg(bx + 14, by + bh / 2 - 4, bx + 18, by + bh / 2, 1.4, PAL.ink);
          gl.seg(bx + 14, by + bh / 2 + 4, bx + 18, by + bh / 2, 1.4, PAL.ink);
        }
        gl.text(text, W / 2, by + (sub ? 11 : 18), { size: 19, weight: 600, color: hovered ? PAL.ink : PAL.inkSoft, align: 'center', family: FONT_SERIF });
        if (sub) gl.text(sub, W / 2, by + 34, { size: 10, weight: 400, color: PAL.inkGhost, align: 'center', tracking: 0.6 });
        this.addRegion({ kind: 'menu', id, x: bx, y: by, w: bw, h: bh });
        by += bh + 12;
      }
      gl.text('v1.0 · WebGL2 · monochrome line art', W / 2, H - 32, { size: 10, weight: 400, color: PAL.inkGhost, align: 'center', tracking: 1.6 });
    } else if (this.menu === 'help') {
      this.drawHelpPanel();
    } else if (this.menu === 'pause') {
      const cw = 360, ch = 260;
      const cx = W / 2 - cw / 2, cy = H / 2 - ch / 2;
      panel(gl, cx, cy, cw, ch, { opacity: 0.98, borderColor: PAL.panelInkBright, corners: 12 });
      gl.text('PAUSED', W / 2, cy + 34, { size: 32, weight: 600, color: PAL.ink, align: 'center', family: FONT_SERIF, tracking: 4 });
      gl.seg(cx + 30, cy + 62, cx + cw - 30, cy + 62, 1, PAL.panelInk);
      const buttons = [
        ['resume', 'Resume'],
        ['help', 'How to Play'],
        ['restart', 'Restart Game'],
        ['quit', 'Quit to Menu'],
      ];
      let by = cy + 82;
      for (const [id, text] of buttons) {
        const hovered = this.hover && this.hover.kind === 'menu' && this.hover.id === id;
        gl.rect(cx + 50, by, cw - 100, 36, hovered ? [0.10, 0.11, 0.125, 0.95] : [0.06, 0.066, 0.076, 0.9]);
        gl.strokeRect(cx + 50, by, cw - 100, 36, 1, hovered ? PAL.ink : PAL.panelInk);
        gl.text(text, W / 2, by + 18, { size: 15, weight: 600, color: hovered ? PAL.ink : PAL.inkSoft, align: 'center', baseline: 'middle', family: FONT_SERIF });
        this.addRegion({ kind: 'menu', id, x: cx + 50, y: by, w: cw - 100, h: 36 });
        by += 42;
      }
    } else if (this.menu === 'gameover') {
      const win = this.game.world.winner === this.game.localTeam;
      const cw = 460, ch = 230;
      const cx = W / 2 - cw / 2, cy = H / 2 - ch / 2;
      panel(gl, cx, cy, cw, ch, { opacity: 0.98, borderColor: PAL.panelInkBright, corners: 14 });
      gl.text(win ? 'VICTORY' : 'DEFEAT', W / 2, cy + 40, {
        size: 46, weight: 600, color: PAL.ink, align: 'center', family: FONT_SERIF, tracking: 8,
      });
      gl.text(win ? 'The enemy has been annihilated.' : 'Your forces have been annihilated.',
        W / 2, cy + 92, { size: 13, weight: 400, color: PAL.inkDim, align: 'center' });
      const buttons = [['restart', 'Play Again'], ['quit', 'Main Menu']];
      let by = cy + 130;
      for (const [id, text] of buttons) {
        const hovered = this.hover && this.hover.kind === 'menu' && this.hover.id === id;
        gl.rect(W / 2 - 110, by, 220, 38, hovered ? [0.10, 0.11, 0.125, 0.95] : [0.06, 0.066, 0.076, 0.9]);
        gl.strokeRect(W / 2 - 110, by, 220, 38, 1, hovered ? PAL.ink : PAL.panelInk);
        gl.text(text, W / 2, by + 19, { size: 16, weight: 600, color: hovered ? PAL.ink : PAL.inkSoft, align: 'center', baseline: 'middle', family: FONT_SERIF });
        this.addRegion({ kind: 'menu', id, x: W / 2 - 110, y: by, w: 220, h: 38 });
        by += 48;
      }
    }
  }

  drawHelpPanel() {
    const gl = this.game.renderer.gl;
    const W = this.W, H = this.H;
    const cw = Math.min(W - 80, 1000), ch = Math.min(H - 60, 640);
    const cx = W / 2 - cw / 2, cy = H / 2 - ch / 2;
    panel(gl, cx, cy, cw, ch, { opacity: 0.98, borderColor: PAL.panelInkBright, corners: 12 });
    gl.text('HOW TO PLAY', cx + 30, cy + 24, { size: 26, weight: 600, color: PAL.ink, family: FONT_SERIF, tracking: 2.4 });
    gl.text('Warcraft III ruleset · monochrome line art', cx + cw - 30, cy + 34, {
      size: 11, weight: 500, color: PAL.inkGhost, align: 'right', tracking: 1.4,
    });
    gl.seg(cx + 30, cy + 58, cx + cw - 30, cy + 58, 1, PAL.panelInk);

    const cols = [
      {
        title: 'CONTROLS',
        lines: [
          ['Left click', 'Select a unit or building'],
          ['Drag', 'Box-select your units'],
          ['Right click', 'Smart order: move, attack, gather'],
          ['A + click', 'Attack-move'],
          ['M', 'Move command'],
          ['S / H', 'Stop / Hold position'],
          ['B', 'Open the build menu (peasant)'],
          ['Ctrl + 1-5', 'Assign control group'],
          ['1-5', 'Recall control group'],
          ['Arrows / edge', 'Scroll the camera'],
          ['Wheel', 'Zoom in and out'],
          ['Space', 'Centre on the town hall'],
          ['Tab', 'Cycle through the selection'],
          ['Esc', 'Cancel, or open the menu'],
        ],
      },
      {
        title: 'ECONOMY',
        lines: [
          ['Peasants', 'Mine gold, chop lumber, build'],
          ['Gold mine', 'Right-click it with a peasant'],
          ['Trees', 'Right-click to harvest lumber'],
          ['Farm', 'Six food per farm'],
          ['Upkeep', 'Above 50 food you deliver less'],
          ['Tiers', 'Keep, then Castle, unlocks tech'],
          ['Blacksmith', 'Weapon and armour upgrades'],
          ['Lumber mill', 'Faster lumber, more upgrades'],
        ],
      },
      {
        title: 'COMBAT',
        lines: [
          ['Barracks', 'Footmen, Riflemen, Knights'],
          ['Sanctum', 'Priests and Sorceresses'],
          ['Guard tower', 'Defensive structure'],
          ['Armour types', 'Light, medium, heavy, fortified'],
          ['Damage types', 'Normal, pierce, siege, magic'],
          ['Creeps', 'Neutral camps guard gold'],
          ['Fog of war', 'Scout to reveal the map'],
          ['Victory', 'Destroy every enemy building'],
        ],
      },
    ];
    const colW = (cw - 60) / 3;
    cols.forEach((col, ci) => {
      const colX = cx + 30 + ci * colW;
      gl.text(col.title, colX, cy + 78, { size: 11, weight: 700, color: PAL.inkSoft, tracking: 2.4 });
      gl.seg(colX, cy + 92, colX + colW - 26, cy + 92, 1, PAL.white12);
      let ly = cy + 106;
      for (const [k, v] of col.lines) {
        gl.text(k, colX, ly, { size: 11, weight: 600, color: PAL.ink, family: FONT_MONO });
        gl.text(v, colX, ly + 13, { size: 10.5, weight: 400, color: PAL.inkDim });
        ly += 29;
      }
    });
    const hx = cx + 30;
    const hy = cy + ch - 88;
    gl.seg(hx, hy - 12, cx + cw - 30, hy - 12, 1, PAL.white08);
    gl.text('HEROES & ITEMS', hx, hy, { size: 11, weight: 700, color: PAL.inkSoft, tracking: 2.4 });
    const para = 'Heroes gain experience in combat and spend one skill point per level, up to level 10. '
      + 'Six inventory slots hold potions, rings and scrolls: click a slot to use it, right-click to drop it. '
      + 'The Altar summons and revives heroes; the Arcane Vault sells equipment.';
    const paraLines = gl.wrapText(para, cw - 60, 11, 400, FONT_SANS);
    paraLines.slice(0, 2).forEach((ln, i) => {
      gl.text(ln, hx, hy + 18 + i * 15, { size: 11, weight: 400, color: PAL.inkDim });
    });
    const hovered = this.hover && this.hover.kind === 'menu' && this.hover.id === 'helpClose';
    const bw = 170, bh = 34;
    const bx = W / 2 - bw / 2, by = cy + ch - 54;
    gl.rect(bx, by, bw, bh, hovered ? [0.10, 0.11, 0.125, 0.95] : [0.06, 0.066, 0.076, 0.9]);
    gl.strokeRect(bx, by, bw, bh, 1, hovered ? PAL.ink : PAL.panelInk);
    gl.text('Close', W / 2, by + bh / 2, { size: 14, weight: 600, color: hovered ? PAL.ink : PAL.inkSoft, align: 'center', baseline: 'middle', family: FONT_SERIF });
    this.addRegion({ kind: 'menu', id: 'helpClose', x: bx, y: by, w: bw, h: bh });
  }

  // ---------------------------------------------------------------- utils
  addRegion(r) { this.regions.push(r); }

  pick(gl, x, y) {
    for (let i = this.regions.length - 1; i >= 0; i--) {
      const r = this.regions[i];
      if (x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h) return r;
    }
    return null;
  }
}

// Human-readable description of the unit's current order.
function describeOrder(e, world) {
  const order = e.order || { type: 'idle' };
  const target = order.targetId && world ? world.getEntity(order.targetId) : null;
  switch (order.type) {
    case 'move': return 'Moving';
    case 'attack': return target ? `Attacking ${target.name}` : 'Attacking';
    case 'attackmove': return 'Attack-moving';
    case 'hold': return 'Holding position';
    case 'gather': return order.gatherType === 'lumber' ? 'Harvesting lumber' : 'Mining gold';
    case 'return': return 'Returning resources';
    case 'build': return target ? `Constructing ${target.name}` : 'Constructing';
    case 'repair': return target ? `Repairing ${target.name}` : 'Repairing';
    case 'pickup': return 'Picking up an item';
    case 'cast': return 'Casting';
    case 'idle':
    default: return e.creep ? 'Guarding' : 'Idle';
  }
}
