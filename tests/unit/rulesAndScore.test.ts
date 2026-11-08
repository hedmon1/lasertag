import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, canRespawn, freshLife, isProtected, lifeAfterHit, respawnAt } from '../../src/game/rules.ts';
import { killFeed, scoreboard, type ShotRecord } from '../../src/game/score.ts';

describe('life and rules', () => {
  const R = DEFAULT_RULES;
  it('takes four 25-damage hits to go down', () => {
    let l = freshLife(R);
    for (let i = 1; i <= 3; i++) {
      l = lifeAfterHit(l, 25, `s${i}`, 500);
      expect(l).toMatchObject({ hp: 100 - 25 * i, alive: true, seq: i, shot: `s${i}`, diedAt: 0 });
    }
    l = lifeAfterHit(l, 25, 's4', 500);
    expect(l).toMatchObject({ hp: 0, alive: false, seq: 4, diedAt: 500 });
  });

  it('never goes below zero when the damage does not divide the health', () => {
    let l = freshLife(R);
    for (let i = 0; i < 2; i++) l = lifeAfterHit(l, 34, `s${i}`, 500);
    expect(l).toMatchObject({ hp: 32, alive: true });
    l = lifeAfterHit(l, 34, 's2', 500);
    expect(l).toMatchObject({ hp: 0, alive: false });
  });

  it('respawns only after the timer, then protects briefly', () => {
    const dead = { ...freshLife(R), hp: 0, alive: false, diedAt: 10_000 };
    expect(respawnAt(dead, R)).toBe(18_000);
    expect(canRespawn(dead, R, 17_999)).toBe(false);
    expect(canRespawn(dead, R, 18_000)).toBe(true);
    const back = { ...freshLife(R), spawnAt: 18_000 };
    expect(isProtected(back, R, 19_000)).toBe(true);
    expect(isProtected(back, R, 20_001)).toBe(false);
    expect(isProtected(freshLife(R), R, 0)).toBe(false);
  });

  it('bumps the sequence on reset so stale writes lose', () => {
    expect(freshLife(R, 7).seq).toBe(8);
  });
});

describe('scoreboard', () => {
  const players = {
    a: { name: 'Ann', slot: 0, fired: 10 },
    b: { name: 'Bob', slot: 1, fired: 4 },
    c: { name: 'Cat', slot: 2, fired: 0 },
    w: { name: 'Watcher', slot: -1 },
  };
  const shot = (id: string, by: string, target: string, kill: boolean, at: number): ShotRecord => ({ id, by, target, kill, at, via: 'ai', dist: 5 });
  const shots = [
    shot('1', 'a', 'b', false, 1), shot('2', 'a', 'b', false, 2), shot('3', 'a', 'b', false, 3), shot('4', 'a', 'b', true, 4),
    shot('5', 'b', 'a', false, 5), shot('6', 'c', 'a', false, 6),
  ];

  it('ranks by kills, then fewest deaths, and works out accuracy', () => {
    const rows = scoreboard(players, shots);
    expect(rows.map((r) => r.name)).toEqual(['Ann', 'Cat', 'Bob']);
    expect(rows[0]).toMatchObject({ kills: 1, deaths: 0, hits: 4, accuracy: 0.4 });
    expect(rows[2]).toMatchObject({ kills: 0, deaths: 1, hits: 1, accuracy: 0.25 });
    expect(rows[1].accuracy).toBe(0);
  });

  it('leaves out people without a slot', () => {
    expect(scoreboard(players, shots).some((r) => r.name === 'Watcher')).toBe(false);
  });

  it('lists kills newest first', () => {
    expect(killFeed([...shots, shot('7', 'c', 'a', true, 9)]).map((s) => s.id)).toEqual(['7', '4']);
  });
});
