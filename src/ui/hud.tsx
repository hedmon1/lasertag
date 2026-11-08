import { useEffect, useState } from 'react';
import { peopleAI, type DetectorState } from '../detect/people.ts';

// Pixel style: square ends, no anti-aliasing, and a black outline (the same path drawn wider
// underneath) so the marks read against any camera background.
const ARMS = 'M32 7v13M32 44v13M7 32h13M44 32h13';
const CORNERS = 'M20 27v-7h7M37 20h7v7M44 37v7h-7M27 44h-7v-7';

export function Crosshair({ locked }: { locked: boolean }) {
  const marks = locked ? `${ARMS}${CORNERS}` : ARMS;
  return (
    <div className={`crosshair${locked ? ' locked' : ''}`} aria-hidden>
      <svg viewBox="0 0 64 64" fill="none" strokeLinecap="square" shapeRendering="crispEdges">
        <path d={marks} stroke="var(--ink)" strokeWidth="7" />
        <path d={marks} stroke="currentColor" strokeWidth="3" />
        <rect x="29" y="29" width="6" height="6" fill="currentColor" stroke="var(--ink)" strokeWidth="2" />
      </svg>
    </div>
  );
}

const X = 'M9 9l8 8M35 9l-8 8M9 35l8-8M35 35l-8-8';

export function HitMarker({ kill }: { kill: boolean }) {
  return (
    <svg className="hitmarker" viewBox="0 0 44 44" fill="none" strokeLinecap="square" shapeRendering="crispEdges" aria-hidden data-kill={kill}>
      <path d={X} stroke="var(--ink)" strokeWidth="8" />
      <path d={X} stroke={kill ? 'var(--danger)' : 'var(--paper)'} strokeWidth="4" />
    </svg>
  );
}

export function useDetectorState(): DetectorState {
  const [s, setS] = useState(peopleAI.state);
  useEffect(() => peopleAI.subscribe(() => setS(peopleAI.state)), []);
  return s;
}

export function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60), s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
