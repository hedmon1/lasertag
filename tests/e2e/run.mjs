// End-to-end two-player game on the emulators with real Chrome browsers and fake cameras.
//
//   Ann hosts. Her camera films a person (a magenta stand-in; see make-video.mjs).
//   Bob joins, and picks the shotgun in the Armory. His camera films an empty room. A third
//   player is turned away.
//   Bob fires and misses. Ann fires her pistol four times: Bob sees each hit, then the
//   elimination screen with a kill cam, then respawns. Ann ends the game and both see the
//   scoreboard. In a second round Ann takes the SMG and holds Fire until Bob is out.
//
// Run with `npm run test:e2e` (starts the Auth and Database emulators around this script).
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { makeVideo } from './make-video.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const out = join(here, 'out');
mkdirSync(out, { recursive: true });
const PORT = 4632;
const BASE = `http://127.0.0.1:${PORT}`;
// Dev builds only: treat the magenta stand-in as a person.
const APP = `${BASE}/?testdetector=1`;
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let failures = 0;
const step = (msg) => console.log(`  - ${msg}`);
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
      if ((await fetch(BASE)).ok) return vite;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  vite.kill();
  throw new Error(`Vite did not start:\n${log}`);
}

async function player(name, videoFile) {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${videoFile}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const context = await browser.newContext({ viewport: { width: 420, height: 860 }, permissions: ['camera'] });
  await context.addInitScript(() => localStorage.setItem('lt.quality', '1080p'));
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`  [${name} page error] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/mediapipe|pose_landmarker|wasm/i.test(m.text()) && console.log(`  [${name} console] ${m.text()}`));
  return { browser, context, page };
}

/** From the lobby: Change gun, pick `name` in the Armory, equip it and come back. */
async function pickGun(page, name) {
  await page.getByRole('button', { name: 'Change gun' }).click();
  await page.waitForURL(/#\/armory/, { timeout: 8000 });
  await page.getByRole('button', { name: new RegExp(`^${name} `) }).click();
  await page.getByRole('button', { name: 'Equip', exact: true }).click();
  await page.getByRole('button', { name: 'Equipped', exact: true }).waitFor({ timeout: 3000 });
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByText('Lobby').waitFor({ timeout: 8000 });
}

async function main() {
  const annVideo = makeVideo('person', join(here, 'fixtures', 'person.y4m')); // Bob in view
  const bobVideo = makeVideo('empty', join(here, 'fixtures', 'empty.y4m')); // nobody in view
  const vite = await startVite();
  const ann = await player('Ann', annVideo);
  const bob = await player('Bob', bobVideo);
  const A = ann.page, B = bob.page;
  try {
    console.log('Lobby');
    await A.goto(`${APP}#/`);
    await A.getByLabel('Your name').fill('Ann');
    await A.getByRole('button', { name: 'Create game' }).click();
    await A.waitForURL(/#\/g\/[A-Z]{4}$/, { timeout: 15000 });
    const code = A.url().split('/').pop();
    step(`Ann created game ${code}`);
    check(await A.getByRole('button', { name: 'Start game' }).isDisabled(), 'Start waits for a second player');
    await A.getByRole('group', { name: 'Respawn time' }).getByRole('button', { name: '5 s' }).click();

    await B.goto(`${APP}#/`);
    await B.getByLabel('Your name').fill('Bob');
    await B.getByLabel('Game code').fill(code);
    await B.getByRole('button', { name: 'Join', exact: true }).click();
    await B.waitForURL(new RegExp(`#/g/${code}$`), { timeout: 15000 });
    await A.getByText('Bob').waitFor({ timeout: 10000 });
    step('Bob joined');

    const C = await bob.context.browser().newContext().then((c) => c.newPage());
    await C.goto(`${APP}#/`);
    await C.getByLabel('Your name').fill('Cat');
    await C.getByLabel('Game code').fill(code);
    await C.getByRole('button', { name: 'Join', exact: true }).click();
    const full = await C.getByText('This game already has 2 players.').waitFor({ timeout: 10000 }).then(() => true, () => false);
    check(full, 'A third player is turned away');
    await C.close();

    await pickGun(B, 'Boomstick');
    await A.locator('.gun-tag').filter({ hasText: 'Boomstick' }).waitFor({ timeout: 8000 });
    check(true, 'Bob picks the shotgun in the Armory, and Ann sees it next to his name');
    check((await B.evaluate(() => localStorage.getItem('lt.gun'))) === 'boomstick', 'Bob\'s phone remembers his gun');
    await A.screenshot({ path: join(out, 'lobby.png') });

    const startBtn = A.getByRole('button', { name: 'Start game' });
    await A.waitForFunction(() => !document.querySelector('button.btn-primary:disabled'), null, { timeout: 10000 });
    await startBtn.click();
    step('Ann started the game');

    console.log('Countdown and camera');
    await A.getByText('Get in position').waitFor({ timeout: 10000 });
    await A.getByText('Get in position').waitFor({ state: 'detached', timeout: 12000 });
    await B.getByText('Get in position').waitFor({ state: 'detached', timeout: 12000 });
    // Ann's crosshair locks on once the detector sees a person under it.
    await A.locator('.aim-name').filter({ hasText: 'Bob' }).waitFor({ timeout: 10000 });
    check(true, "Ann's crosshair locks on and names Bob");
    check(!(await B.locator('.aim-name').isVisible()), "Bob's crosshair stays unlocked (nobody in his view)");
    await A.screenshot({ path: join(out, 'ann-aiming.png') });

    console.log('Shooting');
    await B.getByTestId('fire').dispatchEvent('pointerdown');
    await B.waitForTimeout(900);
    check((await A.locator('.hp').innerText()).includes('100'), "Bob's shot at an empty room misses (Ann still 100 HP)");
    check((await B.locator('.toast, .hitmarker').count()) === 0, 'A miss shows nothing: no popup, no hit marker');
    check((await B.evaluate(() => window.__ltSounds)).includes('gunshot:boomstick'), 'Bob hears his own shotgun');
    check((await B.locator('[data-testid="gun"]').getAttribute('data-gun')) === 'boomstick', 'Bob holds the shotgun on screen');
    await A.waitForFunction(() => window.__ltSounds.includes('distantShot:boomstick'), null, { timeout: 5000 }).then(
      () => check(true, "Ann hears Bob's shotgun from across the field"),
      () => check(false, "Ann hears Bob's shotgun from across the field"),
    );
    const fireBtn = A.getByTestId('fire');
    let annSawKill = null;
    for (let i = 1; i <= 4; i++) {
      await fireBtn.dispatchEvent('pointerdown');
      if (i === 1) {
        const [kick, tracer] = await Promise.all([
          A.locator('.gun-body.kick').waitFor({ timeout: 450 }).then(() => true, () => false),
          A.locator('line.tracer').waitFor({ timeout: 450 }).then(() => true, () => false),
        ]);
        check(kick && tracer, "Ann's gun recoils and fires a tracer into the crosshair");
        await A.screenshot({ path: join(out, 'ann-firing.png') });
      }
      if (i === 4) annSawKill = A.locator('.hitmarker[data-kill="true"]').waitFor({ state: 'attached', timeout: 5000 }).then(() => true, () => false);
      if (i < 4) {
        const hp = 100 - 25 * i;
        await B.locator('.hp').filter({ hasText: String(hp) }).waitFor({ timeout: 8000 });
        check(true, `Bob is at ${hp} HP after hit ${i}`);
        if (i === 1) {
          const hurt = await B.getByText(/Hit by Ann/).textContent({ timeout: 5000 });
          check(/Hit by Ann's Blip(\. \d+ m)?$/.test(hurt ?? ''), `Bob is told who hit him and with what: "${hurt}"`);
          const marker = await A.locator('.hitmarker').getAttribute('data-kill');
          check(marker === 'false' && (await A.locator('.toast').count()) === 0, 'Ann sees only a hit marker, no popup');
        }
      }
      await A.waitForTimeout(600); // past the pistol's 350 ms between shots
    }
    await B.getByTestId('eliminated').waitFor({ timeout: 8000 });
    const elim = await B.getByTestId('eliminated').textContent();
    check(/Eliminated by Ann/.test(elim ?? '') && /Blip/.test(elim ?? ''), 'Bob sees "Eliminated by Ann" and the gun');
    const cam = B.locator('img.killcam');
    await cam.waitFor({ timeout: 8000 });
    const src = await cam.getAttribute('src');
    check(src?.startsWith('data:image/jpeg;base64,') && src.length > 2000, `Bob sees the kill cam (${src?.length} chars)`);
    await B.screenshot({ path: join(out, 'bob-eliminated.png') });
    check(await annSawKill, "Ann's hit marker turns red for the kill");
    const count = (log, name) => log.filter((x) => x === name).length;
    const annSounds = await A.evaluate(() => window.__ltSounds.slice());
    const bobSounds = await B.evaluate(() => window.__ltSounds.slice());
    check(
      count(annSounds, 'go') === 1 && count(annSounds, 'gunshot:blip') === 4 && count(annSounds, 'impact') === 4 && count(annSounds, 'kill') === 1,
      `Ann hears the start, 4 gunshots, 4 impacts and the kill (${annSounds.join(' ')})`,
    );
    check(
      count(bobSounds, 'distantShot:blip') === 4 && count(bobSounds, 'hurt') === 3 && count(bobSounds, 'eliminated') === 1,
      `Bob hears Ann's 4 shots, 3 hits and his elimination (${bobSounds.join(' ')})`,
    );

    // Shooting a downed player is not counted, so it gets no hit marker (no impact sound).
    await fireBtn.dispatchEvent('pointerdown');
    await A.waitForTimeout(1200);
    const afterDown = await A.evaluate(() => window.__ltSounds.slice());
    check(
      count(afterDown, 'gunshot:blip') === 5 && count(afterDown, 'impact') === 4 && (await B.getByTestId('eliminated').count()) === 1,
      'A downed player cannot be hit again (no hit marker)',
    );

    console.log('Respawn');
    await B.getByTestId('eliminated').waitFor({ state: 'detached', timeout: 12000 });
    await B.locator('.hp').filter({ hasText: '100' }).waitFor({ timeout: 5000 });
    check(true, 'Bob respawned at 100 HP');
    await A.waitForTimeout(800);
    await fireBtn.dispatchEvent('pointerdown');
    await A.waitForTimeout(1000);
    const afterSpawn = await A.evaluate(() => window.__ltSounds.slice());
    check(
      count(afterSpawn, 'gunshot:blip') === 6 && count(afterSpawn, 'impact') === 4 && (await B.locator('.hp').innerText()).includes('100'),
      'Spawn protection blocks an instant hit (no hit marker, Bob still 100 HP)',
    );

    console.log('End of game');
    await A.getByLabel('Menu').click();
    await A.getByRole('button', { name: 'End game' }).click();
    await A.getByTestId('scoreboard').waitFor({ timeout: 8000 });
    await B.getByTestId('scoreboard').waitFor({ timeout: 8000 });
    const heading = await A.locator('h1').textContent();
    check(heading === 'Ann wins', `Scoreboard heading: "${heading}"`);
    const annRow = await A.locator('table.score tbody tr').first().innerText();
    const cells = annRow.split('\t').map((s) => s.trim());
    check(cells[0].endsWith('Ann') && cells[1] === '1' && cells[2] === '0' && cells[3] === '4', `Ann: 1 kill, 0 deaths, 4 hits (${cells.join(' | ')})`);
    const bobRow = await B.locator('table.score tbody tr').nth(1).innerText();
    const bc = bobRow.split('\t').map((s) => s.trim());
    check(bc[0].endsWith('Bob') && bc[1] === '0' && bc[2] === '1' && bc[3] === '0' && bc[4] === '0%', `Bob: 0 kills, 1 death, 0 hits from 1 shot (${bc.join(' | ')})`);
    await A.screenshot({ path: join(out, 'scoreboard.png') });

    console.log('Play again');
    await A.getByRole('button', { name: 'Play again' }).click();
    await B.getByText('Lobby').waitFor({ timeout: 8000 });
    check(true, 'Both players are back in the lobby');

    console.log('Round two: the SMG');
    await pickGun(A, 'Stinger');
    await B.locator('.gun-tag').filter({ hasText: 'Stinger' }).waitFor({ timeout: 8000 });
    check(true, "Ann switches to the SMG between rounds, and Bob sees it");
    await A.waitForFunction(() => !document.querySelector('button.btn-primary:disabled'), null, { timeout: 10000 });
    await A.getByRole('button', { name: 'Start game' }).click();
    await A.getByText('Get in position').waitFor({ state: 'detached', timeout: 15000 });
    await A.locator('.aim-name').filter({ hasText: 'Bob' }).waitFor({ timeout: 10000 });
    const before = await A.evaluate(() => window.__ltSounds.length);
    const bobHeard = await B.evaluate(() => window.__ltSounds.length);
    // Hold Fire: the SMG keeps firing until Bob is out (8 hits of 13).
    await fireBtn.dispatchEvent('pointerdown');
    const out2 = await B.getByTestId('eliminated').waitFor({ timeout: 6000 }).then(() => true, () => false);
    await fireBtn.dispatchEvent('pointerup');
    check(out2, 'Holding Fire with the SMG takes Bob out');
    await A.waitForTimeout(600);
    const s2 = (await A.evaluate(() => window.__ltSounds.slice())).slice(before);
    const b2 = (await B.evaluate(() => window.__ltSounds.slice())).slice(bobHeard);
    check(count(s2, 'gunshot:stinger') >= 8 && count(s2, 'impact') === 8 && count(s2, 'kill') === 1, `Ann's SMG fires automatically: ${count(s2, 'gunshot:stinger')} rounds, 8 hits, 1 kill`);
    check(count(b2, 'hurt') === 7 && count(b2, 'eliminated') === 1 && count(b2, 'distantShot:stinger') >= 8, `Bob takes 7 hits, then the eighth puts him out, and hears the SMG (${count(b2, 'distantShot:stinger')} shots)`);
    check((await A.locator('.ammo').innerText()).match(/^(\d+) \/ 30$/) !== null, `The SMG holds 30 rounds (${await A.locator('.ammo').innerText()})`);
    await A.screenshot({ path: join(out, 'ann-smg.png') });
    await A.getByLabel('Menu').click();
    await A.getByRole('button', { name: 'End game' }).click();
    await A.getByTestId('scoreboard').waitFor({ timeout: 8000 });
    const row2 = (await A.locator('table.score tbody tr').first().innerText()).split('\t').map((x) => x.trim());
    check(row2[0].endsWith('Ann') && row2[1] === '1' && row2[3] === '8', `The database recorded 8 SMG hits and the kill (${row2.join(' | ')})`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${e.message}`);
    await A.screenshot({ path: join(out, 'fail-ann.png') }).catch(() => {});
    await B.screenshot({ path: join(out, 'fail-bob.png') }).catch(() => {});
  } finally {
    await ann.browser.close();
    await bob.browser.close();
    vite.kill();
  }
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll E2E checks passed');
  process.exit(failures ? 1 : 0);
}

main();
