// The guns are built from boxes in 3D and projected to flat polygons, once each (nothing
// moves in 3D; the animations are 2D transforms in CSS). Two cameras:
//   - first person: the gun in a gloved hand in the lower right, aimed at the crosshair
//   - showcase: the gun side-on for the Armory, pointing right
// The shapes themselves are in gunShapes.ts.

export type V3 = [number, number, number];
export type V2 = [number, number];

export type Face = 'left' | 'right' | 'top' | 'bottom' | 'back' | 'front';
export interface Decal {
  face: Face;
  u: [number, number];
  v: [number, number];
  color: string;
  /** Lit from inside: not shaded with the face. */
  glow?: boolean;
}
export interface Box {
  min: V3;
  max: V3;
  color: string;
  decals?: Decal[];
}

/** One gun, in gun-local coordinates: x right, y up, z forward; the origin is the rear-top-centre of the receiver. */
export interface GunShape {
  /** Parts that never move. */
  body: Box[];
  /** The part that cycles after a shot: slide, bolt, pump or hammer. */
  action: Box[];
  /** How far and which way the action travels when it cycles. */
  travel: V3;
  /** Height of the bore below the top of the receiver, and where the muzzle ends. */
  bore: number;
  muzzle: number;
  /** Where a spent casing comes out. */
  ejection: V3;
  /** Held further from the camera, so a long gun takes no more of the screen than the pistol. */
  distance: number;
}

export type Part = 'body' | 'action' | 'hand';
export interface Poly {
  points: string;
  fill: string;
  outline: boolean;
}
export interface GunModel {
  /** Drawn in this order: body, action, hand. */
  parts: Record<Part, Poly[]>;
  /** In the model's own coordinates (viewBox 0 0 width height). */
  muzzle: V2;
  ejection: V2;
  /** Where the recoil and reload turn around: the middle of the hand. */
  pivot: V2;
  /** How far the action moves on screen when it cycles. */
  travel: V2;
  /** Screen angle of the barrel, rear to muzzle, in degrees. */
  axisDeg: number;
  width: number;
  height: number;
  /** Where the model's top-left corner sits in the design frame. */
  offset: V2;
}

/** The design frame: a 390 x 844 phone screen with the crosshair in the middle. */
export const FRAME = { w: 390, h: 844 };
const FOCAL = 400;

/** How the gun is held in first person. */
export interface Pose {
  /** Where the rear-top-centre of the pistol sits in camera space (x right, y up, z forward). */
  origin: V3;
  /** The barrel converges on the crosshair at this distance in front of the camera. */
  aim: number;
  /** Cant about the barrel; negative tips the top away from the middle of the screen. */
  roll: number;
}

/** Held out at the right edge just above the Fire button, the arm coming in from the
 *  bottom-right corner, so the gun points diagonally into the screen the way shooters show it
 *  and stays clear of the middle. Far enough from the camera that it stays small. */
export const FIRST_PERSON: Pose = { origin: [1.05, -1.1, 2.5], aim: 9, roll: -18 * (Math.PI / 180) };
const LIGHT = normalize([-0.45, 0.8, -0.4]);

const GLOVE = '#8a5a34';
const SLEEVE = '#8a4fe0';
const LIME = '#c6ff3a';

// A right hand: fingers wrapped round the grip, thumb along the left side, trigger finger
// resting on the frame, then a lime cuff and the sleeve running off the bottom of the screen.
// Every gun's grip sits in the same place, so one hand holds them all.
const HAND: Box[] = [
  { min: [-0.16, -1.05, -0.75], max: [0.24, -0.44, -0.2], color: SLEEVE },
  { min: [-0.17, -1.0, -0.22], max: [0.17, -0.46, -0.04], color: LIME },
  {
    min: [-0.155, -0.92, -0.04],
    max: [0.155, -0.5, 0.4],
    color: GLOVE,
    decals: [
      { face: 'left', u: [0.62, 1], v: [0.24, 0.27], color: '#4a2c16' },
      { face: 'left', u: [0.62, 1], v: [0.49, 0.52], color: '#4a2c16' },
      { face: 'left', u: [0.62, 1], v: [0.74, 0.77], color: '#4a2c16' },
    ],
  },
  { min: [-0.18, -0.53, 0.04], max: [-0.1, -0.44, 0.26], color: GLOVE },
  { min: [-0.15, -0.47, 0.36], max: [-0.1, -0.4, 0.64], color: GLOVE },
];

