// The first-person gun at the right edge of the camera view: the equipped gun in a gloved
// hand, pointing at the crosshair (the 3D models are in gunModel.ts and gunShapes.ts). Each
// shot kicks it back, cycles its action (slide, bolt, pump or hammer), flashes the muzzle,
// ejects a casing and sends a tracer into the crosshair. A reload dips the gun for the
// magazine swap and brings it back up to work the action, timed to that gun's reload.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { buildGun, FRAME, type GunModel, type Poly } from './gunModel.ts';
import { SHAPES } from './gunShapes.ts';
import { gun as gunById, type Gun as GunSpec, type GunId } from '../game/guns.ts';

interface Props {
  gun: GunId;
  /** Goes up by one per shot; each change plays the shot animation. */
  shots: number;
  reloading: boolean;
  /** Out of ammo: a slide stays locked back. */
  empty: boolean;
}

interface Tracer {
  key: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** How hard each gun kicks (px, px, degrees, ms) and how big its muzzle flash is. */
const FEEL: Record<GunId, { kick: [number, number, number, number]; flash: number }> = {
  blip: { kick: [4, 7, 5, 220], flash: 0.65 },
  stinger: { kick: [2, 4, 2.5, 100], flash: 0.5 },
  triplet: { kick: [3, 6, 3.5, 150], flash: 0.7 },
  thumper: { kick: [6, 10, 9, 320], flash: 0.85 },
  boomstick: { kick: [8, 13, 11, 360], flash: 1.05 },
  longshot: { kick: [7, 11, 8, 380], flash: 0.95 },
};

/** When the action cycles after the shot (ms after it, and how long it takes). */
const CYCLE: Record<GunSpec['sound']['action'], [number, number]> = {
  slide: [0, 130],
  hammer: [0, 200],
  pump: [330, 380],
  bolt: [420, 560],
};

const models = new Map<GunId, GunModel>();
function model(id: GunId): GunModel {
  let m = models.get(id);
  if (!m) models.set(id, (m = buildGun(SHAPES[id])));
  return m;
}

const px = (n: number) => `${n.toFixed(1)}px`;

// Sized against a 390 px wide phone, so the barrel lines up with the crosshair on phones.
function style(g: GunSpec, m: GunModel): CSSProperties {
  const [kx, ky, kr, kms] = FEEL[g.id].kick;
  const [delay, ms] = CYCLE[g.sound.action];
  return {
    width: `min(${((m.width / FRAME.w) * 100).toFixed(2)}vw, ${Math.round(m.width * 1.2)}px)`,
    '--travel-x': px(m.travel[0]),
    '--travel-y': px(m.travel[1]),
    '--pivot': `${px(m.pivot[0])} ${px(m.pivot[1])}`,
    '--kick-x': px(kx),
    '--kick-y': px(ky),
    '--kick-rot': `${kr}deg`,
    '--kick-ms': `${kms}ms`,
    '--cycle-delay': `${delay}ms`,
    '--cycle-ms': `${ms}ms`,
    '--reload-ms': `${g.reloadMs}ms`,
  } as CSSProperties;
}

function Polys({ list }: { list: Poly[] }) {
  return (
    <>
      {list.map((p, i) => (
        <polygon key={i} points={p.points} fill={p.fill} stroke={p.outline ? 'var(--gun-ink)' : 'none'} strokeWidth="1.6" strokeLinejoin="round" />
      ))}
    </>
  );
}

/** A shotgun throws a fan of pellets; everything else one round. */
const SPREAD: Partial<Record<GunId, [number, number][]>> = { boomstick: [[0, 0], [-16, 10], [14, -12]] };

export function Gun({ gun: id, shots, reloading, empty }: Props) {
  const g = gunById(id);
  const m = model(g.id);
  const muzzle = useRef<SVGCircleElement>(null);
  const [tracers, setTracers] = useState<Tracer[]>([]);
  const [kick, setKick] = useState(0);

  useEffect(() => {
    const el = muzzle.current;
    if (!shots || !el) return;
    const r = el.getBoundingClientRect();
    const x1 = r.left + r.width / 2, y1 = r.top + r.height / 2;
    const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    setKick(shots);
    setTracers((SPREAD[id] ?? [[0, 0]]).map(([dx, dy], i) => ({ key: shots * 10 + i, x1, y1, x2: cx + dx, y2: cy + dy })));
    const t1 = setTimeout(() => setTracers([]), 200);
    const t2 = setTimeout(() => setKick(0), 900);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [shots, id]);

  const locked = empty && g.sound.action === 'slide';
  const state = reloading ? ' reloading' : locked ? ' empty' : '';
  const [mx, my] = m.muzzle;
  const [ex, ey] = m.ejection;
  const flash = FEEL[g.id].flash;
  return (
    <>
      {tracers.length > 0 && (
        <svg className="tracer-layer" aria-hidden>
          {tracers.map((t) => (
            <line key={t.key} className="tracer" x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} pathLength={100} />
          ))}
        </svg>
      )}
      <svg
        className={`gun${state}`}
        viewBox={`0 0 ${m.width.toFixed(1)} ${m.height.toFixed(1)}`}
        style={style(g, m)}
        aria-hidden
        data-testid="gun"
        data-gun={g.id}
        data-shots={shots}
      >
        <g key={`${g.id}-${reloading ? 'reload' : 'ready'}-${kick}`} className={kick && !reloading ? 'gun-body kick' : 'gun-body'}>
          <Polys list={m.parts.body} />
          <g className="gun-action"><Polys list={m.parts.action} /></g>
          <Polys list={m.parts.hand} />
          {/* Muzzle flash, drawn along the barrel: a blocky burst pointing at the crosshair. */}
          <g transform={`translate(${mx.toFixed(1)} ${my.toFixed(1)}) rotate(${m.axisDeg.toFixed(1)}) scale(${flash})`}>
            <g className="gun-flash" stroke="var(--gun-ink)" strokeWidth="2">
              <rect x="0" y="-11" width="22" height="22" fill="var(--gun-flash)" />
              <rect x="18" y="-6" width="22" height="12" fill="var(--gun-flash)" />
              <rect x="6" y="-20" width="10" height="40" fill="var(--gun-flash)" />
              <rect x="4" y="-5" width="14" height="10" fill="var(--gun-flash-core)" stroke="none" />
            </g>
          </g>
          <circle ref={muzzle} cx={mx} cy={my} r="1" fill="none" />
          {/* Spent casing, thrown up and out when the action cycles. A revolver keeps its brass. */}
          {g.sound.casing && (
            <rect
              className={`gun-casing${g.id === 'boomstick' ? ' shell' : ''}`}
              x={ex - 4}
              y={ey - 2.5}
              width="8"
              height="5"
              fill={g.id === 'boomstick' ? 'var(--red)' : 'var(--gun-brass)'}
              stroke="var(--gun-ink)"
              strokeWidth="1.5"
            />
          )}
        </g>
      </svg>
    </>
  );
}
