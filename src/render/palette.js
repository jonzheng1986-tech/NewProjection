// Pure greyscale palette. Every colour in the game comes from here so the
// "single line art, no colour" rule holds.

import { color, rgba } from '../gl/gl.js';

export const PAL = {
  bg: [0.035, 0.04, 0.047, 1],
  ink: [0.95, 0.96, 0.97, 1],
  inkSoft: [0.80, 0.83, 0.85, 1],
  inkDim: [0.62, 0.66, 0.69, 1],
  inkFaint: [0.44, 0.47, 0.50, 1],
  inkGhost: [0.27, 0.29, 0.32, 1],
  inkWhisper: [0.16, 0.17, 0.19, 1],
  shade: [0.10, 0.11, 0.125, 1],
  shadeDeep: [0.065, 0.072, 0.082, 1],
  panel: [0.052, 0.057, 0.066, 0.96],
  panelSolid: [0.045, 0.05, 0.058, 1],
  panelLight: [0.075, 0.082, 0.094, 0.96],
  panelInk: [0.30, 0.33, 0.37, 1],
  panelInkBright: [0.52, 0.56, 0.60, 1],
  glass: [0.10, 0.12, 0.14, 0.55],
  white05: [1, 1, 1, 0.05],
  white08: [1, 1, 1, 0.08],
  white12: [1, 1, 1, 0.12],
  white20: [1, 1, 1, 0.2],
  white30: [1, 1, 1, 0.3],
  white50: [1, 1, 1, 0.5],
  white70: [1, 1, 1, 0.7],
  white90: [1, 1, 1, 0.9],
  black40: [0, 0, 0, 0.4],
  black60: [0, 0, 0, 0.6],
  black80: [0, 0, 0, 0.8],
  terrain: {
    grass: [0.083, 0.09, 0.099, 1],
    grassAlt: [0.072, 0.078, 0.087, 1],
    dirt: [0.098, 0.096, 0.092, 1],
    dirtAlt: [0.086, 0.084, 0.081, 1],
    rock: [0.115, 0.12, 0.127, 1],
    rockAlt: [0.096, 0.10, 0.108, 1],
    water: [0.055, 0.066, 0.078, 1],
    waterLine: [0.30, 0.34, 0.38, 1],
  },
};

export const INK_LINE = 0.045;      // default stroke widths in world/px units
export const SELECTIVE = rgba(PAL.ink, 0.85);

export { color, rgba };
