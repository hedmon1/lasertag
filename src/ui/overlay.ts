// Debug overlay: the people the detector sees, and the part of each box that counts as a hit.
import { distanceFromBox, hitArea, type PersonBox, type Pt } from '../game/personHit.ts';

/** Maps video pixels to CSS pixels of a full-bleed object-fit: cover view, with optional view zoom. */
export function videoToView(vw: number, vh: number, W: number, H: number, viewZoom = 1): (p: Pt) => Pt {
  const s = Math.max(W / vw, H / vh);
  const ox = (W - vw * s) / 2, oy = (H - vh * s) / 2;
  return (p) => ({ x: W / 2 + (p.x * s + ox - W / 2) * viewZoom, y: H / 2 + (p.y * s + oy - H / 2) * viewZoom });
}

export interface OverlayInput {
  boxes: PersonBox[];
  vw: number;
  vh: number;
  viewZoom: number;
  frameZoom: number;
}

export function drawOverlay(canvas: HTMLCanvasElement, input: OverlayInput) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  const g = canvas.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  if (!input.vw || !input.vh) return;
  const map = videoToView(input.vw, input.vh, W, H, input.viewZoom);
  const rect = (b: { x: number; y: number; w: number; h: number }) => {
    const a = map({ x: b.x, y: b.y }), c = map({ x: b.x + b.w, y: b.y + b.h });
    return { x: a.x, y: a.y, w: c.x - a.x, h: c.y - a.y };
  };
  g.font = '18px VT323, ui-monospace, Menlo, monospace';
  for (const b of input.boxes) {
    const outer = rect(b), inner = rect(hitArea(b));
    g.setLineDash([6, 6]);
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(38, 224, 255, 0.75)';
    g.strokeRect(outer.x, outer.y, outer.w, outer.h);
    g.setLineDash([]);
    g.lineWidth = 3;
    g.strokeStyle = '#c6ff3a';
    g.strokeRect(inner.x, inner.y, inner.w, inner.h);
    const d = distanceFromBox(b, input.vw, input.vh, input.frameZoom);
    const label = `person ${Math.round(b.score * 100)}%${d ? ` · ${d.toFixed(1)} m` : ''}`;
    g.fillStyle = 'rgba(5, 4, 15, 0.9)';
    g.fillRect(inner.x, inner.y - 21, g.measureText(label).width + 10, 19);
    g.fillStyle = '#f6f3ff';
    g.fillText(label, inner.x + 5, inner.y - 7);
  }
}
