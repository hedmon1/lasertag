// The guns you can pick in the Armory. Damage and the time between hits are enforced by
// the database rules (database.rules.json, checked against this table by
// tests/unit/guns.test.ts); everything else is how the gun feels in your hands.

export type GunId = 'blip' | 'stinger' | 'triplet' | 'thumper' | 'boomstick' | 'longshot';

export type FireMode = 'semi' | 'auto' | 'burst';

export interface Gun {
  id: GunId;
  name: string;
  /** What kind of gun it is, shown under the name. */
  kind: string;
  /** One line for the Armory. */
  blurb: string;
  damage: number;
  /** semi: one shot per press. auto: fires while held. burst: `burst.count` shots per press. */
  mode: FireMode;
  burst?: { count: number; gapMs: number };
  /** Time from one trigger pull (or burst, or automatic shot) to the next. */
  fireMs: number;
  /** The least time the database allows between two of your hits. */
  cooldownMs: number;
  magazine: number;
  reloadMs: number;
  /** Hits beyond this distance don't count; null for no limit. */
  rangeM: number | null;
  /** How much of a person's box width counts as a hit: wider is more forgiving. */
  hitWidth: number;
  /** How far the Scope button zooms. */
  scope: number;
  /** The gun's accent colour, for the Armory and its glowing parts. */
  color: string;
  sound: {
    /** Close-up takes in public/sounds/guns/<id>.mp3 (see scripts/build-gun-sounds.mjs). */
    takes: number;
    /** Level into the mix; the soft clipper keeps every gun under full scale. */
    gain: number;
    /** Playback speed: below 1 is deeper and heavier. */
    rate: number;
    /** What the action does after the shot. */
    action: 'slide' | 'bolt' | 'pump' | 'hammer';
    /** Throws a casing that you hear land (a revolver keeps its brass). */
    casing: boolean;
  };
}

export const HP = 100;

export const GUNS: Gun[] = [
  {
    id: 'blip',
    name: 'Blip',
    kind: 'Pistol',
    blurb: 'Quick and steady. Good at every range.',
    damage: 25,
    mode: 'semi',
    fireMs: 350,
    cooldownMs: 250,
    magazine: 12,
    reloadMs: 1800,
    rangeM: null,
    hitWidth: 0.8,
    scope: 2,
    color: '#c6ff3a',
    sound: { takes: 3, gain: 2.2, rate: 1, action: 'slide', casing: true },
  },
  {
    id: 'stinger',
    name: 'Stinger',
    kind: 'SMG',
    blurb: 'Hold Fire to spray. Light hits, very fast.',
    damage: 13,
    mode: 'auto',
    fireMs: 110,
    cooldownMs: 70,
    magazine: 30,
    reloadMs: 2100,
    rangeM: 25,
    hitWidth: 0.8,
    scope: 1.5,
    color: '#26e0ff',
    sound: { takes: 5, gain: 1.7, rate: 1.04, action: 'slide', casing: true },
  },
  {
    id: 'triplet',
    name: 'Triplet',
    kind: 'Burst rifle',
    blurb: 'Three rounds every pull. Keep it on target.',
    damage: 20,
    mode: 'burst',
    burst: { count: 3, gapMs: 90 },
    fireMs: 560,
    cooldownMs: 60,
    magazine: 24,
    reloadMs: 2300,
    rangeM: null,
    hitWidth: 0.8,
    scope: 2.5,
    color: '#ff3d8b',
    sound: { takes: 4, gain: 1.8, rate: 1, action: 'slide', casing: true },
  },
  {
    id: 'thumper',
    name: 'Thumper',
    kind: 'Revolver',
    blurb: 'Six heavy rounds. Three hits and they are out.',
    damage: 34,
    mode: 'semi',
    fireMs: 600,
    cooldownMs: 420,
    magazine: 6,
    reloadMs: 2600,
    rangeM: null,
    hitWidth: 0.8,
    scope: 2,
    color: '#ffd23e',
    sound: { takes: 2, gain: 2.4, rate: 0.9, action: 'hammer', casing: false },
  },
  {
    id: 'boomstick',
    name: 'Boomstick',
    kind: 'Shotgun',
    blurb: 'Wide spread, two hits. Only counts up close.',
    damage: 50,
    mode: 'semi',
    fireMs: 950,
    cooldownMs: 660,
    magazine: 5,
    reloadMs: 2800,
    rangeM: 12,
    hitWidth: 1.25,
    scope: 1.5,
    color: '#ff4d4d',
    sound: { takes: 2, gain: 2.6, rate: 0.96, action: 'pump', casing: true },
  },
  {
    id: 'longshot',
    name: 'Longshot',
    kind: 'Sniper',
    blurb: 'Big scope, big hits. Slow, and it needs aim.',
    damage: 80,
    mode: 'semi',
    fireMs: 1500,
    cooldownMs: 1050,
    magazine: 4,
    reloadMs: 3000,
    rangeM: null,
    hitWidth: 0.6,
    scope: 3,
    color: '#a855ff',
    sound: { takes: 4, gain: 2.4, rate: 1, action: 'bolt', casing: true },
  },
];

export const DEFAULT_GUN: GunId = 'blip';

const BY_ID = new Map(GUNS.map((g) => [g.id, g]));

export function isGunId(id: unknown): id is GunId {
  return typeof id === 'string' && BY_ID.has(id as GunId);
}

/** The gun with this id, or the default for anything unknown (an old save, a typo). */
export function gun(id: unknown): Gun {
  return BY_ID.get(id as GunId) ?? BY_ID.get(DEFAULT_GUN)!;
}

/** Hits needed to take a full-health player out. */
export function hitsToEliminate(g: Gun, hp = HP): number {
  return Math.ceil(hp / g.damage);
}

/** Shots per second with the trigger held (or pulled as fast as it allows). */
export function shotsPerSecond(g: Gun): number {
  return ((g.mode === 'burst' ? g.burst!.count : 1) * 1000) / g.fireMs;
}

/** What a player's record says about their gun; the database checks it against the table. */
export interface GunDoc {
  id: GunId;
  damage: number;
  cooldownMs: number;
}

export function gunDoc(id: GunId): GunDoc {
  const g = gun(id);
  return { id: g.id, damage: g.damage, cooldownMs: g.cooldownMs };
}
