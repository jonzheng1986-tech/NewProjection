// Procedural monochrome line art: stick-figure units, isometric buildings,
// trees, mines, items, effects and UI icons. Everything is drawn with the
// immediate-mode primitives of GLRenderer in screen space.

import { PAL } from './palette.js';
import { ISO_X, ISO_Y, TILE, clamp } from '../core/util.js';
import { ITEMS } from '../data/items.js';

const TAU = Math.PI * 2;
const inkA = (c, a) => [c[0], c[1], c[2], a === undefined ? c[3] : a];

// ------------------------------------------------------------------ helpers
export function isoEllipsePts(cx, cy, rx, ry, segments = 26, rot = 0) {
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * TAU + rot;
    pts.push(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
  }
  return pts;
}

export function groundEllipse(g, cx, cy, r, s, lw, c, dash = 0, gap = 0) {
  const rx = r * 1.41421356 * ISO_X * s;
  const ry = r * 1.41421356 * ISO_Y * s;
  if (dash > 0) {
    const pts = isoEllipsePts(cx, cy, rx, ry, 40);
    let acc = 0;
    for (let i = 0; i < 40; i++) {
      const j = (i + 1) % 40;
      const x1 = pts[i * 2], y1 = pts[i * 2 + 1], x2 = pts[j * 2], y2 = pts[j * 2 + 1];
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len < 1e-4) continue;
      if (acc < dash) {
        g.seg(x1, y1, x2, y2, lw, c);
        acc += len;
      } else {
        acc += len;
        if (acc > dash + gap) acc = 0;
      }
    }
  } else {
    g.polyline(isoEllipsePts(cx, cy, rx, ry, 26), lw, c, true, false);
  }
}

function ellipsePts(cx, cy, rx, ry, segments = 24, rot = 0) {
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * TAU + rot;
    pts.push(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
  }
  return pts;
}

function arcPts(cx, cy, r, a0, a1, segments = 10) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const a = a0 + (a1 - a0) * (i / segments);
    pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return pts;
}

function hatch(g, x, y, w, h, step, lw, c, angle = 1) {
  // simple diagonal hatching clipped to a rect
  const len = Math.hypot(w, h);
  for (let t = -h; t < w; t += step) {
    const x1 = x + t, y1 = y + h;
    const x2 = x + t + h * angle, y2 = y;
    g.seg(clamp(x1, x, x + w), y1 - Math.max(0, x - x1), clamp(x2, x, x + w),
      y2 + Math.max(0, x2 - (x + w)), lw, c);
  }
}

function bracket(g, x, y, w, h, c, len = 6, lw = 1.5) {
  g.seg(x, y, x + len, y, lw, c);
  g.seg(x, y, x, y + len, lw, c);
  g.seg(x + w - len, y, x + w, y, lw, c);
  g.seg(x + w, y, x + w, y + len, lw, c);
  g.seg(x, y + h - len, x, y + h, lw, c);
  g.seg(x, y + h, x + len, y + h, lw, c);
  g.seg(x + w - len, y + h, x + w, y + h, lw, c);
  g.seg(x + w, y + h - len, x + w, y + h, lw, c);
}

// ------------------------------------------------------------------ units
function weapon(g, kind, x, y, H, lw, ink, t, attacking) {
  const swing = attacking ? Math.sin(t * 18) * 0.5 : 0;
  switch (kind) {
    case 'sword': {
      const a = -0.9 + swing;
      const len = H * 0.42;
      const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
      g.seg(x, y, ex, ey, lw, ink);
      const px = Math.cos(a + Math.PI / 2) * H * 0.055, py = Math.sin(a + Math.PI / 2) * H * 0.055;
      g.seg(x - px, y - py, x + px, y + py, lw, ink);
      g.seg(ex, ey, ex + Math.cos(a) * H * 0.04, ey + Math.sin(a) * H * 0.04, lw * 0.8, ink);
      break;
    }
    case 'pick': {
      g.seg(x, y, x + H * 0.20, y - H * 0.10, lw, ink);
      g.polyline(arcPts(x + H * 0.20, y - H * 0.10, H * 0.09, -1.1, 1.1, 6), lw, ink);
      break;
    }
    case 'gun': {
      g.seg(x - H * 0.04, y, x + H * 0.36, y - H * 0.03, lw * 1.3, ink);
      g.seg(x - H * 0.04, y, x - H * 0.06, y + H * 0.08, lw, ink);
      break;
    }
    case 'staff': {
      g.seg(x, y + H * 0.10, x, y - H * 0.34, lw, ink);
      g.ring(x, y - H * 0.38, H * 0.045, lw * 0.8, ink, 10);
      break;
    }
    case 'hammer': {
      g.seg(x, y, x + H * 0.22, y - H * 0.16, lw, ink);
      g.seg(x + H * 0.17, y - H * 0.234, x + H * 0.28, y - H * 0.09, lw * 2.2, ink);
      break;
    }
    case 'cannon': {
      g.seg(x - H * 0.10, y + H * 0.04, x + H * 0.26, y - H * 0.12, lw * 2.6, ink);
      g.ring(x - H * 0.02, y + H * 0.13, H * 0.055, lw * 0.8, ink, 10);
      break;
    }
    case 'club': {
      g.seg(x, y, x + H * 0.20, y - H * 0.16, lw * 1.6, ink);
      g.disc(x + H * 0.22, y - H * 0.18, H * 0.045, ink, 8);
      break;
    }
    case 'spear': {
      g.seg(x - H * 0.08, y + H * 0.06, x + H * 0.34, y - H * 0.24, lw, ink);
      g.tri(x + H * 0.34, y - H * 0.24, x + H * 0.28, y - H * 0.20, x + H * 0.31, y - H * 0.14, ink);
      break;
    }
    case 'claw': {
      for (let i = -1; i <= 1; i++) {
        g.seg(x, y, x + H * 0.18, y + H * 0.10 * i, lw, ink);
      }
      break;
    }
    default: break;
  }
}

function headHat(g, hat, x, y, r, H, lw, ink) {
  switch (hat) {
    case 'straw':
      g.polyline(arcPts(x, y, r * 2.1, Math.PI * 0.05, Math.PI * 0.95, 8), lw * 0.9, ink);
      g.polyline(arcPts(x, y - r * 0.2, r * 0.9, Math.PI, TAU, 6), lw * 0.9, ink);
      break;
    case 'wizard':
      g.polyline(arcPts(x, y, r * 1.55, Math.PI * 0.02, Math.PI * 0.98, 8), lw, ink);
      g.seg(x - r * 1.5, y, x, y - r * 2.9, lw, ink);
      g.seg(x + r * 1.5, y, x, y - r * 2.9, lw, ink);
      g.ring(x, y - r * 0.2, r * 0.35, lw * 0.7, ink, 8);
      break;
    case 'hood':
      g.polyline([x - r * 1.25, y + r * 0.5, x - r * 0.5, y - r * 1.35, x + r * 0.6, y - r * 1.3, x + r * 1.2, y + r * 0.4], lw, ink);
      break;
    case 'horned':
      g.polyline(arcPts(x, y, r * 1.25, Math.PI, TAU, 8), lw, ink);
      g.polyline(arcPts(x - r * 0.8, y - r * 0.2, r * 0.75, Math.PI * 0.9, Math.PI * 1.9, 5), lw, ink);
      g.polyline(arcPts(x + r * 0.8, y - r * 0.2, r * 0.75, Math.PI * 1.1, Math.PI * 0.1, 5), lw, ink);
      break;
    case 'helm':
      g.polyline(arcPts(x, y, r * 1.12, Math.PI * 0.95, Math.PI * 2.05, 8), lw, ink);
      g.seg(x - r * 0.5, y + r * 0.25, x + r * 0.5, y + r * 0.25, lw * 0.8, ink);
      break;
    case 'candle':
      g.seg(x, y - r, x, y - r * 2.1, lw * 0.8, ink);
      g.ring(x, y - r * 2.5, r * 0.3, lw * 0.7, ink, 6);
      break;
    case 'mane':
      for (let i = -2; i <= 2; i++) {
        g.seg(x + i * r * 0.45, y - r * 0.8, x + i * r * 0.7, y - r * 1.7, lw * 0.8, ink);
      }
      break;
    case 'troll':
      g.seg(x - r * 0.6, y - r * 0.4, x - r * 0.9, y - r * 1.4, lw, ink);
      g.seg(x + r * 0.6, y - r * 0.4, x + r * 0.9, y - r * 1.4, lw, ink);
      g.seg(x - r * 0.35, y + r * 0.75, x - r * 0.2, y + r * 0.2, lw * 0.7, ink);
      g.seg(x + r * 0.35, y + r * 0.75, x + r * 0.2, y + r * 0.2, lw * 0.7, ink);
      break;
    case 'ogre':
      g.seg(x - r * 0.5, y - r * 0.6, x - r * 0.9, y - r * 1.8, lw, ink);
      g.seg(x + r * 0.5, y - r * 0.6, x + r * 0.9, y - r * 1.8, lw, ink);
      break;
    case 'horns':
      g.polyline(arcPts(x - r * 0.6, y - r * 0.4, r * 0.8, Math.PI * 0.6, Math.PI * 1.8, 5), lw * 1.2, ink);
      g.polyline(arcPts(x + r * 0.6, y - r * 0.4, r * 0.8, Math.PI * 1.2, Math.PI * 0.4, 5), lw * 1.2, ink);
      break;
    default: break;
  }
}

