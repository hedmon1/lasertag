import { useMemo, useState } from 'react';
import { LogOut, RotateCcw } from 'lucide-react';
import type { GameView } from '../net/useGame.ts';
import { playAgain } from '../net/game.ts';
import { scoreboard } from '../game/score.ts';
import { go } from '../ui/router.ts';
import { Panel } from '../ui/Panel.tsx';

export function Scoreboard({ code, g }: { code: string; g: GameView }) {
  const meta = g.meta!;
  const rows = useMemo(() => scoreboard(g.players, g.shots), [g.players, g.shots]);
  const isHost = meta.host === g.uid;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const top = rows[0];
  const tie = rows.length > 1 && rows[1].kills === top?.kills && rows[1].deaths === top?.deaths;

  return (
    <main className="page" data-testid="scoreboard">
      <div className="brand">Game {code}</div>
      <h1>{top && top.kills > 0 && !tie ? `${top.name} wins` : 'Results'}</h1>

      <Panel title="Scores" tone="cyan">
        <table className="score">
          <thead>
            <tr>
              <th>Player</th>
              <th title="Kills">K</th>
              <th title="Deaths">D</th>
              <th title="Hits">Hits</th>
              <th title="Accuracy">Acc</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.uid} className={r.uid === g.uid ? 'me' : ''}>
                <td>
                  <span className={`slot-badge mini on seat-${r.slot}`}>{r.slot + 1}P</span>
                  {r.name}
                </td>
                <td>{r.kills}</td>
                <td>{r.deaths}</td>
                <td>{r.hits}</td>
                <td>{r.fired ? `${Math.round(r.accuracy * 100)}%` : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {error && <div className="error">{error}</div>}

      {isHost ? (
        <button
          className="btn btn-primary btn-block"
          disabled={busy || meta.state !== 'ended'}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await playAgain(code, g.players, meta.rules);
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}
        >
          <RotateCcw />
          {meta.state !== 'ended' ? 'Closing the game…' : busy ? 'Resetting…' : 'Play again'}
        </button>
      ) : (
        <p className="note">The host can start another round.</p>
      )}
      <button className="btn btn-quiet" onClick={() => go('')}><LogOut />Leave game</button>
    </main>
  );
}
