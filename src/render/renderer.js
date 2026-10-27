// Game renderer: isometric camera, entity draw order, fog texture, selection,
// build ghosts and world-space effects. UI drawing lives in ../ui.

import { ISO_X, ISO_Y, TILE, clamp, TAU } from '../core/util.js';
import { PAL } from './palette.js';
import { GLRenderer } from '../gl/gl.js';
import { buildTerrainMesh } from './terrain.js';
import { FOG_VISIBLE, FOG_EXPLORED } from '../sim/fog.js';
import { drawUnit, drawBuilding, drawTree, drawItem, drawHealthBar, drawFigure, drawIcon } from './art.js';

export class GameRenderer {
  constructor(canvas) {
    this.gl = new GLRenderer(canvas);
    this.cam = { x: 0, y: 0, zoom: 1.0, targetZoom: 1.0 };
    this.viewTeam = 0;
    this.terrainBuilt = false;
    this.fogBuffer = null;
    this.fogVersion = -1;
    this.time = 0;
    this.shake = 0;
    this.mouse = { x: 0, y: 0 };
    this.resize();
  }

  resize() {
    this.gl.resize();
    this.width = this.gl.width;
    this.height = this.gl.height;
  }

  setMap(map) {
    this.map = map;
    this.mesh = buildTerrainMesh(map);
    this.gl.setTerrainMesh(this.mesh);
    this.gl.mapSize = [map.width * TILE, map.height * TILE];
    this.gl.fogEnabled = 1;
    this.terrainBuilt = true;
    this.fogBuffer = new Uint8Array(map.width * map.height * 2);
    this.fogVersion = -1;
    this.zoom = 1.0;
    this.cam.zoom = 1.0;
  }

  // ------------------------------------------------------------- camera
  centerOn(wx, wy) {
    this.cam.x = (wx - wy) * ISO_X;
    this.cam.y = (wx + wy) * ISO_Y;
    this.clampCamera();
  }

  clampCamera() {
    if (!this.map) return;
    const w = this.map.width * TILE, h = this.map.height * TILE;
    const minX = -h * ISO_X, maxX = w * ISO_X;
    const minY = 0, maxY = (w + h) * ISO_Y;
    const halfW = this.width / (2 * this.cam.zoom);
    const halfH = this.height / (2 * this.cam.zoom);
    const spanX = maxX - minX, spanY = maxY - minY;
    if (spanX <= halfW * 2) this.cam.x = (minX + maxX) / 2;
    else this.cam.x = clamp(this.cam.x, minX + halfW * 0.55, maxX - halfW * 0.55);
    if (spanY <= halfH * 2) this.cam.y = (minY + maxY) / 2;
    else this.cam.y = clamp(this.cam.y, minY + halfH * 0.6, maxY - halfH * 0.6);
  }

  zoomBy(delta, sx, sy) {
    const before = this.screenToWorld(sx, sy);
    this.cam.targetZoom = clamp(this.cam.targetZoom * (delta > 0 ? 0.9 : 1.1), 0.55, 2.0);
    this.cam.zoom = this.cam.targetZoom;
    const after = this.screenToWorld(sx, sy);
    this.cam.x += (before.x - after.x) === 0 ? 0 : ((before.x - after.x) - (before.y - after.y)) * ISO_X;
    this.cam.y += (before.x - after.x) * 0 + ((before.x - after.x) + (before.y - after.y)) * ISO_Y;
    this.clampCamera();
  }

  updateCamera(dt) {
    // smooth zoom
    const z = this.cam.zoom + (this.cam.targetZoom - this.cam.zoom) * Math.min(1, dt * 12);
    this.cam.zoom = z;
    this.clampCamera();
  }

  project(wx, wy) {
    const z = this.cam.zoom;
    return [
      ((wx - wy) * ISO_X - this.cam.x) * z + this.width / 2,
      ((wx + wy) * ISO_Y - this.cam.y) * z + this.height / 2,
    ];
  }

  projectIso(ix, iy) {
    const z = this.cam.zoom;
    return [(ix - this.cam.x) * z + this.width / 2, (iy - this.cam.y) * z + this.height / 2];
  }

  screenToWorld(sx, sy) {
    const z = this.cam.zoom;
    const ix = (sx - this.width / 2) / z + this.cam.x;
    const iy = (sy - this.height / 2) / z + this.cam.y;
    return {
      x: ix / (2 * ISO_X) + iy / (2 * ISO_Y),
      y: -ix / (2 * ISO_X) + iy / (2 * ISO_Y),
    };
  }

