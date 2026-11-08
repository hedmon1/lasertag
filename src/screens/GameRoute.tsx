import { useEffect, useMemo, useRef, useState } from 'react';
import { House, LogIn, X } from 'lucide-react';
import { useGame, useTicker, type GameView } from '../net/useGame.ts';
import { clearKillcams, endGame, joinGame, keepPresence } from '../net/game.ts';
import { serverNow } from '../net/firebase.ts';
import { leaderKills, scoreboard } from '../game/score.ts';
import { go } from '../ui/router.ts';
import { load, save } from '../ui/storage.ts';
import { savedGun } from '../ui/loadout.ts';
import { Lobby } from './Lobby.tsx';
import { Live } from './Live.tsx';
import { Scoreboard } from './Scoreboard.tsx';

export type Phase = 'lobby' | 'live' | 'over';

export function gamePhase(g: GameView, now: number): Phase {
  const meta = g.meta!;
  if (meta.state === 'lobby') return 'lobby';
  if (meta.state === 'ended') return 'over';
  if (meta.endAt && now >= meta.endAt) return 'over';
  if (leaderKills(scoreboard(g.players, g.shots)) >= meta.rules.killLimit) return 'over';
  return 'live';
}

export function GameRoute({ code }: { code: string }) {
  const g = useGame(code);
  useTicker(500);
  const now = serverNow();

  useEffect(() => {
    if (g.uid && g.isMember) return keepPresence(code, g.uid);
  }, [code, g.uid, g.isMember]);

  const phase = g.meta && g.isMember ? gamePhase(g, now) : null;
  const isHost = !!g.uid && g.meta?.host === g.uid;

  // The host's phone closes the game when time or the kill limit runs out.
  const ending = useRef(false);
  useEffect(() => {
    if (phase !== 'over' || !isHost || g.meta?.state !== 'live' || ending.current) return;
    ending.current = true;
    endGame(code)
      .then(() => clearKillcams(code))
      .catch(() => {})
      .finally(() => (ending.current = false));
  }, [phase, isHost, g.meta?.state, code]);

  if (g.error) return <Message title="Something went wrong" body={g.error} />;
  if (!g.metaLoaded || !g.membershipKnown) return <Message title="Loading game" body="" />;
  if (!g.meta) return <Message title={`No game with code ${code}`} body="Check the code with the host." />;
  if (!g.isMember) {
    if (g.meta.state !== 'lobby') return <Message title="This game has started" body="Ask the host to start a new round, then join." />;
    return <JoinPanel code={code} g={g} />;
  }
  if (phase === 'lobby') return <Lobby code={code} g={g} />;
  if (phase === 'live') return <Live code={code} g={g} />;
  return <Scoreboard code={code} g={g} />;
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <main className="page">
      <h1>{title}</h1>
      {body && <p className="muted">{body}</p>}
      <a className="btn" href="#/"><House />Home</a>
    </main>
  );
}

function JoinPanel({ code, g }: { code: string; g: GameView }) {
  const [name, setName] = useState(() => load('name'));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const count = useMemo(() => Object.keys(g.players).length, [g.players]);
  return (
    <main className="page">
      <div className="brand">Game {code}</div>
      <h1>Join this game</h1>
      {count > 0 && <p className="muted">{count} already in.</p>}
      <label>
        <span className="label">Your name</span>
        <input className="input" value={name} maxLength={16} onChange={(e) => setName(e.target.value)} />
      </label>
      <button
        className="btn btn-primary btn-block"
        disabled={!g.uid || !name.trim() || busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          save('name', name.trim());
          try {
            await joinGame(code, g.uid!, name, savedGun());
            g.refresh();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <LogIn />
        {busy ? 'Joining…' : 'Join'}
      </button>
      {error && <div className="error">{error}</div>}
      <button className="btn btn-quiet" onClick={() => go('')}><X />Cancel</button>
    </main>
  );
}
