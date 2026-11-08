import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Crosshair as CrosshairIcon, Eye, EyeOff, RotateCcw, RotateCw, ZoomIn } from 'lucide-react';
import { peopleAI } from '../detect/people.ts';
import { fire } from '../game/fire.ts';
import { aimedAtPerson } from '../game/personHit.ts';
import { MAGAZINE, RELOAD_MS } from '../game/rules.ts';
import { CameraView, useCameraRig, useScope } from '../ui/CameraView.tsx';
import { Crosshair, HitMarker, useDetectorState } from '../ui/hud.tsx';
import { sfx, unlockAudio } from '../ui/sound.ts';
import { Gun } from '../ui/Gun.tsx';
import { load, save } from '../ui/storage.ts';
import { keepAwake } from '../camera/camera.ts';

interface LogEntry {
  key: number;
  text: string;
}

/** Solo mode: no server. Aim at a friend and see exactly what the AI counts. */
export function Practice() {
  const { videoRef, rig, error, retry } = useCameraRig();
  const scope = useScope(rig);
  const detector = useDetectorState();
  const [overlay, setOverlay] = useState(() => load('practice.debug', '1') === '1');
  const [locked, setLocked] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [marker, setMarker] = useState<number | null>(null);
  const [ammo, setAmmo] = useState(MAGAZINE);
  const [shots, setShots] = useState(0);
  const [reloadingNow, setReloadingNow] = useState(false);
  const [hits, setHits] = useState({ hits: 0, shots: 0 });
  const busy = useRef(false);
  const reloading = useRef(false);
  const ammoRef = useRef(ammo);
  ammoRef.current = ammo;

  useEffect(() => keepAwake(), []);

  useEffect(() => {
    if (!rig) return;
    const id = setInterval(() => {
      setLocked(aimedAtPerson(rig.pipeline.frames, { x: rig.video.videoWidth / 2, y: rig.video.videoHeight / 2 }, performance.now()));
    }, 100);
    return () => clearInterval(id);
  }, [rig]);

  const reload = () => {
    if (reloading.current) return;
    reloading.current = true;
    setReloadingNow(true);
    sfx.reload();
    setTimeout(() => {
      setAmmo(MAGAZINE);
      reloading.current = false;
      setReloadingNow(false);
    }, RELOAD_MS);
  };

  const onFire = async () => {
    unlockAudio();
    if (!rig || busy.current || reloading.current) return;
    if (ammoRef.current <= 0) {
      sfx.empty();
      reload();
      return;
    }
    busy.current = true;
    setAmmo((a) => a - 1);
    sfx.gunshot();
    setShots((n) => n + 1);
    try {
      const { outcome: o } = await fire({ pipeline: rig.pipeline, video: rig.video, frameZoom: scope.frameZoom });
      const d = o.kind === 'hit' && o.distanceM ? ` · ${o.distanceM.toFixed(1)} m` : '';
      if (o.kind === 'hit') {
        sfx.impact();
        setMarker(Date.now());
      } else {
        sfx.ricochet();
      }
      setHits((h) => ({ hits: h.hits + (o.kind === 'hit' ? 1 : 0), shots: h.shots + 1 }));
      const conf = o.kind === 'hit' ? ` · ${Math.round(o.box.score * 100)}% sure` : '';
      setLog((l) => [{ key: Date.now(), text: `${o.kind === 'hit' ? 'HIT' : 'MISS'}${d}${conf}` }, ...l].slice(0, 5));
    } finally {
      setTimeout(() => (busy.current = false), 300);
      if (ammoRef.current <= 1) reload();
    }
  };

  const fireRef = useRef(onFire);
  fireRef.current = onFire;
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.code === 'Space' && !e.repeat && (e.preventDefault(), fireRef.current());
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  return (
    <CameraView videoRef={videoRef} rig={rig} viewZoom={scope.viewZoom} frameZoom={scope.frameZoom} overlay={overlay}>
      <div className="hud">
        <div className="hud-top">
          <a className="hud-chip" href="#/"><ArrowLeft />Back</a>
          <div className="spacer" />
          <button className="hud-chip" onClick={() => { setOverlay(!overlay); save('practice.debug', overlay ? '0' : '1'); }}>
            {overlay ? <EyeOff /> : <Eye />}
            {overlay ? 'Hide boxes' : 'Show boxes'}
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
        <Gun shots={shots} reloading={reloadingNow} empty={ammo === 0} />
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
            <button className="hud-btn" disabled={ammo === MAGAZINE} onPointerDown={(e) => { e.preventDefault(); reload(); }}><RotateCw />RELOAD</button>
          </div>
          <button className="fire" data-testid="fire" onPointerDown={(e) => { e.preventDefault(); onFire(); }}>
            <CrosshairIcon />
            FIRE
            <span className="ammo num">{reloadingNow ? 'RELOADING' : `${ammo} / ${MAGAZINE}`}</span>
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
