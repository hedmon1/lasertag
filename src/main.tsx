import './net/socketShim.ts';
import '@fontsource/press-start-2p/400.css';
import '@fontsource/vt323/400.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { installAudioUnlock } from './ui/sound.ts';
import './ui/theme.css';

installAudioUnlock();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
