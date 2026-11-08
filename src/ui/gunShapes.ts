// The six guns as boxes (see gunModel.ts for the coordinates). Same blocky style for all: a
// pale or dark receiver, shaded faces with an ink outline, and glowing parts in the gun's
// accent colour. The grip is in the same place on every gun, so the one hand holds them all.
import type { GunId } from '../game/guns.ts';
import type { Box, Decal, GunShape } from './gunModel.ts';

const PALE = '#e4e1f7';
const DARK = '#2b2752';
const NAVY = '#3b3570';
const FRAME = '#6f68b8';
const STEEL = '#9d97c9';
const WINDOW = '#1b1840';
const WOOD = '#9a6236';
const LIME = '#c6ff3a';
const CYAN = '#26e0ff';
const MAGENTA = '#ff3d8b';
const YELLOW = '#ffd23e';
const RED = '#ff4d4d';
const PURPLE = '#a855ff';

/** Slots cut into a face, rear to front between u0 and u1. */
function vents(face: Decal['face'], n: number, u0: number, u1: number, v: [number, number], color = WINDOW): Decal[] {
  const step = (u1 - u0) / n;
  return Array.from({ length: n }, (_, i) => ({ face, u: [u0 + i * step, u0 + i * step + step * 0.55] as [number, number], v, color }));
}

/** Trigger guard, trigger and grip, shared by every gun. */
function lower(gripColor = DARK): Box[] {
  return [
    { min: [-0.045, -0.6, 0.5], max: [0.045, -0.42, 0.57], color: DARK },
    { min: [-0.045, -0.64, 0.3], max: [0.045, -0.58, 0.57], color: DARK },
    { min: [-0.02, -0.56, 0.4], max: [0.02, -0.42, 0.45], color: DARK },
    { min: [-0.115, -1.0, 0.04], max: [0.115, -0.42, 0.34], color: gripColor },
  ];
}

const blip: GunShape = {
  body: [
    // Barrel block, sticking out past the slide, with a glowing band near the muzzle.
    { min: [-0.09, -0.24, 0.96], max: [0.09, -0.05, 1.2], color: DARK, decals: [{ face: 'left', u: [0.55, 0.78], v: [0.18, 0.82], color: LIME, glow: true }] },
    { min: [-0.115, -0.42, 0.04], max: [0.115, -0.28, 0.9], color: FRAME, decals: [{ face: 'left', u: [0.5, 0.92], v: [0.32, 0.68], color: MAGENTA }] },
    ...lower(),
  ],
  action: [
    {
      min: [-0.13, -0.28, 0],
      max: [0.13, 0, 1.0],
      color: PALE,
      decals: [
        // The energy window on the back, like the reference blaster's glowing port.
        { face: 'back', u: [0.16, 0.84], v: [0.2, 0.84], color: WINDOW },
        { face: 'back', u: [0.28, 0.72], v: [0.34, 0.7], color: LIME, glow: true },
        ...vents('left', 3, 0.06, 0.33, [0.3, 0.76]),
        { face: 'left', u: [0.42, 0.92], v: [0.42, 0.58], color: LIME, glow: true },
        { face: 'top', u: [0.08, 0.92], v: [0.4, 0.6], color: STEEL },
      ],
    },
    { min: [-0.1, 0, 0.02], max: [-0.06, 0.045, 0.08], color: DARK },
    { min: [0.06, 0, 0.02], max: [0.1, 0.045, 0.08], color: DARK },
    { min: [-0.025, 0, 0.86], max: [0.025, 0.05, 0.94], color: DARK },
  ],
  travel: [0, 0, -0.16],
  bore: -0.145,
  muzzle: 1.2,
  ejection: [0.04, 0, 0.45],
  distance: 1,
};

