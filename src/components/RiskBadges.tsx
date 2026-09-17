import { isDangerFlag, type RiskFlag } from '../lib/flip';
import type { T } from '../hooks/useT';

interface Props {
  flags: RiskFlag[];
  t: T;
  verbose?: boolean;
}

const SHORT: Record<RiskFlag, string> = {
  LOW_VOLUME: 'VOL',
  THIN_BOOK: 'THIN',
  OUTLIER_BUY: 'OUT↑',
  OUTLIER_SELL: 'OUT↓',
  IMBALANCE: '⇅',
  HUGE_SPREAD: '!!',
  EMPTY_BOOK: '∅',
};

export function RiskBadges({ flags, t, verbose = false }: Props) {
  if (flags.length === 0) return verbose ? null : <span className="muted">—</span>;
  return (
    <span className="badges">
      {flags.map((f) => (
        <span key={f} className={`badge badge--${f.toLowerCase()} ${isDangerFlag(f) ? 'badge--danger' : 'badge--warning'}`} title={`${t(`flag_${f}`)}: ${t(`flagTip_${f}`)}`}>
          {verbose ? t(`flag_${f}`) : SHORT[f]}
        </span>
      ))}
    </span>
  );
}
