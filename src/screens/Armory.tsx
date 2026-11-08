import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, Check, Volume2 } from 'lucide-react';
import { GUNS, gun as gunById, hitsToEliminate, shotsPerSecond, type Gun, type GunId } from '../game/guns.ts';
import { GunPreview } from '../ui/GunPreview.tsx';
import { savedGun, saveGun } from '../ui/loadout.ts';
import { go, useRoute } from '../ui/router.ts';
import { loadGunSounds, sfx, unlockAudio } from '../ui/sound.ts';

const MAX_RATE = Math.max(...GUNS.map(shotsPerSecond));
const MAX_MAG = Math.max(...GUNS.map((g) => g.magazine));
/** A range bar is full at this many metres (and for a gun with no limit). */
const FULL_RANGE_M = 40;

const MODE: Record<Gun['mode'], (g: Gun) => string> = {
  semi: () => 'One shot per pull',
  auto: () => 'Hold Fire for automatic',
  burst: (g) => `${g.burst!.count}-round burst`,
};

/** Pick a gun: a display case for the one you are looking at, and every gun below it. */
export function Armory() {
  const { query } = useRoute();
  const back = query.get('back') ?? '';
  const [equipped, setEquipped] = useState<GunId>(savedGun);
  const [viewing, setViewing] = useState<GunId>(equipped);
  const [kick, setKick] = useState(0);
  const timers = useRef<number[]>([]);
  const display = useRef<HTMLElement>(null);
  const g = gunById(viewing);

  useEffect(() => {
    loadGunSounds([viewing]);
  }, [viewing]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  /** Plays the gun as it fires: one shot, a burst, or a short automatic string. */
  function testFire() {
    unlockAudio();
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const count = g.mode === 'burst' ? g.burst!.count : g.mode === 'auto' ? 5 : 1;
    const gap = g.mode === 'burst' ? g.burst!.gapMs : g.fireMs;
    for (let i = 0; i < count; i++) {
      timers.current.push(
        window.setTimeout(() => {
          sfx.shot(g.id);
          setKick((k) => k + 1);
        }, i * gap),
      );
    }
  }

  function equip() {
    saveGun(g.id);
    setEquipped(g.id);
  }

  const rate = shotsPerSecond(g);
  const isEquipped = equipped === g.id;
  return (
    <main className="page armory">
      <div className="row">
        <button className="btn btn-small" onClick={() => go(back)}><ArrowLeft />Back</button>
        <div className="brand grow" style={{ textAlign: 'right' }}>Armory</div>
      </div>

      <section ref={display} className="display" style={{ '--accent': g.color } as CSSProperties} aria-label={`${g.name}, ${g.kind}`}>
        <div className="display-stage">
          <GunPreview key={kick} id={g.id} w={320} h={140} className={kick ? 'kick' : ''} flash={kick > 0} />
        </div>
        <div className="display-body">
          <div className="display-title">
            <h1>{g.name}</h1>
            <span className="tag">{g.kind}</span>
            {isEquipped && <span className="tag you">Equipped</span>}
          </div>
          <p className="muted display-blurb">{g.blurb}</p>
          <div className="stats-list">
            <StatBar label="Damage" value={`${g.damage} · ${hitsToEliminate(g)} hits`} frac={g.damage / 100} />
            <StatBar label="Fire rate" value={`${rate.toFixed(1)} / s`} frac={rate / MAX_RATE} />
            <StatBar label="Range" value={g.rangeM ? `${g.rangeM} m` : 'Any'} frac={g.rangeM ? g.rangeM / FULL_RANGE_M : 1} />
            <StatBar label="Magazine" value={String(g.magazine)} frac={g.magazine / MAX_MAG} />
          </div>
          <p className="small muted">
            {MODE[g.mode](g)} · Reload {(g.reloadMs / 1000).toFixed(1)} s · Scope {g.scope}x
          </p>
          <div className="row display-actions">
            <button className="btn grow" onClick={testFire}><Volume2 />Test fire</button>
            <button className="btn btn-primary grow" disabled={isEquipped} onClick={equip}>
              <Check />
              {isEquipped ? 'Equipped' : 'Equip'}
            </button>
          </div>
        </div>
      </section>

      <div className="gun-grid" role="group" aria-label="Guns">
        {GUNS.map((x) => (
          <button
            key={x.id}
            className={`gun-tile${x.id === viewing ? ' on' : ''}`}
            style={{ '--accent': x.color } as CSSProperties}
            aria-pressed={x.id === viewing}
            onClick={() => {
              setViewing(x.id);
              // The case is above the grid: bring it back into view to show the pick.
              const top = display.current?.getBoundingClientRect().top ?? 0;
              if (top < 0) display.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
            }}
          >
            <GunPreview id={x.id} w={150} h={66} />
            <span className="gun-tile-name">{x.name}</span>
            <span className="gun-tile-kind">{x.kind}</span>
            {x.id === equipped && <span className="gun-tile-badge">Equipped</span>}
          </button>
        ))}
      </div>
    </main>
  );
}

/** Ten pixel blocks, lit in the gun's accent colour. */
function StatBar({ label, value, frac }: { label: string; value: string; frac: number }) {
  const lit = Math.max(1, Math.min(10, Math.round(frac * 10)));
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-bar" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={10} aria-valuenow={lit}>
        {Array.from({ length: 10 }, (_, i) => <i key={i} className={i < lit ? 'on' : ''} />)}
      </span>
      <span className="stat-value num">{value}</span>
    </div>
  );
}
