import { useEffect, useState } from 'react';
import { ArrowLeft, Crosshair as CrosshairIcon, Eye, EyeOff, RotateCcw, RotateCw, Swords, ZoomIn } from 'lucide-react';
import { peopleAI } from '../detect/people.ts';
import { fire } from '../game/fire.ts';
import { aimedAtPerson } from '../game/personHit.ts';
import { gun as gunById } from '../game/guns.ts';
import { CameraView, useCameraRig, useScope } from '../ui/CameraView.tsx';
import { Crosshair, HitMarker, useDetectorState } from '../ui/hud.tsx';
import { loadGunSounds, sfx } from '../ui/sound.ts';
import { Gun } from '../ui/Gun.tsx';
import { load, save } from '../ui/storage.ts';
import { savedGun } from '../ui/loadout.ts';
import { useSpaceTrigger, useWeapon } from '../ui/useWeapon.ts';
import { keepAwake } from '../camera/camera.ts';

interface LogEntry {
  key: number;
  text: string;
}

/** Solo mode: no server. Aim at a friend and see exactly what the AI counts. */
export function Practice() {
  const [g] = useState(() => gunById(savedGun()));
  const { videoRef, rig, error, retry } = useCameraRig();
  const scope = useScope(rig, g.scope);
  const detector = useDetectorState();
  const [overlay, setOverlay] = useState(() => load('practice.debug', '1') === '1');
  const [locked, setLocked] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [marker, setMarker] = useState<number | null>(null);
  const [hits, setHits] = useState({ hits: 0, shots: 0 });

  useEffect(() => keepAwake(), []);
  useEffect(() => {
    loadGunSounds([g.id]);
  }, [g.id]);

  const frameZoom = scope.frameZoom;
  useEffect(() => {
    if (!rig) return;
    const id = setInterval(() => {
      const vw = rig.video.videoWidth, vh = rig.video.videoHeight;
      setLocked(aimedAtPerson(rig.pipeline.frames, { x: vw / 2, y: vh / 2 }, performance.now(), { hitWidth: g.hitWidth, rangeM: g.rangeM, frameWidth: vw, frameHeight: vh, zoom: frameZoom }));
    }, 100);
    return () => clearInterval(id);
  }, [rig, g, frameZoom]);

  const weapon = useWeapon(g, {
    canFire: () => !!rig,
    onShot: async () => {
      if (!rig) return;
      const { outcome: o } = await fire({ pipeline: rig.pipeline, video: rig.video, frameZoom: scope.frameZoom, hitWidth: g.hitWidth, rangeM: g.rangeM });
      const d = o.kind === 'hit' && o.distanceM ? ` · ${o.distanceM.toFixed(1)} m` : '';
      if (o.kind === 'hit') {
        sfx.impact();
        setMarker(Date.now());
      } else {
        sfx.ricochet();
      }
      setHits((h) => ({ hits: h.hits + (o.kind === 'hit' ? 1 : 0), shots: h.shots + 1 }));
      const conf = o.kind === 'hit' ? ` · ${Math.round(o.box.score * 100)}% sure` : '';
      setLog((l) => [{ key: performance.now(), text: `${o.kind === 'hit' ? 'HIT' : 'MISS'}${d}${conf}` }, ...l].slice(0, 5));
    },
  });
  useSpaceTrigger(weapon);

  return (
    <CameraView videoRef={videoRef} rig={rig} viewZoom={scope.viewZoom} frameZoom={scope.frameZoom} overlay={overlay}>
      <div className="hud">
        <div className="hud-top">
          <a className="hud-chip" href="#/"><ArrowLeft />Back</a>
          <a className="hud-chip" href="#/armory?back=practice" aria-label={`Gun: ${g.name}. Change gun`}><Swords />{g.name}</a>
          <div className="spacer" />
          <button className="hud-chip" aria-label={overlay ? 'Hide boxes' : 'Show boxes'} aria-pressed={overlay} onClick={() => { setOverlay(!overlay); save('practice.debug', overlay ? '0' : '1'); }}>
            {overlay ? <EyeOff /> : <Eye />}
            Boxes
          </button>
        </div>
        <div className="stats">
          <div>
            AI <b>{detector === 'ready' ? `ready (${peopleAI.delegate})` : detector}</b> · {hits.hits} / {hits.shots} hits
          </div>
          {log.length === 0 ? <div className="muted">Aim at a person and fire. Shots appear here.</div> : log.map((l) => <div key={l.key}>{l.text}</div>)}
        </div>
        <Crosshair locked={locked} />
        {locked && <div className="aim-name">Person</div>}
        {marker && <HitMarker key={`marker-${marker}`} kill={false} />}
        <Gun gun={g.id} shots={weapon.shots} reloading={weapon.reloading} empty={weapon.ammo === 0} />
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
            <button className="hud-btn" disabled={weapon.reloading || weapon.ammo === g.magazine} onPointerDown={(e) => { e.preventDefault(); weapon.reload(); }}><RotateCw />RELOAD</button>
          </div>
          <button
            className="fire"
            data-testid="fire"
            onPointerDown={(e) => { e.preventDefault(); weapon.triggerDown(); }}
            onPointerUp={weapon.triggerUp}
            onPointerCancel={weapon.triggerUp}
            onPointerLeave={weapon.triggerUp}
          >
            <CrosshairIcon />
            FIRE
            <span className="ammo num">{weapon.reloading ? 'RELOADING' : `${weapon.ammo} / ${g.magazine}`}</span>
          </button>
        </div>
      </div>
      {(error || detector === 'failed') && (
        <div className="cover">
          <div className="title">{error ? 'Camera unavailable' : 'The AI could not load'}</div>
          <div className="muted">{error ?? 'Check your connection, then try again.'}</div>
          <button className="btn btn-primary" onClick={() => (error ? retry() : peopleAI.load())}><RotateCcw />Try again</button>
        </div>
      )}
    </CameraView>
  );
}
