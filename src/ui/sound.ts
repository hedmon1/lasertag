// Game sounds. The gunshots are real recordings (public/sounds/guns, from The Free Firearm
// Sound Library, CC0; see scripts/build-gun-sounds.mjs); everything else is synthesized with
// Web Audio.
//
// Each gun plays one of its close-up takes at random, a little faster or slower each time,
// with a presence boost so the crack carries on a phone speaker, a room reverb and an outdoor
// echo. Then its action: the slide cycling, the pump racked, the bolt worked or the hammer
// cocked, and the casing landing. The other player's gun is the same gun recorded from
// further away. Until a gun's recording has loaded, a synthesized shot stands in for it.
// Everything runs through a soft clipper, which makes it loud without harsh distortion.
//
// iPhone: Safari mutes web audio when the silent switch is on, unless the page asks for the
// "playback" audio session (iOS 17 and later), and it only starts audio inside a tap.
// installAudioUnlock() handles both, on the first tap anywhere in the app.
import { GUNS, gun as gunById, type Gun, type GunId } from '../game/guns.ts';

interface Chain {
  ctx: BaseAudioContext;
  input: AudioNode;
  reverb: AudioNode;
  echo: AudioNode;
}

let live: AudioContext | null = null;
let liveSince = 0;
let chain: Chain | null = null;

const soundLog: string[] = [];
if (import.meta.env.DEV) (window as unknown as { __ltSounds: string[] }).__ltSounds = soundLog;

function softClip(k: number): Float32Array<ArrayBuffer> {
  const n = 2048, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) curve[i] = Math.tanh(k * ((i / (n - 1)) * 2 - 1)) / Math.tanh(k);
  return curve;
}

/** A decaying burst of stereo noise: a cheap, convincing small-room reverb. */
function roomImpulse(c: BaseAudioContext, seconds: number): AudioBuffer {
  const len = Math.round(c.sampleRate * seconds);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 4;
  }
  return buf;
}

function buildChain(c: BaseAudioContext, dest: AudioNode): Chain {
  // The soft clipper is the limiter: quiet sounds pass almost clean, and the stacked layers of
  // a gunshot saturate up to full scale and never past it.
  const input = c.createGain();
  const drive = c.createWaveShaper();
  drive.curve = softClip(2.4);
  // No oversampling: its anti-alias filter rings past full scale on a hard-driven gunshot (up
  // to 36% over), while the curve alone can never exceed ±1. The aliasing it would remove is
  // buried in the noise layers.
  drive.oversample = 'none';
  const master = c.createGain();
  master.gain.value = 0.95;
  input.connect(drive).connect(master).connect(dest);

  const reverb = c.createConvolver();
  reverb.buffer = roomImpulse(c, 0.9);
  const wet = c.createGain();
  wet.gain.value = 0.45;
  reverb.connect(wet).connect(input);

  // Outdoor slap-back: the shot bouncing off a building twice, darker each time.
  const echo = c.createGain();
  for (const [delay, gain, cutoff] of [[0.17, 0.32, 2400], [0.39, 0.15, 1500]]) {
    const d = c.createDelay(1);
    d.delayTime.value = delay;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = c.createGain();
    g.gain.value = gain;
    echo.connect(d).connect(f).connect(g).connect(input);
  }
  return { ctx: c, input, reverb, echo };
}

const noiseBufs = new WeakMap<BaseAudioContext, AudioBuffer>();
function noiseBuffer(c: BaseAudioContext): AudioBuffer {
  let buf = noiseBufs.get(c);
  if (!buf) {
    buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseBufs.set(c, buf);
  }
  return buf;
}

interface Sends {
  /** Room reverb amount. */
  reverb?: number;
  /** Outdoor echo amount. */
  echo?: number;
}

function envelope(c: BaseAudioContext, t: number, gain: number, attackMs: number, end: number): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attackMs / 1000);
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  return g;
}

function route(node: AudioNode, s: Sends) {
  const { ctx: c, input, reverb, echo } = chain!;
  node.connect(input);
  for (const [amount, bus] of [[s.reverb, reverb], [s.echo, echo]] as const) {
    if (!amount) continue;
    const g = c.createGain();
    g.gain.value = amount;
    node.connect(g).connect(bus);
  }
}

interface NoiseOpts extends Sends {
  ms: number;
  gain: number;
  type: BiquadFilterType;
  from: number;
  to?: number;
  q?: number;
  delay?: number;
  attackMs?: number;
}