export function drawFigure(g, x, y, s, o) {
  const ink = o.ink;
  const lw = (o.lw || 1.5) * s;
  const bulk = o.bulk || 1;
  const H = 38 * s * bulk;
  const t = o.t || 0;
  const walking = !!o.moving;
  const swing = walking ? Math.sin(o.phase || t * 9) : 0;
  const attacking = !!o.attacking;
  const hipY = y - H * 0.44;
  const shoulderY = y - H * 0.72;
  const headR = H * 0.095;
  const headY = y - H * 0.86;
  const legX = H * 0.085;

  // ground shadow
  g.polyline(isoEllipsePts(x, y + 1 * s, H * 0.19, H * 0.075, 12), Math.max(1, 1.1 * s), inkA(ink, 0.12), true, false);

  if (o.mount) {
    const bodyY = y - H * 0.34;
    const bw = H * 0.34, bh = H * 0.13;
    g.polyline(ellipsePts(x, bodyY, bw, bh, 16), lw * 1.1, ink, true, false);
    // legs
    for (let i = 0; i < 4; i++) {
      const lx = x - bw * 0.7 + (i / 3) * bw * 1.4;
      const sw = walking ? Math.sin((o.phase || 0) + i * 1.6) * H * 0.045 : 0;
      g.seg(lx, bodyY + bh * 0.7, lx + sw, y, lw, ink);
    }
    // neck + head
    g.seg(x + bw * 0.75, bodyY - bh * 0.5, x + bw * 1.05, bodyY - bh * 1.5, lw * 1.1, ink);
    g.polyline(ellipsePts(x + bw * 1.18, bodyY - bh * 1.55, H * 0.07, H * 0.04, 10), lw, ink, true, false);
    g.seg(x + bw * 1.1, bodyY - bh * 1.9, x + bw * 1.22, bodyY - bh * 2.3, lw * 0.8, ink);
    // tail
    g.polyline([x - bw, bodyY - bh * 0.4, x - bw * 1.3, bodyY + bh * 0.3, x - bw * 1.15, bodyY + bh * 1.1], lw * 0.9, ink);
    // rider body sits above
    const rHip = bodyY - bh * 0.4;
    const rShoulder = rHip - H * 0.26;
    g.seg(x, rHip, x, rShoulder, lw, ink);
    g.seg(x, rShoulder, x + H * 0.10, rHip + H * 0.06, lw, ink); // near leg
    const armY = rShoulder + H * 0.11;
    g.seg(x, rShoulder, x - H * 0.12, armY, lw, ink);
    g.seg(x, rShoulder, x + H * 0.14, armY - H * 0.02, lw, ink);
    g.ring(x, rShoulder - headR * 1.15, headR, lw, ink, 12);
    headHat(g, o.hat, x, rShoulder - headR * 1.15, headR, H, lw, ink);
    weapon(g, o.weapon, x + H * 0.14, armY - H * 0.02, H, lw, ink, t, attacking);
    if (o.shield) {
      g.polyline(arcPts(x - H * 0.14, armY, H * 0.1, Math.PI * 0.45, Math.PI * 1.55, 7), lw * 0.9, ink);
    }
    if (o.cape) {
      g.polyline([x - H * 0.04, rShoulder, x - H * 0.14, rHip + H * 0.05, x - H * 0.05, rHip + H * 0.12], lw * 0.9, ink);
    }
    if (o.hero) heroGlow(g, x, y, H, s, t, ink);
    return;
  }

  if (o.ethereal) {
    // water elemental: a stack of wobbling arcs
    const w = H * 0.26;
    for (let i = 0; i < 4; i++) {
      const yy = y - H * (0.12 + i * 0.2);
      const ww = w * (1 - i * 0.13);
      const pts = [];
      for (let k = 0; k <= 8; k++) {
        const a = Math.PI + (k / 8) * Math.PI;
        pts.push(x + Math.cos(a) * ww, yy + Math.sin(a) * ww * 0.35 + Math.sin(t * 3 + i + k) * 1.2 * s);
      }
      g.polyline(pts, lw, ink);
    }
    g.ring(x, y - H * 0.88, H * 0.10, lw, ink, 14);
    g.disc(x, y - H * 0.86, H * 0.025, ink, 6);
    g.seg(x - w, y - H * 0.6, x - w * 1.7, y - H * 0.42, lw, ink);
    g.seg(x + w, y - H * 0.6, x + w * 1.7, y - H * 0.42, lw, ink);
    return;
  }

  // legs
  g.seg(x - H * 0.02, hipY, x - legX + swing * H * 0.09, y, lw, ink);
  g.seg(x + H * 0.02, hipY, x + legX - swing * H * 0.09, y, lw, ink);

  if (o.robe) {
    // robe: filled trapezoid with folds
    g.polyline([
      x - H * 0.055, shoulderY + H * 0.02,
      x - H * 0.15, y,
      x + H * 0.15, y,
      x + H * 0.055, shoulderY + H * 0.02,
    ], lw, ink, true, false);
    g.seg(x - H * 0.05, hipY + H * 0.02, x - H * 0.10, y, lw * 0.7, ink);
    g.seg(x + H * 0.05, hipY + H * 0.02, x + H * 0.09, y, lw * 0.7, ink);
  } else {
    g.seg(x, hipY, x, shoulderY, lw, ink);
    // belt / tabard
    g.seg(x - H * 0.035, hipY, x + H * 0.035, hipY, lw * 0.8, ink);
  }

  // arms
  const armY = shoulderY + H * 0.17;
  const handLX = x - H * 0.14;
  const handRX = x + H * 0.15;
  g.seg(x, shoulderY, handLX, armY, lw, ink);
  g.seg(x, shoulderY, handRX, armY, lw, ink);

  // head + hat
  g.ring(x, headY, headR, lw, ink, 12);
  headHat(g, o.hat, x, headY, headR, H, lw, ink);

  if (o.helmet) {
    g.polyline(arcPts(x, headY, headR * 1.12, Math.PI * 0.92, Math.PI * 2.08, 8), lw * 0.9, ink);
  }
  if (o.shield) {
    const shx = handLX - H * 0.01, shy = armY - H * 0.01;
    g.polyline(arcPts(shx, shy, H * 0.11, Math.PI * 0.35, Math.PI * 1.65, 8), lw * 0.9, ink);
    g.seg(shx, shy - H * 0.11, shx, shy + H * 0.11, lw * 0.6, ink);
  }
  if (o.cape) {
    g.polyline([x - H * 0.03, shoulderY, x - H * 0.13, hipY + H * 0.08, x - H * 0.03, hipY + H * 0.16], lw * 0.8, ink);
  }
  weapon(g, o.weapon, handRX, armY, H, lw, ink, t, attacking);
  if (o.hero) heroGlow(g, x, y, H, s, t, ink);
}

