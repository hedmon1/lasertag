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

export function GunPreview({ id, w = 300, h = 130, className = '' }: { id: GunId; w?: number; h?: number; className?: string }) {
  const s = showcase(id, w, h);
  return (
    <svg className={`gun-preview ${className}`} viewBox={`0 0 ${w} ${h}`} aria-hidden data-gun={id}>
      <Polys list={s.parts.body} />
      <Polys list={s.parts.action} />
    </svg>
  );
}
