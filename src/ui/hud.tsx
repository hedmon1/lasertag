import { useEffect, useState } from 'react';
import { peopleAI, type DetectorState } from '../detect/people.ts';
import type { AimLock } from '../game/personHit.ts';

// Pixel style: square ends, no anti-aliasing, and a black outline (the same path drawn wider
// underneath) so the marks read against any camera background.
const ARMS = 'M32 7v13M32 44v13M7 32h13M44 32h13';
const CORNERS = 'M20 27v-7h7M37 20h7v7M44 37v7h-7M27 44h-7v-7';

/** Locked: corners close in on a body (lime), or on a head (yellow). */
export function Crosshair({ lock }: { lock: AimLock }) {
  const marks = lock ? `${ARMS}${CORNERS}` : ARMS;
  return (
    <div className={`crosshair${lock ? ' locked' : ''}${lock === 'head' ? ' head' : ''}`} data-lock={lock || 'none'} aria-hidden>
      <svg viewBox="0 0 64 64" fill="none" strokeLinecap="square" shapeRendering="crispEdges">
        <path d={marks} stroke="var(--ink)" strokeWidth="7" />
        <path d={marks} stroke="currentColor" strokeWidth="3" />
        <rect x="29" y="29" width="6" height="6" fill="currentColor" stroke="var(--ink)" strokeWidth="2" />
      </svg>
    </div>
  );
}

const X = 'M9 9l8 8M35 9l-8 8M9 35l8-8M35 35l-8-8';
const CROWN = 'M14 -6h4v6h-4zM20 -10h4v10h-4zM26 -6h4v6h-4z';

/** White on a hit, yellow with a pixel crown on a headshot, red on the kill. */
export function HitMarker({ kill, head = false }: { kill: boolean; head?: boolean }) {
  const color = kill ? 'var(--danger)' : head ? 'var(--yellow)' : 'var(--paper)';
  return (
    <svg className="hitmarker" viewBox="0 0 44 44" fill="none" strokeLinecap="square" shapeRendering="crispEdges" aria-hidden data-kill={kill} data-head={head}>
      <path d={X} stroke="var(--ink)" strokeWidth="8" />
      <path d={X} stroke={color} strokeWidth="4" />
      {head && <path d={CROWN} fill={color} stroke="var(--ink)" strokeWidth="2" />}
    </svg>
  );
}

/** Under the crosshair while it's locked: who it's on, and HEAD on a head. */
export function AimTag({ lock, name }: { lock: AimLock; name: string }) {
  if (!lock) return null;
  return (
    <div className={`aim-name${lock === 'head' ? ' head' : ''}`}>
      {name}
      {lock === 'head' && <b> HEAD</b>}
    </div>
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