function heroGlow(g, x, y, H, s, t, ink) {
  const pulse = 0.5 + 0.5 * Math.sin(t * 2);
  g.polyline(isoEllipsePts(x, y, H * 0.42, H * 0.17, 20), Math.max(1, 1.2 * s), inkA(ink, 0.28 + pulse * 0.12), true, false);
  g.polyline(isoEllipsePts(x, y, H * 0.52, H * 0.21, 20), Math.max(1, 1 * s), inkA(ink, 0.12 + pulse * 0.08), true, false);
  // level chevrons
  g.polyline([x + H * 0.3, y - H * 1.02, x + H * 0.36, y - H * 0.96, x + H * 0.3, y - H * 0.90], 1.4 * s, inkA(ink, 0.8));
}

// faction ink colour
export function factionInk(world, e, viewerTeam) {
  if (e.owner === undefined || e.owner === null || e.owner === -2) return PAL.inkDim;
  if (e.owner === -1) return PAL.inkFaint;
  const p = world.players[e.owner];
  if (!p) return PAL.inkDim;
  if (p.team === viewerTeam) {
    if (e.owner === 0 || viewerTeam === 0) return PAL.ink;
    return PAL.inkSoft;
  }
  return PAL.inkDim;
}

export function drawUnit(g, world, e, sx, sy, s, t, viewerTeam, selected) {
  const ink = factionInk(world, e, viewerTeam);
  const def = e.def;
  const art = def.art || {};
  const moving = e.moving;
  const phase = t * 9 + e.id * 0.7;
  const bob = moving ? Math.abs(Math.sin(phase)) * 1.2 * s : 0;

  // selection / faction ring on the ground
  if (selected) {
    groundEllipse(g, sx, sy, e.radius * 1.35, s, 2 * s, PAL.ink, 7, 4);
    groundEllipse(g, sx, sy, e.radius * 1.55, s, 1 * s, PAL.white30, 3, 5);
  } else if (e.owner >= 0 && world.players[e.owner]) {
    const friendly = world.players[e.owner].team === viewerTeam;
    groundEllipse(g, sx, sy, e.radius * 1.3, s, 1 * s,
      friendly ? PAL.white20 : PAL.white12, friendly ? 0 : 4, 6);
  } else if (e.creep) {
    groundEllipse(g, sx, sy, e.radius * 1.2, s, 0.9 * s, PAL.white12, 2, 6);
  }

  const y = sy - bob;
  // hero aura ring
  const attacking = e.attackAnim > 0.08;
  drawFigure(g, sx, y, s, {
    ink,
    t: t + e.id,
    phase,
    moving,
    weapon: art.weapon || 'none',
    shield: !!art.shield,
    helmet: !!art.helmet,
    robe: !!art.robe,
    mount: !!art.mount,
    cape: !!art.cape,
    hat: art.hat,
    bulk: (art.bulk || 1) * (e.hero ? 1.12 : 1),
    ethereal: !!art.ethereal,
    hero: !!e.hero,
    attacking,
  });

  // carry indicator for workers
  if (e.carry && e.carry.amount > 0) {
    const cx = sx + 13 * s, cy = y - 26 * s * (art.bulk || 1);
    if (e.carry.type === 'gold') g.disc(cx, cy, 3.2 * s, inkA(PAL.ink, 0.9), 8);
    else g.seg(cx - 4 * s, cy + 3 * s, cx + 4 * s, cy - 3 * s, 2.4 * s, inkA(PAL.ink, 0.85));
  }

  // status pips
  let pipX = sx - 8 * s;
  const pipY = y - 50 * s;
  for (const b of e.buffs) {
    if (b.id === 'slow') { g.ring(pipX, pipY, 2.4 * s, 1 * s, PAL.inkSoft, 6); pipX += 7 * s; }
    else if (b.stun || b.root) { g.seg(pipX - 2 * s, pipY - 2 * s, pipX + 2 * s, pipY + 2 * s, 1.2 * s, PAL.inkSoft); g.seg(pipX + 2 * s, pipY - 2 * s, pipX - 2 * s, pipY + 2 * s, 1.2 * s, PAL.inkSoft); pipX += 7 * s; }
    else if (b.invisible) { g.dashedCircle(pipX, pipY, 2.4 * s, 1 * s, PAL.inkSoft, 2, 2); pipX += 7 * s; }
    else if (b.invulnerable) { g.ring(pipX, pipY, 2.8 * s, 1 * s, PAL.inkSoft, 8); pipX += 7 * s; }
  }
}

export function drawHealthBar(g, sx, sy, s, e, opts = {}) {
  const w = (opts.width || 34) * s;
  const h = 3.4 * s;
  const y = sy - (opts.y !== undefined ? opts.y : 54 * s) - h;
  const x = sx - w / 2;
  const hp = clamp(e.hp / e.maxHp, 0, 1);
  const friendly = opts.friendly;
  if (!opts.always && hp >= 1 && !opts.selected) return;
  g.rect(x - 1, y - 1, w + 2, h + 2, PAL.black60);
  g.rect(x, y, w, h, [0.14, 0.15, 0.17, 1]);
  g.rect(x, y, w * hp, h, friendly ? PAL.ink : PAL.inkDim);
  // segmentation ticks
  if (e.maxHp >= 500) {
    const segs = Math.min(10, Math.floor(e.maxHp / 250));
    for (let i = 1; i < segs; i++) {
      g.seg(x + (w * i) / segs, y, x + (w * i) / segs, y + h, 1 * s, PAL.black40);
    }
  }
  if (e.maxMana > 0) {
    const my = y + h + 1.2 * s;
    g.rect(x, my, w, 2.2 * s, [0.10, 0.11, 0.13, 1]);
    g.rect(x, my, w * clamp(e.mana / e.maxMana, 0, 1), 2.2 * s, PAL.inkSoft);
    g.rect(x, my, w, 2.2 * s, PAL.black40);
    g.rect(x, my, w * clamp(e.mana / e.maxMana, 0, 1), 2.2 * s, PAL.white50);
  }
}

// --------------------------------------------------------------- buildings
function isoQuad(g, pts, fill, ink, lw) {
  g.polyline(pts, lw || 1.4, ink, true, false);
  if (fill) {
    for (let i = 1; i < pts.length / 2 - 1; i++) {
      g.tri(pts[0], pts[1], pts[i * 2], pts[i * 2 + 1], pts[i * 2 + 2], pts[i * 2 + 3], fill);
    }
  }
}

// Draws an isometric box and returns the top-face corner points.
export function isoBox(g, cx, cy, w, d, h, s, o) {
  const a = (w / 2) * s, b = (d / 2) * s, H = h * s;
  const N = [cx + (b - a) * ISO_X, cy - (a + b) * ISO_Y];
  const E = [cx + (a + b) * ISO_X, cy + (a - b) * ISO_Y];
  const S = [cx + (a - b) * ISO_X, cy + (a + b) * ISO_Y];
  const W = [cx - (a + b) * ISO_X, cy + (a - b) * ISO_Y];
  const up = (p) => [p[0], p[1] - H];
  const N2 = up(N), E2 = up(E), S2 = up(S), W2 = up(W);

  // ground shadow
  g.polyline([N[0] + 4 * s, N[1] + 6 * s, E[0] + 6 * s, E[1] + 4 * s, S[0] + 4 * s, S[1] + 4 * s, W[0] - 2 * s, W[1] + 2 * s],
    1 * s, PAL.black60, true, false);

  const wallFill = o.wallFill || [0.058, 0.062, 0.072, 1];
  const roofFill = o.roofFill || [0.085, 0.09, 0.10, 1];
  // visible walls (south-east and south-west)
  isoQuad(g, [E[0], E[1], S[0], S[1], S2[0], S2[1], E2[0], E2[1]], wallFill, o.ink, o.lw);
  isoQuad(g, [W[0], W[1], S[0], S[1], S2[0], S2[1], W2[0], W2[1]], wallFill, o.ink, o.lw);
  // roof
  isoQuad(g, [N2[0], N2[1], E2[0], E2[1], S2[0], S2[1], W2[0], W2[1]], roofFill, o.ink, o.lw);
  // vertical edges
  for (const [p, p2] of [[E, E2], [S, S2], [W, W2]]) {
    g.seg(p[0], p[1], p2[0], p2[1], o.lw || 1.4, o.ink);
  }
  return { N, E, S, W, N2, E2, S2, W2, H };
}

