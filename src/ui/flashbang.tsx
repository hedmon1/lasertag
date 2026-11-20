// The flashbang on screen: its button, the throw, and the white screen when one catches you.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { FLASH, flashReadyIn, flashWhiteness } from '../game/flash.ts';
import { sfx } from './sound.ts';

/**
 * A pixel flashbang on a 10 x 12 grid, drawn at whole multiples so every pixel stays sharp: pale
 * body with a yellow band, dark cap, the spoon down its side and the pin's ring.
 */
const PIXELS: [number, number, number, number, string][] = [
  [2, 2, 7, 10, 'var(--ink)'], // outline
  [3, 3, 5, 2, '#4a4f66'], // cap
  [3, 5, 5, 6, '#e3e7f0'], // body
  [3, 7, 5, 2, 'var(--yellow)'], // band
  [4, 5, 1, 2, '#ffffff'], // shine
  [4, 9, 1, 2, '#ffffff'],
  [8, 1, 2, 1, '#9aa1b5'], // spoon
  [9, 2, 1, 7, '#9aa1b5'],
  // The pin's ring takes the text colour, so it shows on the yellow button too.
  [0, 0, 3, 1, 'currentColor'], // pin ring
  [0, 2, 3, 1, 'currentColor'],
  [0, 1, 1, 1, 'currentColor'],
  [2, 1, 1, 1, 'currentColor'],
  [3, 1, 1, 2, 'currentColor'],
];

export function FlashbangIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 10 12" shapeRendering="crispEdges" aria-hidden>
      {PIXELS.map(([x, y, w, h, fill], i) => <rect key={i} x={x} y={y} width={w} height={h} fill={fill} />)}
    </svg>
  );
}

export interface Flashbang {
  /** Milliseconds until it's back; 0 when ready. */
  readyIn: number;
  /** Goes up with every throw, to replay the throw on screen. */
  throws: number;
  throwIt: () => void;
}

/**
 * The thrower's side: the recharge, the throw sound and the F key. `lastThrowAt` is the
 * database's record of your last throw (Live); `now` is the clock it is in.
 */
export function useFlashbang(o: { canThrow: () => boolean; onThrow: () => void; now: () => number; lastThrowAt?: number }): Flashbang {
  const [localAt, setLocalAt] = useState(0);
  const [throws, setThrows] = useState(0);
  const [, tick] = useState(0);
  const readyIn = flashReadyIn(Math.max(localAt, o.lastThrowAt ?? 0), o.now());

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
    sfx.flashThrow();
    o.onThrow();
  }).current;

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'KeyF' || e.repeat || e.metaKey || e.ctrlKey || (e.target as HTMLElement)?.closest?.('input, textarea')) return;
      e.preventDefault();
      throwIt();
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [throwIt]);

  return { readyIn, throws, throwIt };
}

/** The Flash button: shows the seconds left while it recharges, and lights up with someone in range. */
export function FlashButton({ f, disabled, armed }: { f: Flashbang; disabled: boolean; armed: boolean }) {
  const s = Math.ceil(f.readyIn / 1000);
  return (
    <button
      className={`hud-btn flash-btn${armed && f.readyIn === 0 && !disabled ? ' armed' : ''}`}
      data-testid="flash"
      disabled={disabled || f.readyIn > 0}
      aria-label={f.readyIn > 0 ? `Flashbang back in ${s} seconds` : 'Throw flashbang'}
      onPointerDown={(e) => {
        e.preventDefault();
        f.throwIt();
      }}
    >
      <FlashbangIcon />
      {f.readyIn > 0 ? <span className="num">{s} S</span> : 'FLASH'}
    </button>
  );
}

/** The throw: the flashbang tumbles out from the lower left into the view, then pops where it lands. */
export function ThrownFlashbang() {
  return (
    <div className="throw" style={{ '--flight': `${FLASH.flightMs}ms` } as CSSProperties} aria-hidden>
      <div className="thrown"><FlashbangIcon /></div>
      <div className="flash-pop" />
    </div>
  );
}

/** Caught: the screen is pure white, then fades as your eyes recover. Taps still go through. */
export function Whiteout({ start, by }: { start: number; by: string }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const step = () => {
      const w = flashWhiteness(performance.now() - start);
      if (el.current) el.current.style.opacity = String(w);
      if (w > 0) raf = requestAnimationFrame(step);
    };
    step();
    return () => cancelAnimationFrame(raf);
  }, [start]);
  return (
    <div ref={el} className="whiteout" data-testid="flashed">
      <span>Flashed by {by}</span>
    </div>
  );
}
