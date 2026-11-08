# Laser Tag

Two-player laser tag played with phones. Your phone camera is the blaster: put the crosshair on the other player and press Fire. An AI running on the phone checks that the crosshair is actually on a person. It runs as a web link, so there's nothing to install, and it works on iPhone and Android.

## How a shot is decided

1. **The AI watches the camera continuously.** Google's MediaPipe Object Detector (EfficientDet-Lite0, trained to find people) runs on the phone about 15 times a second and puts a box around every person in view.
2. **The crosshair locks on** (turns red and shows the other player's name) whenever it's inside a person's box.
3. **Fire:** the shot is a hit if a person was under the crosshair at any moment from 150 ms before the press to 120 ms after it. This lag forgiveness means a fast trigger finger on a moving target still counts.
4. **Two players, so no identification is needed:** whoever is under your crosshair is your opponent. The hit is sent to their phone.

Details that make it reliable:

- **The center is checked closely.** Each frame the AI alternates between the middle half of the image (enlarged, so far players look twice as big) and the full width (close players who fill the view). Only people under the crosshair matter, so nothing else needs checking.
- **Not the whole box counts.** A person's box includes air beside their arms, so only the middle 80% of its width counts as a hit (wider for the shotgun's spread, narrower for the sniper). Head to feet all counts.
- **A slow phone can't cost a hit.** The frames from before the press are kept, and the press frame itself is checked straight away.

**Who shot them and how:** the victim sees *"Hit by Ann's Boomstick. 6 m"*. The distance is estimated from how tall they looked, assuming a standing 1.7 m adult. When eliminated, they see a **kill cam** photo from the shooter's camera at the moment of the shot.

**What the shooter sees:** a hit marker on a hit, red on the kill, and nothing else. A miss shows nothing on screen (sometimes a ricochet sound). A shot at a player who is down or just respawned doesn't count, so it gets no marker either.

**Server rules:** the database (`database.rules.json`) accepts a hit only if the game is live, both players are alive, the shooter isn't the target, the damage is exactly the shooter's gun damage, that gun's cooldown has passed and spawn protection is over. Each player's gun must match the table in `src/game/guns.ts` and can't change while a game is live. A hit is one atomic write, so it can never apply twice.

## The guns

Pick one in the **Armory** (on the home screen, in the lobby, and from Practice). It shows each gun in a display case with its stats, a Test fire button, and an Equip button. Your pick stays on your phone, the other player sees it next to your name in the lobby, and it locks when the game starts.

| Gun | Kind | Damage | Hits to eliminate | Firing | Magazine | Reload | Range | Scope |
|---|---|---|---|---|---|---|---|---|
| Blip | Pistol | 25 | 4 | one shot per pull, up to 2.9 a second | 12 | 1.8 s | any | 2x |
| Stinger | SMG | 13 | 8 | hold Fire for automatic, 9 a second | 30 | 2.1 s | 25 m | 1.5x |
| Triplet | Burst rifle | 20 | 5 | 3-round burst per pull | 24 | 2.3 s | any | 2.5x |
| Thumper | Revolver | 34 | 3 | one shot per pull | 6 | 2.6 s | any | 2x |
| Boomstick | Shotgun | 50 | 2 | one shot per pull, wide spread | 5 | 2.8 s | 12 m | 1.5x |
| Longshot | Sniper | 80 | 2 | one shot per pull, needs aim | 4 | 3.0 s | any | 3x |

Range uses the distance estimate, so a shotgun hit on someone 15 m away doesn't count. The database only sees hits, so each gun's time between hits there is a little shorter than its fire rate.

**In your hands:** each gun is a small 3D model built from boxes (`src/ui/gunShapes.ts`, projected by `src/ui/gunModel.ts`), in the same blocky style: shaded faces, ink outlines and glowing parts in the gun's colour. It is held in a gloved hand at the right edge of the screen, just above the Fire button, with the arm coming in from the bottom-right corner, so it points diagonally into the scene the way shooters show it. The barrel aims at the crosshair. Long guns are drawn a little further away and kept short, so no gun covers more than 8% of the screen above the Fire button (the pistol about 5%). Each shot kicks the gun back (harder for the shotgun and sniper), flashes the muzzle, sends a tracer into the crosshair (three pellets for the shotgun) and cycles its action: the slide, the SMG and rifle charging handles, the revolver hammer, the shotgun pump or the sniper bolt, which also throws out the casing. A reload dips the gun and brings it back up to work the action, timed to that gun's reload.

## Sounds

