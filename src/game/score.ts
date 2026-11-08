export interface ShotRecord {
  id: string;
  by: string;
  target: string;
  via: 'ai';
  /** The shooter's gun (GunId); missing on shots from before the Armory. */
  gun?: string;
  dist: number;
  at: number;
  kill: boolean;
}

export interface ScoreRow {
  uid: string;
  name: string;
  slot: number;
  kills: number;
  deaths: number;
  hits: number;
  fired: number;
  /** Hits per trigger pull, 0..1. */
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
    rows.set(uid, { uid, name: p.name, slot: p.slot, kills: 0, deaths: 0, hits: 0, fired: p.fired ?? 0, accuracy: 0 });
  }
  for (const s of shots) {
    const by = rows.get(s.by), target = rows.get(s.target);
    if (by) {
      by.hits++;
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