/** A burst of filtered noise; the filter can sweep from `from` to `to`. */
function noise(o: NoiseOpts) {
  if (!chain) return;
  const c = chain.ctx;
  const t = c.currentTime + (o.delay ?? 0) / 1000;
  const end = t + o.ms / 1000;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  const f = c.createBiquadFilter();
  f.type = o.type;
  f.Q.value = o.q ?? 0.7;
  f.frequency.setValueAtTime(o.from, t);
  if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, end);
  const g = envelope(c, t, o.gain, o.attackMs ?? 1, end);
  src.connect(f).connect(g);
  route(g, o);
  src.start(t, Math.random());
  src.stop(end + 0.05);
}

interface ToneOpts extends Sends {
  type: OscillatorType;
  from: number;
  to?: number;
  ms: number;
  gain: number;
  delay?: number;
  attackMs?: number;
}

/** A pitched blip; the pitch can glide from `from` to `to`. */
function tone(o: ToneOpts) {
  if (!chain) return;
  const c = chain.ctx;
  const t = c.currentTime + (o.delay ?? 0) / 1000;
  const end = t + o.ms / 1000;
  const osc = c.createOscillator();
  osc.type = o.type;
  osc.frequency.setValueAtTime(o.from, t);
  if (o.to && o.to !== o.from) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), end);
  const g = envelope(c, t, o.gain, o.attackMs ?? 3, end);
  osc.connect(g);
  route(g, o);
  osc.start(t);
  osc.stop(end + 0.05);
}

/** A small metallic click, the building block of gun handling sounds. */
function click(delay: number, pitch = 3000, gain = 0.5) {
  noise({ ms: 18, gain, type: 'bandpass', from: pitch, q: 4, delay });
  tone({ type: 'square', from: pitch / 2.5, to: pitch / 3, ms: 22, gain: gain * 0.25, delay });
}

/** A brass casing landing and bouncing: inharmonic metal partials, each bounce quieter. */
function casing(land: number, pitch = 3700, level = 1) {
  const base = vary(pitch, 0.06);
  for (const [at, gain] of [[0, 0.09], [125, 0.055], [205, 0.032], [250, 0.018]]) {
    for (const [ratio, ms] of [[1, 120], [1.59, 85], [2.41, 60]]) {
      tone({ type: 'sine', from: base * ratio, to: base * ratio * 0.995, ms: ms * (1 - at / 450), gain: (level * gain) / ratio, delay: land + at, attackMs: 1 });
    }
  }
}

/** A plastic shotgun hull landing: a dull tock and a smaller bounce, no ring. */
function hull(land: number) {
  for (const [at, gain] of [[0, 0.3], [140, 0.14]]) {
    noise({ ms: 40, gain, type: 'bandpass', from: vary(1300, 0.08), q: 2.2, delay: land + at });
    tone({ type: 'triangle', from: 520, to: 380, ms: 35, gain: gain * 0.4, delay: land + at });
  }
}

const vary = (x: number, amount = 0.12) => x * (1 + (Math.random() * 2 - 1) * amount);

// ---------- recorded gunshots ----------

/** The slot layout of public/sounds/guns/<id>.mp3 (scripts/build-gun-sounds.mjs). */
const NEAR_SLOT = 1;
const FAR_SLOT = 2;

interface Bank {
  near: AudioBuffer[];
  far: AudioBuffer;
}

const banks = new Map<GunId, Bank>();
const loading = new Map<GunId, Promise<void>>();
const lastTake = new Map<GunId, number>();
let decoder: BaseAudioContext | null = null;

/** Every take is scaled so its loudest 50 ms has this RMS; the gun's gain sets the rest. */
const TAKE_RMS = 0.25;

/**
 * Copies one take out of its slot, starting right at its first transient (MP3 encoders pad
 * the start of a file, so the take sits a few milliseconds into its slot), and evens out its
 * loudness so every take of every gun starts from the same level.
 */