  visibleWorldRect(margin = 400) {
    const corners = [
      this.screenToWorld(-margin, -margin),
      this.screenToWorld(this.width + margin, -margin),
      this.screenToWorld(this.width + margin, this.height + margin),
      this.screenToWorld(-margin, this.height + margin),
    ];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const c of corners) {
      minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
      minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
    }
    return { minX, maxX, minY, maxY };
  }

  // --------------------------------------------------------------- fog
  updateFogTexture(world) {
    const team = this.viewTeam;
    const t = world.fog.teams[team];
    if (!t) return;
    if (t.version === this.fogVersion) return;
    this.fogVersion = t.version;
    const w = world.fog.w, h = world.fog.h;
    const buf = this.fogBuffer;
    for (let i = 0; i < w * h; i++) {
      const s = t.state[i];
      buf[i * 2] = s >= FOG_EXPLORED ? 255 : 0;
      buf[i * 2 + 1] = s === FOG_VISIBLE ? 255 : 0;
    }
    this.gl.setFog(this.fogBuffer, w, h);
  }

  // --------------------------------------------------------------- world
  drawWorld(world, view) {
    const s = this.cam.zoom;
    const t = this.time;
    const team = this.viewTeam;
    this.updateFogTexture(world);
    this.gl.setTerrainMesh(this.mesh);
    this.gl.beginFrame(this.cam.x, this.cam.y, this.cam.zoom);

    const rect = this.visibleWorldRect(200);
    const visible = (e) => {
      if (e.dead) return false;
      if (e.x < rect.minX - 150 || e.x > rect.maxX + 150) return false;
      if (e.y < rect.minY - 150 || e.y > rect.maxY + 150) return false;
      return true;
    };

    // ---- ground layer: rally points, AoE indicators, selection rings ----
    if (view.selectedBuildings) {
      for (const b of view.selectedBuildings) {
        if (!b.rally) continue;
        const [rx, ry] = this.project(b.rally.x, b.rally.y);
        const [bx, by] = this.project(b.x, b.y);
        this.gl.dashedLine(bx, by, rx, ry, 1.2 * s, PAL.white20, 6, 6);
        this.gl.polyline([rx, ry - 6 * s, rx + 6 * s, ry, rx, ry + 6 * s, rx - 6 * s, ry], 1.4 * s, PAL.inkSoft, true, false);
      }
    }

    for (const fx of world.effects) {
      if (fx.type !== 'ring' && fx.type !== 'pulse') continue;
      const [sx, sy] = this.project(fx.x, fx.y);
      this.drawEffectLocal(fx, sx, sy, s, t);
    }

    // ---- gather / build target markers ----
    if (view.selectedUnits) {
      for (const u of view.selectedUnits) {
        if (u.order && u.order.type === 'gather') {
          const target = world.getEntity(u.order.targetId);
          if (target && !target.dead) {
            const [tx, ty] = this.project(target.x, target.y);
            this.gl.polyline(isoEllipse((tx), ty, 20 * s, 9 * s), 1 * s, PAL.white30, true, false);
            this.gl.seg(tx, ty - 14 * s, tx, ty + 14 * s, 1 * s, PAL.white20);
          }
        }
        if (u.dest && view.showMoveLines) {
          const [ux, uy] = this.project(u.x, u.y);
          const [dx, dy] = this.project(u.dest.x, u.dest.y);
          this.gl.dashedLine(ux, uy, dx, dy, 1 * s, PAL.white08, 8, 8);
        }
      }
    }

    // ---- build ghost ----
    if (view.buildGhost) {
      const { def, tx, ty, valid } = view.buildGhost;
      const fp = def.footprint || [2, 2];
      const cx = (tx + fp[0] / 2) * TILE, cy = (ty + fp[1] / 2) * TILE;
      const [sx, sy] = this.project(cx, cy);
      const pts = [];
      const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
      for (const [ox, oy] of corners) {
        const p = this.project((tx + ox * fp[0]) * TILE, (ty + oy * fp[1]) * TILE);
        pts.push(p[0], p[1]);
      }
      const fill = valid ? PAL.white12 : PAL.black40;
      for (let i = 1; i < 3; i++) {
        this.gl.tri(pts[0], pts[1], pts[i * 2], pts[i * 2 + 1], pts[i * 2 + 2], pts[i * 2 + 3], fill);
      }
      this.gl.polyline(pts, 1.6 * s, valid ? PAL.ink : PAL.inkFaint, true, false);
      if (!valid) {
        this.gl.seg(pts[0], pts[1], pts[4], pts[5], 1.2 * s, PAL.inkFaint);
        this.gl.seg(pts[2], pts[3], pts[6], pts[7], 1.2 * s, PAL.inkFaint);
      }
      const ghost = { def, x: cx, y: cy, footprint: fp, defId: def.id, kind: 'building', constructing: true, buildProgress: 0.55, owner: view.team, hp: def.hp, maxHp: def.hp, dead: false };
      drawBuilding(this.gl, world, ghost, sx, sy, s, t, team, false);
    }

    // ---- entities (depth sorted) ----
    const drawables = [];
    for (const tree of world.trees) {
      if (tree.dead) continue;
      if (!visible(tree)) continue;
      if (!world.fog.isExplored(team, tree.x, tree.y)) continue;
      drawables.push({ e: tree, kind: 'tree', depth: tree.x + tree.y });
    }
    for (const b of world.buildings) {
      if (b.dead || !visible(b)) continue;
      if (b.kind === 'mine') {
        if (!world.fog.isExplored(team, b.x, b.y)) continue;
        drawables.push({ e: b, kind: 'mine', depth: b.x + b.y });
      } else {
        if (b.owner >= 0 && world.players[b.owner] && world.players[b.owner].team === team) {
          // always visible
        } else if (!world.fog.isVisible(team, b.x, b.y)) {
          continue;
        }
        drawables.push({ e: b, kind: 'building', depth: b.x + b.y + 10 });
      }
    }
    for (const u of world.units) {
      if (u.dead || !visible(u)) continue;
      if (u.owner >= 0 && world.players[u.owner] && world.players[u.owner].team === team) {
        // own team always drawn
      } else if (!world.fog.isVisible(team, u.x, u.y)) continue;
      drawables.push({ e: u, kind: 'unit', depth: u.x + u.y });
    }
    for (const it of world.items) {
      if (it.dead || !visible(it)) continue;
      if (!world.fog.isExplored(team, it.x, it.y)) continue;
      drawables.push({ e: it, kind: 'item', depth: it.x + it.y });
    }
    drawables.sort((a, b) => a.depth - b.depth);

    const sel = view.selectedSet;
    for (const d of drawables) {
      const [sx, sy] = this.project(d.e.x, d.e.y);
      if (d.kind === 'tree') drawTree(this.gl, d.e, sx, sy, s, t);
      else if (d.kind === 'mine') drawMineArt(this.gl, d.e, sx, sy, s, t, world, team);
      else if (d.kind === 'building') drawBuilding(this.gl, world, d.e, sx, sy, s, t, team, sel && sel.has(d.e.id));
      else if (d.kind === 'item') drawItem(this.gl, d.e, sx, sy, s, t);
      else if (d.kind === 'unit') {
        drawUnit(this.gl, world, d.e, sx, sy, s, t, team, sel && sel.has(d.e.id));
      }
    }

    // ---- health bars / selection overlays ----
    for (const d of drawables) {
      if (d.kind !== 'unit' && d.kind !== 'building') continue;
      const e = d.e;
      const [sx, sy] = this.project(e.x, e.y);
      const selected = sel && sel.has(e.id);
      const friendly = e.owner >= 0 && world.players[e.owner] && world.players[e.owner].team === team;
      if (d.kind === 'unit') {
        const art = e.def.art || {};
        const H = 38 * s * (art.bulk || 1) * (e.hero ? 1.12 : 1);
        drawHealthBar(this.gl, sx, sy, s, e, { always: selected || (e.hero && friendly), selected, friendly, y: H + 12 * s });
        if (e.hero && friendly) {
          this.gl.text(`L${e.heroLevel}`, sx + 20 * s, sy - H - 8 * s, { size: 10, color: PAL.white70, weight: 600 });
        }
        if (e.castAnim > 0) {
          this.gl.ring(sx, sy - 14 * s, 16 * s, 1 * s, PAL.white30, 14);
        }
      } else {
        const fp = e.footprint || [3, 3];
        const h = (fp[0] + fp[1]) * 8 * s;
        drawHealthBar(this.gl, sx, sy, s * 0.9, e, { always: selected, selected, friendly, width: 44, y: h });
        if (e.trainQueue && e.trainQueue.length && friendly) {
          const item = e.trainQueue[0];
          const p = 1 - item.timeLeft / item.total;
          const w = 40 * s;
          this.gl.rect(sx - w / 2, sy - h * 0.65, w, 2.5 * s, PAL.black60);
          this.gl.rect(sx - w / 2, sy - h * 0.65, w * p, 2.5 * s, PAL.inkSoft);
        }
      }
      if (selected && e.kind === 'building') {
        this.gl.dashedCircle(sx, sy, 4 * s, 1 * s, PAL.white12, 3, 10);
      }
    }

    // ---- projectiles and air effects ----
    for (const p of world.projectiles) {
      const [sx, sy] = this.project(p.x, p.y);
      const h = p.height * s;
      if (p.art === 'arrow' || p.art === 'spear') {
        const [tx, ty] = this.project(p.tx, p.ty);
        const ang = Math.atan2(ty - sy, tx - sx);
        this.gl.seg(sx - Math.cos(ang) * 5 * s, sy - h - Math.sin(ang) * 5 * s,
          sx + Math.cos(ang) * 5 * s, sy - h + Math.sin(ang) * 5 * s, 1.6 * s, PAL.ink);
      } else if (p.art === 'cannon') {
        this.gl.disc(sx, sy - h, 3.2 * s, PAL.ink, 8);
        this.gl.disc(sx, sy - h, 1.2 * s, PAL.bg, 6);
      } else if (p.art === 'water') {
        this.gl.ring(sx, sy - h, 3 * s, 1.1 * s, PAL.inkSoft, 8);
      } else {
        this.gl.disc(sx, sy - h, 1.8 * s, PAL.ink, 6);
      }
    }
    for (const fx of world.effects) {
      if (fx.type === 'ring' || fx.type === 'pulse') continue;
      const [sx, sy] = this.project(fx.x, fx.y);
      if (fx.type === 'burst') this.drawBurst(fx, sx, sy, s);
      else if (fx.type === 'beam') {
        const [x2, y2] = this.project(fx.x2 !== undefined ? fx.x2 : fx.x, fx.y2 !== undefined ? fx.y2 : fx.y);
        const a = 1 - fx.life / fx.maxLife;
        this.gl.seg(sx, sy - 16 * s, x2, y2 - 16 * s, 2.4 * s, [1, 1, 1, a]);
        this.gl.seg(sx, sy - 16 * s, x2, y2 - 16 * s, 6 * s, [1, 1, 1, a * 0.15]);
      }
    }

    // hover ring
    if (view.hoverEntity && !view.selectedSet?.has(view.hoverEntity.id)) {
      const e = view.hoverEntity;
      const [sx, sy] = this.project(e.x, e.y);
      const r = (e.radius || 20) * 1.4;
      this.gl.polyline(isoEllipse(sx, sy, r * 1.414 * ISO_X * s, r * 1.414 * ISO_Y * s), 1 * s, PAL.white30, true, false);
    }

  }

  finish() {
    this.gl.render();
  }

  beginEmpty() {
    this.gl.beginFrame(this.cam.x, this.cam.y, this.cam.zoom);
  }

  drawBurst(fx, sx, sy, s) {
    const p = fx.life / fx.maxLife;
    const n = fx.count || 10;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + fx.x * 0.03;
      const r0 = (4 + p * 20) * s;
      const r1 = (10 + p * 34) * s;
      this.gl.seg(sx + Math.cos(a) * r0, sy - 14 * s + Math.sin(a) * r0 * 0.7,
        sx + Math.cos(a) * r1, sy - 14 * s + Math.sin(a) * r1 * 0.7,
        1.3 * s, [1, 1, 1, (1 - p) * 0.85]);
    }
  }

  drawEffectLocal(fx, sx, sy, s, t) {
    const p = fx.life / fx.maxLife;
    if (fx.type === 'ring') {
      const r = (fx.radius || 100) * 1.414 * ISO_X * s * (0.25 + p * 0.85);
      const ry = (fx.radius || 100) * 1.414 * ISO_Y * s * (0.25 + p * 0.85);
      this.gl.polyline(isoEllipse(sx, sy, r, ry), 2.4 * s * (1 - p), PAL.ink, true, false);
      this.gl.polyline(isoEllipse(sx, sy, r * 0.8, ry * 0.8), 1 * s, PAL.white30, true, false);
    } else if (fx.type === 'pulse') {
      const wave = (fx.timer || 0) / (fx.interval || 0.7);
      const rr = (fx.radius || 200);
      this.gl.polyline(isoEllipse(sx, sy, rr * 1.414 * ISO_X * s * (0.25 + wave * 0.75), rr * 1.414 * ISO_Y * s * (0.25 + wave * 0.75)),
        1.4 * s, PAL.white50, true, false);
      // frost shards fall
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + fx.x * 0.02;
        const d = rr * 0.8 * (0.3 + ((i * 37) % 10) / 10);
        const px = sx + Math.cos(a) * d * 1.414 * ISO_X * s;
        const py = sy + Math.sin(a) * d * 1.414 * ISO_Y * s - (1 - wave) * 40 * s;
        this.gl.seg(px - 2 * s, py - 8 * s, px + 2 * s, py + 2 * s, 1.2 * s, PAL.white50);
      }
    }
  }
}

