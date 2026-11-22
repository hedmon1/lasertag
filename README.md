# Laser Tag

Two-player laser tag played with phones. Your phone camera is the blaster: put the crosshair on the other player and press Fire. An AI running on the phone checks that the crosshair is actually on a person. It runs as a web link, so there's nothing to install, and it works on iPhone and Android.

## How a shot is decided

1. **The AI watches the camera continuously.** Google's MediaPipe Object Detector (EfficientDet-Lite0, trained to find people) runs on the phone about 15 times a second and puts a box around every person in view.
2. **The crosshair locks on** (turns red and shows the other player's name) whenever it's inside a person's box.
3. **Fire:** the shot is a hit if a person was under the crosshair at any moment from 150 ms before the press to 120 ms after it. This lag forgiveness means a fast trigger finger on a moving target still counts.
4. **Two players, so no identification is needed:** whoever is under your crosshair is your opponent. The hit is sent to their phone.

Details that make it reliable:

- **The center is checked closely.** Each frame the AI alternates between the middle half of the image (enlarged, so far players look twice as big) and the full width (close players who fill the view). Only people under the crosshair matter, so nothing else needs checking.
- **Not the whole box counts.** A person's box includes air beside their arms, so only the middle 80% of its width counts as a hit (wider for the shotgun's spread, narrower for the sniper). Head to feet all counts, and the head counts double (see Headshots).
- **A slow phone can't cost a hit.** The frames from before the press are kept, and the press frame itself is checked straight away.

**Who shot them and how:** the victim sees *"Hit by Ann's Boomstick. 6 m"*. The distance is estimated from how tall they looked, assuming a standing 1.7 m adult. When eliminated, they see a **kill cam** photo from the shooter's camera at the moment of the shot.

**What the shooter sees:** a hit marker on a hit, red on the kill, and nothing else. A miss shows nothing on screen (sometimes a ricochet sound). A shot at a player who is down or just respawned doesn't count, so it gets no marker either.

**Server rules:** the database (`database.rules.json`) accepts a hit only if the game is live, both players are alive, the shooter isn't the target, the damage is exactly the shooter's gun damage (or exactly double for a headshot), that gun's cooldown has passed and spawn protection is over. Each player's gun must match the table in `src/game/guns.ts` and can't change while a game is live. A hit is one atomic write, so it can never apply twice.

The rules file is generated. `scripts/build-rules.mjs` builds it from named pieces and the numbers in `src/game/guns.ts`, `rules.ts`, `flash.ts` and `grenade.ts`, so a change to a gun or the grenade can't leave the rules behind. After changing any of those, run `npm run rules`. A unit test fails if the checked-in file doesn't match what the script writes.

## Headshots

The head is the top 16% of a person's box and the middle half of its width. A shot there does **double damage**: two pistol or revolver headshots take someone out, and one from the shotgun or sniper. The shotgun's spread doesn't widen the head, so a headshot always takes aim.

- **Aiming:** the crosshair turns yellow and the name tag reads *"Bob HEAD"* while it's on the head.
- **You:** a yellow hit marker with a pixel crown (red on the kill) and a helmet ping. Still no popup.
- **Them:** *"Headshot by Ann's Longshot. 14 m"*, a sharper hurt sound, and *"Longshot headshot"* on the elimination screen.

The AI decides head or body on the shooter's phone, the same as a hit. The shot record says `head: true`, and the database only accepts double damage when it does.

## The flashbang

Every player also carries a flashbang: the **Flash** button above Scope, beside Grenade (or the F key). Throw it with the other player **anywhere in view**, within 15 m. The crosshair doesn't need to be on them. The button lights up yellow when someone is in range.

- **Them:** their screen goes pure white for 1.5 s, then fades back over 2.5 s. The bang goes off right beside them, their ears ring, and every other sound is muffled until the white clears. They can still press Fire, but they can't see what they're aiming at. It does no damage.
- **You:** you pull the pin, throw, and see it tumble into the view and pop where it lands. A hit marker shows if it caught them. If it missed, they hear it go off somewhere else.
- **Recharge:** 20 s after every throw, hit or miss. The button counts down.

Server rules hold it to the same limits as a shot. A catch is accepted only if the game is live, both players are alive, the target isn't spawn-protected and is no further than 15 m, and 20 s have passed since the thrower's last throw. The catch and the recharge stamp go in one write, so the recharge can't be skipped. `src/game/flash.ts` has the numbers, and the rules are generated from them.

## Frag grenades

The **Grenade** button sits beside Flash (or the G key). It lights up red when someone is in view within 12 m.

- **You:** you pull the pin and throw. It tumbles into the view, lands, blinks through its fuse and blows up orange **1.5 s** after the throw. The AI checks your camera at that moment: if the other player is still in view within 12 m, they take **60 damage within 5 m, 35 up to 12 m**. You see the hit marker (red on a kill), and a grenade kill sends a kill cam too. Headshots don't apply.
- **Them:** the moment you throw, their phone beeps 7 times, faster and faster, with a blinking GRENADE warning. They can't tell whether it's coming at them, so they move out of your view. If it catches them: a close explosion, the screen shakes, the red flash, and *"Grenade from Ann. 4 m"*. If it misses, they hear it go off nearby.
- **Recharge:** 25 s after every throw, hit or miss. The button counts down.