function takeFrom(c: BaseAudioContext, src: AudioBuffer, slotStart: number, slotSeconds: number): AudioBuffer {
  const rate = src.sampleRate;
  const d = src.getChannelData(0);
  const from = Math.round(slotStart * rate);
  const look = Math.min(d.length, from + Math.round(0.15 * rate));
  let peak = 0;
  for (let i = from; i < look; i++) peak = Math.max(peak, Math.abs(d[i]));
  let onset = from;
  while (onset < look && Math.abs(d[onset]) < peak / 4) onset++;
  const start = Math.max(from, onset - Math.round(0.001 * rate));
  const len = Math.max(1, Math.min(d.length - start, Math.round((slotSeconds - 0.06) * rate)));
  const take = d.slice(start, start + len);
  const win = Math.round(0.05 * rate);
  let loudest = 0;
  for (let i = 0; i + win <= take.length; i += win >> 2) {
    let sum = 0;
    for (let j = i; j < i + win; j++) sum += take[j] * take[j];
    loudest = Math.max(loudest, Math.sqrt(sum / win));
  }
  const k = loudest > 0 ? TAKE_RMS / loudest : 1;
  for (let i = 0; i < take.length; i++) take[i] *= k;
  const out = c.createBuffer(1, len, rate);
  out.getChannelData(0).set(take);
  return out;
}

/**
 * Fetches and decodes these guns' recordings, once each. Safe to call before the first tap:
 * decoding needs no running audio. A failed load is retried on the next call.
 */
export function loadGunSounds(ids: GunId[]): Promise<void> {
  return Promise.all(
    [...new Set(ids)].map((id) => {
      let p = loading.get(id);
      if (!p) {
        const c = live ?? (decoder ??= new OfflineAudioContext(1, 1, 48000));
        p = fetch(`${import.meta.env.BASE_URL}sounds/guns/${id}.mp3`)
          .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
          .then((data) => c.decodeAudioData(data))
          .then((buf) => {
            const n = gunById(id).sound.takes;
            banks.set(id, {
              near: Array.from({ length: n }, (_, i) => takeFrom(c, buf, i * NEAR_SLOT, NEAR_SLOT)),
              far: takeFrom(c, buf, n * NEAR_SLOT, FAR_SLOT),
            });
          })
          .catch(() => {
            loading.delete(id);
          });
        loading.set(id, p);
      }
      return p;
    }),
  ).then(() => {});
}

/** Whether a gun's recording is ready to play. */
export function gunSoundsReady(id: GunId): boolean {
  return banks.has(id);
}

/** A different take from last time, so rapid fire never repeats the same shot. */
function pickTake(id: GunId, takes: AudioBuffer[]): AudioBuffer {
  let i = Math.floor(Math.random() * takes.length);
  if (takes.length > 1 && i === lastTake.get(id)) i = (i + 1) % takes.length;
  lastTake.set(id, i);
  return takes[i];
}

interface SampleOpts extends Sends {
  gain: number;
  rate: number;
  delay?: number;
  /** Boost around 2.2 kHz, where a phone speaker is loudest. */
  presence?: boolean;
  lowpass?: number;
}

function sample(buf: AudioBuffer, o: SampleOpts) {
  if (!chain) return;
  const c = chain.ctx;
  const t = c.currentTime + (o.delay ?? 0) / 1000;
  const src = c.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = o.rate;
  const filters: BiquadFilterNode[] = [];
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 70;
  filters.push(hp);
  if (o.presence) {
    const pk = c.createBiquadFilter();
    pk.type = 'peaking';
    pk.frequency.value = 2200;
    pk.Q.value = 0.8;
    pk.gain.value = 5;
    filters.push(pk);
  }
  if (o.lowpass) {
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = o.lowpass;
    filters.push(lp);
  }
  const g = c.createGain();
  g.gain.value = o.gain;
  let node: AudioNode = src;
  for (const f of filters) node = node.connect(f);
  node.connect(g);
  route(g, o);
  src.start(t);
}

/** The synthesized pistol shot, for a gun whose recording hasn't loaded yet. */
function synthShot(k: number) {
  noise({ ms: 7, gain: 1, type: 'highpass', from: 2000, attackMs: 0.3 }); // crack
  noise({ ms: 280, gain: 1.5, type: 'lowpass', from: vary(7000) * k, to: 380 * k, q: 0.9, reverb: 0.5, echo: 0.6 }); // blast
  noise({ ms: 130, gain: vary(1.2, 0.08), type: 'bandpass', from: vary(950) * k, to: 420 * k, q: 1.1, reverb: 0.3 }); // punch
  tone({ type: 'triangle', from: vary(300) * k, to: 110 * k, ms: 120, gain: 0.45 });
  tone({ type: 'sine', from: vary(140) * k, to: 45, ms: 220, gain: 0.8, reverb: 0.2 }); // thump
}

