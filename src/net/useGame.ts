import { useEffect, useMemo, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { currentUser, database, watchServerTime } from './firebase.ts';
import type { Meta, Players, ShotRecord } from './game.ts';

export interface GameView {
  uid: string | null;
  meta: Meta | null;
  metaLoaded: boolean;
  players: Players;
  shots: ShotRecord[];
  /** False until the players list loads with this device in it. */
  isMember: boolean;
  membershipKnown: boolean;
  error: string | null;
  /** Call after joining so the member-only lists subscribe. */
  refresh: () => void;
}

export function useUid(): { uid: string | null; error: string | null } {
  const [uid, setUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    watchServerTime();
    currentUser().then((u) => setUid(u.uid), (e) => setError(`Could not sign in: ${e?.message ?? e}`));
  }, []);
  return { uid, error };
}

export function useGame(code: string): GameView {
  const { uid, error: authError } = useUid();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaLoaded, setMetaLoaded] = useState(false);
  const [players, setPlayers] = useState<Players>({});
  const [shotsMap, setShotsMap] = useState<Record<string, Omit<ShotRecord, 'id'>>>({});
  const [isMember, setIsMember] = useState(false);
  const [membershipKnown, setMembershipKnown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!uid) return;
    return onValue(
      ref(database(), `games/${code}/meta`),
      (s) => {
        setMeta(s.exists() ? (s.val() as Meta) : null);
        setMetaLoaded(true);
      },
      (e) => setError(`Could not load the game: ${e.message}`),
    );
  }, [uid, code]);

  useEffect(() => {
    if (!uid) return;
    setMembershipKnown(false);
    const offPlayers = onValue(
      ref(database(), `games/${code}/players`),
      (s) => {
        const val = (s.val() ?? {}) as Players;
        setPlayers(val);
        setIsMember(!!val[uid]);
        setMembershipKnown(true);
      },
      () => {
        // Reading players is members-only; a refusal means we haven't joined yet.
        setPlayers({});
        setIsMember(false);
        setMembershipKnown(true);
      },
    );
    return offPlayers;
  }, [uid, code, tick]);

  useEffect(() => {
    if (!uid || !isMember) return;
    return onValue(ref(database(), `games/${code}/shots`), (s) => setShotsMap(s.val() ?? {}), () => setShotsMap({}));
  }, [uid, code, isMember, tick]);

  const shots = useMemo(
    () => Object.entries(shotsMap).map(([id, s]) => ({ id, ...s })).sort((a, b) => a.at - b.at),
    [shotsMap],
  );

  return {
    uid, meta, metaLoaded, players, shots, isMember, membershipKnown,
    error: authError ?? error,
    refresh: () => setTick((t) => t + 1),
  };
}

/** Re-renders every `ms` milliseconds, for countdowns and timers. */
export function useTicker(ms: number): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
  return n;
}