Server rules: the throw stamps the time (the recharge, and the other phone's warning). A grenade hit is accepted only from 1 s to 4 s after your last throw, with the damage matching the distance (60 up to 5 m, 35 up to 12 m, refused beyond), on a live, alive, unprotected opponent. It marks that throw as used in the same write, so one grenade can hit only once, and it doesn't touch your gun's cooldown. `src/game/grenade.ts` has the numbers.

## The scoreboard

Kills, deaths, gun hits, accuracy (gun hits per trigger pull, so grenades don't count), headshots and grenade hits for each player. Under it, the match **highlights**: the longest hit (who, how far, which gun), the most headshots, the best streak (kills in a row without dying, two or more) and the most grenade kills. A tie names both players. Each one only shows if someone earned it.

You also see **your last kill**: the kill cam photo from your most recent kill. The database copy is deleted when the game ends, so the scoreboard uses the copy kept on your phone, which goes when the page closes or the next round starts.

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
- **Getting hit:** a thud for a hit, a sharper one with a ring for a headshot, and a heavier one when eliminated. Android phones also vibrate.
- **Headshots:** a high helmet ping on top of the hit sound.
- **Grenades:** the pin and the throw, then two clinks as it lands. The other phone hears the fuse: 7 square-wave beeps at 2.2 kHz, closer and closer together. Caught by the blast: a full explosion (crack, boom, punch, low thump and debris) as loud as the loudest gunshot, with a ring after it. A blast that misses you is a smaller version of the same explosion, about 5 dB quieter.
- **Flashbangs:** the pin, the spoon flying off and a whoosh, then a distant bang as it lands. Caught by one: a deafening bang, two close high tones beating against each other for the ringing, and everything else crossfaded to a copy through a low-pass filter (after the clipper, so the clipper's distortion can't put the top end back) until the white fades.
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
3. After a 5-second countdown, put the crosshair on the other player and fire. Enough hits for your gun (four with the pistol, or two headshots) eliminate them for a few seconds, then they come back with 2 s of protection. Throw a grenade to flush them out or a flashbang to white out their screen (see Frag grenades and The flashbang).
4. First to the kill limit wins, or most kills when time runs out. The scoreboard shows the highlights. Play again keeps the same two players.

Each player picks a gun in the Armory before the game (see The guns). **Scope** (hold): real camera zoom on Android Chrome, by the gun's scope factor; a magnified view on iPhone (Safari doesn't let web pages zoom the camera).

**Play where only the two of you are in view.** The AI finds people, not specific people, so anyone under the crosshair counts as a hit on your opponent.

## Tools

- **Practice:** no server. Aim at a friend and fire with your equipped gun (the gun button at the top opens the Armory), or throw a grenade or flashbang. It logs every hit, headshot or miss, how sure the AI was, and the distance, the grenade's damage, and whether a flashbang caught anyone. "Boxes" draws what the AI sees: the dashed box is the person, the solid box is the part that counts.
- **Range test:** have a friend walk away from you and watch where the AI stops seeing them. Shows the camera resolution, checks per second and the time per check. You can switch between 1080p and 4K.

## Tests

```bash
npm run typecheck
npm test            # 120 unit tests: hit area, headshots, gun width and range, lag window, distance, crosshair lock, health rules, scoreboard and highlights, gun catalog, every gun's model, the flashbang, the grenade, the generated rules file
npm run test:rules  # 72 database rules tests on the emulator, with two separate signed-in players
npm run rules       # regenerates database.rules.json after a change to a gun, the flashbang or the grenade
npm run test:e2e    # two Chrome browsers with fake cameras play a full game on the emulators
npm run test:sounds # renders every sound and checks it (no emulators needed)
```

`test:sounds` renders each sound offline in Chrome and checks that nothing is silent or clips (including 36 randomised shots from all six guns, 18 rounds of automatic fire and a burst), that every gun's recording loads, that each gunshot is loud through a simulated phone speaker (nothing below about 350 Hz), that the other player's shot is clearly quieter but still heard, that each reload ends on its last step inside that gun's reload time, and that a gun whose recording fails to load still fires. For the flashbang it checks that being caught is as loud as the loudest gunshot and one that misses you is clearly quieter, that your ears ring and then stop, that a gunshot during the white loses its top end and sounds normal again once it fades, and that a thrown one bangs as it lands. For headshots it checks the ping and the hurt sound. For grenades it checks that being caught is as loud as the loudest gunshot, that a blast that misses you is at least 4 dB quieter, and that the fuse beeps 7 times, faster and faster, all before the blast. It also checks that the first tap starts audio, and that shots fired while audio is blocked are dropped rather than all playing at once later. It writes a WAV of every sound to `tests/sound/out` so you can listen.

The E2E test runs a dev build with `?testdetector=1`, which swaps the AI for a stand-in that treats a magenta rectangle as a person. This test switch only exists in dev builds. Ann's fake camera films the rectangle and Bob's films an empty room. For the headshot match, a third feed films the rectangle further back and lower, so the crosshair is on its head.

It checks a full game. A third player is turned away, and Bob picks the shotgun in the Armory, which Ann then sees next to his name. Ann's crosshair locks on and Bob's doesn't, and Bob's shot at an empty room misses with nothing on screen, but both phones hear his shotgun. Bob's flashbang at the empty room catches nobody and starts recharging, while Ann hears it go off. Ann's Flash button lights up with Bob in view, and her flashbang turns Bob's screen white ("Flashed by Ann") with the bang beside him; the white fades and wears off, and he loses no health. Ann's gun recoils and fires a tracer, and each phone plays the right sounds: its own shots, the other player's shots, the hits, the kill and the elimination. Ann's four pistol hits drop Bob's health step by step while Ann sees only hit markers (red on the kill), Bob sees "Hit by Ann's Blip" and then the kill cam, and he can't be hit while down. After that: respawn, spawn protection, a correct scoreboard, and Play again. In a second round Ann switches to the SMG and holds Fire: it fires automatically, and its eight hits go through the database and take Bob out.

Then grenades. Bob respawns and throws one at the empty room: Ann gets the warning and hears the fuse and the blast, loses no health, and Bob's grenade starts recharging. Ann's Grenade button lights up with Bob in range, and her grenade warns Bob first, then lands over a second later and takes 60 ("Grenade from Ann. 4 m"), with the right sounds on both phones. The scoreboard records the grenade apart from the 8 gun hits, names Ann's longest hit and gun in the highlights, and shows Ann her last kill (and Bob, with none, nothing).

Last, a second match with two fresh players and the head feed: Ann's crosshair turns to HEAD, one pistol headshot takes Bob to 50 ("Headshot by Ann's Blip") with a crowned hit marker, the second takes him out ("Blip headshot"), and the scoreboard and highlights count both headshots.

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
8. **Flashbang:** throw one with the other player at the edge of the view, and one from beyond 15 m. Check the white feels long enough to matter but not unfair, and the ringing isn't too loud.
9. **Headshots:** in Practice with Boxes on, aim at a friend's head at 3 m, 10 m and 20 m. Check that HEAD shows when the crosshair is on their head, and not on their neck or shoulders.
10. **Grenades:** throw one at a friend who is ready for it. Check they can get out of view on the warning if they move straight away, and can't if they don't. Check 60 up close and 35 from about 8 m.

If moving shots miss too often, widen the lag window in `src/game/constants.ts`. If shots beside people count, lower `HIT_WIDTH` in `src/game/personHit.ts`. If headshots land on necks, lower `HEAD.top` there. If the grenade is too easy or too hard to escape, change `GRENADE.fuseMs` in `src/game/grenade.ts` (then `npm run rules`).

## Layout

```
src/
  detect/people.ts          person detector: MediaPipe Object Detector loader (and the E2E stand-in)
  detect/peoplePipeline.ts  camera frames to the detector: center and full passes, results kept 0.7 s
  game/personHit.ts         hit area, the head, gun width and range, lag window, distance, crosshair lock, flashbang and blast catch (pure, unit tested)
  game/fire.ts              one shot, flashbang or grenade blast: kill cam grab, press-frame check, lag window
  game/flash.ts             the flashbang: range, recharge, how long the white lasts (written into database.rules.json)
  game/grenade.ts           the frag grenade: fuse, damage by distance, recharge, the fuse beeps (written into database.rules.json)
  game/score.ts             the scoreboard and the match highlights (pure, unit tested)
  game/guns.ts              the six guns: damage, firing, magazine, reload, range, sound (written into database.rules.json)
  game/rules.ts             health, headshot damage, respawn and protection (written into database.rules.json)
  net/game.ts               every database write the game makes, and the ordered hit sender
  ui/sound.ts               recorded gunshots per gun, synthesized actions, reloads, hits, headshots, flashbangs and grenades; starts audio on the first tap
  ui/useWeapon.ts           trigger, magazine and reload: semi, automatic and burst
  ui/gunModel.ts            guns as 3D boxes: the first-person and showcase cameras (pure, unit tested)
  ui/gunShapes.ts           the six guns' boxes
  ui/Gun.tsx                the gun in your hand: recoil, action, muzzle flash, casing, tracer, reload
  ui/throwables.tsx         what you throw: the shared recharge, button and throw; the grenade's icon and the warning
  ui/flashbang.tsx          the Flash button, the throw, and the white screen
  ui/lastKill.ts            your last kill cam photo, kept on the phone for the scoreboard
  ui/GunPreview.tsx         a gun side-on, for the Armory, home screen and lobby
  ui/Arcade.tsx             the home screen's cabinet art: the demo match and the control deck
  ui/theme.css              the arcade look: colours, pixel fonts, panels, HUD, CRT scanlines
  screens/                  Home, Armory, Lobby, Live, Scoreboard, Practice, RangeTest
public/sounds/guns/         one MP3 per gun (built by scripts/build-gun-sounds.mjs)
scripts/build-rules.mjs     writes database.rules.json from named pieces and the game's numbers (npm run rules)
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
