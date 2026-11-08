import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Check, LogOut, Pencil, Play, Share2, Swords } from 'lucide-react';
import type { GameView } from '../net/useGame.ts';
import { SEATS, renamePlayer, setGun, setRules, startGame } from '../net/game.ts';
import { peopleAI } from '../detect/people.ts';
import { gameLink, go } from '../ui/router.ts';
import { save } from '../ui/storage.ts';
import { Panel } from '../ui/Panel.tsx';
import { GunPreview } from '../ui/GunPreview.tsx';
import { savedGun } from '../ui/loadout.ts';
import { gun as gunById, hitsToEliminate } from '../game/guns.ts';

const LENGTHS = [5, 10, 15, 20];
const KILL_LIMITS = [5, 10, 15, 20];
const RESPAWNS = [5, 8, 12];

export function Lobby({ code, g }: { code: string; g: GameView }) {
  const uid = g.uid!;
  const meta = g.meta!;
  const me = g.players[uid];
  const isHost = meta.host === uid;
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(me?.name ?? '');
  const [starting, setStarting] = useState(false);

  // Start loading the person detector now so it is ready when the game starts.
  useEffect(() => {
    peopleAI.load();
  }, []);

  // Back from the Armory with a different gun: put it on your player for the next round.
  const myGun = gunById(me?.gun?.id);
  useEffect(() => {
    const want = savedGun();
    if (me && me.gun?.id !== want) setGun(code, uid, want).catch(() => {});
  }, [code, uid, me?.gun?.id]);

  const seats = useMemo(() => {
    const bySeat = Array.from({ length: SEATS }, () => null as null | [string, (typeof g.players)[string]]);
    for (const entry of Object.entries(g.players)) if (entry[1].slot >= 0 && entry[1].slot < SEATS) bySeat[entry[1].slot] = entry;
    return bySeat;
  }, [g.players]);
  const full = seats.every(Boolean);

  async function share() {
    const url = gameLink(code);
    try {
      if (navigator.share) await navigator.share({ title: 'Laser Tag', text: `Join my game: ${code}`, url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } catch {
      /* dismissed */
    }
  }

  return (
    <main className="page">
      <div className="brand">Lobby</div>

      <section className="section">
        <span className="label" style={{ marginBottom: 0 }}>Game code</span>
        <div className="code-display" aria-label={`Game code ${code}`}>{code}</div>
        <button className="btn btn-cyan btn-block" onClick={share}>{copied ? <Check /> : <Share2 />}{copied ? 'Link copied' : 'Share link'}</button>
      </section>

      <Panel title="Players" tone="cyan">
        <div className="list">
          {seats.map((entry, seat) => (
            <div className="list-item" key={seat}>
              <div className={`slot-badge seat-${seat}${entry ? ' on' : ''}`}>{seat + 1}P</div>
              {entry ? (
                <div className="grow">
                  {entry[0] === uid && editingName ? (
                    <form
                      className="row"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (nameDraft.trim()) renamePlayer(code, uid, nameDraft).catch(() => {});
                        save('name', nameDraft.trim());
                        setEditingName(false);
                      }}
                    >
                      <input className="input grow" style={{ padding: '8px 10px' }} autoFocus maxLength={16} value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} />
                      <button className="btn btn-small"><Check />Save</button>
                    </form>
                  ) : (
                    <div className="player-name">
                      {entry[1].name}
                      {entry[0] === uid && (
                        <button className="btn btn-quiet btn-small" style={{ padding: '4px 8px 2px', marginLeft: 8, border: 0 }} onClick={() => { setNameDraft(entry[1].name); setEditingName(true); }}>
                          <Pencil />
                          Rename
                        </button>
                      )}
                    </div>
                  )}
                  <div className="row wrap" style={{ gap: 8, marginTop: 6 }}>
                    {entry[0] === meta.host && <span className="tag">Host</span>}
                    {entry[0] === uid && <span className="tag you">You</span>}
                    <span className="tag gun-tag" style={{ '--accent': gunById(entry[1].gun?.id).color } as CSSProperties}>
                      <Swords aria-hidden />
                      {gunById(entry[1].gun?.id).name}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="grow muted">Waiting for a second player</div>
              )}
              {entry && <span className={`dot${entry[1].online !== false ? ' on' : ''}`} title={entry[1].online !== false ? 'Online' : 'Offline'} />}
            </div>
          ))}
        </div>
        <p className="note">The AI counts anyone under your crosshair as a hit, so play where only the two of you are in view.</p>
      </Panel>

      <Panel title="Your gun" tone="magenta" icon={<Swords />}>
        <a className="loadout" href={`#/armory?back=g/${code}`} style={{ '--accent': myGun.color } as CSSProperties}>
          <GunPreview id={myGun.id} w={150} h={66} />
          <span className="loadout-text">
            <span className="loadout-name">{myGun.name}</span>
            <span className="small muted">{myGun.kind} · {hitsToEliminate(myGun)} hits to eliminate</span>
          </span>
        </a>
        <button className="btn btn-block" onClick={() => go(`armory?back=g/${code}`)}><Swords />Change gun</button>
      </Panel>

      <Panel title="Settings" tone="yellow">
        <Setting label="Game length" unit="min" values={LENGTHS} value={meta.rules.durationMs / 60000} disabled={!isHost} onPick={(v) => setRules(code, { durationMs: v * 60000 })} />
        <Setting label="Kills to win" unit="" values={KILL_LIMITS} value={meta.rules.killLimit} disabled={!isHost} onPick={(v) => setRules(code, { killLimit: v })} />
        <Setting label="Respawn time" unit="s" values={RESPAWNS} value={meta.rules.respawnMs / 1000} disabled={!isHost} onPick={(v) => setRules(code, { respawnMs: v * 1000 })} />
        {!isHost && <p className="small muted">Only the host can change these.</p>}
      </Panel>

      {error && <div className="error">{error}</div>}

      {isHost ? (
        <section className="section">
          <button
            className="btn btn-primary btn-block"
            disabled={!full || starting}
            onClick={async () => {
              setStarting(true);
              setError(null);
              try {
                await startGame(code, meta.rules);
              } catch (e) {
                setError(`Could not start: ${(e as Error).message}`);
                setStarting(false);
              }
            }}
          >
            <Play />
            {starting ? 'Starting…' : 'Start game'}
          </button>
          {!full && <p className="small muted">Share the code. The game starts once a second player joins.</p>}
        </section>
      ) : (
        <p className="note">Waiting for the host to start.</p>
      )}
      <button className="btn btn-quiet" onClick={() => go('')}><LogOut />Leave game</button>
    </main>
  );
}

function Setting(props: { label: string; unit: string; values: number[]; value: number; disabled: boolean; onPick: (v: number) => void }) {
  return (
    <div>
      <span className="label">{props.label}</span>
      <div className="segmented" role="group" aria-label={props.label}>
        {props.values.map((v) => (
          <button key={v} type="button" aria-pressed={v === props.value} disabled={props.disabled && v !== props.value} onClick={() => !props.disabled && props.onPick(v)}>
            {v}{props.unit ? ` ${props.unit}` : ''}
          </button>
        ))}
      </div>
    </div>
  );
}
