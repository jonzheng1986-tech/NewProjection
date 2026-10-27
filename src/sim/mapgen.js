// Procedural, rotationally symmetric melee map generation.
// Terrain is a tile grid; blockers live in a flag grid used by pathfinding.

import { makeRng, TILE, dist, clamp } from '../core/util.js';
import { CAMP_TEMPLATES } from '../data/creeps.js';

export const TERRAIN = { GRASS: 0, DIRT: 1, ROCK: 2, WATER: 3, SNOW: 4 };
export const FLAG = { BLOCK: 1, WATER: 2, TREE: 4, MINE: 8, BUILDING: 16 };

export const MAP_SIZE = 80;

export function generateMap(seed = 1234, opts = {}) {
  const rng = makeRng(seed);
  const w = opts.width || MAP_SIZE;
  const h = opts.height || MAP_SIZE;
  const terrain = new Uint8Array(w * h);
  const flags = new Uint8Array(w * h);
  const idx = (x, y) => y * w + x;
  const inb = (x, y) => x >= 0 && y >= 0 && x < w && y < h;

  // ---- base terrain: grass with soft noise patches of dirt ----
  terrain.fill(TERRAIN.GRASS);
  for (let i = 0; i < 26; i++) {
    const cx = rng.range(6, w - 6), cy = rng.range(6, h - 6);
    const r = rng.range(3, 9);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const d = dist(x, y, cx, cy);
        if (d < r + rng.range(-0.6, 0.6)) terrain[idx(x, y)] = TERRAIN.DIRT;
      }
    }
  }
  // ---- outer rocky border ----
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) {
        terrain[idx(x, y)] = TERRAIN.ROCK;
        flags[idx(x, y)] |= FLAG.BLOCK;
      }
    }
  }

  // ---- important points (generated for one side, mirrored 180 degrees) ----
  const half = [];
  const sx = 13, sy = 13;
  half.push({ kind: 'start', x: sx, y: sy, r: 8 });
  half.push({ kind: 'mine', x: sx + 1, y: sy + 7, amount: 14000, natural: true, r: 5 });
  half.push({ kind: 'mine', x: 32, y: 12, amount: 9000, natural: false, unit: 'forest_troll', r: 5 });
  half.push({ kind: 'mine', x: 11, y: 38, amount: 9000, natural: false, unit: 'ogre_warrior', r: 5 });
  half.push({ kind: 'mine', x: 43, y: 30, amount: 11000, natural: false, unit: 'troll_shaman', r: 5 });

  const mirror = (p) => ({ ...p, x: w - 1 - p.x, y: h - 1 - p.y });
  const points = [];
  for (const p of half) {
    points.push(p);
    if (p.kind !== 'start' || true) {
      const m = mirror(p);
      if (p.kind === 'mine') m.unit = p.unit;
      points.push(m);
    }
  }

  // Camp sites are picked procedurally so nothing ever spawns on top of a main
  // base or the starting gold mine.
  const camps = [];
  const addCamp = (tx, ty, template) => {
    camps.push({ x: tx, y: ty, template });
  };
  const startsAll = points.filter((p) => p.kind === 'start');
  const startMines = points.filter((p) => p.kind === 'mine' && p.natural);
  const expansionMines = points.filter((p) => p.kind === 'mine' && !p.natural);
  const farFromBases = (x, y) => {
    // camps must not sit in a player's opening build area
    for (const s of startsAll) if (dist(x, y, s.x, s.y) < 30) return false;
    for (const m of startMines) if (dist(x, y, m.x, m.y) < 24) return false;
    for (const m of expansionMines) if (dist(x, y, m.x, m.y) < 7) return false;
    return true;
  };
  const campRng = makeRng(seed * 101 + 17);
  const usedSites = [];
  const candidates = [];
  for (let y = 8; y < h - 8; y += 3) {
    for (let x = 8; x < w - 8; x += 3) {
      if (!farFromBases(x, y)) continue;
      if (x > w / 2 - 2 && x < w / 2 + 2 && y > h / 2 - 2 && y < h / 2 + 2) continue;
      candidates.push({ x, y });
    }
  }
  campRng.shuffle(candidates);
  const desiredPairs = 7;
  let placedPairs = 0;
  for (const c of candidates) {
    if (placedPairs >= desiredPairs) break;
    if (Math.abs(c.x - (w - 1 - c.y)) < 1) continue;
    let ok = true;
    for (const u of usedSites) if (dist(c.x, c.y, u.x, u.y) < 9) { ok = false; break; }
    if (!ok) continue;
    const mx = w - 1 - c.x, my = h - 1 - c.y;
    for (const u of usedSites) if (dist(mx, my, u.x, u.y) < 9) { ok = false; break; }
    if (!ok) continue;
    // tier rises towards the middle of the map
    const centreDist = dist(c.x, c.y, w / 2, h / 2);
    const tierIdx = centreDist > 22 ? 1 : centreDist > 15 ? 3 : centreDist > 9 ? 5 : 7;
    const template = CAMP_TEMPLATES[tierIdx];
    addCamp(c.x, c.y, template);
    addCamp(mx, my, template);
    usedSites.push({ x: c.x, y: c.y }, { x: mx, y: my });
    placedPairs++;
  }
  // boss camp in the very middle
  addCamp(Math.floor(w / 2), Math.floor(h / 2), CAMP_TEMPLATES[8]);

  // ---- carving: keep the bases, roads and camp arenas clear ----
  const clearCircle = (cx, cy, r, newTerrain) => {
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, Math.ceil(cx + r)); x++) {
        if (dist(x, y, cx, cy) <= r) {
          if (newTerrain !== undefined) terrain[idx(x, y)] = newTerrain;
          flags[idx(x, y)] = 0;
        }
      }
    }
  };

  for (const p of points) {
    if (p.kind === 'start') clearCircle(p.x, p.y, 8.5, TERRAIN.DIRT);
    if (p.kind === 'mine') clearCircle(p.x, p.y, 4.5, TERRAIN.DIRT);
  }
  for (const c of camps) clearCircle(c.x, c.y, 4, TERRAIN.DIRT);

  // roads: start -> start, start -> each mine, start -> centre
  const roadLines = [];
  const start0 = points.find((p) => p.kind === 'start' && p.x < w / 2);
  const start1 = points.find((p) => p.kind === 'start' && p.x > w / 2);
  roadLines.push([start0, start1]);
  for (const p of points) {
    if (p.kind === 'mine') roadLines.push([p.x < w / 2 ? start0 : start1, p]);
  }
  roadLines.push([start0, { x: w / 2, y: h / 2 }]);
  roadLines.push([start1, { x: w / 2, y: h / 2 }]);
  for (const [a, b] of roadLines) {
    const steps = Math.ceil(dist(a.x, a.y, b.x, b.y) * 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = a.x + (b.x - a.x) * t + Math.sin(t * 8 + seed) * 0.8;
      const y = a.y + (b.y - a.y) * t + Math.cos(t * 7 + seed) * 0.8;
      for (let oy = -2; oy <= 2; oy++) {
        for (let ox = -2; ox <= 2; ox++) {
          if (ox * ox + oy * oy > 5) continue;
          const tx = Math.round(x + ox), ty = Math.round(y + oy);
          if (!inb(tx, ty)) continue;
          if (tx < 3 || ty < 3 || tx >= w - 3 || ty >= h - 3) continue;
          if (terrain[idx(tx, ty)] === TERRAIN.WATER) terrain[idx(tx, ty)] = TERRAIN.DIRT;
          if (terrain[idx(tx, ty)] !== TERRAIN.ROCK) terrain[idx(tx, ty)] = TERRAIN.DIRT;
          flags[idx(tx, ty)] = 0;
        }
      }
    }
  }

  // ponds
  const ponds = [[30, 26, 4.5], [50, 54, 4.5], [24, 60, 5], [56, 20, 5], [40, 18, 3.5], [40, 62, 3.5]];
  for (const [px, py, pr] of ponds) {
    const jitter = makeRng(seed * 7 + px * 13 + py);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const d = dist(x, y, px, py) + jitter.range(-0.9, 0.9);
        if (d < pr) {
          terrain[idx(x, y)] = TERRAIN.WATER;
          flags[idx(x, y)] |= FLAG.WATER | FLAG.BLOCK;
        }
      }
    }
  }

  // ---- trees: clusters in open ground ----
  const treeAvoid = [];
  for (const p of points) treeAvoid.push({ x: p.x, y: p.y, r: p.kind === 'start' ? 11 : 6 });
  for (const c of camps) treeAvoid.push({ x: c.x, y: c.y, r: 5.5 });
  const trees = [];
  const treeRng = makeRng(seed * 31 + 7);
  const clusters = 34;
  for (let c = 0; c < clusters; c++) {
    const cx = treeRng.range(4, w - 4), cy = treeRng.range(4, h - 4);
    const count = treeRng.int(6, 22);
    const spread = treeRng.range(2, 4.5);
    for (let i = 0; i < count; i++) {
      const tx = Math.round(cx + treeRng.range(-spread, spread));
      const ty = Math.round(cy + treeRng.range(-spread, spread));
      if (!inb(tx, ty) || tx < 3 || ty < 3 || tx >= w - 3 || ty >= h - 3) continue;
      const id = idx(tx, ty);
      if (flags[id] & (FLAG.BLOCK | FLAG.WATER)) continue;
      if (terrain[id] === TERRAIN.WATER) continue;
      let ok = true;
      for (const a of treeAvoid) {
        if (dist(tx, ty, a.x, a.y) < a.r) { ok = false; break; }
      }
      if (!ok) continue;
      trees.push({ tx, ty, size: treeRng.range(0.8, 1.35) });
      flags[id] |= FLAG.BLOCK | FLAG.TREE;
    }
  }

  // border trees to frame the battlefield
  for (let y = 3; y < h - 3; y++) {
    for (let x = 3; x < w - 3; x++) {
      const edge = Math.min(x - 3, y - 3, w - 4 - x, h - 4 - y);
      if (edge > 1) continue;
      const id = idx(x, y);
      if (flags[id] & FLAG.BLOCK) continue;
      const r = makeRng(seed + x * 977 + y * 31);
      if (r.chance(0.5)) {
        trees.push({ tx: x, ty: y, size: r.range(0.9, 1.4) });
        flags[id] |= FLAG.BLOCK | FLAG.TREE;
      }
    }
  }

  // ---- gold mines ----
  const mines = points.filter((p) => p.kind === 'mine').map((p) => ({
    tx: p.x, ty: p.y, amount: p.amount, natural: p.natural, unit: p.unit || null,
  }));
  for (const m of mines) {
    // mark a 2x2 footprint as blocked / mine
    for (let oy = 0; oy < 2; oy++) {
      for (let ox = 0; ox < 2; ox++) {
        const id = idx(m.tx + ox, m.ty + oy);
        if (inb(m.tx + ox, m.ty + oy)) flags[id] |= FLAG.BLOCK | FLAG.MINE;
      }
    }
    terrain[idx(m.tx, m.ty)] = TERRAIN.DIRT;
  }

  // ---- validate connectivity; carve corridors if needed ----
  const openTiles = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!(flags[idx(x, y)] & FLAG.BLOCK)) openTiles.push([x, y]);
  const reachable = floodFill(flags, w, h, start0.x, start0.y);
  const ensureReachable = (targetX, targetY) => {
    if (reachable[idx(targetX, targetY)]) return;
    // carve a straight corridor from the target to the nearest reachable tile
    let best = null, bestD = Infinity;
    for (const [x, y] of openTiles) {
      if (!reachable[idx(x, y)]) continue;
      const d = dist(x, y, targetX, targetY);
      if (d < bestD) { bestD = d; best = [x, y]; }
    }
    if (!best) return;
    carveCorridor(flags, terrain, idx, w, h, targetX, targetY, best[0], best[1]);
  };
  ensureReachable(start1.x, start1.y);
  for (const m of mines) {
    // target an adjacent walkable tile
    ensureReachableNeighbour(flags, idx, w, h, reachable, m.tx, m.ty);
  }
  for (const c of camps) ensureReachable(c.x, c.y);

  return {
    width: w, height: h, terrain, flags, points, mines, camps, trees,
    starts: [
      { tx: points.find((p) => p.kind === 'start' && p.x < w / 2).x, ty: points.find((p) => p.kind === 'start' && p.x < w / 2).y },
      { tx: points.find((p) => p.kind === 'start' && p.x > w / 2).x, ty: points.find((p) => p.kind === 'start' && p.x > w / 2).y },
    ],
    worldWidth: w * TILE, worldHeight: h * TILE,
  };
}

