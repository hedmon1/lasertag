// Shared setup for the database rules tests. Each test file gets its own namespace-wide
// clean slate; helpers seed a game directly (rules off) so each test starts from a known state.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';

import { gun, gunDoc, type GunId } from '../../src/game/guns.ts';

export { assertFails, assertSucceeds, gunDoc };

export const TS = { '.sv': 'timestamp' } as const;
export const INC = { '.sv': { increment: 1 } } as const;

export const RULES = { hp: 100, respawnMs: 3000, protectMs: 2000, durationMs: 600000, killLimit: 10 };

let env: RulesTestEnvironment;

export async function setup(): Promise<RulesTestEnvironment> {
  env = await initializeTestEnvironment({
    projectId: 'demo-laser-tag',
    database: { rules: readFileSync(resolve(import.meta.dirname, '../../database.rules.json'), 'utf8') },
  });
  return env;
}

export async function teardown() {
  await env?.cleanup();
}

export async function reset() {
  await env.clearDatabase();
}

export function db(uid: string | null) {
  return uid ? env.authenticatedContext(uid).database() : env.unauthenticatedContext().database();
}

export async function admin(fn: (d: ReturnType<typeof db>) => Promise<unknown>) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await fn(ctx.database());
  });
}

export function life(over: Partial<Record<string, unknown>> = {}) {
  return { hp: 100, alive: true, seq: 0, shot: '', diedAt: 0, spawnAt: 0, ...over };
}

/** A seeded player, holding the pistol unless `over` says otherwise. */
export function player(name: string, slot: number, over: Record<string, unknown> = {}) {
  return { name, joinedAt: 1, slot, life: life(), fired: 0, lastShotAt: 0, gun: gunDoc('blip'), online: true, ...over };
}

/**
 * Seeds game ABCD. `state` 'live' means started 10 s ago and ending in 10 minutes.
 * Two players: Ann (host, seat 0) and Bob (seat 1).
 */
export async function seedGame(state: 'lobby' | 'live' | 'ended' = 'live', extra: Record<string, unknown> = {}) {
  const now = Date.now();
  const meta: Record<string, unknown> = { host: 'ann', state, createdAt: now - 60000, rules: RULES };
  if (state !== 'lobby') {
    meta.startAt = now - 10000;
    meta.endAt = now - 10000 + RULES.durationMs;
  }
  await admin((d) =>
    d.ref('games/ABCD').set({
      meta,
      slots: { '0': 'ann', '1': 'bob' },
      players: { ann: player('Ann', 0), bob: player('Bob', 1) },
      ...extra,
    }),
  );
}

export async function read(path: string): Promise<any> {
  let v: unknown;
  await admin(async (d) => {
    v = (await d.ref(path).get()).val();
  });
  return v;
}

/** The atomic write a shooter's phone sends for one hit with `with` (the pistol by default). */
export function hitUpdate(
  shooter: string,
  target: string,
  shotId: string,
  targetLife: Record<string, any>,
  over: { shot?: Record<string, unknown>; life?: Record<string, unknown>; skipLastShot?: boolean; with?: GunId } = {},
) {
  const g = gun(over.with ?? 'blip');
  const kill = targetLife.hp <= g.damage;
  const update: Record<string, unknown> = {
    [`shots/${shotId}`]: { by: shooter, target, via: 'ai', gun: g.id, dist: 6.5, at: TS, kill, ...over.shot },
    [`players/${target}/life`]: {
      hp: kill ? 0 : targetLife.hp - g.damage,
      alive: !kill,
      seq: targetLife.seq + 1,
      shot: shotId,
      diedAt: kill ? TS : 0,
      spawnAt: targetLife.spawnAt,
      ...over.life,
    },
  };
  if (!over.skipLastShot) update[`players/${shooter}/lastShotAt`] = TS;
  return update;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