function battlement(g, x1, y1, x2, y2, count, hh, lw, ink) {
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t;
    g.seg(x, y, x, y - hh, lw, ink);
  }
  g.seg(x1, y1 - hh, x2, y2 - hh, lw, ink);
}

function banner(g, x, y, h, w, lw, ink, t, phase = 0) {
  g.seg(x, y, x, y - h, lw, ink);
  const wave = Math.sin(t * 3 + phase) * 2;
  const pts = [x, y - h, x + w * 0.5, y - h + 2 + wave, x + w, y - h + 1 + wave * 1.5, x + w * 0.55, y - h + h * 0.45, x, y - h + h * 0.5];
  g.polyline(pts, lw * 0.9, ink);
  g.tri(x, y - h, x + w, y - h + 1 + wave * 1.5, x + w * 0.55, y - h + h * 0.45, [0.09, 0.10, 0.115, 0.9]);
}

function windows(g, pts, ink, lw, count = 2, wh = 7) {
  const [ax, ay] = pts[0], [bx, by] = pts[1];
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
    g.strokeRect(x - 3, y - wh, 6, wh * 0.9, lw * 0.8, ink);
  }
}

function pitchedRoof(g, box, h, s, ink, lw, fill) {
  const { N2, E2, S2, W2 } = box;
  const ridgeA = [ (N2[0] + W2[0]) / 2, (N2[1] + W2[1]) / 2 - h * s * 0.5 ];
  const ridgeB = [ (E2[0] + S2[0]) / 2, (E2[1] + S2[1]) / 2 - h * s * 0.5 ];
  const f = fill || [0.10, 0.105, 0.115, 1];
  isoQuad(g, [W2[0], W2[1], S2[0], S2[1], ridgeB[0], ridgeB[1], ridgeA[0], ridgeA[1]], f, ink, lw);
  isoQuad(g, [S2[0], S2[1], E2[0], E2[1], ridgeB[0], ridgeB[1], ridgeB[0], ridgeB[1]], f, ink, lw);
  isoQuad(g, [N2[0], N2[1], E2[0], E2[1], ridgeB[0], ridgeB[1], ridgeA[0], ridgeA[1]], f, ink, lw);
  g.seg(ridgeA[0], ridgeA[1], ridgeB[0], ridgeB[1], lw * 1.2, ink);
  return { ridgeA, ridgeB };
}