**Gunshots are real recordings**, from [The Free Firearm Sound Library](https://opengameart.org/content/the-free-firearm-sound-library) (CC0: free to use, no credit required, though we credit it here). Each gun uses a real gun recorded right next to the shooter, and the same gun recorded from further away for what the other player hears:

| Gun | Recording |
|---|---|
| Blip | Walther PPQ 9 mm pistol, 3 takes |
| Stinger | PPSh submachine gun, 5 takes |
| Triplet | AK-47 rifle, 4 takes |
| Thumper | Smith & Wesson 642 .38 revolver, 2 takes (played a little deeper) |
| Boomstick | Benelli Nova 12-gauge pump shotgun, 2 takes |
| Longshot | Mosin Nagant 7.62x54 bolt-action rifle, 4 takes |

`scripts/build-gun-sounds.mjs` cuts these out of the library into one small MP3 per gun in `public/sounds/guns` (65 to 113 KB each), from a single microphone (summing the library's two spaced mics smears the crack). Only your gun and your opponent's are downloaded. Every shot picks a different take from last time and plays it a little faster or slower, so even automatic fire never repeats. Takes are evened out in loudness when they load, then each gun has its own level (the shotgun is the loudest).

Everything else is synthesized in the browser. Phone speakers can't play bass, so every sound carries its weight in the midrange (the gunshots get a boost around 2.2 kHz), and a soft clipper makes them loud without harsh distortion. It never goes past full scale, so even a whole magazine of automatic fire can't clip.

- **Your gunshot:** the recording with a room reverb and an outdoor echo, then the action: the slide cycling, the revolver hammer, the shotgun pump racked, or the sniper bolt worked. Then the casing bouncing on the ground (a plastic hull for the shotgun; a revolver keeps its brass). If a recording hasn't loaded, a synthesized shot plays instead.
- **The other player's shots:** you hear every shot they fire with their gun, quieter and duller, as if from across the field.
- **Hits:** a bullet impact and a hit-marker tick on a hit, a heavier impact and confirm tone on a kill, and sometimes a ricochet on a miss.
- **Reloads,** timed to each gun: magazine out, in, and the slide or charging handle (pistol, SMG, rifle); cylinder out, empties dumped, six rounds in, cylinder shut and hammer back (revolver); four shells pushed in and the pump racked (shotgun); bolt open, magazine swap, bolt closed (sniper). A dry click on empty.
- **Getting hit:** a thud for a hit and a heavier one when eliminated. Android phones also vibrate.
- **iPhone:** sounds play even with the silent switch on (iOS 17 and later), which also pauses music from other apps while you play. Audio starts on your first tap anywhere in the app.

## The look

Retro arcade, after [stakeupapp.com](https://stakeupapp.com/): pixel type (Press Start 2P for labels and buttons, VT323 for text), deep navy-purple with flat lime, cyan, yellow and magenta, thick black outlines with hard offset shadows, and CRT scanlines on the menu screens and on every button. The camera view itself stays clean. Menu screens add the starfield and the moving grid floor, and the home screen is an arcade cabinet: chasing marquee lights, a screen running a demo match (1P sweeps the reticle onto 2P, fires, and knocks out a health block), a joystick deck and a scrolling ticker with the rules. The fonts are bundled with the app, so they also work offline on `npm run phones`.

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

The free plan allows 100 players connected at once and about 360 MB of site downloads a day. The AI runtime (14 MB) and model (7 MB) load from the jsDelivr CDN and Google's model storage, not from Firebase Hosting, so each new player uses Hosting for about 0.9 MB (the site plus two gun recordings).

## How to play

1. One player creates a game. The other joins with its 4-letter code (or the shared link). A third person is turned away.
2. The host sets the game length, kill limit and respawn time, then starts.
3. After a 5-second countdown, put the crosshair on the other player and fire. Enough hits for your gun (four with the pistol) eliminate them for a few seconds, then they come back with 2 s of protection.
4. First to the kill limit wins, or most kills when time runs out. Play again keeps the same two players.

Each player picks a gun in the Armory before the game (see The guns). **Scope** (hold): real camera zoom on Android Chrome, by the gun's scope factor; a magnified view on iPhone (Safari doesn't let web pages zoom the camera).

**Play where only the two of you are in view.** The AI finds people, not specific people, so anyone under the crosshair counts as a hit on your opponent.

## Tools

- **Practice:** no server. Aim at a friend and fire with your equipped gun (the gun button at the top opens the Armory). It logs every hit or miss, how sure the AI was, and the distance. "Boxes" draws what the AI sees: the dashed box is the person, the solid box is the part that counts.
- **Range test:** have a friend walk away from you and watch where the AI stops seeing them. Shows the camera resolution, checks per second and the time per check. You can switch between 1080p and 4K.

## Tests

```bash
npm run typecheck
npm test            # 76 unit tests: hit area, gun width and range, lag window, distance, crosshair lock, health rules, scoreboard, gun catalog, every gun's model
npm run test:rules  # 46 database rules tests on the emulator, with two separate signed-in players
npm run test:e2e    # two Chrome browsers with fake cameras play a full game on the emulators
npm run test:sounds # renders every sound and checks it (no emulators needed)
```

`test:sounds` renders each sound offline in Chrome and checks that nothing is silent or clips (including 36 randomised shots from all six guns, 18 rounds of automatic fire and a burst), that every gun's recording loads, that each gunshot is loud through a simulated phone speaker (nothing below about 350 Hz), that the other player's shot is clearly quieter but still heard, that each reload ends on its last step inside that gun's reload time, and that a gun whose recording fails to load still fires. It also checks that the first tap starts audio, and that shots fired while audio is blocked are dropped rather than all playing at once later. It writes a WAV of every sound to `tests/sound/out` so you can listen.

The E2E test runs a dev build with `?testdetector=1`, which swaps the AI for a stand-in that treats a magenta rectangle as a person. This test switch only exists in dev builds. Ann's fake camera films the rectangle and Bob's films an empty room.

It checks a full game. A third player is turned away, and Bob picks the shotgun in the Armory, which Ann then sees next to his name. Ann's crosshair locks on and Bob's doesn't, and Bob's shot at an empty room misses with nothing on screen, but both phones hear his shotgun. Ann's gun recoils and fires a tracer, and each phone plays the right sounds: its own shots, the other player's shots, the hits, the kill and the elimination. Ann's four pistol hits drop Bob's health step by step while Ann sees only hit markers (red on the kill), Bob sees "Hit by Ann's Blip" and then the kill cam, and he can't be hit while down. After that: respawn, spawn protection, a correct scoreboard, and Play again. In a second round Ann switches to the SMG and holds Fire: it fires automatically, and its eight hits go through the database and take Bob out.

The real AI model was checked separately in Chrome. It loads, runs on the GPU at about 15 checks a second, and finds no one in an empty room. Whether it reliably finds real players can only be checked with real people (see below).

The rules and E2E tests need Java (`brew install openjdk`). If `npm run phones` is already using the emulator ports, run the tests with `VITE_EMU_DB_PORT` / `VITE_EMU_AUTH_PORT` and a config on other ports.

## Playtest checklist (real phones)

1. **Practice, close:** a friend stands 3 m away. Fire at their chest, head, legs, and just beside them. Turn on Show boxes to see what counts.
2. **Range test:** the friend walks away slowly. Note where the AI stops boxing them, at 1080p and at 4K, indoors and outdoors.
3. **Hard poses:** sideways, crouching, running, arms up, partly behind a tree or a doorway.
4. **Light:** dim rooms and backlit (sun behind the player) are where person detectors struggle most.
5. **Two-player game:** a full round. Check that hits feel instant, the "Hit by" message is right, and the kill cam shows the moment.
6. **Sound:** shots should be loud on the phone speaker, also with the iPhone silent switch on, and you should hear the other player's shots.
7. **Guns:** a round with the SMG (hold Fire) and one with the shotgun up close and from beyond 12 m.

If moving shots miss too often, widen the lag window in `src/game/constants.ts`. If shots beside people count, lower `HIT_WIDTH` in `src/game/personHit.ts`.

## Layout

```
src/
  detect/people.ts          person detector: MediaPipe Object Detector loader (and the E2E stand-in)
  detect/peoplePipeline.ts  camera frames to the detector: center and full passes, results kept 0.7 s
  game/personHit.ts         hit area, gun width and range, lag window, distance, crosshair lock (pure, unit tested)
  game/fire.ts              one shot: kill cam grab, press-frame check, lag window
  game/guns.ts              the six guns: damage, firing, magazine, reload, range, sound (mirrored by database.rules.json)
  game/rules.ts             health, respawn and protection (mirrored by database.rules.json)
  net/game.ts               every database write the game makes, and the ordered hit sender
  ui/sound.ts               recorded gunshots per gun, synthesized actions, reloads and hits; starts audio on the first tap
  ui/useWeapon.ts           trigger, magazine and reload: semi, automatic and burst
  ui/gunModel.ts            guns as 3D boxes: the first-person and showcase cameras (pure, unit tested)
  ui/gunShapes.ts           the six guns' boxes
  ui/Gun.tsx                the gun in your hand: recoil, action, muzzle flash, casing, tracer, reload
  ui/GunPreview.tsx         a gun side-on, for the Armory, home screen and lobby
  ui/Arcade.tsx             the home screen's cabinet art: the demo match and the control deck
  ui/theme.css              the arcade look: colours, pixel fonts, panels, HUD, CRT scanlines
  screens/                  Home, Armory, Lobby, Live, Scoreboard, Practice, RangeTest
public/sounds/guns/         one MP3 per gun (built by scripts/build-gun-sounds.mjs)
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
# lasertag
