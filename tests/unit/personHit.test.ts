import { describe, expect, it } from 'vitest';
import {
  HIT_WIDTH, aimedAtPerson, boxContains, distanceFromBox, focalPx, hitArea, resolveShot,
  type PeopleFrame, type PersonBox, type ShotInput,
} from '../../src/game/personHit.ts';
import { PERSON_HEIGHT_M } from '../../src/game/constants.ts';

// Portrait 1080p phone frame; the crosshair is the center.
const VW = 1080, VH = 1920;
const AIM = { x: VW / 2, y: VH / 2 };

function person(cx: number, top: number, h: number, score = 0.8): PersonBox {
  const w = h * 0.35; // a standing adult's box is about a third as wide as tall
  return { x: cx - w / 2, y: top, w, h, score };
}
const frame = (time: number, ...boxes: PersonBox[]): PeopleFrame => ({ time, pass: 0, boxes });
const input = (frames: PeopleFrame[], over: Partial<ShotInput> = {}): ShotInput => ({
  aim: AIM, fireTime: 1000, frames, frameWidth: VW, frameHeight: VH, zoom: 1, ...over,
});

describe('hit area', () => {
  const p = person(AIM.x, 500, 900);

  it('counts the middle of the box, head to feet', () => {
    expect(boxContains(p, AIM)).toBe(true);
    expect(boxContains(p, { x: AIM.x, y: 505 })).toBe(true); // top of the head
    expect(boxContains(p, { x: AIM.x, y: 1395 })).toBe(true); // feet
  });

  it('ignores the outer edges of the box, where there is mostly air beside the arms', () => {
    const edge = p.x + p.w * ((1 - HIT_WIDTH) / 2) * 0.5;
    expect(boxContains(p, { x: edge, y: AIM.y })).toBe(false);
    expect(hitArea(p).w).toBeCloseTo(p.w * HIT_WIDTH);
  });

  it('misses above, below and beside the person', () => {
    expect(boxContains(p, { x: AIM.x, y: 480 })).toBe(false);
    expect(boxContains(p, { x: AIM.x, y: 1420 })).toBe(false);
    expect(boxContains(p, { x: AIM.x + p.w, y: AIM.y })).toBe(false);
  });
});

describe('a Fire press', () => {
  it('hits when a person is under the crosshair', () => {
    expect(resolveShot(input([frame(1000, person(AIM.x, 600, 700))]))).toMatchObject({ kind: 'hit' });
  });

  it('misses when the person is off to the side', () => {
    expect(resolveShot(input([frame(1000, person(AIM.x + 400, 600, 700))]))).toEqual({ kind: 'miss' });
  });

  it('misses an empty frame and with no frames at all', () => {
    expect(resolveShot(input([frame(1000)]))).toEqual({ kind: 'miss' });
    expect(resolveShot(input([]))).toEqual({ kind: 'miss' });
  });

  it('forgives lag: counts a person under the crosshair just before or just after the press', () => {
    const on = (t: number) => frame(t, person(AIM.x, 600, 700));
    const off = (t: number) => frame(t, person(AIM.x + 400, 600, 700));
    expect(resolveShot(input([on(880), off(1000)])).kind).toBe('hit');
    expect(resolveShot(input([off(1000), on(1110)])).kind).toBe('hit');
  });

  it('does not count frames outside the window', () => {
    const on = (t: number) => frame(t, person(AIM.x, 600, 700));
    expect(resolveShot(input([on(800), frame(1000), on(1200)])).kind).toBe('miss');
  });

  it('takes the distance from the frame nearest the press', () => {
    const near = person(AIM.x, 700, 500); // smaller box = farther away
    const early = person(AIM.x, 300, 1300);
    const out = resolveShot(input([frame(900, early), frame(1010, near)]));
    expect(out.kind === 'hit' && out.box).toEqual(near);
  });
});

