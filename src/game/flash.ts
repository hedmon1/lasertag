// The flashbang. Throw it with the other player anywhere in view (the crosshair doesn't need
// to be on them) and their screen goes white, their ears ring and every sound goes muffled
// until it wears off. It does no damage. One flashbang, recharged 20 s after each throw,
// hit or miss. database.rules.json enforces the recharge and the range (scripts/build-rules.mjs
// writes these numbers into it).

export const FLASH = {
  /** Time between throws. */
  cooldownMs: 20000,
  /** How far it carries; anyone further away is not caught. */
  rangeM: 15,
  /** Fully white. */
  holdMs: 1500,
  /** Then the white fades and the hearing comes back. */
  fadeMs: 2500,
  /** From the throw to the bang, on the thrower's screen. */
  flightMs: 600,
};

export const FLASH_TOTAL_MS = FLASH.holdMs + FLASH.fadeMs;

/** How white the screen is `sinceMs` after the bang: 1 while it holds, then an easing fade to 0. */
export function flashWhiteness(sinceMs: number): number {
  if (sinceMs < 0) return 0;
  if (sinceMs <= FLASH.holdMs) return 1;
  const t = (sinceMs - FLASH.holdMs) / FLASH.fadeMs;
  return t >= 1 ? 0 : (1 - t) ** 2;
}

/** Milliseconds until the flashbang is back, 0 when it's ready. `lastThrowAt` 0 means never thrown. */
export function flashReadyIn(lastThrowAt: number, now: number): number {
  if (!lastThrowAt) return 0;
  return Math.max(0, lastThrowAt + FLASH.cooldownMs - now);
}
