import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GRENADE, grenadeDamage, grenadeReadyIn } from '../../src/game/grenade.ts';
import { resolveBlast, type PeopleFrame, type PersonBox } from '../../src/game/personHit.ts';

const rules = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../database.rules.json'), 'utf8'));
const players = rules.rules.games.$code.players.$uid;

const VW = 1280, VH = 720;
const focal = VW / (2 * Math.tan(((69.4 / 2) * Math.PI) / 180));
const personAt = (x: number, m: number): PersonBox => {
  const h = (focal * 1.7) / m;
  return { x, y: VH / 2 - h / 2, w: h * 0.35, h, score: 0.9 };
};
const frame = (time: number, boxes: PersonBox[]): PeopleFrame => ({ time, pass: 0, boxes });
const blastAt = (frames: PeopleFrame[], time = 2500) =>
  resolveBlast({ throwTime: time, frames, frameWidth: VW, frameHeight: VH, zoom: 1, rangeM: GRENADE.far.m });

describe('grenade damage', () => {
  it(`takes ${GRENADE.near.damage} within ${GRENADE.near.m} m and ${GRENADE.far.damage} up to ${GRENADE.far.m} m`, () => {
    expect(grenadeDamage(1)).toBe(GRENADE.near.damage);
    expect(grenadeDamage(GRENADE.near.m)).toBe(GRENADE.near.damage);
    expect(grenadeDamage(GRENADE.near.m + 0.1)).toBe(GRENADE.far.damage);
    expect(grenadeDamage(GRENADE.far.m)).toBe(GRENADE.far.damage);
    expect(grenadeDamage(GRENADE.far.m + 0.1)).toBe(null);
  });

  it('counts someone too close to measure as up close', () => {
    expect(grenadeDamage(null)).toBe(GRENADE.near.damage);
  });

  it('two close blasts take a player out; three far ones do', () => {
    expect(GRENADE.near.damage * 2).toBeGreaterThanOrEqual(100);
    expect(GRENADE.far.damage * 2).toBeLessThan(100);
    expect(GRENADE.far.damage * 3).toBeGreaterThanOrEqual(100);
  });
});

describe('the blast', () => {
  it('catches someone anywhere in view when it goes off', () => {
    const o = blastAt([frame(2500, [personAt(40, 4)])]);
    expect(o.kind).toBe('hit');
    if (o.kind === 'hit') {
      expect(o.distanceM).toBeCloseTo(4, 1);
      expect(o.head).toBe(false);
    }
  });

  it('misses someone who got out of view during the fuse', () => {
    // In view at the throw (1000), gone by the blast (2500).
    expect(blastAt([frame(1000, [personAt(600, 4)]), frame(2500, [])]).kind).toBe('miss');
  });

  it(`misses past ${GRENADE.far.m} m`, () => {
    expect(blastAt([frame(2500, [personAt(600, GRENADE.far.m + 3)])]).kind).toBe('miss');
  });
});

describe('the recharge', () => {
  it('is ready before the first throw and comes back after the cooldown', () => {
    expect(grenadeReadyIn(0, 5000)).toBe(0);
    expect(grenadeReadyIn(10000, 10000)).toBe(GRENADE.cooldownMs);
    expect(grenadeReadyIn(10000, 10000 + GRENADE.cooldownMs)).toBe(0);
  });

  it('gives the fuse room inside the window the database accepts', () => {
    expect(GRENADE.hitWindowMs.from).toBeLessThan(GRENADE.fuseMs);
    expect(GRENADE.hitWindowMs.to).toBeGreaterThan(GRENADE.fuseMs + 1500);
  });
});

describe('the database rules agree', () => {
  it('enforce the same recharge, window, reach and damage', () => {
    expect(players.lastGrenadeAt['.validate']).toContain(`now >= data.val() + ${GRENADE.cooldownMs}`);
    const shot = rules.rules.games.$code.shots.$id['.validate'];
    expect(shot).toContain(`child('lastGrenadeAt').val() + ${GRENADE.hitWindowMs.from}`);
    expect(shot).toContain(`child('lastGrenadeAt').val() + ${GRENADE.hitWindowMs.to}`);
    expect(shot).toContain(`newData.child('dist').val() <= ${GRENADE.far.m}`);
    expect(players.life['.write']).toContain(`data.child('hp').val() > ${GRENADE.near.damage}`);
    expect(players.life['.write']).toContain(`data.child('hp').val() > ${GRENADE.far.damage}`);
  });
});
