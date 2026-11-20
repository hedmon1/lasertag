// The frag grenade. Throw it and it goes off 1.5 s later; whoever is in your camera's view
// at that moment, within 12 m, takes damage by how close they are. The fuse is the
// counterplay: the other phone hears it coming and can get out of your view. One hit per
// throw, recharged 25 s after each throw. database.rules.json enforces all of this
// (scripts/build-rules.mjs writes these numbers into it).

export const GRENADE = {
  /** From the throw to the blast. */
  fuseMs: 1500,
  /** Time between throws. */
  cooldownMs: 25000,
  /** Close: within `m` metres (or too close to measure). */
  near: { m: 5, damage: 60 },
  /** Further out, up to `m` metres; beyond that it misses. */
  far: { m: 12, damage: 35 },
  /** The database accepts the hit only this long after the throw: the fuse, give or take lag. */
  hitWindowMs: { from: 1000, to: 4000 },
};

/** Damage at a distance, or null when it's out of reach. Null distance means too close to measure. */
export function grenadeDamage(distM: number | null): number | null {
  if (distM === null || distM <= GRENADE.near.m) return GRENADE.near.damage;
  if (distM <= GRENADE.far.m) return GRENADE.far.damage;
  return null;
}

/** Milliseconds until the grenade is back, 0 when it's ready. `lastThrowAt` 0 means never thrown. */
export function grenadeReadyIn(lastThrowAt: number, now: number): number {
  if (!lastThrowAt) return 0;
  return Math.max(0, lastThrowAt + GRENADE.cooldownMs - now);
}
