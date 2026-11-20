import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FLASH, FLASH_TOTAL_MS, flashReadyIn, flashWhiteness } from '../../src/game/flash.ts';
import { personInView, resolveFlash, type PeopleFrame, type PersonBox } from '../../src/game/personHit.ts';

const rules = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../database.rules.json'), 'utf8'));
const flashRules = rules.rules.games.$code.flashes.$id;

const VW = 1280, VH = 720;
// A standing person whose box height puts them `m` metres away (see distanceFromBox).
const focal = VW / (2 * Math.tan(((69.4 / 2) * Math.PI) / 180));
const personAt = (x: number, m: number): PersonBox => {
  const h = (focal * 1.7) / m;
  return { x, y: VH / 2 - h / 2, w: h * 0.35, h, score: 0.9 };
};
const frame = (time: number, boxes: PersonBox[]): PeopleFrame => ({ time, pass: 0, boxes });
const throwAt = (frames: PeopleFrame[], throwTime = 1000) =>
  resolveFlash({ throwTime, frames, frameWidth: VW, frameHeight: VH, zoom: 1, rangeM: FLASH.rangeM });

describe('throwing a flashbang', () => {
  it('catches a person anywhere in view, not just under the crosshair', () => {
    const edge = personAt(30, 5); // far left of the frame, nowhere near the middle
    const o = throwAt([frame(1000, [edge])]);
    expect(o.kind).toBe('hit');
    if (o.kind === 'hit') expect(o.distanceM).toBeCloseTo(5, 1);
  });

  it('misses an empty room', () => {
    expect(throwAt([frame(1000, [])]).kind).toBe('miss');
  });

  it(`only reaches ${FLASH.rangeM} m`, () => {
    expect(throwAt([frame(1000, [personAt(600, 14)])]).kind).toBe('hit');
    expect(throwAt([frame(1000, [personAt(600, 18)])]).kind).toBe('miss');
  });

  it('uses the same lag window as a shot: 150 ms before to 120 ms after', () => {
    const p = [personAt(600, 6)];
    expect(throwAt([frame(860, p)]).kind).toBe('hit');
    expect(throwAt([frame(1110, p)]).kind).toBe('hit');
    expect(throwAt([frame(800, p)]).kind).toBe('miss');
    expect(throwAt([frame(1200, p)]).kind).toBe('miss');
  });

  it('picks the nearest person when the far one is out of range', () => {
    const o = throwAt([frame(1000, [personAt(100, 20), personAt(900, 4)])]);
    expect(o.kind === 'hit' && o.box.x).toBe(900);
  });

  it('lights the button only with someone in range in a fresh frame', () => {
    const opts = { rangeM: FLASH.rangeM, frameWidth: VW, frameHeight: VH, zoom: 1 };
    expect(personInView([frame(1000, [personAt(40, 8)])], 1100, opts)).toBe(true);
    expect(personInView([frame(1000, [personAt(40, 30)])], 1100, opts)).toBe(false);
    expect(personInView([frame(1000, [personAt(40, 8)])], 1400, opts)).toBe(false);
  });
});

describe('being flashed', () => {
  it('is fully white while it holds, then fades out smoothly', () => {
    expect(flashWhiteness(0)).toBe(1);
    expect(flashWhiteness(FLASH.holdMs)).toBe(1);
    let prev = 1;
    for (let t = FLASH.holdMs + 100; t < FLASH_TOTAL_MS; t += 100) {
      const w = flashWhiteness(t);
      expect(w).toBeLessThan(prev);
      prev = w;
    }
    expect(flashWhiteness(FLASH_TOTAL_MS)).toBe(0);
    expect(flashWhiteness(FLASH_TOTAL_MS + 500)).toBe(0);
    expect(flashWhiteness(-10)).toBe(0);
  });

  it('wears off in about four seconds', () => {
    expect(FLASH_TOTAL_MS).toBeGreaterThanOrEqual(3000);
    expect(FLASH_TOTAL_MS).toBeLessThanOrEqual(5000);
  });
});

describe('the recharge', () => {
  it('is ready before the first throw and comes back after the cooldown', () => {
    expect(flashReadyIn(0, 5000)).toBe(0);
    expect(flashReadyIn(10000, 10000)).toBe(FLASH.cooldownMs);
    expect(flashReadyIn(10000, 10000 + FLASH.cooldownMs - 1)).toBe(1);
    expect(flashReadyIn(10000, 10000 + FLASH.cooldownMs)).toBe(0);
  });
});

describe('the database rules agree', () => {
  it('enforce the same recharge and range', () => {
    expect(flashRules['.validate']).toContain(`child('lastFlashAt').val() + ${FLASH.cooldownMs})`);
    expect(flashRules.dist['.validate']).toBe(`newData.isNumber() && newData.val() >= 0 && newData.val() <= ${FLASH.rangeM}`);
  });

  it('refuse a catch that does not start the recharge in the same write', () => {
    expect(flashRules['.validate']).toContain("newData.parent().parent().child('players').child(auth.uid).child('lastFlashAt').val() == now");
  });
});
