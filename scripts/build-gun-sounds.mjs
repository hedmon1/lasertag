// Builds the gunshot files in public/sounds/guns from The Free Firearm Sound Library
// (CC0, no rights reserved: https://opengameart.org/content/the-free-firearm-sound-library).
// The library is 194 MB, so it is not kept in this repo; download "Prepared SFX Library.7z",
// unpack it, and run:
//
//   node scripts/build-gun-sounds.mjs "/path/to/Prepared SFX Library"
//
// Each gun gets one MP3 laid out in fixed slots: its close-up takes (what the shooter hears)
// one per NEAR_SLOT, then one take recorded further away (what the other player hears) in
// FAR_SLOT. src/ui/gunSounds.ts reads the slots back out. Every take is cut from just before
// its first transient, taken from one microphone (the library's two spaced mics smear the
// crack when summed), cleared of rumble, faded out and peak-normalised.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB = process.argv[2];
if (!LIB) throw new Error('Pass the path to the unpacked "Prepared SFX Library" folder.');
const out = join(dirname(fileURLToPath(import.meta.url)), '../public/sounds/guns');
mkdirSync(out, { recursive: true });

const RATE = 48000;
export const NEAR_SLOT = 1;
export const FAR_SLOT = 2;

// The take times are where each shot starts in the library file, in seconds (found by
// listening and an onset scan); the script finds the exact transient within 80 ms of it.
const GUNS = {
  blip: { near: ['Walther PPQ/X_39P', 0, [1.4, 6.44, 10.66]], far: ['Walther PPQ/X_31P', 0, 1.08] },
  stinger: { near: ['PPSh/P_30P', 1, [0.96, 4.38, 8.24, 11.42, 15.09]], far: ['PPSh/P_16P', 1, 5.25] },
  triplet: { near: ['AK-47/C_28P', 1, [0.61, 3.25, 6.02, 9.15]], far: ['AK-47/C_31P', 1, 0.33] },
  thumper: { near: ['Smith & Wesson 642/V_27P', 0, [0.8, 6.21]], far: ['Smith & Wesson 642/V_22P', 0, 0.67] },
  boomstick: { near: ['Nova/O_21P', 1, [0.43, 3.46]], far: ['Nova/O_17P', 1, 0.69] },
  longshot: { near: ['Mosin Nagant/M_21P', 0, [1.03, 5.01, 9.15, 14.13]], far: ['Mosin Nagant/M_26P', 0, 1.13] },
};

function decode(file, channel) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', join(LIB, `${file}.wav`), '-af', `pan=mono|c0=c${channel}`, '-ar', String(RATE), '-f', 'f32le', '-'], { maxBuffer: 1 << 29 });
  return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
}

/** The first sample within 80 ms of `at` that reaches a quarter of that window's peak. */
function transient(x, at) {
  const from = Math.max(0, Math.round((at - 0.08) * RATE)), to = Math.min(x.length, Math.round((at + 0.08) * RATE));
  let peak = 0;
  for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(x[i]));
  for (let i = from; i < to; i++) if (Math.abs(x[i]) >= peak / 4) return i;
  return from;
}

/** One take: 3 ms of lead-in, rumble removed, faded out by the end of the slot, peak -1 dBFS. */
function take(x, at, slot) {
  const start = Math.max(0, transient(x, at) - Math.round(0.003 * RATE));
  const len = Math.round(slot * RATE);
  const y = new Float32Array(len);
  const fadeFrom = Math.round(len * 0.45), fadeTo = Math.round(len * 0.96);
  // One-pole high-pass at 40 Hz.
  const a = Math.exp((-2 * Math.PI * 40) / RATE);
  let prevIn = 0, prevOut = 0;
  for (let i = 0; i < len && start + i < x.length; i++) {
    const v = x[start + i];
    prevOut = a * (prevOut + v - prevIn);
    prevIn = v;
    const fade = i < fadeFrom ? 1 : i >= fadeTo ? 0 : ((fadeTo - i) / (fadeTo - fadeFrom)) ** 2;
    y[i] = prevOut * fade;
  }
  let peak = 0;
  for (const v of y) peak = Math.max(peak, Math.abs(v));
  const k = 10 ** (-1 / 20) / (peak || 1);
  for (let i = 0; i < len; i++) y[i] *= k;
  return y;
}

for (const [id, g] of Object.entries(GUNS)) {
  const [nearFile, nearCh, times] = g.near;
  const [farFile, farCh, farAt] = g.far;
  const near = decode(nearFile, nearCh);
  const parts = times.map((t) => take(near, t, NEAR_SLOT));
  parts.push(take(decode(farFile, farCh), farAt, FAR_SLOT));
  const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.length;
  }
  const file = join(out, `${id}.mp3`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(RATE), '-ac', '1', '-i', '-', '-c:a', 'libmp3lame', '-b:a', '128k', file], {
    input: Buffer.from(all.buffer),
  });
  console.log(`${id.padEnd(10)} ${times.length} close takes + 1 far take -> public/sounds/guns/${id}.mp3`);
}
