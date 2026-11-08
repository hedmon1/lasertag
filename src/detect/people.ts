// The person detector: Google MediaPipe Object Detector (EfficientDet-Lite0, COCO "person"),
// running on the phone. It finds people as boxes, works at longer range than a pose model,
// and is fast enough to run continuously so the crosshair can lock on.
import { FilesetResolver, ObjectDetector } from '@mediapipe/tasks-vision';
import { usingEmulators } from '../net/firebase.ts';

export type DetectorState = 'idle' | 'loading' | 'ready' | 'failed';

/** A person in pixels of the image the detector was given. */
export interface RawBox {
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
}

export interface Detector {
  detect(canvas: HTMLCanvasElement): RawBox[];
}

const MODEL_URL =
  import.meta.env.VITE_PERSON_MODEL_URL ??
  'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite';

/** Lowest confidence that still counts as a person. */
export const MIN_SCORE = 0.35;

/**
 * Where the AI runtime (about 14 MB) loads from. Local play uses the copy in public/. The
 * hosted site uses the jsDelivr CDN (same files, pinned to the installed version), which keeps
 * every player's download off the Firebase Hosting free-tier quota.
 */
function wasmBase(): string {
  if (import.meta.env.VITE_MEDIAPIPE_WASM_URL) return import.meta.env.VITE_MEDIAPIPE_WASM_URL;
  if (usingEmulators) return `${import.meta.env.BASE_URL}mediapipe/wasm`;
  return `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${__MEDIAPIPE_VERSION__}/wasm`;
}

/**
 * Dev builds only: `?testdetector=1` swaps the AI for a stand-in that treats any pure magenta
 * area as a person. The end-to-end test films a magenta rectangle with a fake camera, so the
 * whole game can be tested without a real person in front of a real camera.
 */
export const usingTestDetector = import.meta.env.DEV && new URLSearchParams(location.search).has('testdetector');

const testDetector: Detector = {
  detect(canvas) {
    const w = canvas.width, h = canvas.height;
    const px = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        const i = (y * w + x) * 4;
        if (px[i] > 200 && px[i + 1] < 70 && px[i + 2] > 200) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    return x1 < 0 ? [] : [{ x: x0, y: y0, w: x1 - x0 + 2, h: y1 - y0 + 2, score: 0.99 }];
  },
};

class PeopleAI {
  state: DetectorState = 'idle';
  error = '';
  delegate: 'GPU' | 'CPU' | 'test' | null = null;
  private detector: ObjectDetector | null = null;
  private loading: Promise<void> | null = null;
  private listeners = new Set<() => void>();

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(state: DetectorState, error = '') {
    this.state = state;
    this.error = error;
    this.listeners.forEach((fn) => fn());
  }

  load(): Promise<void> {
    if (this.loading) return this.loading;
    if (usingTestDetector) {
      this.delegate = 'test';
      this.set('ready');
      return (this.loading = Promise.resolve());
    }
    this.set('loading');
    this.loading = (async () => {
      try {
        const fileset = await FilesetResolver.forVisionTasks(wasmBase());
        for (const delegate of ['GPU', 'CPU'] as const) {
          try {
            this.detector = await ObjectDetector.createFromOptions(fileset, {
              baseOptions: { modelAssetPath: MODEL_URL, delegate },
              runningMode: 'IMAGE',
              categoryAllowlist: ['person'],
              scoreThreshold: MIN_SCORE,
              maxResults: 6,
            });
            this.delegate = delegate;
            break;
          } catch (e) {
            if (delegate === 'CPU') throw e;
          }
        }
        this.set('ready');
      } catch (e) {
        this.detector = null;
        this.loading = null; // a later screen may try again (for example after a dropped connection)
        this.set('failed', (e as Error)?.message ?? String(e));
      }
    })();
    return this.loading;
  }

  /** The active detector, or null while it isn't ready. */
  get(): Detector | null {
    if (this.state !== 'ready') return null;
    if (usingTestDetector) return testDetector;
    const d = this.detector;
    if (!d) return null;
    return {
      detect: (canvas) =>
        d.detect(canvas).detections.flatMap((det) => {
          const b = det.boundingBox;
          const score = det.categories[0]?.score ?? 0;
          return b ? [{ x: b.originX, y: b.originY, w: b.width, h: b.height, score }] : [];
        }),
    };
  }
}

export const peopleAI = new PeopleAI();
