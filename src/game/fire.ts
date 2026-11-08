// One shot, from camera to outcome. Network and ammo live in the screens (and useWeapon).
import type { PeoplePipeline } from '../detect/peoplePipeline.ts';
import { SHOT_WINDOW_AFTER_MS } from './constants.ts';
import { resolveShot, type ShotOutcome } from './personHit.ts';

export interface FireOptions {
  pipeline: PeoplePipeline;
  video: HTMLVideoElement;
  /** How much the frames themselves are zoomed (1 when only the view is magnified). */
  frameZoom: number;
  /** The gun's hit width and range. */
  hitWidth: number;
  rangeM: number | null;
}

export interface FireResult {
  outcome: ShotOutcome;
  fireTime: number;
  /** JPEG data URL of the crosshair area at the moment of the press. */
  killcam: () => string | null;
}

const KILLCAM_PX = 360;

export async function fire(o: FireOptions): Promise<FireResult> {
  const fireTime = performance.now();
  const vw = o.video.videoWidth, vh = o.video.videoHeight;

  // Kill cam: grab the crosshair area now, encode only if the shot eliminates someone.
  const cam = document.createElement('canvas');
  cam.width = cam.height = KILLCAM_PX;
  const crop = Math.round(Math.min(vw, vh) * 0.6);
  cam.getContext('2d')?.drawImage(o.video, (vw - crop) / 2, (vh - crop) / 2, crop, crop, 0, 0, KILLCAM_PX, KILLCAM_PX);

  // Keep the frames from before the press (a stall would otherwise age them out), check the
  // press frame itself, then allow the frames just after it.
  const before = o.pipeline.frames.slice();
  o.pipeline.detectNow();
  await o.pipeline.waitForFrameAfter(fireTime + SHOT_WINDOW_AFTER_MS, SHOT_WINDOW_AFTER_MS + 160);
  const frames = [...before, ...o.pipeline.frames.filter((f) => !before.includes(f))];

  const outcome = resolveShot({ aim: { x: vw / 2, y: vh / 2 }, fireTime, frames, frameWidth: vw, frameHeight: vh, zoom: o.frameZoom, hitWidth: o.hitWidth, rangeM: o.rangeM });
  return {
    outcome,
    fireTime,
    killcam: () => {
      try {
        return cam.toDataURL('image/jpeg', 0.62);
      } catch {
        return null;
      }
    },
  };
}