export function drawBuilding(g, world, b, sx, sy, s, t, viewerTeam, selected) {
  if (b.kind === 'mine') { drawMine(g, b, sx, sy, s, t); return; }
  const ink = factionInk(world, b, viewerTeam);
  const kind = b.def.art ? b.def.art.kind : 'house';
  const lw = 1.5;
  const fp = b.footprint || [3, 3];
  const w = fp[0] * TILE * 0.92;
  const d = fp[1] * TILE * 0.92;

  if (selected) {
    const rx = (w + d) * 0.5 * 1.41421356 * ISO_X * s * 1.06;
    const ry = (w + d) * 0.5 * 1.41421356 * ISO_Y * s * 1.06;
    g.polyline(isoEllipsePts(sx, sy, rx, ry, 34), 2 * s, PAL.ink, true, false);
  } else if (b.owner >= 0) {
    const friendly = world.players[b.owner] && world.players[b.owner].team === viewerTeam;
    const rx = (w + d) * 0.5 * 1.41421356 * ISO_X * s * 1.04;
    const ry = (w + d) * 0.5 * 1.41421356 * ISO_Y * s * 1.04;
    g.polyline(isoEllipsePts(sx, sy, rx, ry, 30), 1 * s, inkA(friendly ? PAL.white20 : PAL.white12, 1), true, false);
  }

  const building = !b.constructing;

  if (!building) {
    // construction frame
    const box = isoBox(g, sx, sy, w, d, 14 + b.buildProgress * 30, s, { ink, lw: 1.2, wallFill: [0.05, 0.055, 0.062, 0.75] });
    g.dashedLine(box.N2[0], box.N2[1], box.E2[0], box.E2[1], 1 * s, PAL.inkFaint, 4, 4);
    for (const p of [box.N2, box.E2, box.S2, box.W2]) {
      g.seg(p[0], p[1], p[0], p[1] + 10 * s, 1.1 * s, PAL.inkFaint);
    }
    // progress bar
    const pw = 46 * s, ph = 3.4 * s;
    const px = sx - pw / 2, py = sy - 10 * s - (box.H || 0) - 18 * s;
    g.rect(px - 1, py - 1, pw + 2, ph + 2, PAL.black60);
    g.rect(px, py, pw, ph, [0.13, 0.14, 0.16, 1]);
    g.rect(px, py, pw * b.buildProgress, ph, PAL.ink);
    g.strokeRect(px, py, pw, ph, 1, PAL.white30);
    return;
  }

  switch (kind) {
    case 'townhall': {
      const castle = !!b.def.art.castle;
      const keep = !!b.def.art.big;
      const h = castle ? 52 : keep ? 46 : 40;
      const box = isoBox(g, sx, sy, w, d, h, s, { ink, lw, wallFill: [0.062, 0.067, 0.077, 1] });
      // hip roof
      const ridge = [ (box.N2[0] + box.S2[0]) / 2, (box.N2[1] + box.S2[1]) / 2 ];
      const peak = [ridge[0], ridge[1] - 16 * s];
      for (const p of [box.N2, box.E2, box.S2, box.W2]) {
        g.seg(p[0], p[1], peak[0], peak[1], lw, ink);
      }
      g.tri(box.N2[0], box.N2[1], box.E2[0], box.E2[1], peak[0], peak[1], [0.10, 0.105, 0.115, 1]);
      g.tri(box.E2[0], box.E2[1], box.S2[0], box.S2[1], peak[0], peak[1], [0.085, 0.09, 0.10, 1]);
      // tower + flag
      const tx = peak[0], ty = peak[1];
      g.seg(tx, ty, tx, ty - 26 * s, lw * 1.2, ink);
      banner(g, tx, ty - 18 * s, 18 * s, 16 * s, lw, ink, t);
      // door
      const mx = (box.S[0] + box.W[0]) / 2, my = (box.S[1] + box.W[1]) / 2;
      g.strokeRect(mx - 7 * s, my - 16 * s, 14 * s, 16 * s, lw, ink);
      g.polyline(arcPts(mx, my - 16 * s, 7 * s, Math.PI, TAU, 6), lw, ink);
      windows(g, [box.E, box.S], ink, lw, 2, 9 * s);
      windows(g, [box.W, box.S], ink, lw, 1, 9 * s);
      if (keep) {
        for (const p of [box.N2, box.E2]) {
          g.rect(p[0] - 9 * s, p[1] - 16 * s, 18 * s, 16 * s, [0.07, 0.075, 0.085, 1]);
          g.strokeRect(p[0] - 9 * s, p[1] - 16 * s, 18 * s, 16 * s, lw, ink);
          battlement(g, p[0] - 9 * s, p[1] - 16 * s, p[0] + 9 * s, p[1] - 16 * s, 3, 5 * s, lw, ink);
        }
      }
      if (castle) {
        for (const [p, side] of [[box.E2, 1], [box.W2, -1]]) {
          const tw = 26 * s;
          g.strokeRect(p[0] - tw / 2, p[1] - tw, tw, tw, lw, ink);
          g.rect(p[0] - tw / 2, p[1] - tw, tw, tw, [0.075, 0.08, 0.09, 1]);
          battlement(g, p[0] - tw / 2, p[1] - tw, p[0] + tw / 2, p[1] - tw, 4, 6 * s, lw, ink);
        }
      }
      break;
    }
    case 'farm': {
      const box = isoBox(g, sx, sy, w, d, 18, s, { ink, lw, wallFill: [0.06, 0.064, 0.073, 1] });
      pitchedRoof(g, box, 22, s, ink, lw);
      // door + field furrows
      g.strokeRect((box.S[0] + box.W[0]) / 2 - 6 * s, (box.S[1] + box.W[1]) / 2 - 12 * s, 12 * s, 12 * s, lw, ink);
      for (let i = 0; i < 3; i++) {
        const yy = box.S[1] + (12 + i * 7) * s;
        g.seg(box.W[0] + 6 * s, yy, box.E[0] - 6 * s, yy - 2 * s, 1 * s, inkA(ink, 0.35));
      }
      g.seg(box.N2[0], box.N2[1], box.N2[0] - 6 * s, box.N2[1] - 14 * s, lw * 0.8, inkA(ink, 0.5));
      break;
    }
    case 'barracks': {
      const box = isoBox(g, sx, sy, w, d, 26, s, { ink, lw, wallFill: [0.058, 0.063, 0.072, 1] });
      // flat roof with battlements
      battlement(g, box.N2[0], box.N2[1], box.E2[0], box.E2[1], 4, 6 * s, lw, ink);
      battlement(g, box.E2[0], box.E2[1], box.S2[0], box.S2[1], 3, 6 * s, lw, ink);
      battlement(g, box.W2[0], box.W2[1], box.S2[0], box.S2[1], 3, 6 * s, lw, ink);
      // banners
      banner(g, box.N2[0] + 4 * s, box.N2[1] - 6 * s, 26 * s, 14 * s, lw, ink, t, 0);
      banner(g, box.E2[0] - 2 * s, box.E2[1], 26 * s, 14 * s, lw, ink, t, 1.7);
      // door + crossed swords
      const mx = (box.S[0] + box.W[0]) / 2, my = (box.S[1] + box.W[1]) / 2;
      g.strokeRect(mx - 9 * s, my - 18 * s, 18 * s, 18 * s, lw, ink);
      const ex = (box.S[0] + box.E[0]) / 2, ey = (box.S[1] + box.E[1]) / 2;
      g.seg(ex - 8 * s, ey - 16 * s, ex + 8 * s, ey - 4 * s, lw * 1.1, inkA(ink, 0.8));
      g.seg(ex + 8 * s, ey - 16 * s, ex - 8 * s, ey - 4 * s, lw * 1.1, inkA(ink, 0.8));
      break;
    }
    case 'blacksmith': {
      const box = isoBox(g, sx, sy, w, d, 24, s, { ink, lw, wallFill: [0.062, 0.065, 0.073, 1] });
      pitchedRoof(g, box, 16, s, ink, lw);
      // chimney + smoke
      const cx2 = box.N2[0] + 10 * s, cy2 = box.N2[1] - 6 * s;
      g.strokeRect(cx2 - 5 * s, cy2 - 20 * s, 10 * s, 20 * s, lw, ink);
      for (let i = 0; i < 3; i++) {
        const a = (t * 0.8 + i * 0.33) % 1;
        g.ring(cx2 + Math.sin(a * 6) * 4 * s, cy2 - 22 * s - a * 26 * s, (2 + a * 4) * s, 1 * s, inkA(ink, 0.35 * (1 - a)), 8);
      }
      // anvil sign
      const ax = (box.S[0] + box.E[0]) / 2, ay = (box.S[1] + box.E[1]) / 2;
      g.seg(ax - 8 * s, ay - 14 * s, ax + 8 * s, ay - 14 * s, lw * 1.4, ink);
      g.seg(ax - 5 * s, ay - 14 * s, ax - 3 * s, ay - 8 * s, lw * 1.2, ink);
      g.seg(ax + 5 * s, ay - 14 * s, ax + 3 * s, ay - 8 * s, lw * 1.2, ink);
      break;
    }
    case 'lumbermill': {
      const box = isoBox(g, sx, sy, w, d, 22, s, { ink, lw, wallFill: [0.06, 0.064, 0.072, 1] });
      pitchedRoof(g, box, 14, s, ink, lw);
      // saw blade
      const bx = box.S[0] + 26 * s, by = box.S[1] - 4 * s;
      const rot = t * 1.2;
      g.ring(bx, by, 11 * s, 1.2 * s, inkA(ink, 0.85), 14);
      for (let i = 0; i < 10; i++) {
        const a = rot + (i / 10) * TAU;
        g.seg(bx + Math.cos(a) * 11 * s, by + Math.sin(a) * 11 * s,
          bx + Math.cos(a) * 14 * s, by + Math.sin(a) * 14 * s, 1.2 * s, inkA(ink, 0.8));
      }
      g.disc(bx, by, 2 * s, inkA(ink, 0.8), 6);
      // logs
      for (let i = 0; i < 3; i++) {
        g.ring(bx - 26 * s + i * 9 * s, by + 8 * s, 4 * s, 1 * s, inkA(ink, 0.5), 8);
      }
      break;
    }
    case 'altar': {
      // circular dais
      const rx = w * 0.62 * ISO_X * s * 1.4, ry = w * 0.62 * ISO_Y * s * 1.4;
      g.polyline(isoEllipsePts(sx, sy + 3 * s, rx, ry, 30), lw, ink, true, false);
      g.polyline(isoEllipsePts(sx, sy - 6 * s, rx * 0.82, ry * 0.82, 30), lw, ink, true, false);
      g.polyline(isoEllipsePts(sx, sy - 6 * s, rx * 0.82, ry * 0.82, 30), 1 * s, inkA(ink, 0.25), true, false);
      // four pillars
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + Math.PI / 4;
        const px = sx + Math.cos(a) * rx * 0.78, py = sy - 6 * s + Math.sin(a) * ry * 0.78;
        g.seg(px, py, px, py - 26 * s, lw, ink);
        g.seg(px - 4 * s, py - 26 * s, px + 4 * s, py - 26 * s, lw, ink);
      }
      // floating sigil
      const bob = Math.sin(t * 1.6) * 3 * s;
      const cy2 = sy - 46 * s + bob;
      g.polyline([sx, cy2 - 9 * s, sx + 8 * s, cy2, sx, cy2 + 9 * s, sx - 8 * s, cy2], lw * 1.2, ink, true, false);
      g.polyline([sx, cy2 - 4 * s, sx + 3.5 * s, cy2, sx, cy2 + 4 * s, sx - 3.5 * s, cy2], 1 * s, inkA(ink, 0.6), true, false);
      // light beams
      for (let i = 0; i < 5; i++) {
        const a = t * 0.4 + (i / 5) * TAU;
        const px = sx + Math.cos(a) * rx * 0.5;
        g.seg(px, sy - 10 * s, px, sy - 30 * s, 1 * s, inkA(ink, 0.18));
      }
      break;
    }
    case 'sanctum': {
      const box = isoBox(g, sx, sy, w * 0.75, d * 0.75, 52, s, { ink, lw, wallFill: [0.055, 0.06, 0.07, 1] });
      // tapered roof
      const ridge = [(box.N2[0] + box.S2[0]) / 2, (box.N2[1] + box.S2[1]) / 2];
      const peak = [ridge[0], ridge[1] - 24 * s];
      for (const p of [box.N2, box.E2, box.S2, box.W2]) g.seg(p[0], p[1], peak[0], peak[1], lw, ink);
      g.tri(box.E2[0], box.E2[1], box.S2[0], box.S2[1], peak[0], peak[1], [0.085, 0.09, 0.10, 1]);
      g.tri(box.W2[0], box.W2[1], box.S2[0], box.S2[1], peak[0], peak[1], [0.07, 0.075, 0.085, 1]);
      // orb
      const oy = peak[1] - 14 * s + Math.sin(t * 2) * 2 * s;
      g.ring(peak[0], oy, 6 * s, lw * 1.1, ink, 12);
      g.polyline(isoEllipsePts(peak[0], oy, 13 * s, 4 * s, 18, t * 0.8), 1 * s, inkA(ink, 0.5), true, false);
      g.polyline(isoEllipsePts(peak[0], oy, 13 * s, 4 * s, 18, -t * 0.8), 1 * s, inkA(ink, 0.3), true, false);
      // arched windows
      const mx = (box.S[0] + box.W[0]) / 2, my = (box.S[1] + box.W[1]) / 2;
      g.strokeRect(mx - 6 * s, my - 26 * s, 12 * s, 18 * s, lw, ink);
      g.polyline(arcPts(mx, my - 26 * s, 6 * s, Math.PI, TAU, 6), lw, ink);
      windows(g, [box.E, box.S], ink, lw, 1, 10 * s);
      break;
    }
    case 'vault': {
      const box = isoBox(g, sx, sy, w * 0.9, d * 0.9, 22, s, { ink, lw, wallFill: [0.06, 0.065, 0.074, 1] });
      pitchedRoof(g, box, 12, s, ink, lw);
      const mx = (box.S[0] + box.E[0]) / 2, my = (box.S[1] + box.E[1]) / 2;
      g.polyline(arcPts(mx, my - 14 * s, 7 * s, Math.PI, TAU, 7), lw, ink);
      g.seg(mx - 7 * s, my - 14 * s, mx - 7 * s, my, lw, ink);
      g.seg(mx + 7 * s, my - 14 * s, mx + 7 * s, my, lw, ink);
      g.seg(mx - 7 * s, my, mx + 7 * s, my, lw, ink);
      // coin sign
      g.ring(mx, my - 26 * s, 6 * s, lw, ink, 10);
      g.seg(mx - 3 * s, my - 29 * s, mx + 3 * s, my - 23 * s, 1 * s, ink);
      break;
    }
    case 'tower': {
      const box = isoBox(g, sx, sy, w * 0.62, d * 0.62, 62, s, { ink, lw, wallFill: [0.06, 0.065, 0.075, 1] });
      // crenellations
      battlement(g, box.N2[0], box.N2[1], box.E2[0], box.E2[1], 3, 7 * s, lw, ink);
      battlement(g, box.E2[0], box.E2[1], box.S2[0], box.S2[1], 2, 7 * s, lw, ink);
      battlement(g, box.W2[0], box.W2[1], box.S2[0], box.S2[1], 2, 7 * s, lw, ink);
      // arrow slits
      const mx = (box.S[0] + box.W[0]) / 2, my = (box.S[1] + box.W[1]) / 2;
      g.seg(mx, my - 34 * s, mx, my - 24 * s, 2 * s, ink);
      g.seg(mx, my - 18 * s, mx, my - 10 * s, 2 * s, ink);
      // archer silhouette
      const ax = (box.S[0] + box.E[0]) / 2, ay = (box.S[1] + box.E[1]) / 2;
      g.ring(ax, ay - 24 * s, 2.6 * s, 1 * s, inkA(ink, 0.55), 8);
      g.polyline(arcPts(ax + 3 * s, ay - 20 * s, 6 * s, -Math.PI * 0.45, Math.PI * 0.45, 6), 1.1 * s, inkA(ink, 0.7));
      break;
    }
    case 'cannon': {
      const box = isoBox(g, sx, sy, w * 0.65, d * 0.65, 40, s, { ink, lw, wallFill: [0.062, 0.066, 0.076, 1] });
      battlement(g, box.N2[0], box.N2[1], box.E2[0], box.E2[1], 3, 6 * s, lw, ink);
      battlement(g, box.E2[0], box.E2[1], box.S2[0], box.S2[1], 2, 6 * s, lw, ink);
      battlement(g, box.W2[0], box.W2[1], box.S2[0], box.S2[1], 2, 6 * s, lw, ink);
      // barrel points at its target, or outward by default
      let ang = Math.PI * 0.25;
      if (b.attackTarget && !b.attackTarget.dead) {
        ang = Math.atan2(b.attackTarget.y - b.y, b.attackTarget.x - b.x);
      }
      const bx = box.S[0] + 4 * s, by = box.S[1] - 10 * s;
      const dirX = Math.cos(ang) * 20 * s, dirY = Math.sin(ang) * 12 * s;
      g.seg(bx, by, bx + dirX, by + dirY, 5 * s, inkA(ink, 0.9));
      g.seg(bx + dirX * 0.65, by + dirY * 0.65, bx + dirX * 0.7, by + dirY * 0.55, 7 * s, inkA(ink, 0.9));
      g.disc(bx, by, 4.5 * s, [0.1, 0.11, 0.12, 1], 10);
      g.ring(bx, by, 4.5 * s, 1 * s, ink, 10);
      break;
    }
    default: {
      const box = isoBox(g, sx, sy, w * 0.9, d * 0.9, 22, s, { ink, lw });
      pitchedRoof(g, box, 14, s, ink, lw);
      break;
    }
  }

  // rally flag
  if (b.rally && b.owner >= 0) {
    // drawn by the renderer in world space
  }
}

