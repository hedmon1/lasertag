// Game rules and the life state machine. The database rules (database.rules.json) enforce
// exactly the same transitions server-side; tests/rules checks the two agree. Damage and the
// time between hits belong to each player's gun (guns.ts).

export interface GameRules {
  hp: number;
  respawnMs: number;
  protectMs: number;
  durationMs: number;
  killLimit: number;
}

export const DEFAULT_RULES: GameRules = {
  hp: 100,
  respawnMs: 8000,
  protectMs: 2000,
  durationMs: 10 * 60 * 1000,
  killLimit: 10,
};

/** Host-adjustable ranges, mirrored in database.rules.json. */
export const RULE_LIMITS = {
  respawnMs: { min: 3000, max: 30000 },
  durationMs: { min: 60 * 1000, max: 60 * 60 * 1000 },
  killLimit: { min: 1, max: 50 },
};

export interface Life {
  hp: number;
  alive: boolean;
  /** Bumped on every change, so two shooters can't both apply a hit to the same state. */
  seq: number;
  /** Id of the shot that last changed this life, or ''. */
  shot: string;
  /** Server time of death, 0 while alive. */
  diedAt: number;
  /** Server time of the last respawn, 0 at game start. */
  spawnAt: number;
}

export function freshLife(rules: GameRules, prevSeq?: number): Life {
  return { hp: rules.hp, alive: true, seq: prevSeq === undefined ? 0 : prevSeq + 1, shot: '', diedAt: 0, spawnAt: 0 };
}

/** The life after one hit for `damage`. `diedAt` is the caller's timestamp (the database uses its own clock). */
export function lifeAfterHit(life: Life, damage: number, shotId: string, diedAt: number): Life {
  const kill = life.hp <= damage;
  return {
    hp: kill ? 0 : life.hp - damage,
    alive: !kill,
    seq: life.seq + 1,
    shot: shotId,
    diedAt: kill ? diedAt : 0,
    spawnAt: life.spawnAt,
  };
}

export function respawnAt(life: Life, rules: GameRules): number {
  return life.diedAt + rules.respawnMs;
}

export function canRespawn(life: Life, rules: GameRules, now: number): boolean {
  return !life.alive && now >= respawnAt(life, rules);
}

export function isProtected(life: Life, rules: GameRules, now: number): boolean {
  return life.alive && life.spawnAt > 0 && now < life.spawnAt + rules.protectMs;
}
