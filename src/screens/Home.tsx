import { useState } from 'react';
import { BookOpen, Crosshair, Eye, Footprints, Gamepad2, LogIn, Plus, Ruler, Target, UserRound, Users, Wrench } from 'lucide-react';
import { cleanName, createGame, isGameCode, joinGame, normalizeCode, readMeta } from '../net/game.ts';
import { useUid } from '../net/useGame.ts';
import { usingEmulators } from '../net/firebase.ts';
import { go } from '../ui/router.ts';
import { load, save } from '../ui/storage.ts';
import { Panel } from '../ui/Panel.tsx';
import { AttractScene, ControlDeck } from '../ui/Arcade.tsx';

/** The scrolling marquee under the cabinet: the rules at a glance. */
const TICKER = ['4 hits to eliminate', '12 shots a magazine', 'Hold scope to zoom', 'Respawn in seconds', 'Only you two in view'];

export function Home() {
  const { uid, error: authError } = useUid();
  const [name, setName] = useState(() => load('name'));
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const nameOk = cleanName(name).length > 0;

  async function onCreate() {
    if (!uid || !nameOk) return;
    setBusy('create');
    setError(null);
    save('name', cleanName(name));
    try {
      go(`g/${await createGame(uid, name)}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  async function onJoin() {
    const c = normalizeCode(code);
    if (!uid || !nameOk || !isGameCode(c)) return;
    setBusy('join');
    setError(null);
    save('name', cleanName(name));
    try {
      const meta = await readMeta(c);
      if (!meta) throw new Error(`No game with code ${c}.`);
      try {
        await joinGame(c, uid, name);
      } catch (e) {
        // Already in this game (for example after a reload): just go back in.
        if (meta.state === 'lobby') throw e;
      }
      go(`g/${c}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <main className="page home">
      <div className="eyebrow"><span className="blink-dot" aria-hidden />2 players · phone camera</div>

      <section className="cabinet">
        <div className="marquee">
          <div className="bulbs" aria-hidden />
          <h1 className="marquee-title"><span>Laser</span> <span className="hl">Tag</span></h1>
          <div className="bulbs" aria-hidden />
        </div>
        <div className="bezel">
          <div className="screen">
            <AttractScene />
          </div>
        </div>
        <ControlDeck />
      </section>

      <div className="ticker" aria-hidden>
        <div className="ticker-track">
          {[0, 1].map((k) => (
            <span key={k}>
              {TICKER.map((t) => (
                <span key={t}>{t}<i /></span>
              ))}
            </span>
          ))}
        </div>
      </div>

      <Panel title="Play" tone="lime" icon={<Gamepad2 />}>
        <label>
          <span className="label">Your name</span>
          <span className="field">
            <UserRound aria-hidden />
            <input className="input" value={name} maxLength={16} autoComplete="nickname" placeholder="Name" onChange={(e) => setName(e.target.value)} />
          </span>
        </label>
        <button className="btn btn-primary btn-block" disabled={!uid || !nameOk || !!busy} onClick={onCreate}>
          <Plus />
          {busy === 'create' ? 'Creating…' : 'Create game'}
        </button>
        <div className="divider">or join with a code</div>
        <div className="row">
          <input
            className="input input-code grow"
            value={code}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            placeholder="CODE"
            aria-label="Game code"
            onChange={(e) => setCode(normalizeCode(e.target.value))}
            onKeyDown={(e) => e.key === 'Enter' && onJoin()}
          />
          <button className="btn btn-cyan" style={{ alignSelf: 'stretch' }} disabled={!uid || !nameOk || !isGameCode(code) || !!busy} onClick={onJoin}>
            <LogIn />
            {busy === 'join' ? 'Joining…' : 'Join'}
          </button>
        </div>
        {!nameOk && <p className="small muted">Enter your name first.</p>}
      </Panel>

      {(error || authError) && <div className="error">{error ?? authError}</div>}

      <Panel title="How to play" tone="yellow" icon={<BookOpen />}>
        <ol className="steps">
          <li><span className="step-icon"><Users /></span>One player creates a game. The other joins with its 4-letter code.</li>
          <li><span className="step-icon"><Footprints /></span>Spread out. Hold your phone like a blaster, with the camera facing away from you.</li>
          <li><span className="step-icon"><Crosshair /></span>Put the crosshair on the other player and press Fire. The AI checks that the crosshair is on a person. Four hits and they are out for a few seconds.</li>
          <li><span className="step-icon"><Eye /></span>Play where only the two of you are in view: anyone under the crosshair counts as a hit.</li>
        </ol>
      </Panel>

      <Panel title="Tools" tone="magenta" icon={<Wrench />}>
        <div className="row wrap">
          <a className="btn btn-small" href="#/practice"><Target />Practice</a>
          <a className="btn btn-small" href="#/range"><Ruler />Range test</a>
        </div>
      </Panel>

      {usingEmulators && (
        <p className="small muted">Local test mode: games run on this computer's Firebase emulators.</p>
      )}
    </main>
  );
}
