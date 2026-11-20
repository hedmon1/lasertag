// Builds database.rules.json, the server's rules for every write the game makes.
//
// The rules are one long expression per path, and several of them repeat the same checks
// (the game is live, a player is alive) or depend on the game's numbers (each gun's damage,
// the flashbang's recharge). Writing them here from named pieces, with the numbers read from
// the game's own tables, keeps them readable and in step with the app.
//
//   npm run rules            rewrite database.rules.json
//   npm run rules -- --check exit 1 if database.rules.json is out of date (tests/unit/rules-file.test.ts)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GUNS } from '../src/game/guns.ts';
import { FLASH } from '../src/game/flash.ts';
import { GRENADE } from '../src/game/grenade.ts';

const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'database.rules.json');

// ---------- pieces ----------

const and = (...xs) => xs.join(' && ');
const or = (...xs) => xs.join(' || ');
const paren = (x) => `(${x})`;

const game = "root.child('games').child($code)";
const meta = `${game}.child('meta')`;
const state = `${meta}.child('state').val()`;
const isHost = `${meta}.child('host').val() == auth.uid`;
const rule = (name) => `${meta}.child('rules').child('${name}').val()`;
const player = (uid) => `${game}.child('players').child(${uid})`;
const me = player('auth.uid');
const newTarget = (rec) => player(`newData.child('${rec}').val()`);
/** The live window: started and not yet over. */
const inWindow = and(`${state} == 'live'`, `now >= ${meta}.child('startAt').val()`, `now < ${meta}.child('endAt').val()`);
/** You and your target are both seated and alive, and it isn't you. */
const bothIn = (target) =>
  and(
    "newData.child('target').val() != auth.uid",
    `${me}.child('slot').val() >= 0`,
    `${me}.child('life').child('alive').val() == true`,
    `${target}.child('slot').val() >= 0`,
    `${target}.child('life').child('alive').val() == true`,
    `now >= ${target}.child('life').child('spawnAt').val() + ${rule('protectMs')}`,
  );
/** The same write stamps your own field with the server time. */
const stamps = (field) => `newData.parent().parent().child('players').child(auth.uid).child('${field}').val() == now`;
const stampField = { '.write': 'auth != null && auth.uid == $uid', '.validate': "newData.isNumber() && (newData.val() == now || (newData.val() == 0 && !data.exists()))" };
const typed = (kind) => ({ '.validate': `newData.${kind}()` });
const closed = { '$other': { '.validate': false } };
/** Members only: you have a player record in this game. */
const members = `auth != null && ${me}.exists()`;
/** The host clears a whole list after a game. */
const hostClears = `auth != null && ${isHost} && !newData.exists() && ${state} != 'live'`;

// ---------- guns ----------

const gunTable = GUNS.map((g) => `(newData.child('id').val() == '${g.id}' && newData.child('damage').val() == ${g.damage} && newData.child('cooldownMs').val() == ${g.cooldownMs})`).join(' || ');
const myGun = `${me}.child('gun')`;

// ---------- life ----------

// A hit, written by the shooter: the new life must be exactly the old one minus the damage
// (the shooter's gun damage, doubled when the shot record says it was a headshot), and its
// shot record must be new, by the shooter, at this player, in the same write.
const newShot = "newData.parent().parent().parent().child('shots').child(newData.child('shot').val())";
const takes = (damage) =>
  or(
    paren(and(`data.child('hp').val() > ${damage}`, `newData.child('hp').val() == data.child('hp').val() - ${damage}`, "newData.child('alive').val() == true", "newData.child('diedAt').val() == 0")),
    paren(and(`data.child('hp').val() <= ${damage}`, "newData.child('hp').val() == 0", "newData.child('alive').val() == false", "newData.child('diedAt').val() == now")),
  );
