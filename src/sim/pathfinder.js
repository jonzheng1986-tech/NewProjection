// Grid A* with octile movement, corner-cut prevention, path smoothing and a
// budgeted request queue so a big order doesn't stall the frame.

import { TILE, dist } from '../core/util.js';
import { FLAG } from './mapgen.js';

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(node, f) {
    const a = this.a;
    a.push({ node, f });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      const t = a[p]; a[p] = a[i]; a[i] = t;
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        const t = a[m]; a[m] = a[i]; a[i] = t;
        i = m;
      }
    }
    return top ? top.node : undefined;
  }
}

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.41421356], [1, -1, 1.41421356], [-1, 1, 1.41421356], [-1, -1, 1.41421356],
];

export class Pathfinder {
  constructor(width, height, flags) {
    this.w = width;
    this.h = height;
    this.flags = flags;
    this.g = new Float32Array(width * height);
    this.parent = new Int32Array(width * height);
    this.stamp = new Uint32Array(width * height);
    this.closed = new Uint32Array(width * height);
    this.gen = 0;
    this.requests = [];
    this.stats = { searched: 0, paths: 0 };
  }

  blocked(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return true;
    return (this.flags[ty * this.w + tx] & FLAG.BLOCK) !== 0;
  }

  nearestFree(tx, ty, maxR = 8) {
    if (!this.blocked(tx, ty)) return [tx, ty];
    for (let r = 1; r <= maxR; r++) {
      for (let oy = -r; oy <= r; oy++) {
        for (let ox = -r; ox <= r; ox++) {
          if (Math.abs(ox) !== r && Math.abs(oy) !== r) continue;
          const x = tx + ox, y = ty + oy;
          if (!this.blocked(x, y)) return [x, y];
        }
      }
    }
    return null;
  }

  // A* between world coordinates. Returns array of world-space waypoints.
  findPath(sx, sy, gx, gy, maxNodes = 6000) {
    const w = this.w, h = this.h;
    let stx = Math.floor(sx / TILE), sty = Math.floor(sy / TILE);
    let gtx = Math.floor(gx / TILE), gty = Math.floor(gy / TILE);
    if (stx < 0 || sty < 0 || stx >= w || sty >= h) return null;
    if (this.blocked(stx, sty)) {
      const f = this.nearestFree(stx, sty, 4);
      if (!f) return null;
      stx = f[0]; sty = f[1];
    }
    if (this.blocked(gtx, gty)) {
      const f = this.nearestFree(gtx, gty, 6);
      if (!f) return null;
      gtx = f[0]; gty = f[1];
    }
    if (stx === gtx && sty === gty) return [{ x: gx, y: gy }];

    const gen = ++this.gen;
    const startId = sty * w + stx;
    const goalId = gty * w + gtx;
    const open = new MinHeap();
    this.stamp[startId] = gen;
    this.g[startId] = 0;
    this.parent[startId] = -1;
    const heur = (x, y) => {
      const dx = Math.abs(x - gtx), dy = Math.abs(y - gty);
      return (dx + dy) + (1.41421356 - 2) * Math.min(dx, dy);
    };
    open.push(startId, heur(stx, sty));
    let searched = 0;
    let found = false;
    while (open.size) {
      const cur = open.pop();
      if (cur === goalId) { found = true; break; }
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      if (++searched > maxNodes) break;
      const cx = cur % w, cy = (cur / w) | 0;
      const cg = this.g[cur];
      for (let d = 0; d < 8; d++) {
        const [dx, dy, cost] = DIRS[d];
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nid = ny * w + nx;
        if (this.flags[nid] & FLAG.BLOCK) continue;
        if (dx !== 0 && dy !== 0) {
          // no corner cutting
          if (this.flags[cy * w + nx] & FLAG.BLOCK) continue;
          if (this.flags[ny * w + cx] & FLAG.BLOCK) continue;
        }
        if (this.closed[nid] === gen) continue;
        const ng = cg + cost;
        if (this.stamp[nid] !== gen || ng < this.g[nid]) {
          this.stamp[nid] = gen;
          this.g[nid] = ng;
          this.parent[nid] = cur;
          open.push(nid, ng + heur(nx, ny) * 1.05);
        }
      }
    }
    this.stats.searched += searched;
    if (!found) return null;
    this.stats.paths++;
    // reconstruct
    const tiles = [];
    let cur = goalId;
    let guard = 0;
    while (cur !== -1 && guard++ < 20000) {
      tiles.push(cur);
      if (cur === startId) break;
      cur = this.parent[cur];
    }
    tiles.reverse();
    const pts = tiles.map((id) => ({
      x: (id % w + 0.5) * TILE,
      y: (((id / w) | 0) + 0.5) * TILE,
    }));
    pts[pts.length - 1] = { x: gx, y: gy };
    return this.smooth(sx, sy, pts);
  }

  // Remove waypoints that are visible from the previous kept waypoint.
  smooth(sx, sy, pts) {
    if (pts.length <= 2) return pts;
    const out = [];
    let cx = sx, cy = sy;
    let i = 0;
    while (i < pts.length) {
      let best = i;
      for (let j = pts.length - 1; j > i; j--) {
        if (this.lineWalkable(cx, cy, pts[j].x, pts[j].y)) { best = j; break; }
      }
      out.push(pts[best]);
      cx = pts[best].x; cy = pts[best].y;
      i = best + 1;
    }
    return out;
  }

  lineWalkable(ax, ay, bx, by) {
    const d = dist(ax, ay, bx, by);
    const steps = Math.ceil(d / (TILE * 0.4));
    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps;
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
      if (this.blocked(Math.floor(x / TILE), Math.floor(y / TILE))) return false;
    }
    return true;
  }

  // budgeted request queue: call once per tick to service path requests
  request(entity, gx, gy) {
    entity._pathRequest = { x: gx, y: gy };
  }

  serviceQueue(units, budget = 3) {
    let done = 0;
    for (const u of units) {
      if (!u._pathRequest || done >= budget) continue;
      const { x, y } = u._pathRequest;
      u._pathRequest = null;
      const p = this.findPath(u.x, u.y, x, y);
      u.path = p || null;
      u.pathIndex = 0;
      u.pathGoal = { x, y };
      done++;
    }
  }
}