function normalize([x, y, z]: V3): V3 {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** A camera looking at a gun: how gun-local points land in camera space and on screen. */
export interface View {
  /** Gun-local direction to camera space: roll about the barrel, then pitch, then yaw. */
  rotate(v: V3): V3;
  toCamera(p: V3): V3;
  /** A gun-local point to screen coordinates. */
  project(p: V3): V2;
  light: V3;
}

function makeView(o: { origin: V3; roll: number; pitch: number; yaw: number; cx: number; cy: number; mirror?: boolean; light?: V3 }): View {
  const [cr, sr, cp, sp, cyw, syw] = [Math.cos(o.roll), Math.sin(o.roll), Math.cos(o.pitch), Math.sin(o.pitch), Math.cos(o.yaw), Math.sin(o.yaw)];
  const rotate = ([x, y, z]: V3): V3 => {
    const x1 = x * cr - y * sr;
    const y1 = x * sr + y * cr;
    const y2 = y1 * cp - z * sp;
    const z2 = y1 * sp + z * cp;
    return [x1 * cyw + z2 * syw, y2, -x1 * syw + z2 * cyw];
  };
  const toCamera = (p: V3): V3 => {
    const r = rotate(p);
    return [r[0] + o.origin[0], r[1] + o.origin[1], r[2] + o.origin[2]];
  };
  const sx = o.mirror ? -1 : 1;
  return {
    rotate,
    toCamera,
    project: (p) => {
      const [x, y, z] = toCamera(p);
      return [o.cx + (sx * FOCAL * x) / z, o.cy - (FOCAL * y) / z];
    },
    light: o.light ?? LIGHT,
  };
}

/** The first-person camera for a gun: its barrel converges on the crosshair. */
export function firstPersonView(shape: GunShape, pose = FIRST_PERSON): View {
  const origin = pose.origin.map((v) => v * shape.distance) as V3;
  const bore: V3 = [origin[0], origin[1] + shape.bore, origin[2]];
  const yaw = Math.atan2(-bore[0], pose.aim - bore[2]);
  const pitch = -Math.atan2(-bore[1], Math.hypot(bore[0], pose.aim - bore[2]));
  return makeView({ origin, roll: pose.roll, pitch, yaw, cx: FRAME.w / 2, cy: FRAME.h / 2 });
}

const NORMALS: Record<Face, V3> = {
  left: [-1, 0, 0],
  right: [1, 0, 0],
  top: [0, 1, 0],
  bottom: [0, -1, 0],
  back: [0, 0, -1],
  front: [0, 0, 1],
};

/** A point on a box face; u and v run 0 to 1 across it (see each case). */
function facePoint(b: Box, f: Face, u: number, v: number): V3 {
  const [x0, y0, z0] = b.min;
  const [x1, y1, z1] = b.max;
  const X = (t: number) => x0 + (x1 - x0) * t;
  const Y = (t: number) => y0 + (y1 - y0) * t;
  const Z = (t: number) => z0 + (z1 - z0) * t;
  switch (f) {
    case 'left': return [x0, Y(v), Z(u)]; // u rear to front, v bottom to top
    case 'right': return [x1, Y(v), Z(1 - u)];
    case 'top': return [X(v), y1, Z(u)]; // u rear to front, v left to right
    case 'bottom': return [X(v), y0, Z(1 - u)];
    case 'back': return [X(u), Y(v), z0]; // u left to right, v bottom to top
    case 'front': return [X(1 - u), Y(v), z1];
  }
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (s: number) => Math.min(255, Math.round(((n >> s) & 255) * k));
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}

interface RawPoly {
  pts: V2[];
  fill: string;
  outline: boolean;
}

function quad(view: View, b: Box, f: Face, u: [number, number], v: [number, number]): V2[] {
  return [
    view.project(facePoint(b, f, u[0], v[0])),
    view.project(facePoint(b, f, u[1], v[0])),
    view.project(facePoint(b, f, u[1], v[1])),
    view.project(facePoint(b, f, u[0], v[1])),
  ];
}

/** The faces of a box the camera can see, shaded, with their decals on top. */
export function visibleFaces(view: View, b: Box): { face: Face; polys: RawPoly[] }[] {
  const out: { face: Face; polys: RawPoly[] }[] = [];
  for (const f of Object.keys(NORMALS) as Face[]) {
    const n = view.rotate(NORMALS[f]);
    if (dot(n, view.toCamera(facePoint(b, f, 0.5, 0.5))) >= 0) continue; // facing away
    const k = 0.56 + 0.44 * Math.max(0, dot(n, view.light));
    const polys: RawPoly[] = [{ pts: quad(view, b, f, [0, 1], [0, 1]), fill: shade(b.color, k), outline: true }];
    for (const d of b.decals ?? []) {
      if (d.face === f) polys.push({ pts: quad(view, b, f, d.u, d.v), fill: d.glow ? d.color : shade(d.color, k), outline: false });
    }
    out.push({ face: f, polys });
  }
  return out;
}

function centreDistance(view: View, b: Box): number {
  const c = view.toCamera([(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2]);
  return Math.hypot(...c);
}

/** Painter's order within a part: farthest box first. */
function partPolys(view: View, boxes: Box[]): RawPoly[] {
  return [...boxes].sort((a, b) => centreDistance(view, b) - centreDistance(view, a)).flatMap((b) => visibleFaces(view, b).flatMap((f) => f.polys));
}

const fmt = (ps: V2[], at: (p: V2) => V2) => ps.map((p) => at(p).map((n) => n.toFixed(1)).join(',')).join(' ');

function boxCentre(boxes: Box[]): V3 {
  const lo = [0, 1, 2].map((i) => Math.min(...boxes.map((b) => b.min[i])));
  const hi = [0, 1, 2].map((i) => Math.max(...boxes.map((b) => b.max[i])));
  return [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
}

/** The gun in first person, anchored to the bottom-right corner of the design frame. */
export function buildGun(shape: GunShape, pose = FIRST_PERSON): GunModel {
  const view = firstPersonView(shape, pose);
  const raw: Record<Part, RawPoly[]> = { body: partPolys(view, shape.body), action: partPolys(view, shape.action), hand: partPolys(view, HAND) };
  const muzzleF = view.project([0, shape.bore, shape.muzzle]);
  const rearF = view.project([0, shape.bore, 0]);
  // Room above and left of the gun for the muzzle flash and the casing; the frame's right and
  // bottom edges are the screen's.
  const pts = Object.values(raw).flatMap((ps) => ps.flatMap((p) => p.pts));
  const left = Math.max(0, Math.min(...pts.map((p) => p[0]), muzzleF[0]) - 46);
  const top = Math.max(0, Math.min(...pts.map((p) => p[1]), muzzleF[1]) - 64);
  const at = ([x, y]: V2): V2 => [x - left, y - top];
  const parts = Object.fromEntries(
    Object.entries(raw).map(([k, ps]) => [k, ps.map((p) => ({ points: fmt(p.pts, at), fill: p.fill, outline: p.outline }))]),
  ) as Record<Part, Poly[]>;
  const a = boxCentre(shape.action);
  const from = view.project(a);
  const to = view.project([a[0] + shape.travel[0], a[1] + shape.travel[1], a[2] + shape.travel[2]]);
  return {
    parts,
    muzzle: at(muzzleF),
    ejection: at(view.project(shape.ejection)),
    pivot: at(view.project([0, -0.7, 0.18])),
    travel: [to[0] - from[0], to[1] - from[1]],
    axisDeg: (Math.atan2(muzzleF[1] - rearF[1], muzzleF[0] - rearF[0]) * 180) / Math.PI,
    width: FRAME.w - left,
    height: FRAME.h - top,
    offset: [left, top],
  };
}

export interface Showcase {
  parts: { body: Poly[]; action: Poly[] };
  width: number;
  height: number;
}

/**
 * The gun side-on for the Armory: seen from its left and a little above and behind, then
 * mirrored so it points right (the shapes are symmetric apart from decals). Fitted to the
 * box, so every gun fills the display case.
 */
export function buildShowcase(shape: GunShape, w: number, h: number): Showcase {
  const view = makeView({
    origin: [0, 0, 7],
    roll: 0,
    pitch: 0.32,
    yaw: -Math.PI / 2 + 0.38,
    cx: 0,
    cy: 0,
    mirror: true,
    light: normalize([0.45, 0.8, -0.5]),
  });
  // Turn about the middle of the gun, not its back.
  const c = boxCentre([...shape.body, ...shape.action]);
  const shift = (b: Box): Box => ({ ...b, min: [b.min[0] - c[0], b.min[1] - c[1], b.min[2] - c[2]], max: [b.max[0] - c[0], b.max[1] - c[1], b.max[2] - c[2]] });
  const raw = { body: partPolys(view, shape.body.map(shift)), action: partPolys(view, shape.action.map(shift)) };
  const pts = [...raw.body, ...raw.action].flatMap((p) => p.pts);
  const x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0]));
  const y0 = Math.min(...pts.map((p) => p[1])), y1 = Math.max(...pts.map((p) => p[1]));
  const pad = 6;
  const s = Math.min((w - 2 * pad) / (x1 - x0), (h - 2 * pad) / (y1 - y0));
  const ox = (w - s * (x1 - x0)) / 2, oy = (h - s * (y1 - y0)) / 2;
  const at = ([x, y]: V2): V2 => [ox + (x - x0) * s, oy + (y - y0) * s];
  const out = (ps: RawPoly[]) => ps.map((p) => ({ points: fmt(p.pts, at), fill: p.fill, outline: p.outline }));
  return { parts: { body: out(raw.body), action: out(raw.action) }, width: w, height: h };
}
