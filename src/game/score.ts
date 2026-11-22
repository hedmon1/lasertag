export interface ShotRecord {
  id: string;
  by: string;
  target: string;
  /** 'ai': a gun shot the AI saw land. 'grenade': a grenade's blast. */
  via: 'ai' | 'grenade';
  /** The shooter's gun (GunId), or 'grenade'; missing on shots from before the Armory. */
  gun?: string;
  dist: number;
  at: number;
  kill: boolean;
  /** A headshot (double damage); missing on body hits. */
  head?: boolean;
}

export interface ScoreRow {
  uid: string;
  name: string;
  slot: number;
  kills: number;
  deaths: number;
  /** Gun hits. Grenades are counted apart, in `nades`. */
  hits: number;
  /** Gun hits on the head. */
  heads: number;
  /** Grenades that caught someone. */
  nades: number;
  fired: number;
  /** Gun hits per trigger pull, 0..1. A grenade isn't a trigger pull, so it doesn't count. */
  accuracy: number;
}

export interface ScorePlayer {
  name: string;
  slot: number;
  fired?: number;
}

/** Scoreboard from the shot log. Kills first, then fewest deaths, then accuracy. */
export function scoreboard(players: Record<string, ScorePlayer>, shots: ShotRecord[]): ScoreRow[] {
  const rows = new Map<string, ScoreRow>();
  for (const [uid, p] of Object.entries(players)) {
    if (p.slot < 0) continue;
    rows.set(uid, { uid, name: p.name, slot: p.slot, kills: 0, deaths: 0, hits: 0, heads: 0, nades: 0, fired: p.fired ?? 0, accuracy: 0 });
  }
  for (const s of shots) {
    const by = rows.get(s.by), target = rows.get(s.target);
    if (by) {
      if (s.via === 'grenade') by.nades++;
      else {
        by.hits++;
        if (s.head) by.heads++;
      }
      if (s.kill) by.kills++;
    }
    if (target && s.kill) target.deaths++;
  }
  for (const r of rows.values()) r.accuracy = r.fired > 0 ? Math.min(1, r.hits / r.fired) : 0;
  return [...rows.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || b.accuracy - a.accuracy || a.slot - b.slot);
}

export function leaderKills(rows: ScoreRow[]): number {
  return rows.reduce((m, r) => Math.max(m, r.kills), 0);
}

/** Newest first, for the kill feed. */
export function killFeed(shots: ShotRecord[], limit = 4): ShotRecord[] {
  return shots.filter((s) => s.kill).sort((a, b) => b.at - a.at).slice(0, limit);
}

/** Who leads at something, and by how much. A tie lists everyone on the top count. */
export interface Leader {
  uids: string[];
  count: number;
}

export interface Highlights {
  /** The longest gun hit with a known distance. Grenades don't count: they aren't aimed. */
  longest: { by: string; gun?: string; dist: number } | null;
  /** Most headshots, at least one. */
  heads: Leader | null;
  /** Most kills in a row without being eliminated, at least two. */
  streak: Leader | null;
  /** Most grenade kills, at least one. */
  grenadeKills: Leader | null;
}

function leader(counts: Map<string, number>, min: number): Leader | null {
  let best: Leader | null = null;
  for (const [uid, n] of counts) {
    if (n < min) continue;
    if (!best || n > best.count) best = { uids: [uid], count: n };
    else if (n === best.count) best.uids.push(uid);
  }
  return best;
}

/** The match's highlights for the scoreboard, from the shot log. Only players with a slot count. */
export function highlights(players: Record<string, ScorePlayer>, shots: ShotRecord[]): Highlights {
  const playing = (uid: string) => (players[uid]?.slot ?? -1) >= 0;
  const inOrder = shots.filter((s) => playing(s.by)).sort((a, b) => a.at - b.at);
  const heads = new Map<string, number>();
  const nadeKills = new Map<string, number>();
  const run = new Map<string, number>();
  const streak = new Map<string, number>();
  let longest: Highlights['longest'] = null;
  for (const s of inOrder) {
    if (s.via !== 'grenade' && s.dist > 0 && (!longest || s.dist > longest.dist)) longest = { by: s.by, gun: s.gun, dist: s.dist };
    if (s.head && s.via !== 'grenade') heads.set(s.by, (heads.get(s.by) ?? 0) + 1);
    if (!s.kill) continue;
    if (s.via === 'grenade') nadeKills.set(s.by, (nadeKills.get(s.by) ?? 0) + 1);
    const n = (run.get(s.by) ?? 0) + 1;
    run.set(s.by, n);
    streak.set(s.by, Math.max(streak.get(s.by) ?? 0, n));
    run.set(s.target, 0);
  }
  return { longest, heads: leader(heads, 1), streak: leader(streak, 2), grenadeKills: leader(nadeKills, 1) };
}

/** True when there's nothing to show. */
export function noHighlights(h: Highlights): boolean {
  return !h.longest && !h.heads && !h.streak && !h.grenadeKills;
}
