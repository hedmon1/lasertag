// Firebase setup. Two modes:
//   - Real project: when VITE_FIREBASE_* values are set (see .env.example).
//   - Emulators (default): the local Auth and Database emulators. Over https (phones on the
//     same Wi-Fi) everything goes through the Vite dev server's proxy, because a secure page
//     can't open plain ws:// connections (see socketShim.ts). Over http://localhost it
//     connects directly.
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, onAuthStateChanged, signInAnonymously, type Auth, type User } from 'firebase/auth';
import { connectDatabaseEmulator, forceWebSockets, getDatabase, onValue, ref, type Database } from 'firebase/database';

const env = import.meta.env;
const EMU_NAMESPACE = 'demo-laser-tag-default-rtdb';

export const usingEmulators = !env.VITE_FIREBASE_API_KEY || new URLSearchParams(location.search).has('emu');

let app: FirebaseApp;
let auth: Auth;
let db: Database;

function init() {
  if (app) return;
  if (!usingEmulators) {
    app = initializeApp({
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      databaseURL: env.VITE_FIREBASE_DATABASE_URL,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      appId: env.VITE_FIREBASE_APP_ID,
    });
    auth = getAuth(app);
    db = getDatabase(app);
    return;
  }
  const secure = location.protocol === 'https:';
  // Overridable so tests can run beside a dev server that already holds the default ports.
  const dbPort = Number(env.VITE_EMU_DB_PORT ?? 9000);
  const authPort = Number(env.VITE_EMU_AUTH_PORT ?? 9099);
  const databaseURL = secure
    ? `${location.origin}/?ns=${EMU_NAMESPACE}`
    : `http://${location.hostname}:${dbPort}/?ns=${EMU_NAMESPACE}`;
  // Long polling would also follow the emulator's redirect to its own address; sockets are
  // kept on the proxy by socketShim.ts.
  if (secure) forceWebSockets();
  app = initializeApp({ apiKey: 'demo-key', projectId: 'demo-laser-tag', databaseURL });
  auth = getAuth(app);
  db = getDatabase(app);
  if (secure) {
    connectAuthEmulator(auth, location.origin, { disableWarnings: true });
  } else {
    connectAuthEmulator(auth, `http://${location.hostname}:${authPort}`, { disableWarnings: true });
    connectDatabaseEmulator(db, location.hostname, dbPort);
  }
}

export function database(): Database {
  init();
  return db;
}

let userPromise: Promise<User> | null = null;

/** Signs in anonymously once per device; the same identity survives reloads. */
export function currentUser(): Promise<User> {
  init();
  if (!userPromise) {
    userPromise = new Promise<User>((resolve, reject) => {
      const stop = onAuthStateChanged(auth, (u) => {
        if (u) {
          stop();
          resolve(u);
        }
      }, reject);
      signInAnonymously(auth).catch((e) => {
        stop();
        userPromise = null;
        reject(e);
      });
    });
  }
  return userPromise;
}

// Server clock: every game time (start, end, death, respawn) is server time.
let offset = 0;
let offsetWatching = false;

export function watchServerTime() {
  if (offsetWatching) return;
  offsetWatching = true;
  onValue(ref(database(), '.info/serverTimeOffset'), (s) => {
    offset = Number(s.val()) || 0;
  });
}

export function serverNow(): number {
  return Date.now() + offset;
}
