// Database rules, tested against the real Realtime Database emulator with distinct signed-in
// players. Two-player game: Ann (host, seat 0) and Bob (seat 1). Run with `npm run test:rules`.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  INC, RULES, TS, admin, assertFails, assertSucceeds, db, hitUpdate, life, player, read, reset, seedGame, setup, sleep, teardown,
} from './harness.ts';

beforeAll(setup);
afterAll(teardown);
beforeEach(reset);

const G = 'games/ABCD';
const newPlayer = (name: string, slot: number) => ({ name, joinedAt: TS, slot, life: life(), fired: 0, lastShotAt: 0, online: true });

describe('creating and joining', () => {
  it('lets a signed-in user create a game and take seat 1 (index 0) in one write', async () => {
    await assertSucceeds(db('ann').ref(`${G}/meta`).set({ host: 'ann', state: 'lobby', createdAt: TS, rules: RULES }));
    await assertSucceeds(db('ann').ref(G).update({ 'players/ann': newPlayer('Ann', 0), 'slots/0': 'ann' }));
    expect(await read(`${G}/slots/0`)).toBe('ann');
  });

  it('refuses a game created for someone else, a bad code, or signed out', async () => {
    await assertFails(db('ann').ref(`${G}/meta`).set({ host: 'bob', state: 'lobby', createdAt: TS, rules: RULES }));
    await assertFails(db('ann').ref('games/AB1D/meta').set({ host: 'ann', state: 'lobby', createdAt: TS, rules: RULES }));
    await assertFails(db('ann').ref('games/ABIO/meta').set({ host: 'ann', state: 'lobby', createdAt: TS, rules: RULES }));
    await assertFails(db(null).ref(`${G}/meta`).set({ host: 'ann', state: 'lobby', createdAt: TS, rules: RULES }));
  });

  it('refuses rules outside the allowed ranges and fixed damage changes', async () => {
    await assertFails(db('ann').ref(`${G}/meta`).set({ host: 'ann', state: 'lobby', createdAt: TS, rules: { ...RULES, damage: 100 } }));
    await assertFails(db('ann').ref(`${G}/meta`).set({ host: 'ann', state: 'lobby', createdAt: TS, rules: { ...RULES, respawnMs: 500 } }));
    await assertFails(db('ann').ref(`${G}/meta`).set({ host: 'ann', state: 'lobby', createdAt: TS, rules: { ...RULES, killLimit: 0 } }));
  });

  it('only the host changes the game', async () => {
    await seedGame('lobby');
    await assertFails(db('bob').ref(`${G}/meta/rules/killLimit`).set(5));
    await assertSucceeds(db('ann').ref(`${G}/meta/rules/killLimit`).set(5));
  });

  it('lets the second player join by taking the free seat', async () => {
    await admin((d) =>
      d.ref(G).set({
        meta: { host: 'ann', state: 'lobby', createdAt: Date.now(), rules: RULES },
        slots: { '0': 'ann' },
        players: { ann: player('Ann', 0) },
      }),
    );
    await assertSucceeds(db('bob').ref(G).update({ 'players/bob': newPlayer('Bob', 1), 'slots/1': 'bob' }));
  });

  it('turns away a third player: both seats are taken and there is no third seat', async () => {
    await seedGame('lobby');
    await assertFails(db('cat').ref(G).update({ 'players/cat': newPlayer('Cat', 1), 'slots/1': 'cat' }));
    await assertFails(db('cat').ref(G).update({ 'players/cat': newPlayer('Cat', 2), 'slots/2': 'cat' }));
    await assertFails(db('cat').ref(`${G}/players/cat`).set(newPlayer('Cat', -1)));
  });

  it('refuses joining as someone else, a seat without a matching player, or mid-game', async () => {
    await admin((d) =>
      d.ref(G).set({ meta: { host: 'ann', state: 'lobby', createdAt: Date.now(), rules: RULES }, slots: { '0': 'ann' }, players: { ann: player('Ann', 0) } }),
    );
    await assertFails(db('bob').ref(G).update({ 'players/dan': newPlayer('Dan', 1), 'slots/1': 'dan' }));
    await assertFails(db('bob').ref(`${G}/slots/1`).set('bob'));
    await admin((d) => d.ref(`${G}/meta/state`).set('live'));
    await assertFails(db('bob').ref(G).update({ 'players/bob': newPlayer('Bob', 1), 'slots/1': 'bob' }));
  });

  it('refuses names that are empty or too long', async () => {
    await seedGame('lobby');
    await assertFails(db('ann').ref(`${G}/players/ann/name`).set(''));
    await assertFails(db('ann').ref(`${G}/players/ann/name`).set('x'.repeat(17)));
    await assertSucceeds(db('ann').ref(`${G}/players/ann/name`).set('Annie'));
  });

  it('keeps players and shots private to the two players, but lets anyone signed in see the game exists', async () => {
    await seedGame('live');
    await assertSucceeds(db('stranger').ref(`${G}/meta`).get());
    await assertFails(db('stranger').ref(`${G}/players`).get());
    await assertFails(db('stranger').ref(`${G}/shots`).get());
    await assertFails(db(null).ref(`${G}/meta`).get());
    await assertSucceeds(db('bob').ref(`${G}/players`).get());
    await assertSucceeds(db('bob').ref(`${G}/shots`).get());
  });
});