// A compact SMG: dark receiver with a cyan glow strip, a long stick magazine in front of the
// trigger guard, a vented barrel shroud and a small red-dot sight with a cyan lens.
const stinger: GunShape = {
  body: [
    {
      min: [-0.14, -0.3, 0],
      max: [0.14, 0, 1.12],
      color: NAVY,
      decals: [
        { face: 'back', u: [0.18, 0.82], v: [0.22, 0.8], color: WINDOW },
        { face: 'back', u: [0.3, 0.7], v: [0.36, 0.66], color: CYAN, glow: true },
        { face: 'left', u: [0.08, 0.6], v: [0.62, 0.74], color: CYAN, glow: true },
        ...vents('left', 4, 0.66, 0.96, [0.25, 0.7]),
        { face: 'top', u: [0.05, 0.95], v: [0.38, 0.62], color: DARK },
      ],
    },
    { min: [-0.115, -0.42, 0.04], max: [0.115, -0.3, 1.0], color: DARK },
    { min: [-0.07, -1.02, 0.64], max: [0.07, -0.42, 0.82], color: DARK, decals: [{ face: 'left', u: [0.25, 0.75], v: [0.12, 0.88], color: STEEL }] },
    {
      min: [-0.085, -0.23, 1.12],
      max: [0.085, -0.05, 1.42],
      color: DARK,
      decals: [...vents('left', 3, 0.08, 0.62, [0.3, 0.7], NAVY), { face: 'left', u: [0.72, 0.9], v: [0.2, 0.8], color: CYAN, glow: true }],
    },
    // Red-dot sight on top.
    { min: [-0.07, 0, 0.18], max: [0.07, 0.13, 0.42], color: DARK, decals: [{ face: 'back', u: [0.2, 0.8], v: [0.22, 0.78], color: CYAN, glow: true }] },
    ...lower(NAVY),
  ],
  // Charging handle on the left side, pulled back with each shot.
  action: [{ min: [-0.21, -0.17, 0.5], max: [-0.14, -0.09, 0.66], color: CYAN }],
  travel: [0, 0, -0.14],
  bore: -0.14,
  muzzle: 1.42,
  ejection: [0.06, 0, 0.6],
  distance: 1.06,
};

// A burst rifle, short and chunky: pale receiver with magenta panels, a carry-handle sight
// with a glowing window, a fat vented handguard, a stubby barrel with a magenta muzzle brake,
// and a stock behind.
const triplet: GunShape = {
  body: [
    {
      min: [-0.14, -0.3, -0.15],
      max: [0.14, 0, 1.0],
      color: PALE,
      decals: [
        { face: 'back', u: [0.16, 0.84], v: [0.2, 0.8], color: WINDOW },
        { face: 'back', u: [0.3, 0.7], v: [0.34, 0.66], color: MAGENTA, glow: true },
        { face: 'left', u: [0.46, 0.92], v: [0.25, 0.7], color: MAGENTA },
        ...vents('left', 3, 0.12, 0.38, [0.3, 0.72]),
      ],
    },
    { min: [-0.115, -0.42, 0.04], max: [0.115, -0.3, 0.98], color: DARK },
    { min: [-0.08, -0.9, 0.6], max: [0.08, -0.42, 0.86], color: DARK, decals: [{ face: 'left', u: [0.3, 0.7], v: [0.1, 0.9], color: MAGENTA }] },
    { min: [-0.13, -0.28, 1.0], max: [0.13, -0.02, 1.44], color: DARK, decals: vents('left', 3, 0.1, 0.9, [0.3, 0.7], MAGENTA) },
    { min: [-0.06, -0.19, 1.44], max: [0.06, -0.07, 1.62], color: STEEL },
    { min: [-0.085, -0.22, 1.62], max: [0.085, -0.04, 1.76], color: MAGENTA },
    // Carry handle with its rear sight window.
    {
      min: [-0.06, 0, 0.08],
      max: [0.06, 0.14, 0.8],
      color: DARK,
      decals: [{ face: 'back', u: [0.15, 0.85], v: [0.2, 0.8], color: MAGENTA, glow: true }, { face: 'left', u: [0.2, 0.8], v: [0.35, 0.65], color: NAVY }],
    },
    { min: [-0.03, -0.02, 1.3], max: [0.03, 0.11, 1.38], color: DARK },
    { min: [-0.11, -0.46, -0.85], max: [0.11, -0.1, -0.15], color: DARK },
    ...lower(),
  ],
  // Charging handle at the back of the receiver.
  action: [{ min: [-0.08, -0.06, -0.24], max: [0.08, 0.02, -0.15], color: MAGENTA }],
  travel: [0, 0, -0.12],
  bore: -0.13,
  muzzle: 1.76,
  ejection: [0.06, 0, 0.5],
  distance: 1.06,
};

