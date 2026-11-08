// A gun side-on, for the Armory, the home screen and the lobby (the same 3D model as in first
// person, through the showcase camera in gunModel.ts).
import { buildShowcase, type Poly, type Showcase } from './gunModel.ts';
import { SHAPES } from './gunShapes.ts';
import type { GunId } from '../game/guns.ts';

const cache = new Map<string, Showcase>();
function showcase(id: GunId, w: number, h: number): Showcase {
  const key = `${id}:${w}x${h}`;
  let s = cache.get(key);
  if (!s) cache.set(key, (s = buildShowcase(SHAPES[id], w, h)));
  return s;
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

/** `flash` draws a muzzle flash at the end of the barrel (the Armory's test fire). */
export function GunPreview({ id, w = 300, h = 130, className = '', flash = false }: { id: GunId; w?: number; h?: number; className?: string; flash?: boolean }) {
  const s = showcase(id, w, h);
  const [mx, my] = s.muzzle;
  return (
    <svg className={`gun-preview ${className}`} viewBox={`0 0 ${w} ${h}`} aria-hidden data-gun={id}>
      <Polys list={s.parts.body} />
      <Polys list={s.parts.action} />
      {flash && (
        <g className="preview-flash" transform={`translate(${mx.toFixed(1)} ${my.toFixed(1)})`} stroke="var(--gun-ink)" strokeWidth="2">
          <rect x="0" y="-9" width="18" height="18" fill="var(--gun-flash)" />
          <rect x="14" y="-5" width="18" height="10" fill="var(--gun-flash)" />
          <rect x="5" y="-16" width="8" height="32" fill="var(--gun-flash)" />
          <rect x="3" y="-4" width="11" height="8" fill="var(--gun-flash-core)" stroke="none" />
        </g>
      )}
    </svg>
  );
}