// ------------------------------------------------------------------- trees
export function drawTree(g, tree, sx, sy, s, t) {
  const sw = (tree.size || 1);
  const height = (34 + 10 * sw) * s;
  const ink = inkA(PAL.inkFaint, 0.85);
  const lw = 1.2 * s;
  const sway = Math.sin(t * 0.7 + tree.id) * 0.6 * s;
  // trunk
  g.seg(sx, sy, sx + sway * 0.4, sy - height * 0.45, lw, ink);
  // branches / canopy
  if (sw > 1.1) {
    // conifer
    for (let i = 0; i < 4; i++) {
      const yy = sy - height * (0.3 + i * 0.17);
      const ww = height * (0.3 - i * 0.055);
      g.polyline([sx - ww + sway, yy, sx + sway, yy - height * 0.16, sx + ww + sway, yy], lw * 0.9, ink);
    }
  } else {
    const cy = sy - height * 0.68;
    const r = height * 0.30;
    g.polyline(ellipsePts(sx + sway, cy, r, r * 0.9, 9), lw * 0.9, ink, true, false);
    g.polyline(ellipsePts(sx + sway + r * 0.5, cy + r * 0.35, r * 0.65, r * 0.55, 7), lw * 0.8, inkA(ink, 0.7), true, false);
    g.seg(sx + sway, cy, sx + sway * 0.4, sy - height * 0.4, lw * 0.8, inkA(ink, 0.6));
  }
  // root line
  g.seg(sx - 4 * s, sy, sx + 4 * s, sy, 1 * s, inkA(ink, 0.4));
}

// ------------------------------------------------------------------- items
export function drawItem(g, it, sx, sy, s, t) {
  const ink = inkA(PAL.ink, 0.92);
  const bob = Math.sin(t * 2 + it.id) * 2.2 * s;
  const y = sy + bob;
  g.polyline(isoEllipsePts(sx, sy + 3 * s, 9 * s, 4 * s, 14), 1 * s, PAL.white20, true, false);
  g.polyline(isoEllipsePts(sx, sy + 3 * s, 15 * s, 6.5 * s, 16), 0.9 * s, PAL.white08, true, false);
  const size = 17 * s;
  drawIcon(g, it.def.icon, sx, y - 14 * s, size, ink, 1.4 * s);
}

// ------------------------------------------------------------------ effects
export function drawEffect(g, fx, sx, sy, s, t) {
  const p = fx.life / fx.maxLife;
  switch (fx.type) {
    case 'ring': {
      const r = (fx.radius || 100) * 1.41421356 * ISO_X * s * (0.35 + p * 0.7);
      const ry = (fx.radius || 100) * 1.41421356 * ISO_Y * s * (0.35 + p * 0.7);
      g.polyline(isoEllipsePts(sx, sy, r, ry, 30), 2 * s * (1 - p), PAL.ink, true, false);
      break;
    }
    case 'burst': {
      const n = fx.count || 10;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + fx.x * 0.01;
        const r = (6 + p * 26) * s;
        g.seg(sx + Math.cos(a) * r * 0.4, sy - 12 * s + Math.sin(a) * r * 0.4,
          sx + Math.cos(a) * r, sy - 12 * s + Math.sin(a) * r, 1.4 * s, [1, 1, 1, (1 - p) * 0.8]);
      }
      break;
    }
    case 'beam': {
      g.seg(sx, sy - 14 * s, fx.x2 !== undefined ? fx.sx2 : sx, sy, 1.5 * s, [1, 1, 1, 1 - p]);
      break;
    }
    case 'pulse': {
      const wave = (fx.timer || 0) / (fx.interval || 0.7);
      const r = (fx.radius || 200) * 1.41421356 * ISO_X * s * (0.3 + wave * 0.8);
      const ry = (fx.radius || 200) * 1.41421356 * ISO_Y * s * (0.3 + wave * 0.8);
      g.polyline(isoEllipsePts(sx, sy, r, ry, 26), 1.5 * s, [1, 1, 1, 0.5], true, false);
      break;
    }
    default: break;
  }
}

