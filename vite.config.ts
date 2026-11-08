import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { readFileSync } from 'node:fs';

const mediapipeVersion = JSON.parse(readFileSync(new URL('./node_modules/@mediapipe/tasks-vision/package.json', import.meta.url), 'utf8')).version;

// HTTPS is on by default so phones on the same Wi-Fi can open the camera (browsers only
// allow the camera on https or localhost). The E2E run sets LT_HTTP=1 and uses localhost.
const https = process.env.LT_HTTP !== '1';

// In emulator mode over HTTPS, the page talks to the Auth and Database emulators through
// this dev server, so a phone never needs a plain-http connection (which Safari blocks).
const emulatorProxy = {
  '/.ws': { target: 'ws://127.0.0.1:9000', ws: true },
  '/.lp': { target: 'http://127.0.0.1:9000' },
  '/identitytoolkit.googleapis.com': { target: 'http://127.0.0.1:9099' },
  '/securetoken.googleapis.com': { target: 'http://127.0.0.1:9099' },
  '/emulator/': { target: 'http://127.0.0.1:9099' },
};

export default defineConfig({
  plugins: [react(), ...(https ? [basicSsl()] : [])],
  define: { __MEDIAPIPE_VERSION__: JSON.stringify(mediapipeVersion) },
  server: {
    host: true,
    port: Number(process.env.LT_PORT ?? 4630),
    strictPort: true,
    proxy: emulatorProxy,
  },
  preview: { host: true, port: 4631, proxy: emulatorProxy },
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true },
});
