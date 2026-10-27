// Fog of war. Per team we track a 0/1/2 state grid (unexplored / explored / visible)
// plus a dirty flag the renderer uses to re-upload its texture.

import { TILE, dist2 } from '../core/util.js';

export const FOG_NONE = 0;
export const FOG_EXPLORED = 1;
export const FOG_VISIBLE = 2;

export class FogOfWar {
  constructor(width, height, teams = [0, 1]) {
    this.w = width;
    this.h = height;
    this.teams = {};
    for (const t of teams) {
      this.teams[t] = {
        state: new Uint8Array(width * height),
        visible: new Uint8Array(width * height),
        explored: new Uint8Array(width * height),
        dirty: true,
        version: 0,
      };
    }
    this.visibleCount = new Int16Array(width * height);
    this.accumulator = 0;
  }

  clearVisible(team) {
    const t = this.teams[team];
    if (!t) return;
    t.visible.fill(0);
  }

  stamp(team, wx, wy, radius) {
    const t = this.teams[team];
    if (!t) return;
    const w = this.w, h = this.h;
    const minx = Math.max(0, Math.floor((wx - radius) / TILE));
    const maxx = Math.min(w - 1, Math.floor((wx + radius) / TILE));
    const miny = Math.max(0, Math.floor((wy - radius) / TILE));
    const maxy = Math.min(h - 1, Math.floor((wy + radius) / TILE));
    const r2 = radius * radius;
    for (let ty = miny; ty <= maxy; ty++) {
      for (let tx = minx; tx <= maxx; tx++) {
        const cx = (tx + 0.5) * TILE, cy = (ty + 0.5) * TILE;
        if (dist2(cx, cy, wx, wy) <= r2) {
          const id = ty * w + tx;
          t.visible[id] = 1;
          t.explored[id] = 1;
        }
      }
    }
  }

  recompute(team, sources) {
    const t = this.teams[team];
    if (!t) return;
    t.visible.fill(0);
    for (const s of sources) {
      if (s.dead) continue;
      this.stamp(team, s.x, s.y, s.sight || 500);
    }
    const n = this.w * this.h;
    const state = t.state;
    let changed = false;
    for (let i = 0; i < n; i++) {
      const v = t.visible[i] ? FOG_VISIBLE : t.explored[i] ? FOG_EXPLORED : FOG_NONE;
      if (state[i] !== v) { state[i] = v; changed = true; }
    }
    if (changed) { t.dirty = true; t.version++; }
  }

  stateAt(team, wx, wy) {
    const t = this.teams[team];
    if (!t) return FOG_VISIBLE;
    const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE);
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return FOG_NONE;
    return t.state[ty * this.w + tx];
  }

  isVisible(team, wx, wy) { return this.stateAt(team, wx, wy) === FOG_VISIBLE; }
  isExplored(team, wx, wy) { return this.stateAt(team, wx, wy) >= FOG_EXPLORED; }

  takeDirty(team) {
    const t = this.teams[team];
    if (!t || !t.dirty) return null;
    t.dirty = false;
    return t.state;
  }

  // Order-independent merge used when the minimap wants a combined view.
  combinedState() {
    const n = this.w * this.h;
    const out = new Uint8Array(n);
    for (const k of Object.keys(this.teams)) {
      const s = this.teams[k].state;
      for (let i = 0; i < n; i++) if (s[i] > out[i]) out[i] = s[i];
    }
    return out;
  }
}
