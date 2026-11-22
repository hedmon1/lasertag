// What you throw: the shared recharge, button and throw for the flashbang and the frag grenade,
// plus the grenade's own pieces (its icon and the warning on the other player's screen).
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { GRENADE } from '../game/grenade.ts';
import { sfx } from './sound.ts';

export interface Throwable {
  /** Milliseconds until it's back; 0 when ready. */
  readyIn: number;
  /** Goes up with every throw, to replay the throw on screen. */
  throws: number;
  throwIt: () => void;
}

/**
 * The thrower's side: the recharge, the throw sound and a key on a laptop. `lastThrowAt` is
 * the database's record of your last throw (Live); `now` is the clock it is in.
 */
export function useThrowable(o: {
  cooldownMs: number;
  /** KeyboardEvent.code that throws it. */
  key: string;
  sound: () => void;
  canThrow: () => boolean;
  onThrow: () => void;
  now: () => number;
  lastThrowAt?: number;
}): Throwable {
  const [localAt, setLocalAt] = useState(0);
  const [throws, setThrows] = useState(0);
  const [, tick] = useState(0);
  const last = Math.max(localAt, o.lastThrowAt ?? 0);
  const readyIn = last ? Math.max(0, last + o.cooldownMs - o.now()) : 0;

  // Count down while it recharges.
  useEffect(() => {
    if (readyIn <= 0) return;
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [readyIn > 0]);

  const latest = useRef({ o, readyIn });
  latest.current = { o, readyIn };
  const throwIt = useRef(() => {
    const { o, readyIn } = latest.current;
    if (readyIn > 0 || !o.canThrow()) return;
    setLocalAt(o.now());
    setThrows((n) => n + 1);
    o.sound();
    o.onThrow();
  }).current;

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== latest.current.o.key || e.repeat || e.metaKey || e.ctrlKey || (e.target as HTMLElement)?.closest?.('input, textarea')) return;
      e.preventDefault();
      throwIt();
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [throwIt]);

  return { readyIn, throws, throwIt };
}

/** A throw button: the seconds left while it recharges, lit up with someone in range. */
export function ThrowButton(p: { t: Throwable; disabled: boolean; armed: boolean; icon: ReactNode; label: string; name: string; className: string; testId: string }) {
  const s = Math.ceil(p.t.readyIn / 1000);
  return (
    <button
      className={`hud-btn throw-btn ${p.className}${p.armed && p.t.readyIn === 0 && !p.disabled ? ' armed' : ''}`}
      data-testid={p.testId}
      disabled={p.disabled || p.t.readyIn > 0}
      aria-label={p.t.readyIn > 0 ? `${p.name} back in ${s} seconds` : `Throw ${p.name}`}
      onPointerDown={(e) => {
        e.preventDefault();
        p.t.throwIt();
      }}
    >
      {p.icon}
      {p.t.readyIn > 0 ? <span className="num">{s} S</span> : p.label}
    </button>
  );
}

/**
 * The throw on your screen: it tumbles out from the lower left into the view. A flashbang
 * pops white as it lands; a grenade lands, blinks through the rest of its fuse, then blasts.
 */
export function Thrown({ icon, kind, flightMs, fuseMs = flightMs }: { icon: ReactNode; kind: 'flash' | 'frag'; flightMs: number; fuseMs?: number }) {
  return (
    <div className="throw" style={{ '--flight': `${flightMs}ms`, '--fuse': `${fuseMs}ms` } as CSSProperties} aria-hidden>
      <div className={`thrown ${kind}`}>{icon}</div>
      <div className={kind === 'flash' ? 'flash-pop' : 'blast'} />
    </div>
  );
}

/**
 * A pixel frag grenade on a 10 x 12 grid, drawn at whole multiples: olive body in segments,
 * the fuse cap, the spoon down its side and the pin's ring (in the text colour).
 */
const FRAG: [number, number, number, number, string][] = [
  [1, 3, 8, 9, 'var(--ink)'], // outline
  [2, 4, 6, 7, '#6f8a35'], // body
  [2, 6, 6, 1, '#435a20'], // segments
  [2, 8, 6, 1, '#435a20'],
  [4, 4, 1, 7, '#435a20'],
  [3, 5, 1, 1, '#b5d26a'], // shine
  [3, 2, 4, 1, '#9aa1b5'], // fuse cap
  [4, 1, 2, 1, '#9aa1b5'],
  [7, 1, 2, 1, '#c3c8d6'], // spoon
  [8, 2, 1, 5, '#c3c8d6'],
  [0, 0, 3, 1, 'currentColor'], // pin ring
  [0, 2, 3, 1, 'currentColor'],
  [0, 1, 1, 1, 'currentColor'],
  [2, 1, 2, 1, 'currentColor'],
];

export function FragIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 10 12" shapeRendering="crispEdges" aria-hidden>
      {FRAG.map(([x, y, w, h, fill], i) => <rect key={i} x={x} y={y} width={w} height={h} fill={fill} />)}
    </svg>
  );
}

/**
 * The other player threw a grenade: a warning that blinks with each fuse beep, faster and
 * faster, until it goes off. They might not be aiming at you, but you'd better move.
 */
export function GrenadeWarning({ start }: { start: number }) {
  const [lit, setLit] = useState(true);
  useEffect(() => {
    const id = setInterval(() => {
      const t = performance.now() - start;
      setLit(GRENADE.beepsMs.some((b) => t >= b && t < b + 110));
    }, 30);
    return () => clearInterval(id);
  }, [start]);
  return (
    <div className={`grenade-warning${lit ? ' lit' : ''}`} data-testid="grenade-warning" role="alert">
      <FragIcon />
      Grenade
    </div>
  );
}

/** The grenade's throw: the G key, the pin and the throw, recharging after every throw. */
export function useGrenade(o: { canThrow: () => boolean; onThrow: () => void; now: () => number; lastThrowAt?: number }): Throwable {
  return useThrowable({ ...o, cooldownMs: GRENADE.cooldownMs, key: 'KeyG', sound: sfx.grenadeThrow });
}

export function GrenadeButton({ t, disabled, armed }: { t: Throwable; disabled: boolean; armed: boolean }) {
  return <ThrowButton t={t} disabled={disabled} armed={armed} icon={<FragIcon />} label="GRENADE" name="grenade" className="frag-btn" testId="grenade" />;
}

export function ThrownGrenade() {
  return <Thrown icon={<FragIcon />} kind="frag" flightMs={GRENADE.flightMs} fuseMs={GRENADE.fuseMs} />;
}
