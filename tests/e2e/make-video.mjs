// Fake camera feeds for Chrome (--use-file-for-fake-video-capture plays .y4m files as a webcam).
//   person: a gray room with a magenta "person" standing in the middle. In dev builds,
//           ?testdetector=1 makes the game treat magenta as a person, so the full game can be
//           tested without a real person in front of a real camera.
//   head:   the person stands further back and lower, so the crosshair (the frame center) is
//           on their head: the top 16% of the box, middle half of its width (HEAD in personHit.ts).
//   empty:  the same room with nobody in it.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function makeVideo(kind, file) {
  mkdirSync(dirname(file), { recursive: true });
  const room = 'color=c=0x8a8f96:s=1280x720:d=2:r=30';
  const box = { person: 'x=560:y=150:w=160:h=440', head: 'x=560:y=345:w=160:h=355' }[kind];
  const filters = ['-vf', box ? `drawbox=${box}:color=0xff00ff:t=fill,format=yuv420p` : 'format=yuv420p'];
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', room, ...filters, '-pix_fmt', 'yuv420p', file]);
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
  return file;
}
