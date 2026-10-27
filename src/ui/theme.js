// Shared UI drawing helpers: framed panels, buttons, tooltips, labels.
// Pure greyscale line work, no fills with colour.

import { PAL } from '../render/palette.js';
import { drawIcon } from '../render/art.js';
import { FONT_SANS, FONT_SERIF, FONT_MONO } from '../gl/font.js';
import { clamp } from '../core/util.js';

export { FONT_SANS, FONT_SERIF, FONT_MONO };

export const T = {
  body: 13,
  small: 11,
  tiny: 10,
  label: 12,
  button: 12,
  name: 16,
  header: 18,
  title: 46,
};

// A dark framed panel with a 1px outline and hairline inset.
export function panel(g, x, y, w, h, opts = {}) {
  const a = opts.opacity === undefined ? 0.95 : opts.opacity;
  const fill = opts.fill || [PAL.panel[0], PAL.panel[1], PAL.panel[2], a];
  g.rect(x, y, w, h, fill);
  if (opts.glass) g.rect(x, y, w, h, PAL.glass);
  g.strokeRect(x, y, w, h, opts.border || 1, opts.borderColor || PAL.panelInk);
  if (opts.inset !== false) {
    g.strokeRect(x + 3, y + 3, w - 6, h - 6, 1, opts.insetColor || PAL.white05);
  }
  if (opts.corners) cornerTicks(g, x, y, w, h, opts.corners, opts.cornerColor || PAL.panelInkBright);
}

export function cornerTicks(g, x, y, w, h, len = 8, c = PAL.panelInkBright, lw = 1) {
  g.seg(x, y, x + len, y, lw, c);
  g.seg(x, y, x, y + len, lw, c);
  g.seg(x + w - len, y, x + w, y, lw, c);
  g.seg(x + w, y, x + w, y + len, lw, c);
  g.seg(x, y + h - len, x, y + h, lw, c);
  g.seg(x, y + h, x + len, y + h, lw, c);
  g.seg(x + w - len, y + h, x + w, y + h, lw, c);
  g.seg(x + w, y + h - len, x + w, y + h, lw, c);
}

export function divider(g, x, y, w, c = PAL.white08) {
  g.seg(x, y, x + w, y, 1, c);
}

export function label(g, text, x, y, opts = {}) {
  const size = opts.size || T.small;
  return g.text(text, x, y, {
    size,
    weight: opts.weight || 600,
    color: opts.color || PAL.inkDim,
    align: opts.align || 'left',
    baseline: opts.baseline,
    tracking: opts.tracking === undefined ? 0.6 : opts.tracking,
    family: opts.family || FONT_SANS,
  });
}

export function title(g, text, x, y, opts = {}) {
  return g.text(text, x, y, {
    size: opts.size || T.name,
    weight: 600,
    color: opts.color || PAL.ink,
    align: opts.align || 'left',
    baseline: opts.baseline,
    family: opts.family || FONT_SERIF,
    tracking: opts.tracking === undefined ? 0.4 : opts.tracking,
  });
}

// Command card button. Returns nothing; the caller owns hit regions.
export function commandButton(g, x, y, w, h, cmd, state = {}) {
  const hover = state.hover;
  const enabled = cmd.enabled !== false;
  const active = cmd.active;
  const a = enabled ? 1 : 0.32;
  const ink = enabled ? (hover ? PAL.ink : PAL.inkSoft) : PAL.inkFaint;
  g.rect(x, y, w, h, [0.07, 0.076, 0.087, 0.95]);
  if (active) g.rect(x, y, w, h, [1, 1, 1, 0.08]);
  if (hover && enabled) g.rect(x, y, w, h, [1, 1, 1, 0.07]);
  g.strokeRect(x, y, w, h, 1, enabled ? (hover ? PAL.ink : PAL.panelInkBright) : PAL.panelInk);
  const iconSize = Math.min(w, h) * 0.62;
  if (cmd.icon) {
    drawIconAlpha(g, cmd.icon, x + w / 2, y + h / 2 - 2, iconSize, ink, a);
  } else if (cmd.label) {
    const lines = g.wrapText(cmd.label, w - 8, T.tiny, 600);
    lines.slice(0, 2).forEach((ln, i) => {
      g.text(ln, x + w / 2, y + h / 2 - 6 + i * 12, {
        size: T.tiny, weight: 600, color: ink, align: 'center', baseline: 'middle', family: FONT_SANS,
      });
    });
  }
  // hotkey
  if (cmd.hotkey) {
    g.text(cmd.hotkey, x + 4, y + h - 12, { size: T.tiny, weight: 700, color: enabled ? PAL.inkDim : PAL.inkGhost });
  }
  // cost
  if (cmd.cost) {
    const str = cmd.cost.gold ? `${cmd.cost.gold}` : (cmd.cost.lumber ? `${cmd.cost.lumber}` : '');
    if (str) g.text(str, x + w - 4, y + h - 12, { size: T.tiny, weight: 600, color: enabled ? PAL.white50 : PAL.inkGhost, align: 'right' });
  }
  if (cmd.charges !== undefined && cmd.charges !== null) {
    g.text(String(cmd.charges), x + w - 4, y + 4, { size: T.tiny, weight: 700, color: PAL.inkSoft, align: 'right' });
  }
  if (cmd.level) {
    g.text(cmd.level, x + 4, y + 4, { size: T.tiny, weight: 700, color: PAL.inkDim });
  }
  if (cmd.learning) {
    // little "+" affordance
    g.ring(x + w - 9, y + 9, 6, 1, PAL.ink, 10);
    g.seg(x + w - 12, y + 9, x + w - 6, y + 9, 1.4, PAL.ink);
    g.seg(x + w - 9, y + 6, x + w - 9, y + 12, 1.4, PAL.ink);
  }
  if (!enabled) {
    g.seg(x + 4, y + h - 4, x + w - 4, y + 4, 1, [0, 0, 0, 0.5]);
  }
}

