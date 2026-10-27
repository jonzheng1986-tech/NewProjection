// Core math / helper utilities. Pure functions, no DOM, no WebGL, so the
// simulation can be exercised headlessly from Node.

export const TAU = Math.PI * 2;
export const TILE = 32;                 // world units per terrain tile
export const ISO_X = 0.8660254037844386; // cos(30)
export const ISO_Y = 0.5;                // sin(30)

// ---------- scalar helpers ----------
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const sign = (v) => (v < 0 ? -1 : v > 0 ? 1 : 0);
export const sq = (v) => v * v;

export function hypot2(dx, dy) { return Math.sqrt(dx * dx + dy * dy); }

export function dist(ax, ay, bx, by) { return hypot2(bx - ax, by - ay); }

export function dist2(ax, ay, bx, by) { return sq(bx - ax) + sq(by - ay); }

export function normalize(dx, dy) {
  const l = hypot2(dx, dy);
  if (l < 1e-6) return [0, 0];
  return [dx / l, dy / l];
}

export function angleTo(ax, ay, bx, by) { return Math.atan2(by - ay, bx - ax); }

// shortest signed angular difference
export function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function approach(current, goal, maxDelta) {
  if (current < goal) return Math.min(current + maxDelta, goal);
  return Math.max(current - maxDelta, goal);
}

export function circleOverlap(ax, ay, ar, bx, by, br) {
  const r = ar + br;
  return dist2(ax, ay, bx, by) < r * r;
}

export function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function rectContains(x, y, rx, ry, rw, rh) {
  return x >= rx && y >= ry && x <= rx + rw && y <= ry + rh;
}

// ISO projection: world (x,y) -> screen-ish plane coordinates. Camera and
// zoom are applied later by the renderer.
export function isoX(x, y) { return (x - y) * ISO_X; }
export function isoY(x, y) { return (x + y) * ISO_Y; }

// inverse of the projection above (used for mouse picking on the ground plane)
export function unIsoX(sx, sy) { return sx / (2 * ISO_X) + sy / (2 * ISO_Y); }
export function unIsoY(sx, sy) { return -sx / (2 * ISO_X) + sy / (2 * ISO_Y); }

// ---------- deterministic RNG (mulberry32) ----------
export function makeRng(seed) {
  let a = seed >>> 0;
  const rng = function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.range = (lo, hi) => lo + (hi - lo) * rng();
  rng.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * rng());
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length) % arr.length];
  rng.chance = (p) => rng() < p;
  rng.shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  };
  return rng;
}

// Stable hash for per-entity art variation.
export function hash01(n) {
  let x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

// simple id generator
let _nextId = 1;
export function newId() { return _nextId++; }
export function setIdCounter(n) { _nextId = n; }

// ---------- formatting ----------
export function fmtTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtNum(n) {
  if (n === undefined || n === null) return '0';
  return String(Math.round(n));
}

// Roman numerals for ability levels / upgrade levels
export function roman(n) {
  return ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n] || String(n);
}

// WC3 armour damage reduction / amplification.
export function armorMultiplier(armor) {
  if (armor >= 0) {
    const a = armor * 0.06;
    return 1 - a / (1 + a);
  }
  return 2 - Math.pow(0.94, -armor);
}

// grid helpers
export function inBounds(gw, gh, tx, ty) { return tx >= 0 && ty >= 0 && tx < gw && ty < gh; }

export function tileIndex(gw, tx, ty) { return ty * gw + tx; }

export function forEachTileInCircle(cx, cy, r, gw, gh, fn) {
  const minx = Math.max(0, Math.floor((cx - r) / TILE));
  const maxx = Math.min(gw - 1, Math.floor((cx + r) / TILE));
  const miny = Math.max(0, Math.floor((cy - r) / TILE));
  const maxy = Math.min(gh - 1, Math.floor((cy + r) / TILE));
  const r2 = r * r;
  for (let ty = miny; ty <= maxy; ty++) {
    const wy = (ty + 0.5) * TILE;
    for (let tx = minx; tx <= maxx; tx++) {
      const wx = (tx + 0.5) * TILE;
      if (dist2(wx, wy, cx, cy) <= r2) fn(tx, ty);
    }
  }
}

export function shuffleWithRng(arr, rng) { return rng.shuffle(arr); }

// Deep-ish clone used for data templates
export function clone(o) { return JSON.parse(JSON.stringify(o)); }

// Debug-only logger that never throws in odd environments
export function logOnce(key, ...args) {
  logOnce._seen = logOnce._seen || new Set();
  if (logOnce._seen.has(key)) return;
  logOnce._seen.add(key);
  // eslint-disable-next-line no-console
  console.log(...args);
}
