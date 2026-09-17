interface Props {
  /** 5-minute % change of the price we would buy at (top buy order). */
  buyPct: number;
  /** 5-minute % change of the price we would sell at (lowest sell offer). */
  sellPct: number;
}

const arrow = (v: number) => (v > 0.05 ? '▲' : v < -0.05 ? '▼' : '▶');
const cls = (v: number) => (v > 0.05 ? 'trend--up' : v < -0.05 ? 'trend--down' : 'trend--flat');

/** Compact "buy▲0.3 / sell▼1.0" indicator; empty until there is enough history. */
export function Trend({ buyPct, sellPct }: Props) {
  if (!Number.isFinite(buyPct) && !Number.isFinite(sellPct)) return <span className="muted">—</span>;
  const fmt = (v: number) => (Number.isFinite(v) ? `${arrow(v)}${Math.abs(v).toFixed(1)}` : '—');
  return (
    <span className="trend" title="buy / sell">
      <span className={Number.isFinite(buyPct) ? cls(buyPct) : ''}>{fmt(buyPct)}</span>
      <span className="muted"> / </span>
      <span className={Number.isFinite(sellPct) ? cls(sellPct) : ''}>{fmt(sellPct)}</span>
    </span>
  );
}