describe('starting and ending', () => {
  it('lets the host start with a short countdown and a matching end time', async () => {
    await seedGame('lobby');
    const startAt = Date.now() + 5000;
    await assertFails(db('bob').ref(`${G}/meta`).update({ state: 'live', startAt, endAt: startAt + RULES.durationMs }));
    await assertFails(db('ann').ref(`${G}/meta`).update({ state: 'live', startAt: Date.now(), endAt: Date.now() + RULES.durationMs }));
    await assertFails(db('ann').ref(`${G}/meta`).update({ state: 'live', startAt, endAt: startAt + 99 }));
    await assertSucceeds(db('ann').ref(`${G}/meta`).update({ state: 'live', startAt, endAt: startAt + RULES.durationMs }));
  });

  it('locks the rules once live', async () => {
    await seedGame('live');
    await assertFails(db('ann').ref(`${G}/meta/rules/killLimit`).set(3));
  });

  it('goes live -> ended -> lobby, never live -> lobby', async () => {
    await seedGame('live');
    await assertFails(db('ann').ref(`${G}/meta/state`).set('lobby'));
    await assertSucceeds(db('ann').ref(`${G}/meta/state`).set('ended'));
    await assertSucceeds(db('ann').ref(`${G}/meta/state`).set('lobby'));
  });

  it('lets the host reset both players for another round, but only after the game', async () => {
    await seedGame('live', { shots: { s1: { by: 'ann', target: 'bob', via: 'ai', dist: 5, at: 1, kill: false } } });
    await admin((d) => d.ref(`${G}/players/bob/life`).set(life({ hp: 0, alive: false, seq: 4, diedAt: 5 })));
    const again = { 'meta/state': 'lobby', shots: null, killcams: null, 'players/bob/life': life({ seq: 5 }), 'players/bob/fired': 0 };
    await assertFails(db('ann').ref(G).update(again));
    await admin((d) => d.ref(`${G}/meta/state`).set('ended'));
    await assertFails(db('bob').ref(G).update(again));
    await assertSucceeds(db('ann').ref(G).update(again));
    expect(await read(`${G}/players/bob/life/hp`)).toBe(100);
    expect(await read(`${G}/shots`)).toBe(null);
  });
});

