import type { T } from '../hooks/useT';
import type { Lang } from '../i18n';
import type { AlertEvent } from '../lib/alerts';
import { ago, coins, compact, pct } from '../lib/format';
import { ItemName } from './ItemName';

interface Props {
  events: AlertEvent[];
  now: number;
  onOpen: (id: string) => void;
  onDismiss: (at: number, id: string) => void;
  onClear: () => void;
  t: T;
  lang: Lang;
}

export function AlertToasts({ events, now, onOpen, onDismiss, onClear, t, lang }: Props) {
  if (events.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {events.slice(0, 5).map((e) => (
        <div key={`${e.at}-${e.id}`} className="toast">
          <button type="button" className="toast__body" onClick={() => onOpen(e.id)}>
            <div className="toast__head">
              <span className="toast__tag">{t('alertNew')}</span>
              <span className="muted">{ago((now - e.at) / 1000, lang)}</span>
            </div>
            <ItemName id={e.id} showId={false} />
            <div className="toast__line">
              {t('alertBody', { buy: coins(e.buyOrderPrice), sell: coins(e.sellOfferPrice), margin: pct(e.marginPct), perHour: compact(e.profitPerHour) })}
            </div>
          </button>
          <button type="button" className="btn btn--icon toast__close" onClick={() => onDismiss(e.at, e.id)} aria-label={t('dismiss')}>
            ✕
          </button>
        </div>
      ))}
      {events.length > 1 && (
        <button type="button" className="btn btn--ghost btn--sm toasts__clear" onClick={onClear}>
          {t('clearAll')} ({events.length})
        </button>
      )}
    </div>
  );
}
