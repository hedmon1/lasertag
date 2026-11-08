// Rear camera access, resolution choice, zoom, and keeping the screen awake.

export type Quality = '1080p' | '4k';

export interface CameraHandle {
  stream: MediaStream;
  track: MediaStreamTrack;
  /** Real camera zoom range, when the browser exposes it (Android Chrome). */
  nativeZoom: { min: number; max: number } | null;
  /** Applies zoom. Returns the factor the frames are actually zoomed by (1 if the view is magnified instead). */
  setZoom(z: number): Promise<number>;
  stop(): void;
}

const QUALITY_KEY = 'lt.quality';

export function savedQuality(): Quality {
  try {
    return localStorage.getItem(QUALITY_KEY) === '1080p' ? '1080p' : '4k';
  } catch {
    return '4k';
  }
}

export function saveQuality(q: Quality) {
  try {
    localStorage.setItem(QUALITY_KEY, q);
  } catch {
    /* private mode */
  }
}

export class CameraError extends Error {}

export async function openCamera(video: HTMLVideoElement, quality: Quality = savedQuality()): Promise<CameraHandle> {
  if (!window.isSecureContext) throw new CameraError('The camera only works on a secure (https) link.');
  if (!navigator.mediaDevices?.getUserMedia) throw new CameraError('This browser has no camera access.');
  const size = quality === '4k' ? { width: 3840, height: 2160 } : { width: 1920, height: 1080 };
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: size.width }, height: { ideal: size.height }, frameRate: { ideal: 30 } },
    });
  } catch (e) {
    const name = (e as DOMException)?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new CameraError('Camera access is blocked. Allow the camera for this site in your browser settings, then reload.');
    if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new CameraError('No usable camera found.');
    if (name === 'NotReadableError') throw new CameraError('The camera is busy in another app. Close it and try again.');
    throw new CameraError(`Could not start the camera: ${(e as Error)?.message ?? e}`);
  }
  const track = stream.getVideoTracks()[0];
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  await video.play().catch(() => {});
  await new Promise<void>((resolve, reject) => {
    if (video.videoWidth > 0) return resolve();
    const timer = setTimeout(() => reject(new CameraError('The camera did not start. Close other apps using it and try again.')), 8000);
    video.addEventListener('loadedmetadata', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });

  const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { zoom?: { min: number; max: number } };
  const nativeZoom = caps.zoom && caps.zoom.max > caps.zoom.min ? { min: caps.zoom.min, max: caps.zoom.max } : null;

  return {
    stream,
    track,
    nativeZoom,
    async setZoom(z: number) {
      if (!nativeZoom) return 1;
      const level = Math.max(nativeZoom.min, Math.min(nativeZoom.max, z));
      try {
        await track.applyConstraints({ advanced: [{ zoom: level } as MediaTrackConstraintSet] });
        return level / Math.max(1, nativeZoom.min);
      } catch {
        return 1;
      }
    },
    stop() {
      stream.getTracks().forEach((t) => t.stop());
      // Only detach if a newer camera hasn't taken over this element already.
      if (video.srcObject === stream) video.srcObject = null;
    },
  };
}

/** Keeps the screen on during a game. Re-acquires after the tab comes back. */
export function keepAwake(): () => void {
  let lock: { release(): Promise<void> } | null = null;
  let stopped = false;
  const acquire = async () => {
    try {
      lock = (await (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen')) ?? null;
    } catch {
      lock = null;
    }
  };
  const onVis = () => {
    if (!stopped && document.visibilityState === 'visible') acquire();
  };
  acquire();
  document.addEventListener('visibilitychange', onVis);
  return () => {
    stopped = true;
    document.removeEventListener('visibilitychange', onVis);
    lock?.release().catch(() => {});
  };
}
