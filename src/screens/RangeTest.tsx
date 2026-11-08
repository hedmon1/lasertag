import { useEffect, useState } from 'react';
import { ArrowLeft, RotateCcw, ZoomIn } from 'lucide-react';
import { peopleAI } from '../detect/people.ts';
import { distanceFromBox } from '../game/personHit.ts';
import { saveQuality, savedQuality, type Quality } from '../camera/camera.ts';
import { CameraView, useCameraRig, useScope } from '../ui/CameraView.tsx';
import { useDetectorState } from '../ui/hud.tsx';
import { useTicker } from '../net/useGame.ts';
import { keepAwake } from '../camera/camera.ts';

/** Have a friend walk away from the camera and watch where the AI stops seeing them. */
export function RangeTest() {
  const [quality, setQuality] = useState<Quality>(savedQuality);
  const { videoRef, rig, error, retry } = useCameraRig(quality);
  const scope = useScope(rig);
  const detector = useDetectorState();
  const [farthest, setFarthest] = useState(0);
  useTicker(200);

  useEffect(() => keepAwake(), []);

  const s = rig?.pipeline.stats;
  const boxes = rig?.pipeline.latestBoxes(400) ?? [];
  const people = boxes.map((b) => ({ b, d: s ? distanceFromBox(b, s.videoWidth, s.videoHeight, scope.frameZoom) : null }));
  const best = people.reduce((m, p) => Math.max(m, p.d ?? 0), 0);
  useEffect(() => {
    if (best > farthest) setFarthest(best);
  }, [best, farthest]);

  return (
    <CameraView videoRef={videoRef} rig={rig} viewZoom={scope.viewZoom} frameZoom={scope.frameZoom} overlay>
      <div className="hud">
        <div className="hud-top">
          <a className="hud-chip" href="#/"><ArrowLeft />Back</a>
          <div className="spacer" />
          <div className="segmented" style={{ background: 'var(--shade)' }}>
            {(['1080p', '4k'] as const).map((q) => (
              <button key={q} aria-pressed={quality === q} onClick={() => { setQuality(q); saveQuality(q); }}>{q === '4k' ? '4K' : q}</button>
            ))}
          </div>
        </div>
        <div className="stats" data-testid="range-stats">
          <div>Camera <b>{s?.videoWidth ? `${s.videoWidth}x${s.videoHeight}` : '...'}</b> · AI <b>{detector === 'ready' ? peopleAI.delegate : detector}</b></div>
          <div><b>{s?.fps ?? 0}</b> checks/s · {s ? s.ms.toFixed(0) : '0'} ms each</div>
          <div>Zoom {scope.native ? `camera ${scope.frameZoom.toFixed(1)}x` : 'view only (this browser has no camera zoom)'}</div>
          {people.length === 0 ? (
            <div className="muted">No one in view.</div>
          ) : (
            people.map((p, i) => (
              <div key={i}>
                Person {Math.round(p.b.score * 100)}% sure · {p.d ? <b>{p.d.toFixed(1)} m</b> : 'partly out of frame'}
              </div>
            ))
          )}
          <div>Farthest seen so far <b>{farthest.toFixed(1)} m</b> (assumes someone about 1.7 m tall, standing)</div>
        </div>
        <div className="hud-bottom">
          <div className="side-buttons">
            <button
              className="hud-btn"
              aria-pressed={scope.scoped}
              onPointerDown={(e) => { e.preventDefault(); scope.set(true); }}
              onPointerUp={() => scope.set(false)}
              onPointerCancel={() => scope.set(false)}
            >
              <ZoomIn />
              SCOPE
            </button>
          </div>
          <button className="hud-btn" style={{ minWidth: 120 }} onClick={() => setFarthest(0)}><RotateCcw />RESET</button>
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