describe('shots', () => {
  beforeEach(() => seedGame('live'));

  it('applies a valid hit: 25 damage, one shot record, shooter cooldown stamped', async () => {
    await assertSucceeds(db('ann').ref(G).update(hitUpdate('ann', 'bob', 's1', life())));
    expect(await read(`${G}/players/bob/life/hp`)).toBe(75);
    expect(await read(`${G}/shots/s1`)).toMatchObject({ by: 'ann', target: 'bob', via: 'ai' });
    expect(typeof (await read(`${G}/players/ann/lastShotAt`))).toBe('number');
  });

  it('works both ways', async () => {
    await assertSucceeds(db('bob').ref(G).update(hitUpdate('bob', 'ann', 's1', life())));
    expect(await read(`${G}/players/ann/life/hp`)).toBe(75);
  });

  it('refuses shooting yourself', async () => {
    await assertFails(db('ann').ref(G).update(hitUpdate('ann', 'ann', 's1', life())));
  });

  it('refuses the wrong damage', async () => {
    await assertFails(db('ann').ref(G).update(hitUpdate('ann', 'bob', 's1', life(), { life: { hp: 50 } })));
    await assertFails(db('ann').ref(G).update(hitUpdate('ann', 'bob', 's1', life(), { life: { hp: 99 } })));
  });

  it('refuses a kill flag that does not match the health left', async () => {
    await assertFails(db('ann').ref(G).update(hitUpdate('ann', 'bob', 's1', life(), { shot: { kill: true } })));
  });

  it('refuses shot records in the old code format or with extra fields', async () => {
    await assertFails(db('ann').ref(G).update(hitUpdate('ann', 'bob', 's1', life(), { shot: { via: 'code' } })));
    await assertFails(db('ann').ref(G).update(hitUpdate('ann', 'bob', 's1', life(), { shot: { side: 'front' } })));
  });

  it('refuses a shot record without the matching life change, or vice versa', async () => {
    await assertFails(db('ann').ref(`${G}/shots/s1`).set({ by: 'ann', target: 'bob', via: 'ai', dist: 5, at: TS, kill: false }));
    await assertFails(db('ann').ref(`${G}/players/bob/life`).set({ ...life(), hp: 75, seq: 1, shot: 's1' }));
  });

  it('refuses a shot that skips the cooldown stamp', async () => {
    await assertFails(db('ann').ref(G).update(hitUpdate('ann', 'bob', 's1', life(), { skipLastShot: true })));
  });

  it('refuses forging a shot as the other player', async () => {
    await assertFails(db('ann').ref(G).update(hitUpdate('bob', 'ann', 's1', life())));
  });

  it('enforces the 350 ms cooldown between hits', async () => {
    await assertSucceeds(db('ann').ref(G).update(hitUpdate('ann', 'bob', 's1', life())));
    const after = await read(`${G}/players/bob/life`);
    await assertFails(db('ann').ref(G).update(hitUpdate('ann', 'bob', 's2', after)));
    await sleep(RULES.cooldownMs + 100);
    await assertSucceeds(db('ann').ref(G).update(hitUpdate('ann', 'bob', 's2', after)));
    expect(await read(`${G}/players/bob/life/hp`)).toBe(50);
  });

  it('refuses a hit built from stale health, so a retried shot can never land twice', async () => {
    await assertSucceeds(db('ann').ref(G).update(hitUpdate('ann', 'bob', 's1', life())));
    await sleep(RULES.cooldownMs + 100);
    // Same starting state as the first shot: the sequence number gives it away.
    await assertFails(db('ann').ref(G).update(hitUpdate('ann', 'bob', 's2', life())));
    expect(await read(`${G}/players/bob/life/hp`)).toBe(75);
  });

  it('kills on the fourth hit and stamps the death time', async () => {
    await admin((d) => d.ref(`${G}/players/bob/life`).set(life({ hp: 25, seq: 3 })));
    await assertSucceeds(db('ann').ref(G).update(hitUpdate('ann', 'bob', 's4', life({ hp: 25, seq: 3 }))));
    const l = await read(`${G}/players/bob/life`);
    expect(l).toMatchObject({ hp: 0, alive: false, seq: 4, shot: 's4' });
    expect(l.diedAt).toBeGreaterThan(Date.now() - 5000);
    expect(await read(`${G}/shots/s4/kill`)).toBe(true);
  });

  it('refuses shooting a player who is already down', async () => {
    await admin((d) => d.ref(`${G}/players/bob/life`).set(life({ hp: 0, alive: false, seq: 4, diedAt: Date.now() })));
    await assertFails(db('ann').ref(G).update(hitUpdate('ann', 'bob', 's1', life({ hp: 0, alive: false, seq: 4 }))));
  });

  it('refuses shooting while you are down', async () => {
    await admin((d) => d.ref(`${G}/players/ann/life`).set(life({ hp: 0, alive: false, seq: 4, diedAt: Date.now() })));
    await assertFails(db('ann').ref(G).update(hitUpdate('ann', 'bob', 's1', life())));
  });

  it('refuses hits during spawn protection', async () => {
    const spawned = life({ seq: 5, spawnAt: Date.now() });
    await admin((d) => d.ref(`${G}/players/bob/life`).set(spawned));
    await assertFails(db('ann').ref(G).update(hitUpdate('ann', 'bob', 's1', spawned)));
  });

  it('refuses shots outside the game window', async () => {
    await admin((d) => d.ref(`${G}/meta/endAt`).set(Date.now() - 1000));
    await assertFails(db('ann').ref(G).update(hitUpdate('ann', 'bob', 's1', life())));
    await seedGame('lobby');
    await assertFails(db('ann').ref(G).update(hitUpdate('ann', 'bob', 's1', life())));
    await seedGame('ended');
    await assertFails(db('ann').ref(G).update(hitUpdate('ann', 'bob', 's1', life())));
  });

  it('never lets anyone rewrite or delete a shot record', async () => {
    await assertSucceeds(db('ann').ref(G).update(hitUpdate('ann', 'bob', 's1', life())));
    await assertFails(db('ann').ref(`${G}/shots/s1/kill`).set(true));
    await assertFails(db('ann').ref(`${G}/shots/s1`).remove());
    await assertFails(db('ann').ref(`${G}/shots`).remove());
  });

  it('counts trigger pulls one at a time', async () => {
    await assertSucceeds(db('ann').ref(`${G}/players/ann/fired`).set(INC));
    expect(await read(`${G}/players/ann/fired`)).toBe(1);
    await assertFails(db('ann').ref(`${G}/players/ann/fired`).set(10));
    await assertFails(db('ann').ref(`${G}/players/ann/fired`).set(0));
    await assertFails(db('bob').ref(`${G}/players/ann/fired`).set(INC));
  });
});