export function isoEllipse(cx, cy, rx, ry) {
  const pts = [];
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * TAU;
    pts.push(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
  }
  return pts;
}

function drawMineArt(g, mine, sx, sy, s, t, world, team) {
  // rock mound with a timber-framed entrance
  const ink = PAL.inkDim;
  const lw = 1.5;
  const w = 74 * s, h = 40 * s;
  const pts = [
    sx - w * 0.55, sy + 8 * s,
    sx - w * 0.42, sy - h * 0.35,
    sx - w * 0.06, sy - h * 0.95,
    sx + w * 0.34, sy - h * 0.55,
    sx + w * 0.56, sy + 4 * s,
    sx + w * 0.2, sy + 16 * s,
    sx - w * 0.3, sy + 18 * s,
  ];
  g.polyline(pts, lw, ink, true, false);
  for (let i = 1; i < 5; i++) {
    g.tri(pts[0], pts[1], pts[i * 2], pts[i * 2 + 1], pts[i * 2 + 2], pts[i * 2 + 3], [0.075, 0.08, 0.09, 1]);
  }
  // cave mouth
  const mx = sx + 2 * s, my = sy + 2 * s;
  g.polyline([
    mx - 15 * s, my,
    mx - 15 * s, my - 20 * s,
    mx - 8 * s, my - 28 * s,
    mx + 8 * s, my - 28 * s,
    mx + 15 * s, my - 20 * s,
    mx + 15 * s, my,
  ], lw, PAL.inkSoft);
  g.polyline([
    mx - 12 * s, my - 1 * s,
    mx - 12 * s, my - 19 * s,
    mx - 6 * s, my - 25 * s,
    mx + 6 * s, my - 25 * s,
    mx + 12 * s, my - 19 * s,
    mx + 12 * s, my - 1 * s,
  ], lw * 0.9, PAL.inkFaint);
  // timber supports
  g.seg(mx - 17 * s, my - 22 * s, mx - 17 * s, my + 4 * s, 2.4 * s, ink);
  g.seg(mx + 17 * s, my - 22 * s, mx + 17 * s, my + 4 * s, 2.4 * s, ink);
  g.seg(mx - 20 * s, my - 24 * s, mx + 20 * s, my - 24 * s, 2.4 * s, ink);
  g.seg(mx - 17 * s, my - 12 * s, mx + 17 * s, my - 12 * s, 1 * s, PAL.inkFaint);
  // gold veins
  const glint = 0.4 + 0.2 * Math.sin(t * 2 + mine.id);
  g.seg(sx - 26 * s, sy - 8 * s, sx - 18 * s, sy - 16 * s, 2 * s, [1, 1, 1, glint]);
  g.seg(sx + 24 * s, sy - 6 * s, sx + 30 * s, sy - 14 * s, 2 * s, [1, 1, 1, glint * 0.8]);
  g.disc(sx - 20 * s, sy - 12 * s, 1.8 * s, [1, 1, 1, glint], 6);
  g.disc(sx + 27 * s, sy - 10 * s, 1.5 * s, [1, 1, 1, glint * 0.7], 6);
  // remaining gold
  const pct = mine.maxGold ? clamp(mine.gold / mine.maxGold, 0, 1) : 1;
  const bw = 34 * s;
  g.rect(sx - bw / 2, sy + 20 * s, bw, 2.6 * s, PAL.black60);
  g.rect(sx - bw / 2, sy + 20 * s, bw * pct, 2.6 * s, PAL.inkSoft);
}

export { drawFigure, drawIcon };