describe('distance', () => {
  it('follows the pinhole camera: half the height on screen means twice as far', () => {
    const d = distanceFromBox(person(AIM.x, 700, 400), VW, VH)!;
    expect(distanceFromBox(person(AIM.x, 800, 200), VW, VH)).toBeCloseTo(d * 2);
    // A 1.7 m person at 5 m on a 1080p phone is about 470 px tall.
    const h = (focalPx(VH) * PERSON_HEIGHT_M) / 5;
    expect(distanceFromBox(person(AIM.x, VH / 2 - h / 2, h), VW, VH)).toBeCloseTo(5, 5);
  });

  it('accounts for real camera zoom', () => {
    const d = distanceFromBox(person(AIM.x, 700, 400), VW, VH)!;
    expect(distanceFromBox(person(AIM.x, 700, 400), VW, VH, 2)).toBeCloseTo(d * 2);
  });

  it('says nothing when the person is cut off by the frame edge', () => {
    expect(distanceFromBox(person(AIM.x, 0, 1200), VW, VH)).toBeNull();
    expect(distanceFromBox(person(AIM.x, 900, 1020), VW, VH)).toBeNull();
  });
});

describe('crosshair lock', () => {
  it('locks while a recent frame has a person under the crosshair', () => {
    const frames = [frame(990, person(AIM.x, 600, 700))];
    expect(aimedAtPerson(frames, AIM, 1000)).toBe(true);
    expect(aimedAtPerson(frames, AIM, 1400)).toBe(false);
    expect(aimedAtPerson([frame(990, person(AIM.x + 400, 600, 700))], AIM, 1000)).toBe(false);
  });

  it("only locks when the gun's shot would count: in its hit width and range", () => {
    const opts = { frameWidth: VW, frameHeight: VH, zoom: 1 };
    const far = [frame(990, person(AIM.x, 880, 160))]; // about 15 m away
    expect(aimedAtPerson(far, AIM, 1000, { ...opts, rangeM: 25 })).toBe(true);
    expect(aimedAtPerson(far, AIM, 1000, { ...opts, rangeM: 12 })).toBe(false);
    const p = person(AIM.x, 600, 700);
    const edge = [frame(990, { ...p, x: AIM.x - p.w * 0.05 })]; // crosshair just inside the left edge
    expect(aimedAtPerson(edge, AIM, 1000, { ...opts, hitWidth: 1.25 })).toBe(true);
    expect(aimedAtPerson(edge, AIM, 1000, { ...opts, hitWidth: 0.6 })).toBe(false);
  });
});

describe('gun hit width and range', () => {
  const p = person(AIM.x, 600, 700);

  it('a wide gun counts a little beside the body; a precise one needs the middle', () => {
    const beside = { x: p.x - p.w * 0.08, y: 900 };
    expect(boxContains(p, beside)).toBe(false);
    expect(boxContains(p, beside, 1.25)).toBe(true);
    const offCentre = { x: p.x + p.w * 0.17, y: 900 };
    expect(boxContains(p, offCentre)).toBe(true);
    expect(boxContains(p, offCentre, 0.6)).toBe(false);
  });

  it('misses a person beyond the gun range, and hits them with no range limit', () => {
    const far = [frame(1000, person(AIM.x, 880, 160))];
    const d = distanceFromBox(person(AIM.x, 880, 160), VW, VH)!;
    expect(d).toBeGreaterThan(12);
    expect(resolveShot(input(far, { rangeM: 12 })).kind).toBe('miss');
    expect(resolveShot(input(far, { rangeM: null })).kind).toBe('hit');
    expect(resolveShot(input(far, { rangeM: 25 })).kind).toBe('hit');
  });

  it('counts a person cut off by the frame edge (too close to measure) for a short-range gun', () => {
    const close = [frame(1000, person(AIM.x, 0, 1920))];
    expect(resolveShot(input(close, { rangeM: 12 })).kind).toBe('hit');
  });
});
