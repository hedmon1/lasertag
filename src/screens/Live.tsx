import { useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair as CrosshairIcon, Flag, LogOut, Menu, RotateCcw, RotateCw, X, ZoomIn } from 'lucide-react';
import type { GameView } from '../net/useGame.ts';
import { useTicker } from '../net/useGame.ts';
import { countTrigger, endGame, hitSender, respawn, sendFlash, sendGrenadeHit, sendKillcam, throwGrenade, watchKillcam, type ShotRecord } from '../net/game.ts';
import { serverNow } from '../net/firebase.ts';
import { keepAwake } from '../camera/camera.ts';
import { peopleAI } from '../detect/people.ts';
import { blast, fire, throwFlash, type FireResult } from '../game/fire.ts';
import { aimedAtPerson, personInView, type AimLock } from '../game/personHit.ts';
import { FLASH, FLASH_TOTAL_MS } from '../game/flash.ts';
import { GRENADE } from '../game/grenade.ts';
import { canRespawn, isProtected, respawnAt, type Life } from '../game/rules.ts';
import { gun as gunById, gunDoc } from '../game/guns.ts';
import { killFeed, scoreboard } from '../game/score.ts';
import { CameraView, useCameraRig, useScope } from '../ui/CameraView.tsx';
import { buzz, loadGunSounds, sfx } from '../ui/sound.ts';
import { Gun } from '../ui/Gun.tsx';
import { useSpaceTrigger, useWeapon } from '../ui/useWeapon.ts';
import { load, save } from '../ui/storage.ts';
import { go } from '../ui/router.ts';
import { AimTag, Crosshair, HitMarker, useDetectorState, formatClock } from '../ui/hud.tsx';
import { FlashButton, ThrownFlashbang, Whiteout, useFlashbang } from '../ui/flashbang.tsx';
import { GrenadeButton, GrenadeWarning, ThrownGrenade, useGrenade } from '../ui/throwables.tsx';
import { keepLastKill, roundKey } from '../ui/lastKill.ts';