// A heavy revolver: gunmetal frame, a fat pale cylinder with chambers on its face, a long
// barrel with a yellow rib, and a hammer at the back that cocks with each shot.
const thumper: GunShape = {
  body: [
    { min: [-0.115, -0.42, 0.02], max: [0.115, -0.3, 0.36], color: FRAME },
    { min: [-0.11, -0.36, 0], max: [0.11, -0.03, 0.5], color: FRAME },
    {
      min: [-0.165, -0.35, 0.08],
      max: [0.165, -0.02, 0.46],
      color: PALE,
      decals: [
        { face: 'back', u: [0.12, 0.38], v: [0.56, 0.86], color: WINDOW },
        { face: 'back', u: [0.62, 0.88], v: [0.56, 0.86], color: WINDOW },
        { face: 'back', u: [0.12, 0.38], v: [0.14, 0.44], color: WINDOW },
        { face: 'back', u: [0.62, 0.88], v: [0.14, 0.44], color: WINDOW },
        { face: 'left', u: [0, 1], v: [0.42, 0.58], color: YELLOW, glow: true },
        { face: 'top', u: [0, 1], v: [0.4, 0.6], color: STEEL },
      ],
    },
    { min: [-0.075, -0.21, 0.5], max: [0.075, -0.03, 1.28], color: DARK, decals: [{ face: 'left', u: [0.7, 0.88], v: [0.2, 0.8], color: YELLOW, glow: true }] },
    { min: [-0.065, -0.33, 0.5], max: [0.065, -0.21, 1.05], color: FRAME },
    { min: [-0.03, -0.03, 0.5], max: [0.03, 0.04, 1.28], color: YELLOW },
    { min: [-0.02, 0.04, 1.17], max: [0.02, 0.09, 1.25], color: DARK },
    ...lower(FRAME),
  ],
  action: [{ min: [-0.045, -0.15, -0.12], max: [0.045, 0.06, 0.01], color: DARK, decals: [{ face: 'back', u: [0.2, 0.8], v: [0.6, 0.9], color: YELLOW, glow: true }] }],
  travel: [0, 0.04, -0.08],
  bore: -0.12,
  muzzle: 1.28,
  ejection: [0.1, -0.1, 0.3],
  distance: 1.02,
};

// A pump shotgun, sawn short: dark receiver with a shell showing in its side window, a fat
// barrel with a vent rib and a red bead, the tube magazine under it, a wooden pump and stock.
const boomstick: GunShape = {
  body: [
    {
      min: [-0.15, -0.36, -0.05],
      max: [0.15, 0, 0.72],
      color: NAVY,
      decals: [
        { face: 'left', u: [0.4, 0.84], v: [0.3, 0.68], color: WINDOW },
        { face: 'left', u: [0.46, 0.78], v: [0.38, 0.6], color: RED, glow: true },
        { face: 'back', u: [0.18, 0.82], v: [0.24, 0.8], color: WINDOW },
        { face: 'back', u: [0.32, 0.68], v: [0.38, 0.66], color: RED, glow: true },
      ],
    },
    { min: [-0.115, -0.42, 0.04], max: [0.115, -0.34, 0.66], color: DARK },
    { min: [-0.11, -0.2, 0.72], max: [0.11, 0, 1.62], color: DARK, decals: [{ face: 'left', u: [0.86, 0.95], v: [0.2, 0.8], color: RED, glow: true }] },
    { min: [-0.035, 0, 0.72], max: [0.035, 0.035, 1.6], color: STEEL },
    { min: [-0.025, 0.035, 1.53], max: [0.025, 0.08, 1.59], color: RED },
    { min: [-0.08, -0.36, 0.72], max: [0.08, -0.2, 1.5], color: DARK },
    { min: [-0.11, -0.54, -0.86], max: [0.11, -0.12, -0.05], color: WOOD },
    ...lower(WOOD),
  ],
  // The pump, racked after every shot.
  action: [{ min: [-0.14, -0.4, 0.88], max: [0.14, -0.16, 1.32], color: WOOD, decals: vents('left', 4, 0.1, 0.92, [0.25, 0.75], '#6b4022') }],
  travel: [0, 0, -0.22],
  bore: -0.1,
  muzzle: 1.62,
  ejection: [0.08, -0.05, 0.38],
  distance: 1.06,
};

