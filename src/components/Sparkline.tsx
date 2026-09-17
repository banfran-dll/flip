import type { PricePoint } from '../lib/history';
import { compact } from '../lib/format';

interface Props {
  points: PricePoint[];
  width?: number;
  height?: number;
}

/** Two-line SVG chart of instabuy (upper) and instasell (lower) prices. */
export function Sparkline({ points, width = 360, height = 90 }: Props) {
  const values = points.flatMap((p) => [p.buy, p.sell]).filter(Number.isFinite);
  if (points.length < 2 || values.length === 0) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || max * 0.01 || 1;
  const padX = 4;
  const padY = 6;
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const dt = t1 - t0 || 1;

  const x = (t: number) => padX + ((t - t0) / dt) * (width - padX * 2);
  const y = (v: number) => height - padY - ((v - min) / span) * (height - padY * 2);
  const path = (pick: (p: PricePoint) => number) =>
    points
      .filter((p) => Number.isFinite(pick(p)))
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(pick(p)).toFixed(1)}`)
      .join(' ');

  return (
    <div className="sparkline">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" role="img">
        <path d={path((p) => p.buy)} className="sparkline__buy" fill="none" />
        <path d={path((p) => p.sell)} className="sparkline__sell" fill="none" />
      </svg>
      <div className="sparkline__axis">
        <span>{compact(max)}</span>
        <span>{compact(min)}</span>
      </div>
    </div>
  );
}
