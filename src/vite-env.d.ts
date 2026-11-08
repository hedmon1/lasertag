/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_DATABASE_URL?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_PERSON_MODEL_URL?: string;
  readonly VITE_MEDIAPIPE_WASM_URL?: string;
  readonly VITE_EMU_DB_PORT?: string;
  readonly VITE_EMU_AUTH_PORT?: string;
}

/** Installed @mediapipe/tasks-vision version, injected by vite.config.ts. */
declare const __MEDIAPIPE_VERSION__: string;
