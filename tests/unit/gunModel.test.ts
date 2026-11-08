import { describe, expect, it } from 'vitest';
import { FRAME, buildGun, buildShowcase, firstPersonView, visibleFaces } from '../../src/ui/gunModel.ts';
import { SHAPES } from '../../src/ui/gunShapes.ts';
import { GUNS } from '../../src/game/guns.ts';

const cx = FRAME.w / 2, cy = FRAME.h / 2;
const FIRE_TOP = FRAME.h - 18 - 116; // the Fire button's top edge on the design frame

function points(polys: { points: string }[], offset: [number, number] = [0, 0]): [number, number][] {
  return polys.flatMap((p) => p.points.split(' ').map((s) => s.split(',').map(Number))).map(([x, y]) => [x + offset[0], y + offset[1]]);
}

describe('every gun has a model', () => {
  it('one shape per gun in the catalog', () => {
    expect(Object.keys(SHAPES).sort()).toEqual(GUNS.map((g) => g.id).sort());
  });
});

describe.each(GUNS.map((g) => [g.id, SHAPES[g.id]] as const))('first-person %s', (_id, shape) => {
  const m = buildGun(shape);
  const view = firstPersonView(shape);
  const rear = view.project([0, shape.bore, 0]);
  const tip = view.project([0, shape.bore, shape.muzzle]);
  const gun = points([...m.parts.body, ...m.parts.action], m.offset);
  const xs = gun.map((p) => p[0]), ys = gun.map((p) => Math.min(FRAME.h, p[1]));

  it('points the barrel at the crosshair', () => {
    const [dx, dy] = [tip[0] - rear[0], tip[1] - rear[1]];
    const miss = Math.abs(dx * (rear[1] - cy) - dy * (rear[0] - cx)) / Math.hypot(dx, dy);
    expect(miss).toBeLessThan(6);
    expect(Math.hypot(tip[0] - cx, tip[1] - cy)).toBeLessThan(Math.hypot(rear[0] - cx, rear[1] - cy));
  });

  it('is held at the right edge and angled into the screen like a shooter, not straight up', () => {
    expect(rear[0]).toBeGreaterThan(FRAME.w * 0.85);
    // Steepness of the barrel on screen: well short of vertical.
    const deg = (Math.atan2(rear[1] - tip[1], rear[0] - tip[0]) * 180) / Math.PI;
    expect(deg).toBeGreaterThan(30);
    expect(deg).toBeLessThan(62);
  });

  it('stays out of the way: right of the middle, well below the crosshair, back above the Fire button', () => {
    expect(Math.min(...xs)).toBeGreaterThan(FRAME.w * 0.62);
    expect(Math.min(...ys)).toBeGreaterThan(cy + 60);
    expect(tip[1]).toBeGreaterThan(cy + 70);
    expect(rear[1]).toBeLessThan(FIRE_TOP);
    // Only the part above the Fire button counts: below it the gun is behind the button.
    const visible = gun.filter((p) => p[1] < FIRE_TOP);
    const vx = visible.map((p) => Math.min(FRAME.w, p[0])), vy = visible.map((p) => p[1]);
    const area = (Math.max(...vx) - Math.min(...vx)) * (Math.max(...vy) - Math.min(...vy));
    expect(area).toBeLessThan(FRAME.w * FRAME.h * 0.08);
  });

  it('draws every part with finite coordinates, anchored to the bottom-right corner', () => {
    for (const polys of Object.values(m.parts)) {
      expect(polys.length).toBeGreaterThan(0);
      for (const p of polys) for (const n of p.points.split(/[ ,]/)) expect(Number.isFinite(Number(n))).toBe(true);
    }
    expect(m.offset[0] + m.width).toBeCloseTo(FRAME.w, 5);
    expect(m.offset[1] + m.height).toBeCloseTo(FRAME.h, 5);
    expect(m.muzzle[0] + m.offset[0]).toBeCloseTo(tip[0], 5);
  });

  it('shows the back, top and left of the receiver, never the far sides', () => {
    const receiver = [...shape.body, ...shape.action].reduce((a, b) => ((b.max[2] - b.min[2]) * (b.max[0] - b.min[0]) > (a.max[2] - a.min[2]) * (a.max[0] - a.min[0]) ? b : a));
    expect(visibleFaces(view, receiver).map((f) => f.face).sort()).toEqual(['back', 'left', 'top']);
  });

  it('moves its action on screen when it cycles', () => {
    expect(Math.hypot(...m.travel)).toBeGreaterThan(1);
  });
});

describe('Armory showcase', () => {
  it.each(GUNS.map((g) => g.id))('%s fits its box and points right', (id) => {
    const s = buildShowcase(SHAPES[id], 300, 130);
    const pts = points([...s.parts.body, ...s.parts.action]);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(-0.01);
      expect(x).toBeLessThanOrEqual(300.01);
      expect(y).toBeGreaterThanOrEqual(-0.01);
      expect(y).toBeLessThanOrEqual(130.01);
    }
    // The barrel ends at the right, in the box.
    expect(s.muzzle[0]).toBeGreaterThan(300 * 0.7);
    expect(s.muzzle[1]).toBeGreaterThan(0);
    expect(s.muzzle[1]).toBeLessThan(130);
  });
});
