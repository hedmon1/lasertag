import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair as CrosshairIcon, Flag, LogOut, Menu, RotateCcw, RotateCw, X, ZoomIn } from 'lucide-react';
import type { GameView } from '../net/useGame.ts';
import { useTicker } from '../net/useGame.ts';
import { countTrigger, endGame, respawn, sendKillcam, submitHit, watchKillcam } from '../net/game.ts';
import { serverNow } from '../net/firebase.ts';
import { keepAwake } from '../camera/camera.ts';
import { peopleAI } from '../detect/people.ts';
import { fire, type FireResult } from '../game/fire.ts';
import { aimedAtPerson } from '../game/personHit.ts';
import { MAGAZINE, RELOAD_MS, canRespawn, isProtected, respawnAt, type Life } from '../game/rules.ts';
import { killFeed, scoreboard } from '../game/score.ts';
import { CameraView, useCameraRig, useScope } from '../ui/CameraView.tsx';
import { buzz, sfx, unlockAudio } from '../ui/sound.ts';
import { Gun } from '../ui/Gun.tsx';
import { load, save } from '../ui/storage.ts';
import { go } from '../ui/router.ts';
import { Crosshair, HitMarker, useDetectorState, formatClock } from '../ui/hud.tsx';

export function Live({ code, g }: { code: string; g: GameView }) {
  const uid = g.uid!;
  const meta = g.meta!;
  const rules = meta.rules;
  const me = g.players[uid];
  const isHost = meta.host === uid;
  // Two players: whoever is under the crosshair is the other one.
  const opponentId = useMemo(
    () => Object.entries(g.players).find(([id, p]) => id !== uid && p.slot >= 0)?.[0] ?? null,
    [g.players, uid],
  );

  const { videoRef, rig, error: camError, retry } = useCameraRig();
  const scope = useScope(rig);
  const detector = useDetectorState();
  useTicker(250);
  const now = serverNow();

  const [overlay, setOverlay] = useState(() => load('debug') === '1');
  const [menu, setMenu] = useState(false);
  const [ammo, setAmmo] = useState(MAGAZINE);
  const [reloading, setReloading] = useState(false);
  const [locked, setLocked] = useState(false);
  const [shots, setShots] = useState(0);
  const [marker, setMarker] = useState<{ key: number; kill: boolean } | null>(null);
  const [flashKey, setFlashKey] = useState(0);
  const [hurt, setHurt] = useState<{ shotId: string; key: number } | null>(null);

  const players = useRef(g.players);
  players.current = g.players;
  const opponentName = opponentId ? g.players[opponentId]?.name : undefined;

  const countdownMs = meta.startAt ? meta.startAt - now : 0;
  const started = countdownMs <= 0;

  useEffect(() => keepAwake(), []);

  // Countdown beeps.
  const lastBeep = useRef(-1);
  useEffect(() => {
    const s = Math.ceil(countdownMs / 1000);
    if (s === lastBeep.current) return;
    lastBeep.current = s;
    if (s > 0 && s <= 3) sfx.countdown();
    if (s === 0) sfx.go();
  }, [countdownMs]);

  // Crosshair lock: is a person under it right now?
  useEffect(() => {
    if (!rig) return;
    const id = setInterval(() => {
      const c = { x: rig.video.videoWidth / 2, y: rig.video.videoHeight / 2 };
      setLocked(aimedAtPerson(rig.pipeline.frames, c, performance.now()));
    }, 100);
    return () => clearInterval(id);
  }, [rig]);

  // ---------- firing ----------
  const lastFire = useRef(0);
  const firing = useRef(false);
  const ammoRef = useRef(ammo);
  ammoRef.current = ammo;
  const reloadingRef = useRef(false);

  const startReload = useCallback(() => {
    if (reloadingRef.current) return;
    reloadingRef.current = true;
    setReloading(true);
    sfx.reload();
    setTimeout(() => {
      setAmmo(MAGAZINE);
      setReloading(false);
      reloadingRef.current = false;
    }, RELOAD_MS);
  }, []);

  async function handleOutcome(res: FireResult) {
    const o = res.outcome;
    if (o.kind === 'miss') {
      sfx.ricochet();
      return;
    }
    const target = opponentId ? players.current[opponentId] : undefined;
    if (!opponentId || !target) return;
    // The hit marker is the only feedback, so it only shows for a hit that counts: none for a
    // player who is down or just respawned.
    if (!target.life.alive || isProtected(target.life, rules, serverNow())) return;
    setMarker({ key: Date.now(), kill: false });
    sfx.impact();
    buzz(30);
    const r = await submitHit(code, uid, { target: opponentId, distanceM: o.distanceM }, target.life, rules);
    if (r.ok && r.kill) {
      setMarker({ key: Date.now(), kill: true });
      sfx.kill();
      const jpg = res.killcam();
      if (jpg) sendKillcam(code, r.shotId, uid, opponentId, jpg).catch(() => {});
    }
  }

  async function onFire() {
    unlockAudio();
    if (!rig || !started || !me?.life.alive || firing.current || reloadingRef.current) return;
    const t = performance.now();
    if (t - lastFire.current < rules.cooldownMs) return;
    if (ammoRef.current <= 0) {
      sfx.empty();
      startReload();
      return;
    }
    lastFire.current = t;
    firing.current = true;
    const left = ammoRef.current - 1;
    setAmmo(left);
    sfx.gunshot();
    setShots((n) => n + 1);
    buzz(20);
    countTrigger(code, uid).catch(() => {});
    try {
      await handleOutcome(await fire({ pipeline: rig.pipeline, video: rig.video, frameZoom: scope.frameZoom }));
    } finally {
      firing.current = false;
      if (left <= 0) startReload();
    }
  }

  // Space bar fires on a laptop (handy for testing).
  const fireRef = useRef(onFire);
  fireRef.current = onFire;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        fireRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Hear the other player's shots: their trigger count goes up with every shot they fire.
  const oppFired = opponentId ? g.players[opponentId]?.fired ?? 0 : 0;
  const heard = useRef<{ id: string | null; fired: number }>({ id: null, fired: 0 });
  useEffect(() => {
    const prev = heard.current;
    heard.current = { id: opponentId, fired: oppFired };
    if (prev.id !== opponentId || oppFired <= prev.fired) return;
    for (let i = 0; i < Math.min(oppFired - prev.fired, 3); i++) setTimeout(() => sfx.distantShot(), i * 140);
  }, [opponentId, oppFired]);

  // ---------- being hit ----------
  const prevLife = useRef<Life | null>(null);
  useEffect(() => {
    const l = me?.life;
    if (!l) return;
    const prev = prevLife.current;
    prevLife.current = l;
    if (!prev || l.seq <= prev.seq) return;
    if (l.shot && l.hp < prev.hp) {
      setFlashKey((k) => k + 1);
      setHurt({ shotId: l.shot, key: Date.now() });
      if (l.alive) {
        sfx.hurt();
        buzz(90);
      } else {
        sfx.eliminated();
        buzz([220, 80, 220]);
      }
    } else if (l.alive && !prev.alive) {
      sfx.respawn();
      setAmmo(MAGAZINE);
    }
  }, [me?.life]);

  const hurtShot = hurt ? g.shots.find((s) => s.id === hurt.shotId) : undefined;
  const hurtBy = hurtShot ? players.current[hurtShot.by]?.name ?? 'Someone' : null;
  const showHurt = hurt && hurtShot && Date.now() - hurt.key < 2600 && me?.life.alive;

  // Respawn automatically once the timer runs out.
  const respawning = useRef(false);
  useEffect(() => {
    const l = me?.life;
    if (!l || l.alive || respawning.current || !canRespawn(l, rules, serverNow() - 200)) return;
    respawning.current = true;
    respawn(code, uid, l, rules)
      .catch(() => {})
      .finally(() => setTimeout(() => (respawning.current = false), 400));
  });

  // Kill cam for the shot that eliminated me.
  const [killcam, setKillcam] = useState<string | null>(null);
  const deathShot = me && !me.life.alive ? me.life.shot : '';
  useEffect(() => {
    setKillcam(null);
    if (!deathShot) return;
    return watchKillcam(code, deathShot, setKillcam);
  }, [code, deathShot]);

  // ---------- derived HUD values ----------
  const rows = useMemo(() => scoreboard(g.players, g.shots), [g.players, g.shots]);
  const myRow = rows.find((r) => r.uid === uid);
  const feed = useMemo(() => killFeed(g.shots, 3), [g.shots]);
  const remaining = meta.endAt ? Math.max(0, meta.endAt - now) : 0;
  const hp = me?.life.hp ?? 0;
  const prot = me ? isProtected(me.life, rules, now) : false;
  const deathShotRec = deathShot ? g.shots.find((s) => s.id === deathShot) : undefined;
  const killer = deathShotRec ? players.current[deathShotRec.by]?.name : undefined;

  return (
    <CameraView videoRef={videoRef} rig={rig} viewZoom={scope.viewZoom} frameZoom={scope.frameZoom} overlay={overlay}>
      {flashKey > 0 && <div key={flashKey} className="flash" />}
      <div className="hud">
        <div className="hud-top">
          <button className="hud-chip" onClick={() => setMenu(true)} aria-label="Menu"><Menu /></button>
          <div className="hud-chip hp" aria-label={`Health ${hp}`}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span>HP</span>
              <span className="num">{hp}</span>
            </div>
            <div className="hp-bar"><div className={`hp-fill${hp <= 25 ? ' low' : ''}`} style={{ width: `${hp}%` }} /></div>
          </div>
          <div className="spacer" />
          <div className="hud-chip num" aria-label="Time left">{formatClock(remaining)}</div>
          <div className="hud-chip num" aria-label="Your kills">K {myRow?.kills ?? 0}</div>
        </div>

        <div className="feed">
          {prot && <div className="feed-line" style={{ color: 'var(--ok)' }}>Protected</div>}
          {detector === 'loading' && <div className="feed-line">Loading the AI</div>}
          {feed.map((s) => (
            <div className="feed-line" key={s.id}>
              <b>{players.current[s.by]?.name ?? '?'}</b> eliminated <b>{players.current[s.target]?.name ?? '?'}</b>
            </div>
          ))}
        </div>

        <Crosshair locked={locked} />
        {locked && opponentName && <div className="aim-name">{opponentName}</div>}
        {marker && <HitMarker key={`marker-${marker.key}`} kill={marker.kill} />}
        {showHurt && (
          <div className="toast bad" style={{ top: 'calc(96px + var(--safe-top))' }}>
            Hit by {hurtBy}{hurtShot!.dist > 0 ? `. ${Math.round(hurtShot!.dist)} m` : ''}
          </div>
        )}

        <Gun shots={shots} reloading={reloading} empty={ammo === 0} />
        <div className="hud-bottom">
          <div className="side-buttons">
            <button
              className="hud-btn"
              aria-pressed={scope.scoped}
              onPointerDown={(e) => { e.preventDefault(); scope.set(true); }}
              onPointerUp={() => scope.set(false)}
              onPointerCancel={() => scope.set(false)}
              onPointerLeave={() => scope.scoped && scope.set(false)}
            >
              <ZoomIn />
              SCOPE
            </button>
            <button className="hud-btn" disabled={reloading || ammo === MAGAZINE} onPointerDown={(e) => { e.preventDefault(); startReload(); }}>
              <RotateCw />
              {reloading ? '…' : 'RELOAD'}
            </button>
          </div>
          <button
            className="fire"
            data-testid="fire"
            disabled={!me?.life.alive || !started}
            onPointerDown={(e) => { e.preventDefault(); onFire(); }}
          >
            <CrosshairIcon />
            FIRE
            <span className="ammo num">{reloading ? 'RELOADING' : `${ammo} / ${MAGAZINE}`}</span>
          </button>
        </div>
      </div>

      {!started && (
        <div className="cover">
          <div className="kicker">Get in position</div>
          <div className="big num">{Math.max(1, Math.ceil(countdownMs / 1000))}</div>
          {opponentName && <div className="muted">You against {opponentName}</div>}
        </div>
      )}

      {started && me && !me.life.alive && (
        <div className="cover" data-testid="eliminated">
          <div className="title danger">Eliminated{killer ? ` by ${killer}` : ''}</div>
          {killcam ? <img className="killcam" src={killcam} alt="The shot that eliminated you" /> : <div className="killcam killcam-empty">Loading the shot…</div>}
          {deathShotRec && deathShotRec.dist > 0 && <div className="small muted">About {Math.round(deathShotRec.dist)} m away</div>}
          <div className="kicker num">Back in {Math.max(0, Math.ceil((respawnAt(me.life, rules) - now) / 1000))} s</div>
        </div>
      )}

      {(camError || detector === 'failed') && (
        <div className="cover">
          <div className="title">{camError ? 'Camera unavailable' : 'The AI could not load'}</div>
          <div className="muted">{camError ?? 'Check your connection, then try again.'}</div>
          <button className="btn btn-primary" onClick={() => (camError ? retry() : peopleAI.load())}><RotateCcw />Try again</button>
        </div>
      )}

      {menu && (
        <div className="menu">
          <div className="row">
            <div className="brand grow">Game {code}</div>
            <button className="btn btn-small" onClick={() => setMenu(false)}><X />Close</button>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={overlay} onChange={(e) => { setOverlay(e.target.checked); save('debug', e.target.checked ? '1' : '0'); }} />
            <span>
              Show what the AI sees
              <span className="small muted" style={{ display: 'block' }}>
                {detector === 'ready' ? `AI ready (${peopleAI.delegate})` : detector === 'loading' ? 'AI loading' : 'AI not loaded'}
              </span>
            </span>
          </label>
          <div className="row">
            {isHost && <button className="btn btn-danger grow" onClick={() => endGame(code)}><Flag />End game</button>}
            <button className="btn grow" onClick={() => go('')}><LogOut />Leave</button>
          </div>
        </div>
      )}
    </CameraView>
  );
}