// A sniper rifle, chunky: dark purple receiver, a thick barrel with a muzzle brake, a big pale
// scope with a glowing cyan lens, a stock, and a bolt handle that cycles after each shot.
const longshot: GunShape = {
  body: [
    { min: [-0.13, -0.27, -0.1], max: [0.13, 0, 0.9], color: NAVY, decals: [{ face: 'left', u: [0.45, 0.92], v: [0.35, 0.6], color: PURPLE, glow: true }] },
    { min: [-0.115, -0.42, 0.04], max: [0.115, -0.27, 0.95], color: DARK },
    { min: [-0.07, -0.58, 0.5], max: [0.07, -0.42, 0.74], color: DARK },
    { min: [-0.06, -0.19, 0.9], max: [0.06, -0.07, 1.58], color: DARK, decals: [{ face: 'left', u: [0.1, 0.9], v: [0.4, 0.6], color: NAVY }] },
    { min: [-0.085, -0.22, 1.58], max: [0.085, -0.04, 1.72], color: PURPLE, decals: vents('left', 2, 0.15, 0.85, [0.3, 0.7]) },
    // Scope: mounts, tube, eyepiece with the lens, objective bell.
    { min: [-0.035, 0, 0.22], max: [0.035, 0.05, 0.32], color: DARK },
    { min: [-0.035, 0, 0.62], max: [0.035, 0.05, 0.72], color: DARK },
    { min: [-0.075, 0.05, 0.06], max: [0.075, 0.19, 0.9], color: PALE, decals: [{ face: 'left', u: [0.35, 0.65], v: [0.3, 0.7], color: STEEL }] },
    { min: [-0.1, 0.03, -0.08], max: [0.1, 0.22, 0.08], color: DARK, decals: [{ face: 'back', u: [0.18, 0.82], v: [0.18, 0.82], color: CYAN, glow: true }] },
    { min: [-0.11, 0.02, 0.84], max: [0.11, 0.23, 1.02], color: DARK, decals: [{ face: 'left', u: [0.2, 0.8], v: [0.2, 0.8], color: PURPLE, glow: true }] },
    { min: [-0.11, -0.46, -0.92], max: [0.11, -0.08, -0.1], color: NAVY, decals: [{ face: 'left', u: [0.1, 0.9], v: [0.42, 0.58], color: PURPLE }] },
    ...lower(NAVY),
  ],
  // Bolt handle out to the left, worked back after each shot.
  action: [
    { min: [-0.25, -0.12, 0.08], max: [-0.13, -0.05, 0.16], color: STEEL },
    { min: [-0.31, -0.15, 0.06], max: [-0.23, -0.04, 0.18], color: PURPLE },
  ],
  travel: [0, 0, -0.2],
  bore: -0.13,
  muzzle: 1.72,
  ejection: [0.06, 0, 0.3],
  distance: 1.06,
};

export const SHAPES: Record<GunId, GunShape> = { blip, stinger, triplet, thumper, boomstick, longshot };
