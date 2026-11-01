# Laser Tag

Two-player laser tag played with phones. Your phone camera is the blaster: put the crosshair on the other player and press Fire. An AI running on the phone checks that the crosshair is actually on a person. It runs as a web link, so there's nothing to install, and it works on iPhone and Android.

## How a shot is decided

1. **The AI watches the camera continuously.** Google's MediaPipe Object Detector (EfficientDet-Lite0, trained to find people) runs on the phone about 15 times a second and puts a box around every person in view.
2. **The crosshair locks on** (turns red and shows the other player's name) whenever it's inside a person's box.
3. **Fire:** the shot is a hit if a person was under the crosshair at any moment from 150 ms before the press to 120 ms after it. This lag forgiveness means a fast trigger finger on a moving target still counts.
4. **Two players, so no identification is needed:** whoever is under your crosshair is your opponent. The hit is sent to their phone.

Details that make it reliable:

- **The center is checked closely.** Each frame the AI alternates between the middle half of the image (enlarged, so far players look twice as big) and the full width (close players who fill the view). Only people under the crosshair matter, so nothing else needs checking.
- **Not the whole box counts.** A person's box includes air beside their arms, so only the middle 80% of its width counts as a hit. Head to feet all counts.
- **A slow phone can't cost a hit.** The frames from before the press are kept, and the press frame itself is checked straight away.

**Who shot them and how:** the victim sees *"Hit by Ann. 6 m"*. The distance is estimated from how tall they looked, assuming a standing 1.7 m adult. When eliminated, they see a **kill cam** photo from the shooter's camera at the moment of the shot.

**Server rules:** the database (`database.rules.json`) accepts a hit only if the game is live, both players are alive, the shooter isn't the target, the damage is exactly 25, the cooldown has passed and spawn protection is over. A hit is one atomic write, so it can never apply twice.

## Sounds

All synthesized in the browser, no audio files. Phone speakers can't play bass, so every sound carries its weight in the midrange, and a soft clipper makes them loud without harsh distortion. It never goes past full scale, so even the loudest gunshot can't clip. On a simulated phone speaker the gunshot is about 17 dB louder than in the first version, and the hit sounds about 19 dB louder.

- **Your gunshot:** a sharp crack, a blast falling from bright to dark, a midrange punch, the slide cycling, a room reverb and an outdoor echo, then the shell casing bouncing on the ground. Each shot is slightly different.
- **The other player's shots:** you hear every shot they fire, quieter and duller, as if from across the field.
- **Hits:** a bullet impact and a hit-marker tick on a hit, a heavier impact and confirm tone on a kill, and sometimes a ricochet on a miss.
- **Gun handling:** a dry click on empty, and a reload in three parts (magazine out, magazine in, slide racked).
- **Getting hit:** a thud for a hit and a heavier one when eliminated. Android phones also vibrate.
- **iPhone:** sounds play even with the silent switch on (iOS 17 and later), which also pauses music from other apps while you play. Audio starts on your first tap anywhere in the app.

## The look

Retro arcade, after [stakeupapp.com](https://stakeupapp.com/): pixel type (Press Start 2P for labels and buttons, VT323 for text), deep navy-purple with flat lime, cyan, yellow and magenta, thick black outlines with hard offset shadows, and CRT scanlines over every screen, the camera view included. Menu screens add the starfield and the moving grid floor. The fonts are bundled with the app, so they also work offline on `npm run phones`.

## The gun

A small pixel-art pistol sits in the lower right of the camera view. Each shot kicks it back, cycles the slide, flashes the muzzle, ejects a casing and sends a tracer into the crosshair. A reload dips it, swaps the magazine and racks the slide, in time with the reload sound.

## Play it

```bash
npm install
```

### On phones (same Wi-Fi as this Mac)

```bash
npm run phones
```

Then on both phones open `https://<this Mac's Wi-Fi address>:4630` (for example `https://10.0.0.139:4630`). The page uses a self-signed certificate, so the browser warns the first time:

- **iPhone (Safari):** tap Show Details, then visit this website.
- **Android (Chrome):** tap Advanced, then Proceed.

Everything runs on this Mac: the game server is the Firebase emulator, so no internet is needed. It must be https because phones only allow the camera on secure pages.

### On a laptop

```bash
npm run laptop
```

Then open `http://localhost:4634`. Press the space bar to fire.

### Over the internet

The game is hosted at **https://phone-laser-tag-vyck.web.app** (Firebase project `phone-laser-tag-vyck`). It has a real certificate, so there are no warnings, on any network. After changing code, update it with:

```bash
npm run deploy
```

`npm run deploy` builds with `.env.production.local` (the project's web config) and deploys the site, the database rules and the sign-in settings. Local play never reads that file, so it always stays on the emulators.

The free plan allows 100 players connected at once and about 360 MB of site downloads a day. The AI runtime (14 MB) and model (7 MB) load from the jsDelivr CDN and Google's model storage, not from Firebase Hosting, so each new player uses Hosting for only about 0.7 MB.

## How to play

1. One player creates a game. The other joins with its 4-letter code (or the shared link). A third person is turned away.
2. The host sets the game length, kill limit and respawn time, then starts.
3. After a 5-second countdown, put the crosshair on the other player and fire. Four hits eliminate them for a few seconds, then they come back with 2 s of protection.
4. First to the kill limit wins, or most kills when time runs out. Play again keeps the same two players.

Weapon: 12 shots, 1.8 s reload, at most one shot every 350 ms. **Scope** (hold): real 2x camera zoom on Android Chrome, a magnified view on iPhone (Safari doesn't let web pages zoom the camera).

**Play where only the two of you are in view.** The AI finds people, not specific people, so anyone under the crosshair counts as a hit on your opponent.

## Tools

- **Practice:** no server. Aim at a friend and fire. It logs every hit or miss, how sure the AI was, and the distance. "Show boxes" draws what the AI sees: the dashed box is the person, the solid box is the part that counts.
- **Range test:** have a friend walk away from you and watch where the AI stops seeing them. Shows the camera resolution, checks per second and the time per check. You can switch between 1080p and 4K.

## Tests

```bash
npm run typecheck
npm test            # 19 unit tests: hit area, lag window, distance, crosshair lock, health rules, scoreboard
npm run test:rules  # 39 database rules tests on the emulator, with two separate signed-in players
npm run test:e2e    # two Chrome browsers with fake cameras play a full game on the emulators
npm run test:sounds # renders every sound and checks it (no emulators needed)
```

`test:sounds` renders each sound offline in Chrome and checks that nothing is silent or clips (including a run of 20 randomised gunshots), that the gunshot is loud through a simulated phone speaker (nothing below about 350 Hz), that the other player's shot is clearly quieter, and that the casing and reload steps are there. It also checks that the first tap starts audio, and that shots fired while audio is blocked are dropped rather than all playing at once later. It writes a WAV of every sound to `tests/sound/out` so you can listen.

The E2E test runs a dev build with `?testdetector=1`, which swaps the AI for a stand-in that treats a magenta rectangle as a person. This test switch only exists in dev builds. Ann's fake camera films the rectangle and Bob's films an empty room.

It checks a full game. A third player is turned away, Ann's crosshair locks on and Bob's doesn't, and Bob's shot at an empty room misses. Ann's gun recoils and fires a tracer, and each phone plays the right sounds: its own shots, the other player's shots, the hits, the kill and the elimination. Ann's four hits drop Bob's health step by step, Bob sees "Hit by Ann" and then the kill cam, and he can't be hit while down. After that: respawn, spawn protection, a correct scoreboard, and Play again.

The real AI model was checked separately in Chrome. It loads, runs on the GPU at about 15 checks a second, and finds no one in an empty room. Whether it reliably finds real players can only be checked with real people (see below).

The rules and E2E tests need Java (`brew install openjdk`). If `npm run phones` is already using the emulator ports, run the tests with `VITE_EMU_DB_PORT` / `VITE_EMU_AUTH_PORT` and a config on other ports.

## Playtest checklist (real phones)

1. **Practice, close:** a friend stands 3 m away. Fire at their chest, head, legs, and just beside them. Turn on Show boxes to see what counts.
2. **Range test:** the friend walks away slowly. Note where the AI stops boxing them, at 1080p and at 4K, indoors and outdoors.
3. **Hard poses:** sideways, crouching, running, arms up, partly behind a tree or a doorway.
4. **Light:** dim rooms and backlit (sun behind the player) are where person detectors struggle most.
5. **Two-player game:** a full round. Check that hits feel instant, the "Hit by" message is right, and the kill cam shows the moment.
6. **Sound:** shots should be loud on the phone speaker, also with the iPhone silent switch on, and you should hear the other player's shots.

If moving shots miss too often, widen the lag window in `src/game/constants.ts`. If shots beside people count, lower `HIT_WIDTH` in `src/game/personHit.ts`.

## Layout

```
src/
  detect/people.ts          person detector: MediaPipe Object Detector loader (and the E2E stand-in)
  detect/peoplePipeline.ts  camera frames to the detector: center and full passes, results kept 0.7 s
  game/personHit.ts         hit area, lag window, distance, crosshair lock (pure, unit tested)
  game/fire.ts              one Fire press: kill cam grab, press-frame check, lag window
  game/rules.ts             health, respawn and protection (mirrored by database.rules.json)
  net/game.ts               every database write the game makes
  ui/sound.ts               synthesized gunshots, impacts, reload; starts audio on the first tap
  ui/Gun.tsx                the on-screen pixel pistol: recoil, muzzle flash, casing, tracer, reload
  ui/theme.css              the arcade look: colours, pixel fonts, panels, HUD, CRT scanlines
  screens/                  Home, Lobby, Live, Scoreboard, Practice, RangeTest
tests/unit  tests/rules  tests/e2e  tests/sound
```

The earlier version that identified players by printed codes is saved in `../laser-tag-codes-version.zip`.

## Known limits

- Anyone in view counts as a person. Play in a space with just the two of you.
- The detector finds people in normal poses and light. Very dark scenes, heavy backlight, or someone mostly hidden can be missed.
- Distance is an estimate based on a standing adult's height. Crouching players read as farther away.
- iPhone browsers don't allow vibration or camera zoom.
- On iPhones older than iOS 17, the silent switch mutes the game. Flip it off to hear the shots.
- First visit downloads about 21 MB of AI (runtime and model), cached after that. The lobby starts loading it early.
- If the host leaves mid-game, the game still ends on time, but only the host can start another round.
# lasertag
