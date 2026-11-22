import { useMemo, useState } from 'react';
import { LogOut, RotateCcw } from 'lucide-react';
import type { GameView } from '../net/useGame.ts';
import { playAgain } from '../net/game.ts';
import { highlights, noHighlights, scoreboard, type Leader } from '../game/score.ts';
import { gun as gunById } from '../game/guns.ts';
import { lastKill, roundKey } from '../ui/lastKill.ts';
import { go } from '../ui/router.ts';
import { Panel } from '../ui/Panel.tsx';

export function Scoreboard({ code, g }: { code: string; g: GameView }) {
  const meta = g.meta!;
  const rows = useMemo(() => scoreboard(g.players, g.shots), [g.players, g.shots]);
  const best = useMemo(() => highlights(g.players, g.shots), [g.players, g.shots]);
  const myKill = lastKill(roundKey(code, meta.startAt));
  const names = (uids: string[]) => uids.map((u) => g.players[u]?.name ?? 'Someone').join(' and ');
  const lead = (l: Leader, unit: string) => `${names(l.uids)}${l.uids.length > 1 ? ', ' : ' · '}${l.count} ${unit}${l.uids.length > 1 ? ' each' : ''}`;
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
              <th title="Headshots">Head</th>
              <th title="Grenade hits">Nade</th>
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
                <td>{r.heads}</td>
                <td>{r.nades}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {!noHighlights(best) && (
        <Panel title="Highlights" tone="yellow">
          <dl className="highlights" data-testid="highlights">
            {best.longest && (
              <div>
                <dt>Longest hit</dt>
                <dd>{names([best.longest.by])} · {best.longest.dist.toFixed(1)} m{best.longest.gun ? <small>{gunById(best.longest.gun).name}</small> : null}</dd>
              </div>
            )}
            {best.heads && (
              <div>
                <dt>Most headshots</dt>
                <dd>{lead(best.heads, best.heads.count === 1 ? 'headshot' : 'headshots')}</dd>
              </div>
            )}
            {best.streak && (
              <div>
                <dt>Best streak</dt>
                <dd>{lead(best.streak, 'kills in a row')}</dd>
              </div>
            )}
            {best.grenadeKills && (
              <div>
                <dt>Grenade kills</dt>
                <dd>{lead(best.grenadeKills, best.grenadeKills.count === 1 ? 'kill' : 'kills')}</dd>
              </div>
            )}
          </dl>
        </Panel>
      )}

      {myKill && (
        <Panel title="Your last kill" tone="magenta">
          <img className="killcam last-kill" src={myKill} alt="Your last kill" data-testid="last-kill" />
        </Panel>
      )}

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