// ------------------------------------------------------------------- icons
// Icon ids are shared with data files (abilities, items, buildings).
export function drawIcon(g, id, cx, cy, size, ink, lw) {
  lw = lw || Math.max(1, size * 0.07);
  const r = size * 0.5;
  const u = size / 32;
  const L = (x1, y1, x2, y2, w) => g.seg(cx + x1 * u, cy + y1 * u, cx + x2 * u, cy + y2 * u, w || lw, ink);
  const P = (pts, closed, w) => {
    const out = [];
    for (let i = 0; i < pts.length; i += 2) out.push(cx + pts[i] * u, cy + pts[i + 1] * u);
    g.polyline(out, w || lw, ink, !!closed, false);
  };
  const R = (x, y, w, h) => g.strokeRect(cx + x * u, cy + y * u, w * u, h * u, lw, ink);
  const C = (x, y, rr, w) => g.ring(cx + x * u, cy + y * u, rr * u, w || lw, ink, 14);
  const A = (x, y, rr, a0, a1) => {
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const a = a0 + (a1 - a0) * (i / 10);
      pts.push(cx + x * u + Math.cos(a) * rr * u, cy + y * u + Math.sin(a) * rr * u);
    }
    g.polyline(pts, lw, ink);
  };
  switch (id) {
    // ---- units
    case 'peasant': case 'worker':
      C(0, -8, 3.2); P([0, -5, 0, 3]); L(0, 3, -4, 10); L(0, 3, 4, 10); L(0, -2, -5, 3); L(0, -2, 5, 3); L(6, 4, 12, -6); break;
    case 'footman':
      C(0, -8, 3.2); P([0, -5, 0, 3]); L(0, 3, -4, 10); L(0, 3, 4, 10); L(0, -2, -5, 3); L(0, -2, 5, 3);
      L(6, 4, 12, -8); L(2, 1, 9, 1); A(-6, 2, 4, 0.6, 2.6); break;
    case 'rifleman':
      C(0, -8, 3.2); P([0, -5, 0, 3]); L(0, 3, -4, 10); L(0, 3, 4, 10); L(0, -2, -5, 3); L(0, -2, 5, 3);
      L(4, 0, 14, -2); L(6, 2, 14, 1); break;
    case 'knight':
      C(1, -10, 3.2); P([1, -7, 1, -1]); L(1, -1, -3, 8); L(1, -1, 5, 8);
      P([-11, 0, -6, -3, 8, -3, 12, -1, 9, 1, -8, 2], true); L(-8, 1, -9, 9); L(6, 1, 7, 9);
      L(12, -1, 15, -6); L(14, -8, 16, -7); L(5, -2, 9, -8); break;
    case 'mortar':
      C(-3, -7, 3); P([-3, -4, -3, 2]); L(-3, 2, -6, 9); L(-3, 2, 0, 9);
      L(2, 2, 13, -7, lw * 2.4); L(4, 5, 11, 0); R(1, 2, 4, 3); break;
    case 'priest': case 'sorceress': case 'caster':
      C(0, -9, 3.2); P([0, -6, 0, 6], false); P([-6, 10, 0, -5, 6, 10], true);
      L(6, 6, 6, -8, lw * 1.1); C(6, -9.5, 2.2); break;
    case 'water_elemental': case 'elemental':
      P([-7, 9, -5, 0, -8, -6, 0, -10, 8, -6, 5, 0, 7, 9], false);
      C(0, -4, 2.4); C(-9, 0, 2.4); C(9, 0, 2.4); break;
    case 'hero': case 'hero_portrait':
      C(0, -8, 4); P([0, -4, 0, 6]); L(0, 6, -5, 14); L(0, 6, 5, 14); L(0, -1, -7, 4); L(0, -1, 7, 1);
      P([-4, -11, 0, -16, 4, -11], false); break;
    // ---- creeps
    case 'creep': case 'kobold': case 'gnoll': case 'ogre': case 'wendigo':
      C(0, -6, 4.4); P([0, -2, 0, 6]); L(0, 6, -5, 12); L(0, 6, 5, 12); L(0, 1, -7, 6); L(0, 1, 7, 4);
      P([-5, -10, -8, -15]); P([5, -10, 8, -15]); break;
    // ---- buildings
    case 'townhall': case 'keep': case 'castle':
      P([-12, 4, 0, -5, 12, 4, 0, 12], true); L(0, -5, 0, -13); P([0, -13, 7, -10, 0, -8], true);
      R(-4, 3, 8, 7); R(-9, 1, 3, 1); R(6, 1, 3, 1); break;
    case 'farm':
      P([-12, 4, 0, -3, 12, 4, 0, 11], true); P([-12, 4, 0, -6, 12, 4], false);
      L(-9, 7, 9, 7); L(-7, 9, 7, 9); break;
    case 'barracks':
      P([-12, 3, 0, -6, 12, 3, 0, 11], true); P([-12, 3, -12, -2, 0, -11, 12, -2, 12, 3], false);
      R(-3, 5, 6, 6); L(-8, 2, -2, 7); L(-2, 2, -8, 7); break;
    case 'blacksmith':
      P([-11, 4, 0, -4, 11, 4, 0, 11], true); R(4, -11, 4, 8); C(6, -13, 2); C(8, -17, 1.5);
      L(-6, 5, 6, 5); L(-4, 5, -3, 8); L(4, 5, 3, 8); break;
    case 'lumbermill':
      P([-11, 4, 0, -4, 11, 4, 0, 11], true); C(6, 0, 5); for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; L(6 + Math.cos(a) * 5, Math.sin(a) * 5, 6 + Math.cos(a) * 7, Math.sin(a) * 7); } break;
    case 'altar':
      P([-12, 7, 0, 1, 12, 7, 0, 13], true); L(0, 1, 0, -6); P([0, -12, 5, -6, 0, 0, -5, -6], true);
      L(-8, 5, -8, -1); L(8, 5, 8, -1); break;
    case 'sanctum':
      P([-9, 5, 0, -3, 9, 5, 0, 12], true); P([-9, 5, 0, -9, 9, 5], false); C(0, -13, 3);
      A(0, -13, 6, 0, 3.5); break;
    case 'vault':
      P([-11, 4, 0, -4, 11, 4, 0, 11], true); P([-4, 9, -4, 4, 0, 1, 4, 4, 4, 9], false);
      C(0, -6, 3.4); L(-2, -8, 2, -4); break;
    case 'tower': case 'guardtower':
      P([-6, 8, -6, -6, -8, -6, -3, -11, 3, -11, 8, -6, 6, -6, 6, 8], true);
      L(0, 2, 0, 6); L(-3, -2, 3, -2); A(3, 2, 4, -1.2, 1.2); break;
    case 'cannon': case 'cannontower':
      P([-8, 8, -6, -4, -8, -4, -2, -9, 6, -6, 6, 8], true);
      L(2, -1, 12, -6, lw * 2.6); C(0, 0, 3); break;
    case 'goldmine': case 'mine':
      P([-13, 8, -9, -2, -2, -8, 7, -6, 12, 3, 8, 10, -5, 11], true);
      P([-5, 9, -5, 3, 0, 0, 5, 3, 5, 9], false); L(-8, 10, 8, 10); break;
    // ---- abilities
    case 'blizzard': case 'storm':
      P([-2, -13, -7, 1, -2, 0, -5, 12, 5, -3, 0, -1, 3, -13], true);
      L(-11, -6, -8, -3); L(9, -4, 12, -7); L(10, 6, 13, 8); break;
    case 'bolt':
      L(-10, -10, -3, -3, lw * 2); L(-3, -3, -7, 4, lw * 2); L(2, -8, 9, -1);
      C(6, 0, 4); P([3, 3, 1, 9], false); break;
    case 'clap':
      C(0, 4, 9); P([-6, -6, 0, -12, 6, -6], false); L(-12, 12, 12, 12); L(-8, -2, -12, 2); L(8, -2, 12, 2); break;
    case 'bash':
      C(0, 0, 8); P([0, -13, 0, 13], false); L(-7, -7, 7, 7); break;
    case 'avatar':
      C(0, -4, 6); P([0, 2, 0, 13]); L(0, 13, -8, 9); L(0, 13, 8, 9);
      L(-6, -1, -12, -6); L(6, -1, 12, -6); break;
    case 'holy_light':
      C(0, 0, 8); L(0, -13, 0, 13); L(-13, 0, 13, 0); L(-8, -8, 8, 8); L(8, -8, -8, 8); break;
    case 'shield_holy':
      P([0, -12, 8, -8, 8, 2, 0, 12, -8, 2, -8, -8], true); L(0, -7, 0, 7); L(-5, 0, 5, 0); break;
    case 'resurrect':
      P([0, -13, 8, 4, -8, 4], true); L(0, -6, 0, 2); L(-4, -2, 4, -2); C(0, -15, 2); break;
    case 'aura_devotion': case 'aura':
      C(0, 0, 11); C(0, 0, 6); P([0, -6, 5, 0, 0, 6, -5, 0], true); break;
    case 'aura_brilliance':
      C(0, 0, 11); C(0, 0, 5); L(0, -11, 0, -5); L(0, 5, 0, 11); L(-11, 0, -5, 0); L(5, 0, 11, 0); break;
    case 'teleport':
      C(0, 4, 10); A(0, -4, 6, 0, 5.5); P([0, -13, 3, -6, 0, 2, -3, -6], true); break;
    case 'heal':
      C(0, 0, 10); L(-5, 0, 5, 0); L(0, -5, 0, 5); L(-7, -7, 7, 7); break;
    case 'inner_fire':
      C(0, 0, 9); P([0, -12, 4, -2, 0, 8, -4, -2], true); break;
    case 'slow':
      C(0, 0, 11); A(0, 0, 7, 0, 4.4); L(0, 0, 5, -5); C(9, -9, 2.4); break;
    case 'invisible':
      A(0, 0, 12, 0.3, 2.8); C(2, -1, 3); L(-6, 9, 6, -9); break;
    case 'snare':
      C(0, 0, 10); for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; L(Math.cos(a) * 3, Math.sin(a) * 3, Math.cos(a) * 10, Math.sin(a) * 10); } break;
    // ---- items
    case 'potion_heal': case 'potion':
      P([-4, -2, -4, 8, 4, 8, 4, -2], true); R(-2, -7, 4, 5); L(-2, -8, 2, -8);
      L(-1, 3, 1, 3); L(0, 2, 0, 4); break;
    case 'potion_mana':
      P([-4, -2, -4, 8, 4, 8, 4, -2], true); R(-2, -7, 4, 5);
      P([0, 0, 2, 4, 0, 6, -2, 4], true); break;
    case 'scroll':
      P([-7, -8, 7, -8, 7, 8, -7, 8], true); L(-8, -9, 8, -9); L(-8, 9, 8, 9);
      L(-4, -3, 4, -3); L(-4, 1, 4, 1); L(-4, 5, 2, 5); break;
    case 'ring':
      C(0, 2, 8); C(0, -8, 3); P([0, -12, 3, -14, 0, -16, -3, -14], true); break;
    case 'boots':
      P([-6, -8, -6, 4, -10, 8, 2, 8, 6, 4, 2, -2, 2, -8], true); L(-6, 1, 2, 1); break;
    case 'claw':
      L(-8, -9, -3, 8); L(-2, -11, 0, 8); L(4, -10, 5, 8); L(9, -8, 10, 6); break;
    case 'tome_str': case 'tome_agi': case 'tome_int': case 'tome':
      P([-9, -8, 9, -8, 9, 8, -9, 8], true); L(-4, -8, -4, 8); L(-9, 0, 9, 0);
      L(1, -5, 6, -5); L(1, 3, 6, 3); break;
    case 'salve':
      C(0, 2, 8); R(-3, -10, 6, 6); L(-3, -4, 3, -4); L(-4, 2, 4, 2); L(0, -2, 0, 6); break;
    case 'gold':
      C(0, 0, 10); C(0, 0, 5.5); L(-4, -6, -2, -8); L(2, 7, 4, 9); break;
    case 'lumber':
      R(-11, -5, 22, 10); C(-11, 0, 5); C(11, 0, 5); L(-11, 0, 11, 0);
      L(-4, -5, -4, 5); L(4, -5, 4, 5); break;
    case 'food':
      L(0, 12, 0, -6); L(0, 2, -7, -5); L(0, 2, 7, -5); L(0, -3, -4, -10); L(0, -3, 4, -10);
      C(0, -8, 2.4); break;
    case 'supply':
      P([-8, 8, -6, -6, 6, -6, 8, 8], true); L(-6, -1, 6, -1); break;
    case 'anvil':
      P([-10, 0, 10, 0, 8, 4, -8, 4], true); R(-3, 4, 6, 4); P([-7, 8, 7, 8], false); break;
    case 'powder':
      P([-7, 8, -5, -6, 5, 0, 7, 8], true); C(4, -10, 2.4); C(8, -14, 1.6); L(-6, 10, 6, 10); break;
    case 'plate':
      P([0, -12, 9, -6, 8, 6, 0, 12, -8, 6, -9, -6], true); L(0, -12, 0, 12); L(-6, -2, 6, -2); break;
    case 'masonry':
      R(-10, -8, 20, 6); R(-10, 0, 20, 6); L(-4, -8, -4, -2); L(2, -8, 2, -2); L(-6, 0, -6, 6); L(4, 0, 4, 6); break;
    case 'training':
      C(0, -9, 3); P([0, -6, 0, 4]); L(0, 4, -5, 12); L(0, 4, 5, 12); L(0, -1, -6, 5); L(0, -1, 6, 5);
      A(0, -1, 9, -0.4, 0.4); break;
    // ---- commands
    case 'move':
      C(0, 0, 4); L(0, 0, 12, -8); P([12, -8, 8, -9, 11, -12], true); break;
    case 'stop':
      P([-8, -8, 8, -8, 8, 8, -8, 8], true); break;
    case 'hold':
      P([0, -12, 9, -8, 9, 2, 0, 12, -9, 2, -9, -8], true); L(0, -8, 0, 8); break;
    case 'attack':
      L(-10, 10, 10, -10); L(4, -10, 10, -10, lw); L(10, -10, 10, -4); R(-6, 4, 5, 5); break;
    case 'patrol':
      A(0, 0, 11, 0.6, 5.6); P([9, -7, 13, -4, 9, -1], true); break;
    case 'build':
      L(-10, -4, 0, -10); L(0, -10, 10, -4); L(-10, -4, -10, 8); L(-10, 8, 0, 12);
      L(0, 12, 10, 8); L(10, 8, 10, -4); L(0, -10, 0, 12); L(-6, 6, 6, -2); break;
    case 'gather': case 'harvest':
      P([-2, -12, 6, -8, 8, -2, 4, 2, -4, 0, -6, -6], true); L(-6, 2, -2, 10); L(4, 4, 6, 12); break;
    case 'cancel': case 'close':
      L(-8, -8, 8, 8); L(8, -8, -8, 8); break;
    case 'info':
      C(0, 0, 11); L(0, -6, 0, 4); C(0, 6, 1); break;
    case 'upgrade':
      P([0, -12, 6, -4, 3, -4, 3, 6, -3, 6, -3, -4, -6, -4], true); break;
    case 'rally':
      L(-4, 12, -4, -12); P([-4, -12, 8, -8, -4, -4], true); break;
    case 'hero_xp':
      P([0, -10, 3, -3, 10, -3, 5, 2, 7, 10, 0, 6, -7, 10, -5, 2, -10, -3, -3, -3], true); break;
    case 'ability':
      C(0, 0, 10); P([0, -7, 5, 0, 0, 7, -5, 0], true); break;
    default:
      C(0, 0, 10); C(0, 0, 4); break;
  }
}

// ------------------------------------------------------------------ tooltip icon
export function itemIcon(id) {
  return ITEMS[id] ? ITEMS[id].icon : 'info';
}

// ------------------------------------------------------------------ misc
export function drawCastBar(g, sx, sy, s, p, ink) {
  const w = 40 * s, h = 3 * s;
  g.rect(sx - w / 2, sy, w, h, PAL.black60);
  g.rect(sx - w / 2, sy, w * p, h, ink);
}
