import { describe, expect, it } from 'vitest';
import { BORE, FRAME, MUZZLE, SLIDE_BOX, buildGun, projectLocal, visibleFaces } from '../../src/ui/gunModel.ts';

describe('first-person gun', () => {
  const m = buildGun();
  const cx = FRAME.w / 2, cy = FRAME.h / 2;
  const rear = projectLocal([0, BORE, 0]);
  const tip = projectLocal([0, BORE, MUZZLE]);

  it('points the barrel at the crosshair', () => {
    const [dx, dy] = [tip[0] - rear[0], tip[1] - rear[1]];
    const miss = Math.abs(dx * (rear[1] - cy) - dy * (rear[0] - cx)) / Math.hypot(dx, dy);
    expect(miss).toBeLessThan(6);
    expect(Math.hypot(tip[0] - cx, tip[1] - cy)).toBeLessThan(Math.hypot(rear[0] - cx, rear[1] - cy));
  });

  it('stays small in the lower-right corner, with the muzzle well clear of the crosshair', () => {
    expect(rear[0]).toBeGreaterThan(cx + 100);
    expect(rear[1]).toBeGreaterThan(cy + 220);
    expect(tip[1]).toBeGreaterThan(cy + 130);
    expect(m.muzzle[0] + m.offset[0]).toBeCloseTo(tip[0], 5);
    const pts = [...m.parts.body, ...m.parts.slide].flatMap((p) =>
      p.points.split(' ').map((s) => s.split(',').map(Number)).map(([x, y]) => [x + m.offset[0], y + m.offset[1]]),
    );
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    expect(Math.min(...xs)).toBeGreaterThan(FRAME.w * 0.6);
    expect(Math.min(...ys)).toBeGreaterThan(FRAME.h * 0.65);
    expect((Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))).toBeLessThan(FRAME.w * FRAME.h * 0.08);
  });

  it('shows the back, top and left of the slide, never the far sides', () => {
    expect(visibleFaces(SLIDE_BOX).map((f) => f.face).sort()).toEqual(['back', 'left', 'top']);
  });

  it('draws every part with finite coordinates inside a viewBox anchored to the bottom-right corner', () => {
    for (const polys of Object.values(m.parts)) {
      expect(polys.length).toBeGreaterThan(0);
      for (const p of polys) for (const n of p.points.split(/[ ,]/)) expect(Number.isFinite(Number(n))).toBe(true);
    }
    expect(m.offset[0] + m.width).toBeCloseTo(FRAME.w, 5);
    expect(m.offset[1] + m.height).toBeCloseTo(FRAME.h, 5);
  });

  it('racks the slide back towards you, down and to the right on screen', () => {
    expect(m.slideBack[0]).toBeGreaterThan(0);
    expect(m.slideBack[1]).toBeGreaterThan(0);
  });
});