/** The gun's action after the shot, and the casing landing. */
function cycle(g: Gun) {
  switch (g.sound.action) {
    case 'slide':
      click(22, vary(2300, 0.05), 0.3); // slide back
      click(68, vary(1700, 0.05), 0.35); // slide home
      if (g.sound.casing) casing(vary(400, 0.15), 3700, g.mode === 'auto' ? 0.6 : 1);
      break;
    case 'hammer':
      click(170, 2000, 0.3); // hammer back
      click(240, 2700, 0.22); // cylinder turns
      break;
    case 'pump':
      noise({ ms: 90, gain: 0.45, type: 'bandpass', from: 1600, to: 900, q: 2, delay: 330 }); // pump back
      click(345, 1400, 0.55);
      noise({ ms: 80, gain: 0.45, type: 'bandpass', from: 900, to: 1900, q: 2, delay: 520 }); // pump forward
      click(575, 2100, 0.7);
      hull(vary(760, 0.06));
      break;
    case 'bolt':
      click(420, 2200, 0.45); // bolt up
      noise({ ms: 140, gain: 0.28, type: 'bandpass', from: 2600, to: 1200, q: 2, delay: 450 }); // bolt back
      click(600, 1800, 0.5);
      noise({ ms: 120, gain: 0.28, type: 'bandpass', from: 1200, to: 2700, q: 2, delay: 700 }); // bolt forward
      click(830, 2500, 0.6); // bolt down
      click(880, 1600, 0.4);
      casing(vary(860, 0.06), 3300);
      break;
  }
}

function gunshot(id: GunId) {
  const g = gunById(id);
  const bank = banks.get(id);
  if (bank) sample(pickTake(id, bank.near), { gain: vary(g.sound.gain, 0.06), rate: vary(g.sound.rate, 0.03), presence: true, reverb: 0.22, echo: 0.4 });
  else synthShot(g.sound.rate);
  cycle(g);
}

/** The other player's shot, heard from across the field: duller, quieter, mostly echo. */
function distantShot(id: GunId) {
  const g = gunById(id);
  const bank = banks.get(id);
  if (bank) {
    sample(bank.far, { gain: vary(g.sound.gain * 0.16, 0.08), rate: vary(g.sound.rate, 0.03), lowpass: 3800, reverb: 0.25, echo: 0.5 });
    return;
  }
  noise({ ms: 230, gain: 0.32, type: 'lowpass', from: vary(2600), to: 300, q: 0.8, reverb: 0.8, echo: 1 });
  noise({ ms: 110, gain: 0.26, type: 'bandpass', from: vary(800), to: 380, q: 1, echo: 0.6 });
  tone({ type: 'triangle', from: vary(240), to: 90, ms: 140, gain: 0.16 });
}

/** A magazine seating: a thunk and a latch. */
function magIn(at: number) {
  tone({ type: 'sine', from: 220, to: 110, ms: 60, gain: 0.4, delay: at });
  noise({ ms: 30, gain: 0.3, type: 'bandpass', from: 900, q: 1.5, delay: at });
  click(at + 5, 1800, 0.6);
}

