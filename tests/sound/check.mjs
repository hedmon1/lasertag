// Renders every game sound offline in Chrome and checks it, then writes WAV files to listen to.
//
//   - nothing is silent or clips
//   - the gunshot is loud on a phone speaker (simulated: nothing below ~350 Hz), the other
//     player's shot is clearly quieter, the casing pings and reload steps are there
//   - two gunshots are never identical
//   - audio starts on the first tap anywhere, and sounds asked for while audio is blocked
//     are dropped instead of all playing at once later
//
// Run with `npm run test:sounds`. WAVs go to tests/sound/out.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const out = join(here, 'out');
mkdirSync(out, { recursive: true });
const PORT = 4636;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let failures = 0;
function check(cond, msg) {
  if (cond) console.log(`  ok  ${msg}`);
  else {
    failures++;
    console.log(`  FAIL ${msg}`);
  }
}

async function startVite() {
  const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
    cwd: root,
    env: { ...process.env, LT_HTTP: '1', LT_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  vite.stdout.on('data', (d) => (log += d));
  vite.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${BASE}/src/ui/sound.ts`)).ok) return vite;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  vite.kill();
  throw new Error(`Vite did not start:\n${log}`);
}

/** Serves a blank page on the dev server's origin that runs `script` as a module. */
async function testPage(context, script) {
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`  [page error] ${e.message}`));
  await page.route(`${BASE}/__sound-test`, (r) =>
    r.fulfill({ contentType: 'text/html', body: `<!doctype html><body style="height:100vh"><script type="module">${script}</script></body>` }),
  );
  await page.goto(`${BASE}/__sound-test`);
  await page.waitForFunction(() => window.ready === true);
  return page;
}

// Runs in the page: renders a sound, then measures it as is and through a phone speaker.
async function measure(name) {
  const m = await import('/src/ui/sound.ts');
  const buf = await m.renderSound(name);
  const filtered = async (hz) => {
    const off = new OfflineAudioContext(buf.numberOfChannels, buf.length, buf.sampleRate);
    const src = off.createBufferSource();
    src.buffer = buf;
    let node = src;
    for (let i = 0; i < 2; i++) {
      const f = off.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = hz;
      node.connect(f);
      node = f;
    }
    node.connect(off.destination);
    src.start();
    return off.startRendering();
  };
  const rate = buf.sampleRate;
  const db = (x) => (x > 0 ? 20 * Math.log10(x) : -200);
  const rms = (b, from, to) => {
    let sum = 0, n = 0;
    for (let ch = 0; ch < b.numberOfChannels; ch++) {
      const d = b.getChannelData(ch);
      for (let i = Math.floor(from * rate); i < Math.min(d.length, Math.floor(to * rate)); i++, n++) sum += d[i] * d[i];
    }
    return n ? Math.sqrt(sum / n) : 0;
  };
  const loudest = (b) => {
    let best = 0;
    for (let t = 0; t + 0.05 <= b.duration; t += 0.01) best = Math.max(best, rms(b, t, t + 0.05));
    return db(best);
  };
  let peak = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) for (const v of buf.getChannelData(ch)) peak = Math.max(peak, Math.abs(v));
  let end = 0;
  for (let t = 0; t + 0.01 <= buf.duration; t += 0.01) if (db(rms(buf, t, t + 0.01)) > -50) end = t + 0.01;
  const phone = await filtered(350);
  const high = await filtered(3000);
  const pcm = new Int16Array(buf.length * 2);
  const l = buf.getChannelData(0), r = buf.getChannelData(1);
  for (let i = 0; i < buf.length; i++) {
    pcm[2 * i] = Math.max(-1, Math.min(1, l[i])) * 32767;
    pcm[2 * i + 1] = Math.max(-1, Math.min(1, r[i])) * 32767;
  }
  let bin = '';
  const bytes = new Uint8Array(pcm.buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return {
    peak,
    end,
    phoneDb: loudest(phone),
    bands: {
      high350to750: db(rms(high, 0.35, 0.75)),
      phone1400to1550: db(rms(phone, 1.4, 1.55)),
      phone600to720: db(rms(phone, 0.6, 0.72)),
      phoneTail: db(rms(phone, 2.2, 2.5)),
    },
    rate,
    pcm: btoa(bin),
  };
}

function wav(base64, rate) {
  const data = Buffer.from(base64, 'base64');
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(2, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 4, 28);
  h.writeUInt16LE(4, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

async function main() {
  const vite = await startVite();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--autoplay-policy=user-gesture-required'] });
  try {
    console.log('Rendering');
    const ctx = await browser.newContext();
    const page = await testPage(ctx, `import * as m from '/src/ui/sound.ts'; window.names = m.SOUND_NAMES; window.ready = true;`);
    const names = await page.evaluate(() => window.names);
    const res = {};
    for (const name of names) {
      const r = await page.evaluate(measure, name);
      res[name] = r;
      writeFileSync(join(out, `${name}.wav`), wav(r.pcm, r.rate));
      console.log(`  ${name.padEnd(12)} peak ${r.peak.toFixed(2)}  phone ${r.phoneDb.toFixed(1)} dB  length ${r.end.toFixed(2)} s`);
    }

    console.log('Checks');
    for (const name of names) {
      check(res[name].peak > 0.05, `${name} makes a sound`);
      check(res[name].peak <= 1.0001, `${name} does not clip (peak ${res[name].peak.toFixed(3)})`);
      check(res[name].bands.phoneTail < -60, `${name} has finished by 2.2 s`);
    }
    const shot = res.gunshot, far = res.distantShot;
    check(shot.phoneDb >= -10, `gunshot is loud on a phone speaker (${shot.phoneDb.toFixed(1)} dB)`);
    check(shot.phoneDb - far.phoneDb >= 5, `the other player's shot is clearly quieter (${(shot.phoneDb - far.phoneDb).toFixed(1)} dB less)`);
    check(far.phoneDb >= -24, `the other player's shot is still audible (${far.phoneDb.toFixed(1)} dB)`);
    check(shot.bands.high350to750 > -50, `the shell casing pings after the shot (${shot.bands.high350to750.toFixed(1)} dB above 3 kHz)`);
    check(res.reload.bands.phone1400to1550 > -40, 'the reload ends with the slide snapping forward');
    check(res.reload.bands.phone600to720 > -40, 'the reload has the magazine going in');
    check(res.reload.end <= 1.8, `the reload finishes within the 1.8 s reload (${res.reload.end.toFixed(2)} s)`);
    const again = await page.evaluate(measure, 'gunshot');
    check(again.pcm !== shot.pcm, 'two gunshots are not identical');
    // Every shot is randomised, so one render can pass by luck: check a run of them.
    const peaks = await page.evaluate(async () => {
      const m = await import('/src/ui/sound.ts');
      const out = [];
      for (let i = 0; i < 20; i++) {
        const b = await m.renderSound('gunshot', 1.2);
        let p = 0;
        for (let ch = 0; ch < b.numberOfChannels; ch++) for (const v of b.getChannelData(ch)) p = Math.max(p, Math.abs(v));
        out.push(p);
      }
      return out;
    });
    check(Math.max(...peaks) <= 1.0001, `20 gunshots in a row never clip (highest peak ${Math.max(...peaks).toFixed(3)})`);
    await ctx.close();

    console.log('Starting audio');
    const touch = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 800 } });
    const tap = await testPage(touch, `import * as m from '/src/ui/sound.ts'; m.installAudioUnlock(); window.m = m; window.ready = true;`);
    check((await tap.evaluate(() => window.m.audioState())) === 'none', 'no audio before the first tap');
    await tap.touchscreen.tap(195, 400);
    await tap.waitForFunction(() => window.m.audioState() === 'running', null, { timeout: 2000 }).catch(() => {});
    check((await tap.evaluate(() => window.m.audioState())) === 'running', 'a tap anywhere starts audio');
    await tap.evaluate(() => window.m.sfx.gunshot());
    check((await tap.evaluate(() => window.__ltSounds.slice())).includes('gunshot'), 'a gunshot plays after the tap');
    await touch.close();

    // A phone that blocks audio (no tap yet, or a call in progress): shots fired meanwhile must
    // be dropped, not saved up to all play at once when audio starts.
    const blocked = await browser.newContext();
    const page2 = await testPage(
      blocked,
      `const Real = window.AudioContext;
       window.AudioContext = class extends Real {
         constructor(o) { super(o); this.suspend(); }
         resume() { return window.allowAudio ? super.resume() : Promise.resolve(); }
       };
       const m = await import('/src/ui/sound.ts');
       window.m = m;
       m.unlockAudio();
       setTimeout(() => { m.sfx.gunshot(); m.sfx.gunshot(); window.state = m.audioState(); window.ready = true; }, 700);`,
    );
    const st = await page2.evaluate(() => ({ state: window.state, log: window.__ltSounds.slice() }));
    check(st.state === 'suspended' && st.log.length === 0, `shots fired while audio is blocked are dropped (${st.state}, ${st.log.length} played)`);
    await page2.evaluate(async () => {
      window.allowAudio = true;
      window.m.unlockAudio();
      for (let i = 0; i < 50 && window.m.audioState() !== 'running'; i++) await new Promise((r) => setTimeout(r, 20));
      window.m.sfx.gunshot();
    });
    check((await page2.evaluate(() => window.__ltSounds.length)) === 1, 'once audio starts again, the next shot plays');
    await blocked.close();
  } finally {
    await browser.close();
    vite.kill();
  }
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll sound checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
