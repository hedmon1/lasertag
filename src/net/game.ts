// Every write the game makes. database.rules.json is the authority; these build exactly the
// shapes it accepts (tests/rules exercises the same shapes against the emulator).
import {
  get, increment, onDisconnect, onValue, push, ref, serverTimestamp, set, update, type DatabaseReference,
} from 'firebase/database';
import { database, serverNow } from './firebase.ts';
import { DEFAULT_RULES, freshLife, type GameRules, type Life } from '../game/rules.ts';
import type { ShotRecord } from '../game/score.ts';

export type GameState = 'lobby' | 'live' | 'ended';

export interface Meta {
  host: string;
  state: GameState;
  createdAt: number;
  startAt?: number;
  endAt?: number;
  rules: GameRules;
}

export interface PlayerDoc {
  name: string;
  joinedAt: number;
  slot: number;
  life: Life;
  fired: number;
  lastShotAt: number;
  online?: boolean;
}

export type Players = Record<string, PlayerDoc>;
export type { ShotRecord };

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const COUNTDOWN_MS = 5000;
/** Two players for now: seat 0 is the host, seat 1 the opponent. */
export const SEATS = 2;

const gameRef = (code: string, path = ''): DatabaseReference => ref(database(), `games/${code}${path ? '/' + path : ''}`);

export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
}

export function isGameCode(code: string): boolean {
  return /^[A-HJ-NP-Z]{4}$/.test(code);
}

function randomCode(): string {
  let s = '';
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  for (const b of bytes) s += CODE_LETTERS[b % CODE_LETTERS.length];
  return s;
}

export function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, 16);
}

function newPlayer(name: string, rules: GameRules, seat: number) {
  return {
    name: cleanName(name),
    joinedAt: serverTimestamp(),
    slot: seat,
    life: freshLife(rules),
    fired: 0,
    lastShotAt: 0,
    online: true,
  };
}

/** Creates a game with a fresh 4-letter code, joins it as host, and returns the code. */
export async function createGame(uid: string, name: string): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode();
    const existing = await get(gameRef(code, 'meta'));
    if (existing.exists()) continue;
    try {
      await set(gameRef(code, 'meta'), { host: uid, state: 'lobby', createdAt: serverTimestamp(), rules: DEFAULT_RULES });
    } catch {
      continue; // someone took the code between the check and the write
    }
    await update(gameRef(code), { [`players/${uid}`]: newPlayer(name, DEFAULT_RULES, 0), 'slots/0': uid });
    return code;
  }
  throw new Error('Could not create a game. Check your connection and try again.');
}

export async function readMeta(code: string): Promise<Meta | null> {
  const s = await get(gameRef(code, 'meta'));
  return s.exists() ? (s.val() as Meta) : null;
}

export async function joinGame(code: string, uid: string, name: string): Promise<void> {
  const meta = await readMeta(code);
  if (!meta) throw new Error(`No game with code ${code}.`);
  if (meta.state !== 'lobby') throw new Error('That game has already started. Ask the host to start a new round.');
  const seats = ((await get(gameRef(code, 'slots'))).val() ?? {}) as Record<string, string>;
  const seat = Array.from({ length: SEATS }, (_, i) => i).find((i) => !seats[i]);
  if (seat === undefined) throw new Error('This game already has 2 players.');
  try {
    await update(gameRef(code), { [`players/${uid}`]: newPlayer(name, meta.rules, seat), [`slots/${seat}`]: uid });
  } catch {
    throw new Error('Could not join. Someone may have taken the last spot; try again.');
  }
}

export async function renamePlayer(code: string, uid: string, name: string) {
  await set(gameRef(code, `players/${uid}/name`), cleanName(name));
}

export async function setRules(code: string, rules: Partial<Pick<GameRules, 'respawnMs' | 'durationMs' | 'killLimit'>>) {
  const changes: Record<string, number> = {};
  for (const [k, v] of Object.entries(rules)) changes[`rules/${k}`] = v as number;
  await update(gameRef(code, 'meta'), changes);
}

export async function startGame(code: string, rules: GameRules) {
  const startAt = Math.round(serverNow() + COUNTDOWN_MS);
  await update(gameRef(code, 'meta'), { state: 'live', startAt, endAt: startAt + rules.durationMs });
}