/** The reload for each kind of gun, spread over its reload time so the last step lands as the gun comes back up. */
function reload(id: GunId) {
  const g = gunById(id);
  const R = g.reloadMs;
  switch (g.sound.action) {
    case 'slide': // magazine out, magazine in, slide pulled back and released
      click(0, 2200, 0.45);
      noise({ ms: 150, gain: 0.16, type: 'bandpass', from: 1800, to: 900, q: 2, delay: 40 });
      magIn(R * 0.36);
      noise({ ms: 130, gain: 0.2, type: 'bandpass', from: 1500, to: 3500, q: 2, delay: R * 0.67 });
      click(R * 0.73, 2800, 0.4);
      click(R * 0.79, 3200, 0.7);
      tone({ type: 'sine', from: 300, to: 150, ms: 40, gain: 0.3, delay: R * 0.79 });
      break;
    case 'hammer': // cylinder out, empties dumped, six rounds in, cylinder shut, hammer back
      click(0, 1900, 0.5);
      noise({ ms: 60, gain: 0.2, type: 'bandpass', from: 1400, q: 1.5, delay: 10 });
      for (let i = 0; i < 6; i++) casing(R * 0.12 + i * 28, 5200, 0.35);
      for (let i = 0; i < 3; i++) {
        tone({ type: 'triangle', from: 640, to: 420, ms: 30, gain: 0.18, delay: R * (0.34 + i * 0.08) });
        click(R * (0.34 + i * 0.08) + 10, 2500, 0.3);
      }
      click(R * 0.7, 1600, 0.7);
      noise({ ms: 40, gain: 0.3, type: 'bandpass', from: 1000, q: 1.5, delay: R * 0.7 });
      click(R * 0.79, 2600, 0.5);
      click(R * 0.79 + 40, 3400, 0.4);
      break;
    case 'pump': // four shells pushed into the tube, then the pump racked
      for (const k of [0.14, 0.3, 0.46, 0.6]) {
        noise({ ms: 60, gain: 0.25, type: 'bandpass', from: 1100, to: 1500, q: 1.8, delay: R * k });
        click(R * k + 50, 1500, 0.45);
      }
      noise({ ms: 90, gain: 0.5, type: 'bandpass', from: 1600, to: 900, q: 2, delay: R * 0.7 });
      click(R * 0.7 + 15, 1400, 0.6);
      noise({ ms: 80, gain: 0.5, type: 'bandpass', from: 900, to: 1900, q: 2, delay: R * 0.78 });
      click(R * 0.78 + 55, 2100, 0.7);
      break;
    case 'bolt': // bolt open, magazine out, magazine in, bolt closed
      click(0, 2200, 0.45);
      noise({ ms: 140, gain: 0.25, type: 'bandpass', from: 2600, to: 1200, q: 2, delay: R * 0.04 });
      click(R * 0.18, 2000, 0.4);
      noise({ ms: 150, gain: 0.16, type: 'bandpass', from: 1800, to: 900, q: 2, delay: R * 0.19 });
      magIn(R * 0.46);
      noise({ ms: 120, gain: 0.25, type: 'bandpass', from: 1200, to: 2700, q: 2, delay: R * 0.7 });
      click(R * 0.76, 2500, 0.6);
      click(R * 0.8, 1600, 0.45);
      break;
  }
}

const synth = {
  /** The bullet landing on the other player (shooter hears it), with a hit-marker tick. */
  impact() {
    noise({ ms: 90, gain: 1.3, type: 'bandpass', from: 1100, to: 320, q: 1.4, delay: 45 });
    tone({ type: 'triangle', from: 420, to: 160, ms: 70, gain: 0.35, delay: 45 });
    tone({ type: 'sine', from: 190, to: 70, ms: 70, gain: 0.5, delay: 45 });
    tone({ type: 'triangle', from: 2400, to: 2300, ms: 45, gain: 0.22, delay: 35 });
  },
  /** The final hit: a heavier impact and a confirm tone. */
  kill() {
    noise({ ms: 160, gain: 0.95, type: 'lowpass', from: 1500, to: 140, delay: 45, reverb: 0.3 });
    tone({ type: 'triangle', from: 260, to: 80, ms: 200, gain: 0.5, delay: 45 });
    tone({ type: 'sine', from: 120, to: 40, ms: 240, gain: 0.8, delay: 45 });
    tone({ type: 'triangle', from: 880, ms: 110, gain: 0.2, delay: 170 });
    tone({ type: 'triangle', from: 1320, ms: 170, gain: 0.2, delay: 280 });
  },
  /** A miss whining off something. */
  ricochet() {
    if (!chain) return;
    const c = chain.ctx;
    const t = c.currentTime + 0.08;
    const osc = c.createOscillator(), lfo = c.createOscillator(), lfoGain = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(vary(3200), t);
    osc.frequency.exponentialRampToValueAtTime(vary(1100), t + 0.4);
    lfo.frequency.value = 38;
    lfoGain.gain.value = 120;
    lfo.connect(lfoGain).connect(osc.frequency);
    const g = envelope(c, t, 0.09, 20, t + 0.42);
    osc.connect(g);
    route(g, { reverb: 0.5 });
    osc.start(t);
    lfo.start(t);
    osc.stop(t + 0.45);
    lfo.stop(t + 0.45);
  },
  /** Trigger pulled on an empty magazine. */
  empty() {
    click(0, 2600, 0.7);
  },
  /** Getting hit (victim hears it). */
  hurt() {
    noise({ ms: 170, gain: 0.7, type: 'lowpass', from: 900, to: 160 });
    tone({ type: 'triangle', from: 230, to: 80, ms: 200, gain: 0.45 });
    tone({ type: 'sine', from: 110, to: 38, ms: 260, gain: 0.8 });
  },
  eliminated() {
    noise({ ms: 420, gain: 0.6, type: 'lowpass', from: 1000, to: 90, reverb: 0.6 });
    tone({ type: 'triangle', from: 220, to: 60, ms: 450, gain: 0.45 });
    tone({ type: 'sine', from: 110, to: 30, ms: 500, gain: 1 });
    tone({ type: 'sawtooth', from: 420, to: 70, ms: 800, gain: 0.1, delay: 120 });
  },
  respawn() {
    tone({ type: 'triangle', from: 300, to: 900, ms: 300, gain: 0.15 });
  },
  countdown() {
    tone({ type: 'sine', from: 880, ms: 120, gain: 0.14 });
  },
  go() {
    tone({ type: 'sine', from: 1320, ms: 300, gain: 0.16 });
  },
};

