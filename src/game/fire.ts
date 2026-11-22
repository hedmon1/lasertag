// One shot or flashbang, from camera to outcome. Network and ammo live in the screens (and useWeapon).
import type { PeoplePipeline } from '../detect/peoplePipeline.ts';
import { SHOT_WINDOW_AFTER_MS } from './constants.ts';
import { FLASH } from './flash.ts';
import { GRENADE } from './grenade.ts';
import { resolveBlast, resolveFlash, resolveShot, type PeopleFrame, type ShotOutcome } from './personHit.ts';

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

/**
 * The detector's frames around a press: the ones from before it (a stall would otherwise age
 * them out), the press frame itself, then the frames just after it.
 */
async function framesAround(pipeline: PeoplePipeline, time: number): Promise<PeopleFrame[]> {
  const before = pipeline.frames.slice();
  pipeline.detectNow();
  await pipeline.waitForFrameAfter(time + SHOT_WINDOW_AFTER_MS, SHOT_WINDOW_AFTER_MS + 160);
  return [...before, ...pipeline.frames.filter((f) => !before.includes(f))];
}

/** Kill cam: grabs the middle of the view now; encodes it only if asked (the shot eliminated someone). */
function grabKillcam(video: HTMLVideoElement): () => string | null {
  const vw = video.videoWidth, vh = video.videoHeight;
  const cam = document.createElement('canvas');
  cam.width = cam.height = KILLCAM_PX;
  const crop = Math.round(Math.min(vw, vh) * 0.6);
  cam.getContext('2d')?.drawImage(video, (vw - crop) / 2, (vh - crop) / 2, crop, crop, 0, 0, KILLCAM_PX, KILLCAM_PX);
  return () => {
    try {
      return cam.toDataURL('image/jpeg', 0.62);
    } catch {
      return null;
    }
  };
}

export async function fire(o: FireOptions): Promise<FireResult> {
  const fireTime = performance.now();
  const vw = o.video.videoWidth, vh = o.video.videoHeight;
  const killcam = grabKillcam(o.video);
  const frames = await framesAround(o.pipeline, fireTime);
  const outcome = resolveShot({ aim: { x: vw / 2, y: vh / 2 }, fireTime, frames, frameWidth: vw, frameHeight: vh, zoom: o.frameZoom, hitWidth: o.hitWidth, rangeM: o.rangeM });
  return { outcome, fireTime, killcam };
}

/** A flashbang: did it catch anyone in view? */
export async function throwFlash(o: Pick<FireOptions, 'pipeline' | 'video' | 'frameZoom'>): Promise<ShotOutcome> {
  const throwTime = performance.now();
  const frames = await framesAround(o.pipeline, throwTime);
  return resolveFlash({ throwTime, frames, frameWidth: o.video.videoWidth, frameHeight: o.video.videoHeight, zoom: o.frameZoom, rangeM: FLASH.rangeM });
}

/** A grenade going off now: did the blast catch anyone in view? */
export async function blast(o: Pick<FireOptions, 'pipeline' | 'video' | 'frameZoom'>): Promise<FireResult> {
  const fireTime = performance.now();
  const killcam = grabKillcam(o.video);
  const frames = await framesAround(o.pipeline, fireTime);
  const outcome = resolveBlast({ throwTime: fireTime, frames, frameWidth: o.video.videoWidth, frameHeight: o.video.videoHeight, zoom: o.frameZoom, rangeM: GRENADE.far.m });
  return { outcome, fireTime, killcam };
}
