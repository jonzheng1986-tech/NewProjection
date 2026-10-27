// Static terrain mesh. World-space triangles with per-vertex colour; the
// terrain shader applies the isometric projection and the fog texture.

import { TILE, makeRng } from '../core/util.js';
import { TERRAIN, FLAG } from '../sim/mapgen.js';

const C = {
  grass: [0.078, 0.085, 0.094],
  grassAlt: [0.068, 0.074, 0.083],
  dirt: [0.096, 0.094, 0.090],
  dirtAlt: [0.085, 0.083, 0.080],
  rock: [0.112, 0.117, 0.124],
  rockAlt: [0.094, 0.099, 0.106],
  water: [0.049, 0.060, 0.072],
  waterDeep: [0.040, 0.050, 0.062],
  deco: [0.58, 0.62, 0.66, 0.5],
  decoSoft: [0.42, 0.46, 0.50, 0.4],
  grid: [0.32, 0.35, 0.38, 0.10],
  rockEdge: [0.62, 0.66, 0.70, 0.55],
};

export function buildTerrainMesh(map) {
  const { width: w, height: h, terrain, flags } = map;
  const verts = [];
  const push = (x, y, c, a = 1) => verts.push(x, y, c[0], c[1], c[2], a);

  const tri = (x1, y1, x2, y2, x3, y3, c, a) => {
    push(x1, y1, c, a); push(x2, y2, c, a); push(x3, y3, c, a);
  };

  const quad = (x1, y1, x2, y2, x3, y3, x4, y4, c, a) => {
    push(x1, y1, c, a); push(x2, y2, c, a); push(x3, y3, c, a);
    push(x1, y1, c, a); push(x3, y3, c, a); push(x4, y4, c, a);
  };

  // world-space line as a quad (width is in world units)
  const line = (ax, ay, bx, by, lw, c, a = 1) => {
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return;
    const nx = (-dy / len) * lw * 0.5, ny = (dx / len) * lw * 0.5;
    quad(ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny, ax - nx, ay - ny, c, a);
  };

  const rng = makeRng(9182);
  const hash = (x, y) => {
    let n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return n - Math.floor(n);
  };

  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const i = ty * w + tx;
      const t = terrain[i];
      const f = flags[i];
      const x0 = tx * TILE, y0 = ty * TILE;
      const x1 = x0 + TILE, y1 = y0 + TILE;
      const hsh = hash(tx, ty);
      let base, alt;
      if (t === TERRAIN.WATER) { base = C.water; alt = C.waterDeep; }
      else if (t === TERRAIN.ROCK) { base = C.rock; alt = C.rockAlt; }
      else if (t === TERRAIN.DIRT) { base = C.dirt; alt = C.dirtAlt; }
      else { base = C.grass; alt = C.grassAlt; }
      const col = hsh > 0.5 ? base : alt;
      // two-triangle tile
      const shade = 0.92 + hsh * 0.16;
      const cc = [col[0] * shade, col[1] * shade, col[2] * shade];
      tri(x0, y0, x1, y0, x1, y1, cc);
      tri(x0, y0, x1, y1, x0, y1, cc);

      // faint tile seams on a subset of tiles for texture
      if (hsh > 0.82) {
        line(x0, y0, x1, y0, 0.6, C.grid);
        line(x0, y1, x1, y1, 0.6, C.grid);
      }

      // --- decorations -----------------------------------------------------
      if (t === TERRAIN.GRASS && hsh > 0.35) {
        const n = 1 + Math.floor(hsh * 3);
        for (let k = 0; k < n; k++) {
          const px = x0 + 4 + rng() * (TILE - 8);
          const py = y0 + 5 + rng() * (TILE - 10);
          const gh = 3 + rng() * 4;
          line(px, py, px - 1.2, py - gh, 0.7, C.deco, 0.33);
          line(px, py, px + 1.2, py - gh * 0.8, 0.7, C.deco, 0.28);
        }
      } else if (t === TERRAIN.DIRT) {
        if (hsh > 0.55) {
          for (let k = 0; k < 2; k++) {
            const px = x0 + 5 + rng() * (TILE - 10);
            const py = y0 + 5 + rng() * (TILE - 10);
            line(px, py, px + 2.5, py + 0.6, 0.7, C.decoSoft, 0.3);
          }
        }
      } else if (t === TERRAIN.ROCK) {
        if (hsh > 0.4) {
          const px = x0 + 6 + rng() * (TILE - 12);
          const py = y0 + 6 + rng() * (TILE - 12);
          line(px, py, px + 4, py + 3, 1.0, C.rockEdge, 0.35);
          line(px + 4, py + 3, px + 3, py + 7, 1.0, C.rockEdge, 0.28);
        }
      } else if (t === TERRAIN.WATER) {
        const n = 1 + Math.floor(hsh * 2);
        for (let k = 0; k < n; k++) {
          const px = x0 + 5 + rng() * (TILE - 12);
          const py = y0 + 6 + rng() * (TILE - 12);
          const len = 6 + rng() * 8;
          const pts = [];
          for (let s = 0; s <= 4; s++) {
            pts.push([px + (s / 4) * len, py + Math.sin(s * 1.7 + tx) * 1.2]);
          }
          for (let s = 0; s < 4; s++) {
            line(pts[s][0], pts[s][1], pts[s + 1][0], pts[s + 1][1], 0.7, C.deco, 0.18);
          }
        }
      }
      // blocked rock border highlight
      if (f & FLAG.BLOCK && t === TERRAIN.ROCK) {
        line(x0, y0, x1, y0, 1.0, C.rockEdge, 0.10);
      }
    }
  }
  return { verts: new Float32Array(verts), count: verts.length / 6 };
}
