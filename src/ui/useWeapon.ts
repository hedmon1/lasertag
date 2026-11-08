// The trigger, the magazine and the reload for the equipped gun, shared by Practice and the
// live game. A semi-automatic gun fires once per pull, an automatic one keeps firing while the
// trigger is held, a burst gun fires a set number of rounds per pull. The hook plays each
// gunshot and counts rounds; `onShot` judges the shot (and in a game, sends the hit).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Gun } from '../game/guns.ts';
import { buzz, sfx, unlockAudio } from './sound.ts';

export interface WeaponOptions {
  /** Whether the gun can fire right now (camera ready, game started, alive). */
  canFire: () => boolean;
  /** One round has left the barrel. */
  onShot: () => void;
}

export interface Weapon {
  ammo: number;
  reloading: boolean;
  /** Goes up by one per round, for the gun animation. */
  shots: number;
  triggerDown: () => void;
  triggerUp: () => void;
  reload: () => void;
  /** A full magazine, for a respawn. */
  refill: () => void;
}

export function useWeapon(g: Gun, o: WeaponOptions): Weapon {
  const [ammo, setAmmo] = useState(g.magazine);
  const [reloading, setReloading] = useState(false);
  const [shots, setShots] = useState(0);
  const st = useRef({ gun: g, ammo: g.magazine, reloading: false, held: false, nextAt: 0, timers: [] as number[] });
  const opts = useRef(o);
  opts.current = o;

  const later = (fn: () => void, ms: number) => {
    st.current.timers.push(window.setTimeout(fn, ms));
  };
  const clearTimers = () => {
    for (const t of st.current.timers) clearTimeout(t);
    st.current.timers = [];
  };

  const reload = useCallback(() => {
    const s = st.current;
    if (s.reloading || s.ammo >= s.gun.magazine) return;
    clearTimers();
    s.held = false;
    s.reloading = true;
    setReloading(true);
    sfx.reload(s.gun.id);
    later(() => {
      s.ammo = s.gun.magazine;
      s.reloading = false;
      setAmmo(s.ammo);
      setReloading(false);
    }, s.gun.reloadMs);
  }, []);

  /** Fires one round. False when it couldn't (reloading, empty, not allowed). */
  const round = useCallback((): boolean => {
    const s = st.current;
    if (s.reloading || s.ammo <= 0 || !opts.current.canFire()) return false;
    s.ammo -= 1;
    setAmmo(s.ammo);
    sfx.shot(s.gun.id);
    setShots((n) => n + 1);
    buzz(s.gun.damage >= 50 ? 40 : 18);
    opts.current.onShot();
    // Out of rounds: reload once this one has gone.
    if (s.ammo <= 0) later(reload, 300);
    return true;
  }, [reload]);

  const triggerDown = useCallback(() => {
    unlockAudio();
    const s = st.current;
    const gun = s.gun;
    if (gun.mode === 'auto') {
      if (s.held) return;
      s.held = true;
    }
    if (s.reloading || performance.now() < s.nextAt || !opts.current.canFire()) return;
    if (s.ammo <= 0) {
      sfx.empty();
      reload();
      return;
    }
    s.nextAt = performance.now() + gun.fireMs;
    round();
    if (gun.mode === 'burst') {
      for (let i = 1; i < gun.burst!.count; i++) later(() => st.current.ammo > 0 && round(), i * gun.burst!.gapMs);
    } else if (gun.mode === 'auto') {
      const loop = () => {
        const now = st.current;
        if (!now.held || now.reloading || now.ammo <= 0) return;
        now.nextAt = performance.now() + gun.fireMs;
        if (round()) later(loop, gun.fireMs);
      };
      later(loop, gun.fireMs);
    }
  }, [reload, round]);

  const triggerUp = useCallback(() => {
    st.current.held = false;
  }, []);

  const refill = useCallback(() => {
    st.current.ammo = st.current.gun.magazine;
    setAmmo(st.current.ammo);
  }, []);

  // A different gun: a fresh, full magazine and nothing left in the air.
  useEffect(() => {
    const s = st.current;
    if (s.gun.id === g.id) return;
    clearTimers();
    Object.assign(s, { gun: g, ammo: g.magazine, reloading: false, held: false, nextAt: 0 });
    setAmmo(g.magazine);
    setReloading(false);
  }, [g]);

  useEffect(() => clearTimers, []);

  return { ammo, reloading, shots, triggerDown, triggerUp, reload, refill };
}

/** Space fires on a laptop (handy for testing): held for an automatic gun. */
export function useSpaceTrigger(w: Pick<Weapon, 'triggerDown' | 'triggerUp'>) {
  const ref = useRef(w);
  ref.current = w;
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      e.preventDefault();
      if (!e.repeat) ref.current.triggerDown();
    };
    const up = (e: KeyboardEvent) => e.code === 'Space' && ref.current.triggerUp();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);
}
