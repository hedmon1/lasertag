// Runs the person detector on camera frames and keeps the last ~0.7 s of results.
//
// Two passes, alternating, both centered on the crosshair:
//   pass 0: the middle half of the frame, enlarged (far players look tiny; this doubles them)
//   pass 1: the full width of the frame (close players who fill the view)
// Only people under the crosshair matter, so nothing outside the center needs checking.

import { peopleAI } from './people.ts';
import type { PeopleFrame, PersonBox } from '../game/personHit.ts';

const CANVAS = 384; // the detector shrinks its input to 320 px anyway
const KEEP_MS = 700;
const MIN_GAP_MS = 45; // at most ~20 detections a second, to spare the battery

export interface Pass {
  x: number;
  y: number;
  side: number;
}

export function passesFor(vw: number, vh: number): Pass[] {
  const short = Math.min(vw, vh);
  return [0.5, 1].map((k) => {
    const side = Math.round(short * k);
    return { x: Math.round((vw - side) / 2), y: Math.round((vh - side) / 2), side };
  });
}

export interface PipelineStats {
  fps: number;
  ms: number;
  videoWidth: number;
  videoHeight: number;
}

export class PeoplePipeline {
  frames: PeopleFrame[] = [];
  stats: PipelineStats = { fps: 0, ms: 0, videoWidth: 0, videoHeight: 0 };

  private video: HTMLVideoElement;
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private running = false;
  private passIndex = 0;
  private lastRun = 0;
  private waiters: { after: number; resolve: () => void }[] = [];
  private doneTimes: number[] = [];
  private msSum = 0;
  private msCount = 0;

  constructor(video: HTMLVideoElement) {
    this.video = video;
    this.canvas.width = this.canvas.height = CANVAS;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.loop();
  }

  stop() {
    this.running = false;
    for (const w of this.waiters) w.resolve();
    this.waiters = [];
  }

  /** Resolves once a frame captured after `time` has been processed, or after `timeoutMs`. */
  waitForFrameAfter(time: number, timeoutMs: number): Promise<void> {
    if (this.frames.some((f) => f.time >= time)) return Promise.resolve();
    return new Promise((resolve) => {
      const w = { after: time, resolve };
      this.waiters.push(w);
      setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== w);
        resolve();
      }, timeoutMs);
    });
  }

  /** Runs the far (center) pass right now, so a Fire press is judged on its own frame. */
  detectNow(): PeopleFrame | null {
    return this.run(0);
  }

  private loop = () => {
    if (!this.running) return;
    const v = this.video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    const next = () => {
      if (performance.now() - this.lastRun >= MIN_GAP_MS) this.run(this.passIndex++ % 2);
      this.loop();
    };
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(next);
    else requestAnimationFrame(next);
  };

  private run(passIndex: number): PeopleFrame | null {
    const detector = peopleAI.get();
    const vw = this.video.videoWidth, vh = this.video.videoHeight;
    if (!detector || !vw || !vh || this.video.readyState < 2) return null;
    const pass = passesFor(vw, vh)[passIndex];
    const time = performance.now();
    this.lastRun = time;
    this.ctx.drawImage(this.video, pass.x, pass.y, pass.side, pass.side, 0, 0, CANVAS, CANVAS);
    let raw;
    try {
      raw = detector.detect(this.canvas);
    } catch {
      return null;
    }
    const k = pass.side / CANVAS;
    const boxes: PersonBox[] = raw.map((b) => ({ x: pass.x + b.x * k, y: pass.y + b.y * k, w: b.w * k, h: b.h * k, score: b.score }));
    const frame: PeopleFrame = { time, pass: passIndex, boxes };
    this.record(frame, performance.now() - time, vw, vh);
    return frame;
  }

  private record(frame: PeopleFrame, ms: number, vw: number, vh: number) {
    const now = performance.now();
    this.frames.push(frame);
    this.frames = this.frames.filter((f) => now - f.time <= KEEP_MS);
    this.doneTimes.push(now);
    this.doneTimes = this.doneTimes.filter((t) => now - t <= 1000);
    this.msSum += ms;
    if (++this.msCount >= 10) {
      this.stats.ms = this.msSum / this.msCount;
      this.msSum = 0;
      this.msCount = 0;
    }
    this.stats.fps = this.doneTimes.length;
    this.stats.videoWidth = vw;
    this.stats.videoHeight = vh;
    const ready = this.waiters.filter((w) => frame.time >= w.after);
    this.waiters = this.waiters.filter((w) => frame.time < w.after);
    for (const w of ready) w.resolve();
  }

  /** People seen in the last `maxAgeMs`, newest frame per pass, for overlays. */
  latestBoxes(maxAgeMs = 300): PersonBox[] {
    const now = performance.now();
    const newest = new Map<number, PeopleFrame>();
    for (const f of this.frames) if (now - f.time <= maxAgeMs && (!newest.has(f.pass) || f.time > newest.get(f.pass)!.time)) newest.set(f.pass, f);
    return [...newest.values()].flatMap((f) => f.boxes);
  }
}