function floodFill(flags, w, h, sx, sy) {
  const seen = new Uint8Array(w * h);
  const stack = [sy * w + sx];
  seen[sy * w + sx] = 1;
  while (stack.length) {
    const id = stack.pop();
    const x = id % w, y = (id / w) | 0;
    const push = (nx, ny) => {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
      const nid = ny * w + nx;
      if (seen[nid] || (flags[nid] & FLAG.BLOCK)) return;
      seen[nid] = 1;
      stack.push(nid);
    };
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
  return seen;
}

function nearestFree(flags, idx, w, h, tx, ty) {
  for (let r = 0; r < 6; r++) {
    for (let oy = -r; oy <= r; oy++) {
      for (let ox = -r; ox <= r; ox++) {
        const x = tx + ox, y = ty + oy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        if (!(flags[idx(x, y)] & FLAG.BLOCK)) return [x, y];
      }
    }
  }
  return null;
}

function ensureReachableNeighbour(flags, idx, w, h, reachable, tx, ty) {
  // find any walkable neighbour of the mine footprint
  for (let oy = -1; oy <= 2; oy++) {
    for (let ox = -1; ox <= 2; ox++) {
      const x = tx + ox, y = ty + oy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      if (flags[idx(x, y)] & FLAG.BLOCK) continue;
      if (reachable[idx(x, y)]) return;
    }
  }
  const free = nearestFree(flags, idx, w, h, tx - 2, ty - 2);
  if (!free) return;
  let best = null, bestD = Infinity;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!reachable[idx(x, y)]) continue;
      const d = dist(x, y, free[0], free[1]);
      if (d < bestD) { bestD = d; best = [x, y]; }
    }
  }
  if (best) carveCorridor(flags, null, idx, w, h, free[0], free[1], best[0], best[1]);
}

function carveCorridor(flags, terrain, idx, w, h, ax, ay, bx, by) {
  const steps = Math.ceil(dist(ax, ay, bx, by) * 2);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(ax + (bx - ax) * t);
    const y = Math.round(ay + (by - ay) * t);
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const nx = x + ox, ny = y + oy;
        if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= h - 1) continue;
        flags[idx(nx, ny)] &= ~(FLAG.BLOCK | FLAG.TREE | FLAG.WATER);
        if (terrain) terrain[idx(nx, ny)] = TERRAIN.DIRT;
      }
    }
  }
}

// Simple deterministic spawn point picker around a base, used when placing
// starting buildings so they never overlap terrain blockers.
export function findFreeSpot(flags, w, h, cx, cy, r, tries = 200) {
  const idx = (x, y) => y * w + x;
  for (let i = 0; i < tries; i++) {
    const a = (i / tries) * Math.PI * 2;
    const rad = r + (i % 5);
    const x = Math.round(cx + Math.cos(a) * rad);
    const y = Math.round(cy + Math.sin(a) * rad);
    if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) continue;
    if (!(flags[idx(x, y)] & FLAG.BLOCK)) return [x, y];
  }
  return [cx, cy];
}