/** What a shot was fired with, for the messages: the gun's name, or Grenade. */
function weaponName(s?: ShotRecord): string | null {
  if (!s) return null;
  if (s.via === 'grenade') return 'Grenade';
  return s.gun ? gunById(s.gun).name : null;
}

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
  const [lock, setLock] = useState<AimLock>(false);
  const [inView, setInView] = useState(false);
  const [inBlastRange, setInBlastRange] = useState(false);
  const [shake, setShake] = useState(0);
  const [marker, setMarker] = useState<{ key: number; kill: boolean; head?: boolean } | null>(null);
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

  // Crosshair lock: would a shot count right now (a person under it, in range)? And would a
  // flashbang (anyone in view, in its range)?
  const frameZoom = scope.frameZoom;
  useEffect(() => {
    if (!rig) return;
    const id = setInterval(() => {
      const vw = rig.video.videoWidth, vh = rig.video.videoHeight, t = performance.now();
      setLock(aimedAtPerson(rig.pipeline.frames, { x: vw / 2, y: vh / 2 }, t, { hitWidth: myGun.hitWidth, rangeM: myGun.rangeM, frameWidth: vw, frameHeight: vh, zoom: frameZoom }));
      setInView(personInView(rig.pipeline.frames, t, { rangeM: FLASH.rangeM, frameWidth: vw, frameHeight: vh, zoom: frameZoom }));
      setInBlastRange(personInView(rig.pipeline.frames, t, { rangeM: GRENADE.far.m, frameWidth: vw, frameHeight: vh, zoom: frameZoom }));
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
    setMarker({ key: Date.now(), kill: false, head: o.head });
    sfx.impact();
    if (o.head) sfx.headshot();
    buzz(o.head ? [20, 20, 30] : 30);
    const r = await sendHit({ target: opponentId, distanceM: o.distanceM, head: o.head }, target.life, rules, gunDoc(myGun.id));
    if (r.ok && r.kill) {
      setMarker({ key: Date.now(), kill: true, head: o.head });
      sfx.kill();
      const jpg = res.killcam();
      if (jpg) {
        sendKillcam(code, r.shotId, uid, opponentId, jpg).catch(() => {});
        keepLastKill(roundKey(code, meta.startAt), jpg);
      }
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

  // ---------- flashbang ----------
  const flash = useFlashbang({
    lastThrowAt: me?.lastFlashAt,
    now: serverNow,
    canThrow: () => !!rig && started && !!me?.life.alive,
    onThrow: () => {
      if (!rig) return;
      const thrownAt = performance.now();
      throwFlash({ pipeline: rig.pipeline, video: rig.video, frameZoom: scope.frameZoom })
        .then(async (o) => {
          const target = opponentId ? players.current[opponentId] : undefined;
          const catchable = o.kind === 'hit' && !!opponentId && !!target && target.life.alive && !isProtected(target.life, rules, serverNow());
          const caught = await sendFlash(code, uid, catchable ? { target: opponentId!, distanceM: o.distanceM } : null);
          // The same hit marker as a shot, as it goes off.
          if (caught) setTimeout(() => setMarker({ key: Date.now(), kill: false }), Math.max(0, FLASH.flightMs - (performance.now() - thrownAt)));
        })
        .catch(() => {});
    },
  });

  // ---------- grenade ----------
  // The throw stamps the database (the other phone starts beeping). When the fuse runs out,
  // the AI checks who is in view right then, and the blast's damage goes in as a shot.
  const grenade = useGrenade({
    lastThrowAt: me?.lastGrenadeAt,
    now: serverNow,
    canThrow: () => !!rig && started && !!me?.life.alive,
    onThrow: () => {
      const stamp = throwGrenade(code, uid).catch(() => 0);
      setTimeout(async () => {
        sfx.grenadeBlast();
        if (!rig) return;
        const thrownAt = await stamp;
        const res = await blast({ pipeline: rig.pipeline, video: rig.video, frameZoom: scope.frameZoom });
        const o = res.outcome;
        const target = opponentId ? players.current[opponentId] : undefined;
        if (!thrownAt || o.kind !== 'hit' || !opponentId || !target || !target.life.alive || isProtected(target.life, rules, serverNow())) return;
        const r = await sendGrenadeHit(code, uid, { target: opponentId, distanceM: o.distanceM }, target.life, thrownAt, rules);
        if (!r.ok) return;
        setMarker({ key: Date.now(), kill: r.kill });
        sfx.impact();
        if (r.kill) {
          sfx.kill();
          const jpg = res.killcam();
          if (jpg) {
            sendKillcam(code, r.shotId, uid, opponentId, jpg).catch(() => {});
            keepLastKill(roundKey(code, meta.startAt), jpg);
          }
        }
      }, GRENADE.fuseMs);
    },
  });

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

  // ---------- being flashed ----------
  const [flashed, setFlashed] = useState<{ id: string; start: number; by: string } | null>(null);
  const flashes = useRef(g.flashes);
  flashes.current = g.flashes;
  const seenFlash = useRef<string | null>(null);
  useEffect(() => {
    const latest = g.flashes.filter((f) => f.target === uid).at(-1);
    if (!latest || latest.id === seenFlash.current) return;
    seenFlash.current = latest.id;
    // Only a fresh one: not one from earlier in the game, seen on reconnecting.
    if (serverNow() - latest.at > FLASH.holdMs) return;
    setFlashed({ id: latest.id, start: performance.now(), by: players.current[latest.by]?.name ?? 'Someone' });
    sfx.flashed();
    buzz([80, 40, 260]);
  }, [g.flashes, uid]);
  useEffect(() => {
    if (!flashed) return;
    const t = setTimeout(() => setFlashed(null), FLASH_TOTAL_MS);
    return () => clearTimeout(t);
  }, [flashed?.id]);

  // Hear the other player's flashbang go off when it misses you (a catch plays the close bang).
  const oppFlashAt = opponentId ? g.players[opponentId]?.lastFlashAt ?? 0 : 0;
  const heardFlash = useRef<{ id: string | null; at: number }>({ id: null, at: 0 });
  useEffect(() => {
    const prev = heardFlash.current;
    heardFlash.current = { id: opponentId, at: oppFlashAt };
    if (prev.id !== opponentId || oppFlashAt <= prev.at) return;
    // The catch record is written with the same timestamp; give it a moment to arrive.
    setTimeout(() => {
      if (!flashes.current.some((f) => f.by === opponentId && f.at === oppFlashAt)) sfx.flashBang();
    }, 400);
  }, [opponentId, oppFlashAt]);

  // ---------- being hit ----------
  // The shot record and the health change arrive separately; give the record a moment, so a
  // headshot sounds like one.
  const shotsNow = useRef(g.shots);
  shotsNow.current = g.shots;
  function hurtSound(shotId: string, alive: boolean) {
    const play = (shot?: ShotRecord) => {
      if (shot?.via === 'grenade') {
        sfx.grenadeHurt();
        setShake((n) => n + 1);
      }
      if (!alive) {
        sfx.eliminated();
        buzz([220, 80, 220]);
      } else if (shot?.via === 'grenade') {
        buzz([140, 40, 180]);
      } else if (shot?.head) {
        sfx.hurtHead();
        buzz([60, 30, 120]);
      } else {
        sfx.hurt();
        buzz(90);
      }
    };
    const known = shotsNow.current.find((s) => s.id === shotId);
    if (known) play(known);
    else setTimeout(() => play(shotsNow.current.find((s) => s.id === shotId)), 150);
  }

  // ---------- the other player's grenade ----------
  // Their throw stamps the database: the fuse beeps here, faster and faster, with a warning on
  // screen. If the blast doesn't catch you, you hear it go off nearby.
  const [warning, setWarning] = useState<number | null>(null);
  const oppGrenadeAt = opponentId ? g.players[opponentId]?.lastGrenadeAt ?? 0 : 0;
  const heardGrenade = useRef<{ id: string | null; at: number }>({ id: null, at: 0 });
  useEffect(() => {
    const prev = heardGrenade.current;
    heardGrenade.current = { id: opponentId, at: oppGrenadeAt };
    if (prev.id !== opponentId || oppGrenadeAt <= prev.at) return;
    const age = Math.max(0, serverNow() - oppGrenadeAt);
    if (age > GRENADE.fuseMs) return; // late news (reconnecting): it already went off
    const start = performance.now() - age;
    setWarning(start);
    sfx.grenadeFuse();
    setTimeout(() => setWarning((w) => (w === start ? null : w)), GRENADE.fuseMs - age + 200);
    const thrownAt = oppGrenadeAt, by = opponentId;
    setTimeout(() => {
      if (!shotsNow.current.some((s) => s.via === 'grenade' && s.by === by && s.target === uid && s.at >= thrownAt)) sfx.grenadeBlast();
    }, GRENADE.fuseMs - age + 700);
  }, [opponentId, oppGrenadeAt]);

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
      hurtSound(l.shot, l.alive);
    } else if (l.alive && !prev.alive) {
      sfx.respawn();
      weapon.refill();
    }
  }, [me?.life]);

  const hurtShot = hurt ? g.shots.find((s) => s.id === hurt.shotId) : undefined;
  const hurtBy = hurtShot ? players.current[hurtShot.by]?.name ?? 'Someone' : null;
  const hurtGun = weaponName(hurtShot);
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
  const killerGun = weaponName(deathShotRec);
  const away = deathShotRec && deathShotRec.dist > 0 ? `about ${Math.round(deathShotRec.dist)} m away` : '';
  const how = killerGun ? `${killerGun}${deathShotRec?.head ? ' headshot' : ''}` : deathShotRec?.head ? 'Headshot' : '';
  const deathLine = how ? [how, away].filter(Boolean).join(', ') : away.replace(/^a/, 'A');

  return (
    <CameraView videoRef={videoRef} rig={rig} viewZoom={scope.viewZoom} frameZoom={scope.frameZoom} overlay={overlay} shake={shake}>
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

        <Crosshair lock={lock} />
        {opponentName && <AimTag lock={lock} name={opponentName} />}
        {marker && <HitMarker key={`marker-${marker.key}`} kill={marker.kill} head={marker.head} />}
        {showHurt && (
          <div className="toast bad" style={{ top: 'calc(96px + var(--safe-top))' }}>
            {hurtShot!.via === 'grenade' ? `Grenade from ${hurtBy}` : `${hurtShot!.head ? 'Headshot by' : 'Hit by'} ${hurtBy}${hurtGun ? `'s ${hurtGun}` : ''}`}
            {hurtShot!.dist > 0 ? `. ${Math.round(hurtShot!.dist)} m` : ''}
          </div>
        )}

        {flash.throws > 0 && <ThrownFlashbang key={flash.throws} />}
        {grenade.throws > 0 && <ThrownGrenade key={`g${grenade.throws}`} />}
        {warning !== null && <GrenadeWarning start={warning} />}
        <Gun gun={myGun.id} shots={weapon.shots} reloading={weapon.reloading} empty={weapon.ammo === 0} />
        <div className="hud-bottom">
          <div className="side-buttons">
            <div className="throw-row">
              <GrenadeButton t={grenade} disabled={!me?.life.alive || !started} armed={inBlastRange} />
              <FlashButton f={flash} disabled={!me?.life.alive || !started} armed={inView} />
            </div>
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

      {flashed && <Whiteout key={flashed.id} start={flashed.start} by={flashed.by} />}

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
