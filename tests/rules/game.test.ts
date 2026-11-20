// Database rules, tested against the real Realtime Database emulator with distinct signed-in
// players. Two-player game: Ann (host, seat 0) and Bob (seat 1). Run with `npm run test:rules`.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  INC, RULES, TS, admin, assertFails, assertSucceeds, db, flashUpdate, grenadeHit, gunDoc, hitUpdate, life, player, read, reset, seedGame, setup, sleep, teardown,
} from './harness.ts';
import { gun } from '../../src/game/guns.ts';
import { FLASH } from '../../src/game/flash.ts';
import { GRENADE } from '../../src/game/grenade.ts';

beforeAll(setup);
afterAll(teardown);
beforeEach(reset);

const G = 'games/ABCD';
const newPlayer = (name: string, slot: number) => ({ name, joinedAt: TS, slot, life: life(), fired: 0, lastShotAt: 0, lastFlashAt: 0, lastGrenadeAt: 0, gun: gunDoc('blip'), online: true });

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

  it('refuses rules outside the allowed ranges, and a damage setting (damage belongs to the guns)', async () => {
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
    await seedGame('live', {
      shots: { s1: { by: 'ann', target: 'bob', via: 'ai', dist: 5, at: 1, kill: false } },
      flashes: { f1: { by: 'bob', target: 'ann', dist: 4, at: 1 } },
    });
    await admin((d) => d.ref(`${G}/players/bob/life`).set(life({ hp: 0, alive: false, seq: 4, diedAt: 5 })));
    const again = { 'meta/state': 'lobby', shots: null, flashes: null, killcams: null, 'players/bob/life': life({ seq: 5 }), 'players/bob/fired': 0 };
    await assertFails(db('ann').ref(G).update(again));
    await admin((d) => d.ref(`${G}/meta/state`).set('ended'));
    await assertFails(db('bob').ref(G).update(again));
    await assertSucceeds(db('ann').ref(G).update(again));
    expect(await read(`${G}/players/bob/life/hp`)).toBe(100);
    expect(await read(`${G}/shots`)).toBe(null);
    expect(await read(`${G}/flashes`)).toBe(null);
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

  it("enforces the pistol's cooldown between hits", async () => {
    await assertSucceeds(db('ann').ref(G).update(hitUpdate('ann', 'bob', 's1', life())));
    const after = await read(`${G}/players/bob/life`);
    await assertFails(db('ann').ref(G).update(hitUpdate('ann', 'bob', 's2', after)));
    await sleep(gun('blip').cooldownMs + 100);
    await assertSucceeds(db('ann').ref(G).update(hitUpdate('ann', 'bob', 's2', after)));
    expect(await read(`${G}/players/bob/life/hp`)).toBe(50);
  });

  it('refuses a hit built from stale health, so a retried shot can never land twice', async () => {
    await assertSucceeds(db('ann').ref(G).update(hitUpdate('ann', 'bob', 's1', life())));
    await sleep(gun('blip').cooldownMs + 100);
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

describe('guns', () => {
  it('lets you pick any gun in the lobby, and only from the catalog with its own damage and cooldown', async () => {
    await seedGame('lobby');
    for (const id of ['stinger', 'triplet', 'thumper', 'boomstick', 'longshot', 'blip'] as const) {
      await assertSucceeds(db('bob').ref(`${G}/players/bob/gun`).set(gunDoc(id)));
    }
    await assertFails(db('bob').ref(`${G}/players/bob/gun`).set({ id: 'railgun', damage: 100, cooldownMs: 0 }));
    await assertFails(db('bob').ref(`${G}/players/bob/gun`).set({ ...gunDoc('blip'), damage: 100 }));
    await assertFails(db('bob').ref(`${G}/players/bob/gun`).set({ ...gunDoc('stinger'), cooldownMs: 0 }));
    await assertFails(db('bob').ref(`${G}/players/bob/gun`).set({ ...gunDoc('blip'), spread: 2 }));
    await assertFails(db('bob').ref(`${G}/players/bob/gun/damage`).set(80));
  });

  it("refuses changing your gun mid-game, or anyone else's gun", async () => {
    await seedGame('live');
    await assertFails(db('bob').ref(`${G}/players/bob/gun`).set(gunDoc('longshot')));
    await seedGame('ended');
    await assertSucceeds(db('bob').ref(`${G}/players/bob/gun`).set(gunDoc('longshot')));
    await assertFails(db('ann').ref(`${G}/players/bob/gun`).set(gunDoc('blip')));
  });

  it('refuses joining without a gun', async () => {
    await admin((d) =>
      d.ref(G).set({ meta: { host: 'ann', state: 'lobby', createdAt: Date.now(), rules: RULES }, slots: { '0': 'ann' }, players: { ann: player('Ann', 0) } }),
    );
    const { gun: _gun, ...noGun } = newPlayer('Bob', 1);
    await assertFails(db('bob').ref(G).update({ 'players/bob': noGun, 'slots/1': 'bob' }));
  });

  it("takes the shooter's gun damage: a shotgun takes two hits, and can't claim more or less", async () => {
    await seedGame('live', { players: { ann: player('Ann', 0, { gun: gunDoc('boomstick') }), bob: player('Bob', 1) } });
    await assertFails(db('ann').ref(G).update(hitUpdate('ann', 'bob', 's0', life())));
    await assertSucceeds(db('ann').ref(G).update(hitUpdate('ann', 'bob', 's1', life(), { with: 'boomstick' })));
    expect(await read(`${G}/players/bob/life/hp`)).toBe(50);
    await sleep(gun('boomstick').cooldownMs + 100);
    await assertSucceeds(db('ann').ref(G).update(hitUpdate('ann', 'bob', 's2', await read(`${G}/players/bob/life`), { with: 'boomstick' })));
    expect(await read(`${G}/players/bob/life`)).toMatchObject({ hp: 0, alive: false });
    expect(await read(`${G}/shots/s2`)).toMatchObject({ gun: 'boomstick', kill: true });
  });

  it("takes a revolver's 34 down to zero on the third hit, never below", async () => {
    await seedGame('live', { players: { ann: player('Ann', 0, { gun: gunDoc('thumper') }), bob: player('Bob', 1, { life: life({ hp: 32, seq: 2 }) }) } });
    await assertSucceeds(db('ann').ref(G).update(hitUpdate('ann', 'bob', 's3', life({ hp: 32, seq: 2 }), { with: 'thumper' })));
    expect(await read(`${G}/players/bob/life`)).toMatchObject({ hp: 0, alive: false });
  });

  it("refuses a shot record that names a gun other than the shooter's", async () => {
    await seedGame('live');
    await assertFails(db('ann').ref(G).update(hitUpdate('ann', 'bob', 's1', life(), { shot: { gun: 'longshot' } })));
  });

  it("uses the shooter's gun cooldown: an SMG can hit again quickly, a sniper can't", async () => {
    await seedGame('live', { players: { ann: player('Ann', 0, { gun: gunDoc('stinger') }), bob: player('Bob', 1, { gun: gunDoc('longshot') }) } });
    await assertSucceeds(db('ann').ref(G).update(hitUpdate('ann', 'bob', 's1', life(), { with: 'stinger' })));
    await sleep(gun('stinger').cooldownMs + 40);
    await assertSucceeds(db('ann').ref(G).update(hitUpdate('ann', 'bob', 's2', await read(`${G}/players/bob/life`), { with: 'stinger' })));
    expect(await read(`${G}/players/bob/life/hp`)).toBe(74);

    await assertSucceeds(db('bob').ref(G).update(hitUpdate('bob', 'ann', 's3', life(), { with: 'longshot' })));
    await sleep(300);
    await assertFails(db('bob').ref(G).update(hitUpdate('bob', 'ann', 's4', await read(`${G}/players/ann/life`), { with: 'longshot' })));
  });
});

describe('headshots', () => {
  beforeEach(() => seedGame('live'));

  it('takes double the gun damage for a headshot', async () => {
    await assertSucceeds(db('ann').ref(G).update(hitUpdate('ann', 'bob', 's1', life(), { head: true })));
    expect(await read(`${G}/players/bob/life/hp`)).toBe(50);
    expect(await read(`${G}/shots/s1/head`)).toBe(true);
  });

  it('refuses a headshot claim with body damage, and double damage without the claim', async () => {
    await assertFails(db('ann').ref(G).update(hitUpdate('ann', 'bob', 's1', life(), { head: true, damage: 25 })));
    await assertFails(db('ann').ref(G).update(hitUpdate('ann', 'bob', 's1', life(), { damage: 50 })));
    await assertFails(db('ann').ref(G).update(hitUpdate('ann', 'bob', 's1', life(), { head: true, damage: 100 })));
    await assertFails(db('ann').ref(G).update(hitUpdate('ann', 'bob', 's1', life(), { shot: { head: 'yes' } })));
  });

  it('treats head: false as a body hit', async () => {
    await assertSucceeds(db('ann').ref(G).update(hitUpdate('ann', 'bob', 's1', life(), { shot: { head: false } })));
    expect(await read(`${G}/players/bob/life/hp`)).toBe(75);
  });

  it('makes a sniper headshot a one-hit kill, flagged as the kill', async () => {
    await admin((d) => d.ref(`${G}/players/ann/gun`).set(gunDoc('longshot')));
    await assertFails(db('ann').ref(G).update(hitUpdate('ann', 'bob', 's1', life(), { with: 'longshot', head: true, shot: { kill: false } })));
    await assertSucceeds(db('ann').ref(G).update(hitUpdate('ann', 'bob', 's1', life(), { with: 'longshot', head: true })));
    expect(await read(`${G}/players/bob/life`)).toMatchObject({ hp: 0, alive: false });
  });

  it('takes a pistol player out in two headshots', async () => {
    await db('ann').ref(G).update(hitUpdate('ann', 'bob', 's1', life(), { head: true }));
    await sleep(300); // past the pistol's 250 ms between hits
    const now = await read(`${G}/players/bob/life`);
    await assertSucceeds(db('ann').ref(G).update(hitUpdate('ann', 'bob', 's2', now, { head: true })));
    expect(await read(`${G}/players/bob/life/alive`)).toBe(false);
  });
});

describe('grenades', () => {
  beforeEach(() => seedGame('live'));
  /** Ann threw `agoMs` ago (the database sees it as a throw at that time). */
  const thrown = async (agoMs: number) => {
    const at = Date.now() - agoMs;
    await admin((d) => d.ref(`${G}/players/ann/lastGrenadeAt`).set(at));
    return at;
  };

  it('lets you throw in a live game, which starts the recharge', async () => {
    await assertSucceeds(db('ann').ref(`${G}/players/ann/lastGrenadeAt`).set(TS));
    await assertFails(db('ann').ref(`${G}/players/ann/lastGrenadeAt`).set(TS));
    await assertFails(db('ann').ref(`${G}/players/bob/lastGrenadeAt`).set(TS));
    await admin((d) => d.ref(`${G}/players/ann/lastGrenadeAt`).set(Date.now() - GRENADE.cooldownMs - 200));
    await assertSucceeds(db('ann').ref(`${G}/players/ann/lastGrenadeAt`).set(TS));
  });

  it('refuses a throw outside a live game, or a made-up time', async () => {
    await assertFails(db('ann').ref(`${G}/players/ann/lastGrenadeAt`).set(Date.now() - 60000));
    await admin((d) => d.ref(`${G}/meta/state`).set('ended'));
    await assertFails(db('ann').ref(`${G}/players/ann/lastGrenadeAt`).set(TS));
  });

  it(`takes ${GRENADE.near.damage} up close and ${GRENADE.far.damage} further out, and nothing past ${GRENADE.far.m} m`, async () => {
    const at = await thrown(1600);
    await assertSucceeds(db('ann').ref(G).update(grenadeHit('ann', 'bob', 'g1', life(), at, { dist: 3.5 })));
    expect(await read(`${G}/players/bob/life/hp`)).toBe(100 - GRENADE.near.damage);
    await seedGame('live');
    const at2 = await thrown(1600);
    await assertFails(db('ann').ref(G).update(grenadeHit('ann', 'bob', 'g2', life(), at2, { dist: 9, damage: GRENADE.near.damage })));
    await assertSucceeds(db('ann').ref(G).update(grenadeHit('ann', 'bob', 'g2', life(), at2, { dist: 9 })));
    expect(await read(`${G}/players/bob/life/hp`)).toBe(100 - GRENADE.far.damage);
    await seedGame('live');
    const at3 = await thrown(1600);
    await assertFails(db('ann').ref(G).update(grenadeHit('ann', 'bob', 'g3', life(), at3, { dist: GRENADE.far.m + 1 })));
  });

  it('counts "too close to measure" (distance 0) as up close', async () => {
    const at = await thrown(1600);
    await assertFails(db('ann').ref(G).update(grenadeHit('ann', 'bob', 'g1', life(), at, { dist: 0, damage: GRENADE.far.damage })));
    await assertSucceeds(db('ann').ref(G).update(grenadeHit('ann', 'bob', 'g1', life(), at, { dist: 0 })));
  });

  it('refuses a blast before the fuse has burned, or long after the throw, or with no throw', async () => {
    await assertFails(db('ann').ref(G).update(grenadeHit('ann', 'bob', 'g1', life(), 0)));
    const early = await thrown(300);
    await assertFails(db('ann').ref(G).update(grenadeHit('ann', 'bob', 'g1', life(), early)));
    const late = await thrown(GRENADE.hitWindowMs.to + 1500);
    await assertFails(db('ann').ref(G).update(grenadeHit('ann', 'bob', 'g1', life(), late)));
  });

  it('lets one throw hit only once, and only with the throw marked as used', async () => {
    const at = await thrown(1600);
    await assertFails(db('ann').ref(G).update(grenadeHit('ann', 'bob', 'g1', life(), at, { skipMark: true })));
    await assertFails(db('ann').ref(G).update(grenadeHit('ann', 'bob', 'g1', life(), at - 5000)));
    await assertSucceeds(db('ann').ref(G).update(grenadeHit('ann', 'bob', 'g1', life(), at)));
    const now = await read(`${G}/players/bob/life`);
    await assertFails(db('ann').ref(G).update(grenadeHit('ann', 'bob', 'g2', now, at)));
  });

  it("never claims a headshot, another gun's damage, or a hit on yourself", async () => {
    const at = await thrown(1600);
    await assertFails(db('ann').ref(G).update(grenadeHit('ann', 'bob', 'g1', life(), at, { shot: { head: true } })));
    await assertFails(db('ann').ref(G).update(grenadeHit('ann', 'bob', 'g1', life(), at, { shot: { gun: 'blip' } })));
    await assertFails(db('ann').ref(G).update(grenadeHit('ann', 'ann', 'g1', life(), at)));
    await assertFails(db('ann').ref(G).update(grenadeHit('ann', 'bob', 'g1', life(), at, { shot: { via: 'rocket' } })));
  });

  it('refuses a blast on a player who is down or spawn-protected, or from a downed thrower', async () => {
    const at = await thrown(1600);
    await admin((d) => d.ref(`${G}/players/bob/life`).set(life({ seq: 3, spawnAt: Date.now() })));
    await assertFails(db('ann').ref(G).update(grenadeHit('ann', 'bob', 'g1', life({ seq: 3, spawnAt: Date.now() }), at)));
    await admin((d) => d.ref(`${G}/players/bob/life`).set(life({ hp: 0, alive: false, seq: 4, shot: 's4', diedAt: Date.now() })));
    await assertFails(db('ann').ref(G).update(grenadeHit('ann', 'bob', 'g1', life({ hp: 0, alive: false, seq: 4 }), at)));
    await seedGame('live');
    const at2 = await thrown(1600);
    await admin((d) => d.ref(`${G}/players/ann/life`).set(life({ hp: 0, alive: false, seq: 2, shot: 's2', diedAt: Date.now() })));
    await assertFails(db('ann').ref(G).update(grenadeHit('ann', 'bob', 'g1', life(), at2)));
  });

  it("leaves the gun's cooldown alone: a grenade and a shot can land together", async () => {
    const at = await thrown(1600);
    await db('ann').ref(G).update(hitUpdate('ann', 'bob', 's1', life()));
    const now = await read(`${G}/players/bob/life`);
    await assertSucceeds(db('ann').ref(G).update(grenadeHit('ann', 'bob', 'g1', now, at)));
    expect(await read(`${G}/players/bob/life/hp`)).toBe(100 - 25 - GRENADE.near.damage);
  });

  it('kills a player low on health and flags the kill', async () => {
    const at = await thrown(1600);
    await admin((d) => d.ref(`${G}/players/bob/life`).set(life({ hp: 50, seq: 2 })));
    await assertSucceeds(db('ann').ref(G).update(grenadeHit('ann', 'bob', 'g1', life({ hp: 50, seq: 2 }), at)));
    expect(await read(`${G}/players/bob/life`)).toMatchObject({ hp: 0, alive: false });
    expect(await read(`${G}/shots/g1/kill`)).toBe(true);
  });
});

describe('flashbangs', () => {
  beforeEach(() => seedGame('live'));

  it('records a catch and starts the recharge in one write, without touching health', async () => {
    await assertSucceeds(db('ann').ref(G).update(flashUpdate('ann', 'bob', 'f1')));
    const f = await read(`${G}/flashes/f1`);
    expect(f.by).toBe('ann');
    expect(f.target).toBe('bob');
    expect(Math.abs(f.at - Date.now())).toBeLessThan(5000);
    expect(await read(`${G}/players/ann/lastFlashAt`)).toBe(f.at);
    expect((await read(`${G}/players/bob/life`)).hp).toBe(100);
  });

  it('lets the other player see it, but nobody outside the game', async () => {
    await db('ann').ref(G).update(flashUpdate('ann', 'bob', 'f1'));
    await assertSucceeds(db('bob').ref(`${G}/flashes`).get());
    await assertFails(db('stranger').ref(`${G}/flashes`).get());
  });

  it('lets a miss start the recharge on its own', async () => {
    await assertSucceeds(db('bob').ref(`${G}/players/bob/lastFlashAt`).set(TS));
    await assertFails(db('ann').ref(`${G}/players/bob/lastFlashAt`).set(TS));
    await assertFails(db('bob').ref(`${G}/players/bob/lastFlashAt`).set(0));
  });

  it('refuses a catch that skips the recharge stamp', async () => {
    await assertFails(db('ann').ref(G).update(flashUpdate('ann', 'bob', 'f1', { skipStamp: true })));
  });

  it(`refuses a second flashbang within ${FLASH.cooldownMs / 1000} s, hit or miss`, async () => {
    await db('ann').ref(G).update(flashUpdate('ann', 'bob', 'f1'));
    await assertFails(db('ann').ref(G).update(flashUpdate('ann', 'bob', 'f2')));
    await db('bob').ref(`${G}/players/bob/lastFlashAt`).set(TS); // Bob's throw missed
    await assertFails(db('bob').ref(G).update(flashUpdate('bob', 'ann', 'f3')));
    await admin((d) => d.ref(`${G}/players/ann/lastFlashAt`).set(Date.now() - FLASH.cooldownMs - 200));
    await assertSucceeds(db('ann').ref(G).update(flashUpdate('ann', 'bob', 'f4')));
  });

  it('works in a game started before flashbangs existed (no recharge stamp yet)', async () => {
    await admin((d) => d.ref(`${G}/players/ann/lastFlashAt`).remove());
    await assertSucceeds(db('ann').ref(G).update(flashUpdate('ann', 'bob', 'f1')));
  });

  it('refuses flashing yourself, forging one as the other player, or extra fields', async () => {
    await assertFails(db('ann').ref(G).update(flashUpdate('ann', 'ann', 'f1')));
    await assertFails(db('ann').ref(G).update({ ...flashUpdate('bob', 'ann', 'f1'), 'players/bob/lastFlashAt': TS }));
    await assertFails(db('ann').ref(G).update(flashUpdate('ann', 'bob', 'f1', { flash: { damage: 50 } })));
  });

  it(`refuses a catch further than ${FLASH.rangeM} m, or a made-up time`, async () => {
    await assertFails(db('ann').ref(G).update(flashUpdate('ann', 'bob', 'f1', { flash: { dist: FLASH.rangeM + 1 } })));
    await assertFails(db('ann').ref(G).update(flashUpdate('ann', 'bob', 'f1', { flash: { at: Date.now() - 60000 } })));
    await assertSucceeds(db('ann').ref(G).update(flashUpdate('ann', 'bob', 'f1', { flash: { dist: 0 } })));
  });

  it('refuses flashing a player who is down or spawn-protected, or throwing while down', async () => {
    await admin((d) => d.ref(`${G}/players/bob/life`).set(life({ hp: 0, alive: false, seq: 4, shot: 's4', diedAt: Date.now() })));
    await assertFails(db('ann').ref(G).update(flashUpdate('ann', 'bob', 'f1')));
    await assertFails(db('bob').ref(G).update(flashUpdate('bob', 'ann', 'f2')));
    await admin((d) => d.ref(`${G}/players/bob/life`).set(life({ seq: 5, spawnAt: Date.now() })));
    await assertFails(db('ann').ref(G).update(flashUpdate('ann', 'bob', 'f3')));
  });

  it('refuses flashbangs outside the game window', async () => {
    await admin((d) => d.ref(`${G}/meta/state`).set('ended'));
    await assertFails(db('ann').ref(G).update(flashUpdate('ann', 'bob', 'f1')));
  });

  it('never lets anyone rewrite a flashbang, and lets the host clear them after the game', async () => {
    await db('ann').ref(G).update(flashUpdate('ann', 'bob', 'f1'));
    await assertFails(db('ann').ref(`${G}/flashes/f1/target`).set('ann'));
    await assertFails(db('bob').ref(`${G}/flashes/f1`).remove());
    await assertFails(db('ann').ref(`${G}/flashes`).remove());
    await admin((d) => d.ref(`${G}/meta/state`).set('ended'));
    await assertFails(db('bob').ref(`${G}/flashes`).remove());
    await assertSucceeds(db('ann').ref(`${G}/flashes`).remove());
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
