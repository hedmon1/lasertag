import { useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair as CrosshairIcon, Flag, LogOut, Menu, RotateCcw, RotateCw, X, ZoomIn } from 'lucide-react';
import type { GameView } from '../net/useGame.ts';
import { useTicker } from '../net/useGame.ts';
import { countTrigger, endGame, hitSender, respawn, sendKillcam, watchKillcam } from '../net/game.ts';
import { serverNow } from '../net/firebase.ts';
import { keepAwake } from '../camera/camera.ts';
import { peopleAI } from '../detect/people.ts';
import { fire, type FireResult } from '../game/fire.ts';
import { aimedAtPerson } from '../game/personHit.ts';
import { canRespawn, isProtected, respawnAt, type Life } from '../game/rules.ts';
import { gun as gunById, gunDoc } from '../game/guns.ts';
import { killFeed, scoreboard } from '../game/score.ts';
import { CameraView, useCameraRig, useScope } from '../ui/CameraView.tsx';
import { buzz, loadGunSounds, sfx } from '../ui/sound.ts';
import { Gun } from '../ui/Gun.tsx';
import { useSpaceTrigger, useWeapon } from '../ui/useWeapon.ts';
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

  // Guns are locked while the game is live, so these only change between rounds.
  const myGun = gunById(me?.gun?.id);
  const oppGun = gunById(opponentId ? g.players[opponentId]?.gun?.id : undefined);
  useEffect(() => {
    loadGunSounds([myGun.id, oppGun.id]);
  }, [myGun.id, oppGun.id]);

  const { videoRef, rig, error: camError, retry } = useCameraRig();
  const scope = useScope(rig, myGun.scope);
  const detector = useDetectorState();
  useTicker(250);
  const now = serverNow();

  const [overlay, setOverlay] = useState(() => load('debug') === '1');
  const [menu, setMenu] = useState(false);
  const [locked, setLocked] = useState(false);
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

  // Crosshair lock: would a shot count right now (a person under it, in range)?
  const frameZoom = scope.frameZoom;
  useEffect(() => {
    if (!rig) return;
    const id = setInterval(() => {
      const vw = rig.video.videoWidth, vh = rig.video.videoHeight;
      setLocked(aimedAtPerson(rig.pipeline.frames, { x: vw / 2, y: vh / 2 }, performance.now(), { hitWidth: myGun.hitWidth, rangeM: myGun.rangeM, frameWidth: vw, frameHeight: vh, zoom: frameZoom }));
    }, 100);
    return () => clearInterval(id);
  }, [rig, myGun, frameZoom]);

  // ---------- firing ----------
  const sendHit = useMemo(() => hitSender(code, uid), [code, uid]);

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
    const r = await sendHit({ target: opponentId, distanceM: o.distanceM }, target.life, rules, gunDoc(myGun.id));
    if (r.ok && r.kill) {
      setMarker({ key: Date.now(), kill: true });
      sfx.kill();
      const jpg = res.killcam();
      if (jpg) sendKillcam(code, r.shotId, uid, opponentId, jpg).catch(() => {});
    }
  }

  const weapon = useWeapon(myGun, {
    canFire: () => !!rig && started && !!me?.life.alive,
    onShot: () => {
      countTrigger(code, uid).catch(() => {});
      if (!rig) return;
      fire({ pipeline: rig.pipeline, video: rig.video, frameZoom: scope.frameZoom, hitWidth: myGun.hitWidth, rangeM: myGun.rangeM })
        .then(handleOutcome)
        .catch(() => {});
    },
  });
  useSpaceTrigger(weapon);

  // Hear the other player's shots: their trigger count goes up with every shot they fire.
  const oppFired = opponentId ? g.players[opponentId]?.fired ?? 0 : 0;
  const heard = useRef<{ id: string | null; fired: number }>({ id: null, fired: 0 });
  useEffect(() => {
    const prev = heard.current;
    heard.current = { id: opponentId, fired: oppFired };
    if (prev.id !== opponentId || oppFired <= prev.fired) return;
    // Several at once (a burst, or a late update): spread them out like the gun fires them.
    const gap = oppGun.mode === 'burst' ? oppGun.burst!.gapMs : Math.min(oppGun.fireMs, 140);
    for (let i = 0; i < Math.min(oppFired - prev.fired, 6); i++) setTimeout(() => sfx.distantShot(oppGun.id), i * gap);
  }, [opponentId, oppFired, oppGun]);

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
      weapon.refill();
    }
  }, [me?.life]);

  const hurtShot = hurt ? g.shots.find((s) => s.id === hurt.shotId) : undefined;
  const hurtBy = hurtShot ? players.current[hurtShot.by]?.name ?? 'Someone' : null;
  const hurtGun = hurtShot?.gun ? gunById(hurtShot.gun).name : null;
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
  const killerGun = deathShotRec?.gun ? gunById(deathShotRec.gun).name : null;
  const away = deathShotRec && deathShotRec.dist > 0 ? `about ${Math.round(deathShotRec.dist)} m away` : '';
  const deathLine = killerGun ? [killerGun, away].filter(Boolean).join(', ') : away.replace(/^a/, 'A');

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
            Hit by {hurtBy}{hurtGun ? `'s ${hurtGun}` : ''}{hurtShot!.dist > 0 ? `. ${Math.round(hurtShot!.dist)} m` : ''}
          </div>
        )}

        <Gun gun={myGun.id} shots={weapon.shots} reloading={weapon.reloading} empty={weapon.ammo === 0} />
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
            <button className="hud-btn" disabled={weapon.reloading || weapon.ammo === myGun.magazine} onPointerDown={(e) => { e.preventDefault(); weapon.reload(); }}>
              <RotateCw />
              {weapon.reloading ? '…' : 'RELOAD'}
            </button>
          </div>
          <button
            className="fire"
            data-testid="fire"
            disabled={!me?.life.alive || !started}
            onPointerDown={(e) => { e.preventDefault(); weapon.triggerDown(); }}
            onPointerUp={weapon.triggerUp}
            onPointerCancel={weapon.triggerUp}
            onPointerLeave={weapon.triggerUp}
          >
            <CrosshairIcon />
            FIRE
            <span className="ammo num">{weapon.reloading ? 'RELOADING' : `${weapon.ammo} / ${myGun.magazine}`}</span>
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
          {deathLine && <div className="small muted">{deathLine}</div>}
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
