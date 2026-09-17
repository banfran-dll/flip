import type { ReactNode } from 'react';

interface Props {
  value: number;
  prev: number | undefined;
  /** Changes on every new snapshot so the flash animation replays. */
  stamp: number;
  title?: string;
  children: ReactNode;
}

/** Wraps a cell value and flashes green/red when it moved since the previous snapshot. */
export function Changed({ value, prev, stamp, title, children }: Props) {
  const dir = prev === undefined || prev === value || !Number.isFinite(prev) ? '' : value > prev ? 'up' : 'down';
  if (!dir) return <span title={title}>{children}</span>;
  return (
    <span key={stamp} className={`chg chg--${dir}`} title={title}>
      {children}
    </span>
  );
}
