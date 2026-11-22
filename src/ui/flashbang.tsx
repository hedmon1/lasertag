// The flashbang on screen: its button, the throw, and the white screen when one catches you.
import { useEffect, useRef } from 'react';
import { FLASH, flashWhiteness } from '../game/flash.ts';
import { sfx } from './sound.ts';
import { ThrowButton, Thrown, useThrowable, type Throwable } from './throwables.tsx';

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

/** The flashbang's throw: the F key, the pin and the bang, recharging after every throw. */
export function useFlashbang(o: { canThrow: () => boolean; onThrow: () => void; now: () => number; lastThrowAt?: number }): Throwable {
  return useThrowable({ ...o, cooldownMs: FLASH.cooldownMs, key: 'KeyF', sound: sfx.flashThrow });
}

/** The Flash button: shows the seconds left while it recharges, and lights up with someone in range. */
export function FlashButton({ f, disabled, armed }: { f: Throwable; disabled: boolean; armed: boolean }) {
  return <ThrowButton t={f} disabled={disabled} armed={armed} icon={<FlashbangIcon />} label="FLASH" name="flashbang" className="flash-btn" testId="flash" />;
}

/** The throw: the flashbang tumbles out from the lower left into the view, then pops where it lands. */
export function ThrownFlashbang() {
  return <Thrown icon={<FlashbangIcon />} kind="flash" flightMs={FLASH.flightMs} />;
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
