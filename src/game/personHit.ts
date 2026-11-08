// Decides what a Fire press hit, from the person boxes the detector found. Pure, so it is
// unit tested. Two-player game: any person under the crosshair is the opponent.

import { MAIN_CAMERA_FOV_DEG, PERSON_HEIGHT_M, SHOT_WINDOW_AFTER_MS, SHOT_WINDOW_BEFORE_MS } from './constants.ts';

export interface Pt {
  x: number;
  y: number;
}

/** A detected person, in video pixels. */
export interface PersonBox {
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
}

/** Detector results for one camera frame. */
export interface PeopleFrame {
  time: number;
  pass: number;
  boxes: PersonBox[];
}

/**
 * A person's box includes air beside the arms and between the legs, so only the middle part
 * of its width counts. Full height: head to feet are all body. Each gun can widen this (a
 * shotgun's spread) or narrow it (a sniper needs aim).
 */
export const HIT_WIDTH = 0.8;

export function hitArea(b: PersonBox, hitWidth = HIT_WIDTH): PersonBox {
  const inset = (b.w * (1 - hitWidth)) / 2;
  return { ...b, x: b.x + inset, w: b.w - 2 * inset };
}

export function boxContains(b: PersonBox, p: Pt, hitWidth = HIT_WIDTH): boolean {
  const a = hitArea(b, hitWidth);
  return p.x >= a.x && p.x <= a.x + a.w && p.y >= b.y && p.y <= b.y + b.h;
}

/** Focal length in pixels; the camera's field of view spans the frame's long side. */
export function focalPx(longSide: number, zoom = 1): number {
  return (longSide / (2 * Math.tan(((MAIN_CAMERA_FOV_DEG / 2) * Math.PI) / 180))) * zoom;
}

/**
 * Rough distance from how tall the person looks. Null when the box touches the top or bottom
 * of the frame (part of the body is cut off, so the height says nothing).
 */
export function distanceFromBox(b: PersonBox, vw: number, vh: number, zoom = 1): number | null {
  const margin = vh * 0.02;
  if (b.y <= margin || b.y + b.h >= vh - margin || b.h <= 0) return null;
  return (focalPx(Math.max(vw, vh), zoom) * PERSON_HEIGHT_M) / b.h;
}

export interface ShotInput {
  /** Crosshair in video pixels (the frame center). */
  aim: Pt;
  fireTime: number;
  frames: PeopleFrame[];
  frameWidth: number;
  frameHeight: number;
  /** How much the frames themselves are zoomed (1 when only the view is magnified). */
  zoom: number;
  /** The gun's hit width and range (see guns.ts). */
  hitWidth?: number;
  rangeM?: number | null;
}

export type ShotOutcome = { kind: 'hit'; box: PersonBox; distanceM: number | null } | { kind: 'miss' };

/** Out of range: the gun has a range and the person is known to be beyond it. */
function outOfRange(b: PersonBox, vw: number, vh: number, zoom: number, rangeM: number | null | undefined): boolean {
  if (!rangeM) return false;
  const d = distanceFromBox(b, vw, vh, zoom);
  return d !== null && d > rangeM;
}

/**
 * A hit if a person was under the crosshair in any frame from 150 ms before the press to
 * 120 ms after it (lag forgiveness), and within the gun's range. The frame nearest the press
 * supplies the distance.
 */
export function resolveShot(input: ShotInput): ShotOutcome {
  let best: { box: PersonBox; dt: number } | null = null;
  for (const f of input.frames) {
    if (f.time < input.fireTime - SHOT_WINDOW_BEFORE_MS || f.time > input.fireTime + SHOT_WINDOW_AFTER_MS) continue;
    const dt = Math.abs(f.time - input.fireTime);
    for (const b of f.boxes) {
      if (!boxContains(b, input.aim, input.hitWidth)) continue;
      if (!best || dt < best.dt || (dt === best.dt && b.h > best.box.h)) best = { box: b, dt };
    }
  }
  if (!best) return { kind: 'miss' };
  if (outOfRange(best.box, input.frameWidth, input.frameHeight, input.zoom, input.rangeM)) return { kind: 'miss' };
  return { kind: 'hit', box: best.box, distanceM: distanceFromBox(best.box, input.frameWidth, input.frameHeight, input.zoom) };
}

export interface AimOptions {
  hitWidth?: number;
  rangeM?: number | null;
  frameWidth: number;
  frameHeight: number;
  zoom: number;
}

/** Whether a shot would count right now, for the crosshair lock. */
export function aimedAtPerson(frames: PeopleFrame[], aim: Pt, now: number, o?: AimOptions, maxAgeMs = 250): boolean {
  return frames.some(
    (f) =>
      now - f.time <= maxAgeMs &&
      f.boxes.some((b) => boxContains(b, aim, o?.hitWidth) && !(o && outOfRange(b, o.frameWidth, o.frameHeight, o.zoom, o.rangeM))),
  );
}
