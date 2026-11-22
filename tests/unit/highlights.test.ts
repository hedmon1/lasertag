import { describe, expect, it } from 'vitest';
import { highlights, noHighlights, scoreboard, type ShotRecord } from '../../src/game/score.ts';

const players = {
  a: { name: 'Ann', slot: 0, fired: 10 },
  b: { name: 'Bob', slot: 1, fired: 8 },
  w: { name: 'Watcher', slot: -1 },
};

let n = 0;
function shot(by: string, target: string, at: number, o: Partial<ShotRecord> = {}): ShotRecord {
  return { id: String(++n), by, target, at, via: 'ai', gun: 'blip', dist: 5, kill: false, ...o };
}
const nade = (by: string, target: string, at: number, o: Partial<ShotRecord> = {}) => shot(by, target, at, { via: 'grenade', gun: 'grenade', ...o });

describe('scoreboard counts heads and grenades', () => {
  const shots = [
    shot('a', 'b', 1, { head: true }),
    shot('a', 'b', 2),
    nade('a', 'b', 3, { dist: 3.6, kill: true }),
    shot('b', 'a', 4, { head: true, kill: true }),
  ];

  it('counts headshots and grenade hits apart from gun hits', () => {
    const ann = scoreboard(players, shots).find((r) => r.name === 'Ann')!;
    expect(ann).toMatchObject({ hits: 2, heads: 1, nades: 1, kills: 1 });
  });

  it('leaves grenades out of accuracy, which is gun hits per trigger pull', () => {
    const ann = scoreboard(players, shots).find((r) => r.name === 'Ann')!;
    expect(ann.accuracy).toBe(0.2);
  });

  it('still gives the grenade kill a kill and the death a death', () => {
    const bob = scoreboard(players, shots).find((r) => r.name === 'Bob')!;
    expect(bob).toMatchObject({ kills: 1, deaths: 1, heads: 1, nades: 0 });
  });
});

describe('highlights', () => {
  it('has nothing to show with no shots', () => {
    const h = highlights(players, []);
    expect(h).toEqual({ longest: null, heads: null, streak: null, grenadeKills: null });
    expect(noHighlights(h)).toBe(true);
  });

  it('finds the longest gun hit, with its gun', () => {
    const h = highlights(players, [shot('a', 'b', 1, { dist: 8.2 }), shot('b', 'a', 2, { dist: 14.3, gun: 'longshot' }), shot('a', 'b', 3, { dist: 9 })]);
    expect(h.longest).toEqual({ by: 'b', gun: 'longshot', dist: 14.3 });
  });

  it("doesn't count a grenade or an unknown distance as the longest hit", () => {
    const h = highlights(players, [nade('a', 'b', 1, { dist: 11.5 }), shot('b', 'a', 2, { dist: 0 }), shot('a', 'b', 3, { dist: 4 })]);
    expect(h.longest).toEqual({ by: 'a', gun: 'blip', dist: 4 });
    expect(highlights(players, [nade('a', 'b', 1, { dist: 11.5 })]).longest).toBeNull();
  });

  it('keeps the first of two equally long hits', () => {
    expect(highlights(players, [shot('b', 'a', 1, { dist: 7 }), shot('a', 'b', 2, { dist: 7 })]).longest?.by).toBe('b');
  });

  it('names the player with the most headshots', () => {
    const h = highlights(players, [shot('a', 'b', 1, { head: true }), shot('a', 'b', 2, { head: true }), shot('b', 'a', 3, { head: true })]);
    expect(h.heads).toEqual({ uids: ['a'], count: 2 });
  });

  it('lists both players when they tie', () => {
    const h = highlights(players, [shot('a', 'b', 1, { head: true }), shot('b', 'a', 2, { head: true })]);
    expect(h.heads).toEqual({ uids: ['a', 'b'], count: 1 });
  });

  it('counts kills in a row, and a death ends the streak', () => {
    const shots = [
      shot('a', 'b', 1, { kill: true }),
      shot('a', 'b', 2, { kill: true }),
      shot('b', 'a', 3, { kill: true }),
      shot('a', 'b', 4, { kill: true }),
    ];
    expect(highlights(players, shots).streak).toEqual({ uids: ['a'], count: 2 });
  });

  it('reads the log in time order, not the order it arrived', () => {
    const shots = [shot('a', 'b', 4, { kill: true }), shot('b', 'a', 2, { kill: true }), shot('a', 'b', 1, { kill: true }), shot('a', 'b', 3, { kill: true })];
    // Ann at 1, Bob at 2 (Ann's run ends), then Ann at 3 and 4.
    expect(highlights(players, shots).streak).toEqual({ uids: ['a'], count: 2 });
  });

  it('shows no streak for single kills', () => {
    expect(highlights(players, [shot('a', 'b', 1, { kill: true }), shot('b', 'a', 2, { kill: true })]).streak).toBeNull();
  });

  it('counts grenade kills, not grenade hits', () => {
    const h = highlights(players, [nade('a', 'b', 1), nade('b', 'a', 2, { kill: true }), nade('a', 'b', 3)]);
    expect(h.grenadeKills).toEqual({ uids: ['b'], count: 1 });
  });

  it('leaves out people without a slot', () => {
    const h = highlights(players, [shot('w', 'a', 1, { dist: 30, head: true, kill: true }), shot('w', 'a', 2, { kill: true })]);
    expect(noHighlights(h)).toBe(true);
  });
});