type SynthName = keyof typeof synth;
export type SoundName = SynthName | `gunshot:${GunId}` | `distantShot:${GunId}` | `reload:${GunId}`;
export const SOUND_NAMES: SoundName[] = [
  ...GUNS.flatMap((g) => [`gunshot:${g.id}`, `distantShot:${g.id}`, `reload:${g.id}`] as SoundName[]),
  ...(Object.keys(synth) as SynthName[]),
];

function perform(name: SoundName) {
  const [kind, id] = name.split(':') as [string, GunId];
  if (kind === 'gunshot') gunshot(id);
  else if (kind === 'distantShot') distantShot(id);
  else if (kind === 'reload') reload(id);
  else synth[name as SynthName]();
}

function play(name: SoundName) {
  if (!chain || !live) return;
  // Sounds asked for while audio is blocked would otherwise all play at once when it starts.
  // A context made a moment ago is still starting up, so those are kept.
  if (live.state !== 'running' && performance.now() - liveSince > 400) return;
  if (import.meta.env.DEV) soundLog.push(name);
  perform(name);
}

export const sfx = {
  impact: () => play('impact'),
  kill: () => play('kill'),
  empty: () => play('empty'),
  hurt: () => play('hurt'),
  eliminated: () => play('eliminated'),
  respawn: () => play('respawn'),
  countdown: () => play('countdown'),
  go: () => play('go'),
  shot: (id: GunId) => play(`gunshot:${id}`),
  distantShot: (id: GunId) => play(`distantShot:${id}`),
  reload: (id: GunId) => play(`reload:${id}`),
  /** Only some misses whine off something. */
  ricochet: () => {
    if (Math.random() < 0.35) play('ricochet');
  },
};

/** Starts audio if it isn't running. Browsers only allow that inside a tap or key press. */
export function unlockAudio() {
  try {
    if (!live) {
      // iOS 17+: play through the silent switch, like a video does.
      const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
      if (session) session.type = 'playback';
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      live = new AC({ latencyHint: 'interactive' });
      liveSince = performance.now();
      chain = buildChain(live, live.destination);
    }
    if (live.state !== 'running') {
      live.resume().catch(() => {});
      // Older iPhones only unlock once something actually plays inside the tap.
      const s = live.createBufferSource();
      s.buffer = live.createBuffer(1, 1, live.sampleRate);
      s.connect(live.destination);
      s.start();
    }
  } catch {
    live = null;
    chain = null;
  }
}

/**
 * Starts audio on the first tap or key press anywhere, and restarts it after the phone
 * paused it (a call, Siri, switching apps). Call once at startup.
 */
export function installAudioUnlock() {
  for (const type of ['pointerup', 'touchend', 'click', 'keydown']) {
    window.addEventListener(type, unlockAudio, { capture: true, passive: true });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && live && live.state !== 'running') live.resume().catch(() => {});
  });
}

/** 'none' until the first tap, then the audio context's state. */
export function audioState(): string {
  return live?.state ?? 'none';
}

/** Renders one sound without speakers, for the sound tests and previews. */
export async function renderSound(name: SoundName, seconds = 2.5, rate = 48000): Promise<AudioBuffer> {
  const id = name.split(':')[1] as GunId | undefined;
  if (id) await loadGunSounds([id]);
  const off = new OfflineAudioContext(2, Math.round(rate * seconds), rate);
  const saved = chain;
  chain = buildChain(off, off.destination);
  try {
    perform(name);
  } finally {
    chain = saved;
  }
  return off.startRendering();
}

/** Vibration on phones that allow it (Android). iPhone browsers do not. */
export function buzz(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not supported */
  }
}
