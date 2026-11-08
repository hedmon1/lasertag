// Fake camera feeds for Chrome (--use-file-for-fake-video-capture plays .y4m files as a webcam).
//   person: a gray room with a magenta "person" standing in the middle. In dev builds,
//           ?testdetector=1 makes the game treat magenta as a person, so the full game can be
//           tested without a real person in front of a real camera.
//   empty:  the same room with nobody in it.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function makeVideo(kind, file) {
  mkdirSync(dirname(file), { recursive: true });
  const room = 'color=c=0x8a8f96:s=1280x720:d=2:r=30';
  const filters = kind === 'person' ? ['-vf', 'drawbox=x=560:y=150:w=160:h=440:color=0xff00ff:t=fill,format=yuv420p'] : ['-vf', 'format=yuv420p'];
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', room, ...filters, '-pix_fmt', 'yuv420p', file]);
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
  return file;
}
