import type { T } from '../hooks/useT';
import type { Lang } from '../i18n';
import type { AlertEvent } from '../lib/alerts';
import { ago } from '../lib/format';

interface Props {
  events: AlertEvent[];
  now: number;
  onOpen: (itemId: string) => void;
  onDismiss: (at: number, itemId: string) => void;
  onClear: () => void;
  t: T;
  lang: Lang;
}

export function AlertToasts({ events, now, onOpen, onDismiss, onClear, t, lang }: Props) {
  if (events.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {events.slice(0, 5).map((e) => (
        <div key={`${e.at}-${e.itemId}-${e.kind}`} className={`toast toast--${e.kind}`}>
          <button type="button" className="toast__body" onClick={() => onOpen(e.itemId)}>
            <div className="toast__head">
              <span className="toast__tag">{e.kind === 'order' ? t('tabOrders') : e.kind === 'npc' ? t('tabNpc') : t('alertNew')}</span>
              <span className="muted">{ago((now - e.at) / 1000, lang)}</span>
            </div>
            <div className="toast__title">{e.title}</div>
            <div className="toast__line">{e.body}</div>
          </button>
          <button type="button" className="btn btn--icon toast__close" onClick={() => onDismiss(e.at, e.itemId)} aria-label={t('dismiss')}>
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