// alpha-aware icon wrapper
function drawIconAlpha(g, id, cx, cy, size, ink, alpha) {
  const c = [ink[0], ink[1], ink[2], (ink[3] === undefined ? 1 : ink[3]) * alpha];
  drawIcon(g, id, cx, cy, size, c);
}

export function bar(g, x, y, w, h, value, opts = {}) {
  const v = clamp(value, 0, 1);
  g.rect(x, y, w, h, opts.bg || [0.10, 0.11, 0.13, 1]);
  if (v > 0) g.rect(x, y, w * v, h, opts.fg || PAL.inkSoft);
  g.strokeRect(x, y, w, h, 1, opts.border || PAL.panelInk);
  if (opts.ticks) {
    for (let i = 1; i < opts.ticks; i++) {
      g.seg(x + (w * i) / opts.ticks, y, x + (w * i) / opts.ticks, y + h, 1, [0, 0, 0, 0.5]);
    }
  }
}

export function tooltip(g, x, y, opts) {
  const maxW = opts.width || 280;
  const titleLines = g.wrapText(opts.title || '', maxW - 20, T.body + 1, 600, FONT_SERIF);
  const bodyLines = opts.body ? g.wrapText(opts.body, maxW - 20, T.small, 400, FONT_SANS) : [];
  const hintLines = opts.hint ? g.wrapText(opts.hint, maxW - 20, T.tiny, 400, FONT_SANS) : [];
  let h = 10 + titleLines.length * (T.body + 3);
  if (opts.subtitle) h += 16;
  if (opts.costLine) h += 16;
  if (bodyLines.length) h += 6 + bodyLines.length * (T.small + 3);
  if (hintLines.length) h += 4 + hintLines.length * (T.tiny + 3);
  if (opts.extraLines) h += opts.extraLines * 14;
  h += 10;
  const w = maxW;
  let bx = x + 18;
  let by = y - h - 12;
  if (bx + w > g.width - 8) bx = g.width - w - 8;
  if (by < 8) by = y + 22;
  if (by + h > g.height - 8) by = g.height - h - 8;
  g.rect(bx + 3, by + 3, w, h, [0, 0, 0, 0.5]);
  panel(g, bx, by, w, h, { opacity: 0.98, borderColor: PAL.panelInkBright, corners: 7 });
  let ty = by + 8;
  for (const ln of titleLines) {
    g.text(ln, bx + 10, ty, { size: T.body + 1, weight: 600, color: PAL.ink, family: FONT_SERIF });
    ty += T.body + 3;
  }
  if (opts.subtitle) {
    g.text(opts.subtitle, bx + 10, ty + 1, { size: T.small, weight: 500, color: PAL.inkDim });
    ty += 16;
  }
  if (opts.costLine) {
    g.text(opts.costLine, bx + 10, ty, { size: T.small, weight: 600, color: PAL.inkSoft });
    ty += 16;
  }
  if (bodyLines.length) {
    ty += 4;
    for (const ln of bodyLines) {
      g.text(ln, bx + 10, ty, { size: T.small, weight: 400, color: PAL.inkDim, family: FONT_SANS });
      ty += T.small + 3;
    }
  }
  if (opts.extraLines) ty += opts.extraLines * 14;
  if (hintLines.length) {
    ty += 3;
    for (const ln of hintLines) {
      g.text(ln, bx + 10, ty, { size: T.tiny, weight: 400, color: PAL.inkFaint, family: FONT_SANS });
      ty += T.tiny + 3;
    }
  }
  return { x: bx, y: by, w, h };
}

export function iconBadge(g, x, y, size, id, opts = {}) {
  g.rect(x, y, size, size, [0.075, 0.08, 0.09, 1]);
  g.strokeRect(x, y, size, size, 1, opts.border || PAL.panelInk);
  drawIcon(g, id, x + size / 2, y + size / 2, size * 0.62, opts.ink || PAL.inkSoft, 1);
}

export function fmtCost(cost) {
  if (!cost) return '';
  const parts = [];
  if (cost.gold) parts.push(`${cost.gold} gold`);
  if (cost.lumber) parts.push(`${cost.lumber} lumber`);
  if (cost.food) parts.push(`${cost.food} food`);
  return parts.join('  ');
}

export function costShort(cost) {
  if (!cost) return '';
  const parts = [];
  if (cost.gold) parts.push(`${cost.gold}g`);
  if (cost.lumber) parts.push(`${cost.lumber}l`);
  return parts.join(' ');
}