describe('respawning', () => {
  beforeEach(() => seedGame('live'));

  it('respawns yourself once the timer has run out', async () => {
    await admin((d) => d.ref(`${G}/players/bob/life`).set(life({ hp: 0, alive: false, seq: 4, shot: 's4', diedAt: Date.now() - RULES.respawnMs - 500 })));
    await assertSucceeds(db('bob').ref(`${G}/players/bob/life`).set({ hp: 100, alive: true, seq: 5, shot: '', diedAt: 0, spawnAt: TS }));
    expect(await read(`${G}/players/bob/life/alive`)).toBe(true);
  });

  it('refuses respawning early', async () => {
    await admin((d) => d.ref(`${G}/players/bob/life`).set(life({ hp: 0, alive: false, seq: 4, shot: 's4', diedAt: Date.now() - 1000 })));
    await assertFails(db('bob').ref(`${G}/players/bob/life`).set({ hp: 100, alive: true, seq: 5, shot: '', diedAt: 0, spawnAt: TS }));
  });

  it('refuses respawning the other player, or healing yourself while alive', async () => {
    await admin((d) => d.ref(`${G}/players/bob/life`).set(life({ hp: 0, alive: false, seq: 4, shot: 's4', diedAt: Date.now() - 9000 })));
    await assertFails(db('ann').ref(`${G}/players/bob/life`).set({ hp: 100, alive: true, seq: 5, shot: '', diedAt: 0, spawnAt: TS }));
    await admin((d) => d.ref(`${G}/players/ann/life`).set(life({ hp: 25, seq: 3 })));
    await assertFails(db('ann').ref(`${G}/players/ann/life`).set({ hp: 100, alive: true, seq: 4, shot: '', diedAt: 0, spawnAt: TS }));
  });
});

describe('kill cams', () => {
  const jpg = 'data:image/jpeg;base64,' + 'A'.repeat(2000);

  beforeEach(async () => {
    await seedGame('live');
    await db('ann').ref(G).update(hitUpdate('ann', 'bob', 's1', life()));
  });

  it('lets the shooter attach a photo to their own shot', async () => {
    await assertSucceeds(db('ann').ref(`${G}/killcams/s1`).set({ by: 'ann', target: 'bob', jpg }));
  });

  it('refuses photos for the other player’s shots, wrong targets, or anything but a JPEG', async () => {
    await assertFails(db('bob').ref(`${G}/killcams/s1`).set({ by: 'bob', target: 'bob', jpg }));
    await assertFails(db('ann').ref(`${G}/killcams/s1`).set({ by: 'ann', target: 'ann', jpg }));
    await assertFails(db('ann').ref(`${G}/killcams/s1`).set({ by: 'ann', target: 'bob', jpg: 'data:text/html;base64,AAAA' }));
    await assertFails(db('ann').ref(`${G}/killcams/s1`).set({ by: 'ann', target: 'bob', jpg: 'data:image/jpeg;base64,' + 'A'.repeat(160000) }));
  });

  it('shows the photo only to the shooter and the player hit', async () => {
    await db('ann').ref(`${G}/killcams/s1`).set({ by: 'ann', target: 'bob', jpg });
    await assertSucceeds(db('bob').ref(`${G}/killcams/s1`).get());
    await assertSucceeds(db('ann').ref(`${G}/killcams/s1`).get());
    await assertFails(db('stranger').ref(`${G}/killcams/s1`).get());
  });

  it('lets the player hit listen for the photo before it arrives', async () => {
    await assertSucceeds(db('bob').ref(`${G}/killcams/s1`).get());
    await assertFails(db('stranger').ref(`${G}/killcams/s1`).get());
  });

  it('lets the host clear kill cams after the game', async () => {
    await db('ann').ref(`${G}/killcams/s1`).set({ by: 'ann', target: 'bob', jpg });
    await assertFails(db('ann').ref(`${G}/killcams`).remove());
    await admin((d) => d.ref(`${G}/meta/state`).set('ended'));
    await assertFails(db('bob').ref(`${G}/killcams`).remove());
    await assertSucceeds(db('ann').ref(`${G}/killcams`).remove());
  });
});