export async function endGame(code: string) {
  await set(gameRef(code, 'meta/state'), 'ended');
}

/** Host only, after a game: clears shots and kill cams and gives everyone full health. */
export async function playAgain(code: string, players: Players, rules: GameRules) {
  const changes: Record<string, unknown> = { 'meta/state': 'lobby', shots: null, killcams: null };
  for (const [uid, p] of Object.entries(players)) {
    changes[`players/${uid}/life`] = freshLife(rules, p.life?.seq ?? 0);
    changes[`players/${uid}/fired`] = 0;
  }
  await update(gameRef(code), changes);
}

export async function clearKillcams(code: string) {
  await set(gameRef(code, 'killcams'), null);
}

export interface HitRequest {
  target: string;
  /** Estimated distance, or null when the person was cut off by the frame edge. */
  distanceM: number | null;
}

export type HitResult =
  | { ok: true; shotId: string; kill: boolean }
  | { ok: false; reason: 'down' | 'protected' | 'rejected' };

function hitChanges(me: string, req: HitRequest, life: Life, rules: GameRules, shotId: string) {
  const kill = life.hp <= rules.damage;
  // 0 means unknown; the HUD leaves it out.
  const dist = req.distanceM === null ? 0 : Math.max(0, Math.min(200, Math.round(req.distanceM * 10) / 10)) || 0;
  return {
    kill,
    changes: {
      [`shots/${shotId}`]: { by: me, target: req.target, via: 'ai', dist, at: serverTimestamp(), kill },
      [`players/${req.target}/life`]: {
        hp: kill ? 0 : life.hp - rules.damage,
        alive: !kill,
        seq: life.seq + 1,
        shot: shotId,
        diedAt: kill ? serverTimestamp() : 0,
        spawnAt: life.spawnAt,
      },
      [`players/${me}/lastShotAt`]: serverTimestamp(),
    },
  };
}

/**
 * Applies a hit. Built from the target's last known life; if someone else hit them in the
 * meantime the database refuses it (stale sequence), so this re-reads once and retries.
 */
export async function submitHit(code: string, me: string, req: HitRequest, known: Life, rules: GameRules): Promise<HitResult> {
  let life = known;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!life.alive) return { ok: false, reason: 'down' };
    if (life.spawnAt > 0 && serverNow() < life.spawnAt + rules.protectMs) return { ok: false, reason: 'protected' };
    const shotId = push(gameRef(code, 'shots')).key!;
    const { kill, changes } = hitChanges(me, req, life, rules, shotId);
    try {
      await update(gameRef(code), changes);
      return { ok: true, shotId, kill };
    } catch {
      const fresh = await get(gameRef(code, `players/${req.target}/life`));
      if (!fresh.exists()) return { ok: false, reason: 'rejected' };
      const next = fresh.val() as Life;
      // Same state as before: refused for another reason (cooldown, game just ended).
      if (next.seq === life.seq) return { ok: false, reason: 'rejected' };
      life = next;
    }
  }
  return { ok: false, reason: life.alive ? 'rejected' : 'down' };
}

export async function countTrigger(code: string, me: string) {
  await set(gameRef(code, `players/${me}/fired`), increment(1));
}

export async function respawn(code: string, me: string, life: Life, rules: GameRules) {
  await set(gameRef(code, `players/${me}/life`), {
    hp: rules.hp, alive: true, seq: life.seq + 1, shot: '', diedAt: 0, spawnAt: serverTimestamp(),
  });
}

export async function sendKillcam(code: string, shotId: string, me: string, target: string, jpg: string) {
  await set(gameRef(code, `killcams/${shotId}`), { by: me, target, jpg });
}

export function watchKillcam(code: string, shotId: string, cb: (jpg: string | null) => void): () => void {
  return onValue(gameRef(code, `killcams/${shotId}`), (s) => cb(s.exists() ? (s.val().jpg as string) : null), () => cb(null));
}

/** Marks the player online while connected, offline when the tab closes or drops. */
export function keepPresence(code: string, me: string): () => void {
  const onlineRef = gameRef(code, `players/${me}/online`);
  return onValue(ref(database(), '.info/connected'), (s) => {
    if (s.val() !== true) return;
    onDisconnect(onlineRef).set(false).then(() => set(onlineRef, true)).catch(() => {});
  });
}