/** What the new shot record says. */
const shotSays = (field) => `${newShot}.child('${field}').val()`;
// A gun shot takes the shooter's gun damage, doubled on the head. A grenade takes its damage
// by distance; its range is checked on the shot record.
const damageTaken = or(
  paren(and(`${shotSays('via')} != 'grenade'`, `${shotSays('head')} != true`, paren(takes(`${myGun}.child('damage').val()`)))),
  paren(and(`${shotSays('via')} != 'grenade'`, `${shotSays('head')} == true`, paren(takes(`${myGun}.child('damage').val() * 2`)))),
  paren(and(`${shotSays('via')} == 'grenade'`, `${shotSays('dist')} <= ${GRENADE.near.m}`, paren(takes(GRENADE.near.damage)))),
  paren(and(`${shotSays('via')} == 'grenade'`, `${shotSays('dist')} > ${GRENADE.near.m}`, paren(takes(GRENADE.far.damage)))),
);
const hit = and(
  '(auth.uid != $uid)',
  "newData.child('shot').val() != data.child('shot').val()",
  `${newShot}.child('by').val() == auth.uid`,
  `${newShot}.child('target').val() == $uid`,
  `!${game}.child('shots').child(newData.child('shot').val()).exists()`,
  "data.child('alive').val() == true",
  "newData.child('seq').val() == data.child('seq').val() + 1",
  "newData.child('spawnAt').val() == data.child('spawnAt').val()",
  paren(damageTaken),
);
const respawn = and(
  'auth.uid == $uid',
  "data.child('alive').val() == false",
  `${state} == 'live'`,
  `now >= data.child('diedAt').val() + ${rule('respawnMs')}`,
  `newData.child('hp').val() == ${rule('hp')}`,
  "newData.child('alive').val() == true",
  "newData.child('seq').val() == data.child('seq').val() + 1",
  "newData.child('shot').val() == ''",
  "newData.child('diedAt').val() == 0",
  "newData.child('spawnAt').val() == now",
);
const reset = and(
  `(auth.uid == $uid || ${isHost})`,
  `${state} != 'live'`,
  `newData.child('hp').val() == ${rule('hp')}`,
  "newData.child('alive').val() == true",
  "newData.child('shot').val() == ''",
  "newData.child('diedAt').val() == 0",
  "newData.child('spawnAt').val() == 0",
  "newData.child('seq').val() == data.child('seq').val() + 1",
);

// ---------- shots and flashbangs ----------

// A gun shot: your gun's cooldown has passed, and the write stamps the next one.
const byGun = and(
  "newData.child('via').val() == 'ai'",
  `newData.child('gun').val() == ${myGun}.child('id').val()`,
  `now >= ${me}.child('lastShotAt').val() + ${myGun}.child('cooldownMs').val()`,
  stamps('lastShotAt'),
);
// A grenade's blast: in the window after your last throw, in reach, never a headshot, and the
// write marks that throw as used, so one throw can only hit once.
const lastThrow = `${me}.child('lastGrenadeAt').val()`;
const byGrenade = and(
  "newData.child('via').val() == 'grenade'",
  "newData.child('gun').val() == 'grenade'",
  "newData.child('head').val() != true",
  `${me}.child('lastGrenadeAt').exists()`,
  `now >= ${lastThrow} + ${GRENADE.hitWindowMs.from}`,
  `now <= ${lastThrow} + ${GRENADE.hitWindowMs.to}`,
  `newData.child('dist').val() <= ${GRENADE.far.m}`,
  `newData.parent().parent().child('players').child(auth.uid).child('grenadeHitOf').val() == ${lastThrow}`,
);
const shotValidate = and(
  "newData.hasChildren(['by', 'target', 'via', 'gun', 'dist', 'at', 'kill'])",
  inWindow,
  "newData.child('target').val() != auth.uid",
  `${me}.child('slot').val() >= 0`,
  `${me}.child('life').child('alive').val() == true`,
  paren(or(paren(byGun), paren(byGrenade))),
  `${newTarget('target')}.child('slot').val() >= 0`,
  `${newTarget('target')}.child('life').child('alive').val() == true`,
  `now >= ${newTarget('target')}.child('life').child('spawnAt').val() + ${rule('protectMs')}`,
  "newData.parent().parent().child('players').child(newData.child('target').val()).child('life').child('shot').val() == $id",
  "newData.child('kill').val() == (newData.parent().parent().child('players').child(newData.child('target').val()).child('life').child('hp').val() == 0)",
);

