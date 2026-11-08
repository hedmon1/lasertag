// Renders every game sound offline in Chrome and checks it, then writes WAV files to listen to.
//
//   - nothing is silent or clips, even a whole magazine of automatic fire
//   - every gun plays its own recording, and its shot is loud on a phone speaker (simulated:
//     nothing below ~350 Hz); the other player's shot is clearly quieter but still heard
//   - each reload finishes inside that gun's reload time, ending on its last step
//   - two gunshots are never identical, and a gun whose recording fails to load still fires
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
// `windows` are [from, to] seconds to measure on the phone-speaker version.
async function measure([name, windows]) {
  const m = await import('/src/ui/sound.ts');
  const buf = await m.renderSound(name, 3.4);
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
    high350to750: db(rms(high, 0.35, 0.75)),
    phoneTail: db(rms(phone, 3.1, 3.4)),
    windows: (windows ?? []).map(([a, b]) => db(rms(phone, a, b))),
    rate,
    pcm: btoa(bin),
  };
}

/** Peaks of several renders: the same sound again and again, or a string of rounds. */
async function peaks(runs) {
  const m = await import('/src/ui/sound.ts');
  const out = [];
  for (const list of runs) {
    const b = await m.renderSounds(list, 2.5);
    let p = 0;
    for (let ch = 0; ch < b.numberOfChannels; ch++) for (const v of b.getChannelData(ch)) p = Math.max(p, Math.abs(v));
    out.push(p);
  }
  return out;
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
    const page = await testPage(ctx, `import * as m from '/src/ui/sound.ts'; import * as g from '/src/game/guns.ts'; window.names = m.SOUND_NAMES; window.guns = g.GUNS; window.m = m; window.ready = true;`);
    const names = await page.evaluate(() => window.names);
    const guns = await page.evaluate(() => window.guns);
    // Each reload's last step lands at 76 to 84% of the gun's reload time.
    const lastStep = (g) => [(g.reloadMs / 1000) * 0.74, (g.reloadMs / 1000) * 0.84];
    const res = {};
    for (const name of names) {
      const g = guns.find((x) => name === `reload:${x.id}`);
      const r = await page.evaluate(measure, [name, g ? [lastStep(g)] : []]);
      res[name] = r;
      writeFileSync(join(out, `${name.replace(':', '-')}.wav`), wav(r.pcm, r.rate));
      console.log(`  ${name.padEnd(22)} peak ${r.peak.toFixed(2)}  phone ${r.phoneDb.toFixed(1)} dB  length ${r.end.toFixed(2)} s`);
    }

    console.log('Checks');
    for (const name of names) {
      check(res[name].peak > 0.05, `${name} makes a sound`);
      check(res[name].peak <= 1.0001, `${name} does not clip (peak ${res[name].peak.toFixed(3)})`);
      check(res[name].phoneTail < -60, `${name} has finished by 3.1 s`);
    }
    const ready = await page.evaluate(async (ids) => {
      await window.m.loadGunSounds(ids);
      return ids.map((id) => window.m.gunSoundsReady(id));
    }, guns.map((g) => g.id));
    check(ready.every(Boolean), `every gun's recording loads (${guns.map((g, i) => `${g.id} ${ready[i] ? 'yes' : 'no'}`).join(', ')})`);
    for (const g of guns) {
      const shot = res[`gunshot:${g.id}`], far = res[`distantShot:${g.id}`], rl = res[`reload:${g.id}`];
      check(shot.phoneDb >= -10, `${g.name}: loud on a phone speaker (${shot.phoneDb.toFixed(1)} dB)`);
      check(shot.phoneDb - far.phoneDb >= 5, `${g.name}: the other player hears it clearly quieter (${(shot.phoneDb - far.phoneDb).toFixed(1)} dB less)`);
      check(far.phoneDb >= -24, `${g.name}: the other player still hears it (${far.phoneDb.toFixed(1)} dB)`);
      check(rl.end <= g.reloadMs / 1000, `${g.name}: the reload finishes within ${(g.reloadMs / 1000).toFixed(1)} s (${rl.end.toFixed(2)} s)`);
      check(rl.windows[0] > -40, `${g.name}: the reload ends on its last step as the gun comes back up (${rl.windows[0].toFixed(1)} dB)`);
    }
    check(res['gunshot:blip'].high350to750 > -50, `the pistol's casing pings after the shot (${res['gunshot:blip'].high350to750.toFixed(1)} dB above 3 kHz)`);
    const again = await page.evaluate(measure, ['gunshot:blip', []]);
    check(again.pcm !== res['gunshot:blip'].pcm, 'two gunshots are not identical');
    // Every shot is randomised, so one render can pass by luck: check runs of them, and a
    // whole string of automatic fire and a burst, where the shots pile up on each other.
    const runs = [
      ...guns.flatMap((g) => Array.from({ length: 6 }, () => [[`gunshot:${g.id}`, 0]])),
      Array.from({ length: 18 }, (_, i) => ['gunshot:stinger', i * 110]),
      Array.from({ length: 3 }, (_, i) => ['gunshot:triplet', i * 90]),
    ];
    const p = await page.evaluate(peaks, runs);
    check(Math.max(...p.slice(0, -2)) <= 1.0001, `36 single shots from all six guns never clip (highest peak ${Math.max(...p.slice(0, -2)).toFixed(3)})`);
    check(p.at(-2) <= 1.0001, `18 rounds of automatic fire never clip (peak ${p.at(-2).toFixed(3)})`);
    check(p.at(-1) <= 1.0001, `a three-round burst never clips (peak ${p.at(-1).toFixed(3)})`);
    await ctx.close();

    // No recordings (offline, or a file that failed): the synthesized shot stands in.
    const noFiles = await browser.newContext();
    await noFiles.route(/\/sounds\/guns\//, (r) => r.fulfill({ status: 404, body: '' }));
    const page3 = await testPage(noFiles, `import * as m from '/src/ui/sound.ts'; window.m = m; window.ready = true;`);
    const fallback = await page3.evaluate(measure, ['gunshot:boomstick', []]);
    const loaded = await page3.evaluate(() => window.m.gunSoundsReady('boomstick'));
    check(!loaded && fallback.phoneDb >= -10 && fallback.peak <= 1.0001, `a gun whose recording fails to load still fires a loud shot (${fallback.phoneDb.toFixed(1)} dB)`);
    await noFiles.close();

    console.log('Starting audio');
    const touch = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 800 } });
    const tap = await testPage(touch, `import * as m from '/src/ui/sound.ts'; m.installAudioUnlock(); window.m = m; window.ready = true;`);
    check((await tap.evaluate(() => window.m.audioState())) === 'none', 'no audio before the first tap');
    await tap.touchscreen.tap(195, 400);
    await tap.waitForFunction(() => window.m.audioState() === 'running', null, { timeout: 2000 }).catch(() => {});
    check((await tap.evaluate(() => window.m.audioState())) === 'running', 'a tap anywhere starts audio');
    await tap.evaluate(() => window.m.sfx.shot('blip'));
    check((await tap.evaluate(() => window.__ltSounds.slice())).includes('gunshot:blip'), 'a gunshot plays after the tap');
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
       setTimeout(() => { m.sfx.shot('blip'); m.sfx.shot('blip'); window.state = m.audioState(); window.ready = true; }, 700);`,
    );
    const st = await page2.evaluate(() => ({ state: window.state, log: window.__ltSounds.slice() }));
    check(st.state === 'suspended' && st.log.length === 0, `shots fired while audio is blocked are dropped (${st.state}, ${st.log.length} played)`);
    await page2.evaluate(async () => {
      window.allowAudio = true;
      window.m.unlockAudio();
      for (let i = 0; i < 50 && window.m.audioState() !== 'running'; i++) await new Promise((r) => setTimeout(r, 20));
      window.m.sfx.shot('blip');
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
