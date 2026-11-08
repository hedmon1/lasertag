// Emulator mode over https (phones on the same Wi-Fi) only.
//
// After the first connection the Database emulator tells the SDK to reconnect straight to its
// own address (127.0.0.1:9000). On a phone that is the phone itself, over plain ws, so every
// reconnect would fail. This keeps database sockets on the page's https proxy instead.
//
// The SDK keeps its own reference to WebSocket from the moment it loads, so this module must
// be imported before anything that imports firebase (it is the first import in main.tsx).

const emulators = !import.meta.env.VITE_FIREBASE_API_KEY || new URLSearchParams(location.search).has('emu');

if (emulators && location.protocol === 'https:') {
  const Native = window.WebSocket;
  const host = location.host;
  class ProxiedWebSocket extends Native {
    constructor(url: string | URL, protocols?: string | string[]) {
      const u = new URL(String(url));
      if (u.pathname === '/.ws' && u.host !== host) {
        u.protocol = 'wss:';
        u.host = host;
      }
      super(u, protocols);
    }
  }
  window.WebSocket = ProxiedWebSocket;
}

export {};