const flashValidate = and(
  "newData.hasChildren(['by', 'target', 'dist', 'at'])",
  inWindow,
  "newData.child('target').val() != auth.uid",
  `${me}.child('slot').val() >= 0`,
  `${me}.child('life').child('alive').val() == true`,
  `(!${me}.child('lastFlashAt').exists() || now >= ${me}.child('lastFlashAt').val() + ${FLASH.cooldownMs})`,
  stamps('lastFlashAt'),
  `${newTarget('target')}.child('slot').val() >= 0`,
  `${newTarget('target')}.child('life').child('alive').val() == true`,
  `now >= ${newTarget('target')}.child('life').child('spawnAt').val() + ${rule('protectMs')}`,
);

// ---------- the whole file ----------

const ruleLimit = (min, max) =>
  ({ '.validate': `newData.isNumber() && newData.val() >= ${min} && newData.val() <= ${max} && (newData.val() == data.val() || ${state} != 'live')` });

export const RULES = {
  rules: {
    '.read': false,
    '.write': false,
    games: {
      $code: {
        meta: {
          '.read': 'auth != null',
          '.write': "auth != null && ((!data.exists() && newData.child('host').val() == auth.uid && $code.matches(/^[A-HJ-NP-Z]{4}$/)) || (data.exists() && data.child('host').val() == auth.uid))",
          '.validate': "newData.hasChildren(['host', 'state', 'createdAt', 'rules'])",
          host: { '.validate': 'newData.val() == auth.uid && (!data.exists() || data.val() == newData.val())' },
          createdAt: { '.validate': '(data.exists() && newData.val() == data.val()) || (!data.exists() && newData.val() == now)' },
          state: {
            '.validate': "newData.val() == data.val() || (!data.exists() && newData.val() == 'lobby') || (data.val() == 'lobby' && newData.val() == 'live' && newData.parent().child('startAt').val() >= now + 2000) || (data.val() == 'live' && newData.val() == 'ended') || (data.val() == 'ended' && newData.val() == 'lobby')",
          },
          startAt: {
            '.validate': "newData.isNumber() && (newData.val() == data.val() || (data.parent().child('state').val() == 'lobby' && newData.parent().child('state').val() == 'live' && newData.val() >= now + 2000 && newData.val() <= now + 15000))",
          },
          endAt: {
            '.validate': "newData.isNumber() && (newData.val() == data.val() || newData.val() == newData.parent().child('startAt').val() + newData.parent().child('rules').child('durationMs').val())",
          },
          rules: {
            '.validate': "newData.hasChildren(['hp', 'respawnMs', 'protectMs', 'durationMs', 'killLimit'])",
            hp: { '.validate': 'newData.val() == 100' },
            protectMs: { '.validate': 'newData.val() == 2000' },
            respawnMs: ruleLimit(3000, 30000),
            durationMs: ruleLimit(60000, 3600000),
            killLimit: ruleLimit(1, 50),
            ...closed,
          },
          ...closed,
        },

        slots: {
          '.read': 'auth != null',
          $slot: {
            '.write': `auth != null && ${state} == 'lobby' && ((!data.exists() && newData.val() == auth.uid && newData.parent().parent().child('players').child(auth.uid).child('slot').val() + '' == $slot && (!${me}.exists() || ${me}.child('slot').val() == -1)) || (data.val() == auth.uid && !newData.exists() && newData.parent().parent().child('players').child(auth.uid).child('slot').val() + '' != $slot))`,
            '.validate': '$slot.matches(/^[01]$/) && newData.isString()',
          },
        },

        players: {
          '.read': 'auth != null && data.child(auth.uid).exists()',
          $uid: {
            '.write': `auth != null && auth.uid == $uid && !data.exists() && ${state} == 'lobby'`,
            '.validate': "newData.hasChildren(['name', 'joinedAt', 'slot', 'life', 'fired', 'lastShotAt', 'gun']) && newData.child('slot').val() >= 0",
            name: { '.write': 'auth != null && auth.uid == $uid', '.validate': 'newData.isString() && newData.val().length > 0 && newData.val().length <= 16' },
            joinedAt: { '.validate': '(data.exists() && newData.val() == data.val()) || (!data.exists() && newData.val() == now)' },
            slot: {
              '.write': `auth != null && auth.uid == $uid && ${state} == 'lobby'`,
              '.validate': "newData.isNumber() && (newData.val() == -1 || (newData.val() >= 0 && newData.val() < 2 && newData.parent().parent().parent().child('slots').child(newData.val() + '').val() == auth.uid))",
            },
            online: { '.write': 'auth != null && auth.uid == $uid', '.validate': 'newData.isBoolean()' },
            fired: {
              '.write': `auth != null && (auth.uid == $uid || (${isHost} && newData.val() == 0))`,
              '.validate': `newData.isNumber() && ((newData.val() == 0 && ${state} != 'live') || (data.exists() && newData.val() == data.val() + 1))`,
            },
            lastShotAt: stampField,
            lastFlashAt: stampField,
            // A throw, in a live game, once the last one has recharged.
            lastGrenadeAt: {
              '.write': 'auth != null && auth.uid == $uid',
              '.validate': `newData.isNumber() && ((newData.val() == 0 && !data.exists()) || (newData.val() == now && ${state} == 'live' && (!data.exists() || now >= data.val() + ${GRENADE.cooldownMs})))`,
            },
            // The throw that has already hit someone; set by the hit itself.
            grenadeHitOf: {
              '.write': 'auth != null && auth.uid == $uid',
              '.validate': "newData.isNumber() && newData.val() != data.val() && newData.val() == data.parent().child('lastGrenadeAt').val()",
            },
            gun: {
              '.write': `auth != null && auth.uid == $uid && ${state} != 'live'`,
              '.validate': `newData.hasChildren(['id', 'damage', 'cooldownMs']) && (${gunTable})`,
              id: typed('isString'),
              damage: typed('isNumber'),
              cooldownMs: typed('isNumber'),
              ...closed,
            },
            life: {
              '.write': `auth != null && (${paren(hit)} || ${paren(respawn)} || ${paren(reset)})`,
              '.validate': "newData.hasChildren(['hp', 'alive', 'seq', 'shot', 'diedAt', 'spawnAt'])",
              hp: { '.validate': 'newData.isNumber() && newData.val() >= 0' },
              alive: typed('isBoolean'),
              seq: typed('isNumber'),
              shot: typed('isString'),
              diedAt: typed('isNumber'),
              spawnAt: typed('isNumber'),
              ...closed,
            },
            ...closed,
          },
        },

        shots: {
          '.read': members,
          '.write': hostClears,
          $id: {
            '.write': "auth != null && !data.exists() && newData.child('by').val() == auth.uid",
            '.validate': shotValidate,
            by: typed('isString'),
            target: typed('isString'),
            via: { '.validate': "newData.val() == 'ai' || newData.val() == 'grenade'" },
            gun: typed('isString'),
            dist: { '.validate': 'newData.isNumber() && newData.val() >= 0 && newData.val() <= 200' },
            at: { '.validate': 'newData.val() == now' },
            kill: typed('isBoolean'),
            head: typed('isBoolean'),
            ...closed,
          },
        },

        flashes: {
          '.read': members,
          '.write': hostClears,
          $id: {
            '.write': "auth != null && !data.exists() && newData.child('by').val() == auth.uid",
            '.validate': flashValidate,
            by: typed('isString'),
            target: typed('isString'),
            dist: { '.validate': `newData.isNumber() && newData.val() >= 0 && newData.val() <= ${FLASH.rangeM}` },
            at: { '.validate': 'newData.val() == now' },
            ...closed,
          },
        },

        killcams: {
          '.write': hostClears,
          $id: {
            '.read': `auth != null && (${game}.child('shots').child($id).child('target').val() == auth.uid || ${game}.child('shots').child($id).child('by').val() == auth.uid)`,
            '.write': `auth != null && !data.exists() && newData.child('by').val() == auth.uid && ${game}.child('shots').child($id).child('by').val() == auth.uid`,
            '.validate': `newData.hasChildren(['by', 'target', 'jpg']) && newData.child('target').val() == ${game}.child('shots').child($id).child('target').val()`,
            by: typed('isString'),
            target: typed('isString'),
            jpg: { '.validate': "newData.isString() && newData.val().length < 150000 && newData.val().beginsWith('data:image/jpeg;base64,')" },
            ...closed,
          },
        },
      },
    },
  },
};

export const TEXT = JSON.stringify(RULES, null, 2) + '\n';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const same = readFileSync(FILE, 'utf8') === TEXT;
    console.log(same ? 'database.rules.json is up to date' : 'database.rules.json is out of date: run npm run rules');
    process.exit(same ? 0 : 1);
  }
  writeFileSync(FILE, TEXT);
  console.log('Wrote database.rules.json');
}
