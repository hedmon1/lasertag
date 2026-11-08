import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { openCamera, savedQuality, type CameraHandle, type Quality } from '../camera/camera.ts';
import { PeoplePipeline } from '../detect/peoplePipeline.ts';
import { peopleAI } from '../detect/people.ts';
import { drawOverlay } from './overlay.ts';

export interface CameraRig {
  video: HTMLVideoElement;
  camera: CameraHandle;
  pipeline: PeoplePipeline;
}

/** Opens the rear camera and starts the person detector. Closes both on unmount. */
export function useCameraRig(quality: Quality = savedQuality()) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [rig, setRig] = useState<CameraRig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    let made: CameraRig | null = null;
    setError(null);
    openCamera(video, quality).then(
      (camera) => {
        if (cancelled) return camera.stop();
        peopleAI.load();
        const pipeline = new PeoplePipeline(video);
        pipeline.start();
        made = { video, camera, pipeline };
        // Dev builds expose the rig for debugging and the E2E test.
        if (import.meta.env.DEV) (window as unknown as { __ltRig?: CameraRig }).__ltRig = made;
        setRig(made);
      },
      (e) => !cancelled && setError((e as Error).message),
    );
    return () => {
      cancelled = true;
      made?.pipeline.stop();
      made?.camera.stop();
      setRig(null);
    };
  }, [quality, attempt]);

  return { videoRef, rig, error, retry: useCallback(() => setAttempt((a) => a + 1), []) };
}

/** Scope: real camera zoom where the browser allows it, otherwise a magnified view. */
export function useScope(rig: CameraRig | null, level = 2) {
  const [scoped, setScoped] = useState(false);
  const [frameZoom, setFrameZoom] = useState(1);
  const native = !!rig?.camera.nativeZoom;

  const set = useCallback(
    async (on: boolean) => {
      setScoped(on);
      if (!rig?.camera.nativeZoom) return;
      const base = rig.camera.nativeZoom.min;
      setFrameZoom(on ? await rig.camera.setZoom(base * level) : (await rig.camera.setZoom(base), 1));
    },
    [rig, level],
  );

  return { scoped, native, frameZoom: native ? frameZoom : 1, viewZoom: scoped && !native ? level : 1, set };
}

export function CameraView(props: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  rig: CameraRig | null;
  viewZoom: number;
  frameZoom?: number;
  overlay: boolean;
  children?: ReactNode;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef(props);
  live.current = props;

  useEffect(() => {
    if (!props.overlay) {
      const c = canvasRef.current;
      c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
      return;
    }
    let raf = 0;
    const draw = () => {
      const { rig, viewZoom, frameZoom } = live.current;
      const c = canvasRef.current;
      if (c && rig) {
        drawOverlay(c, {
          boxes: rig.pipeline.latestBoxes(),
          vw: rig.video.videoWidth,
          vh: rig.video.videoHeight,
          viewZoom,
          frameZoom: frameZoom ?? 1,
        });
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [props.overlay]);

  return (
    <div className="stage">
      <video
        ref={props.videoRef}
        className="stage-video"
        playsInline
        muted
        autoPlay
        style={{ transform: `scale(${props.viewZoom})` }}
      />
      <canvas ref={canvasRef} className="stage-overlay" />
      {props.children}
    </div>
  );
}
