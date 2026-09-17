import type { T } from '../hooks/useT';
import type { Lang } from '../i18n';
import { ago } from '../lib/format';

interface Props {
  t: T;
  lang: Lang;
  query: string;
  onQuery: (q: string) => void;
  loading: boolean;
  error: string | null;
  fetchedAt: number | null;
  lastUpdated: number | null;
  now: number;
  onRefresh: () => void;
  onToggleLang: () => void;
  onToggleSettings: () => void;
}

export function Header({ t, lang, query, onQuery, loading, error, fetchedAt, lastUpdated, now, onRefresh, onToggleLang, onToggleSettings }: Props) {
  return (
    <header className="header">
      <div className="header__brand">
        <span className="header__logo" aria-hidden>
          ⚖
        </span>
        <div>
          <div className="header__title">{t('appTitle')}</div>
          <div className="header__subtitle">{t('appSubtitle')}</div>
        </div>
      </div>

      <div className="header__search">
        <input
          type="search"
          className="input input--search"
          placeholder={t('searchPlaceholder')}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          aria-label={t('searchPlaceholder')}
        />
      </div>

      <div className="header__status">
        {error ? (
          <span className="status status--error" title={error}>
            {t('apiError')}: {error}
          </span>
        ) : fetchedAt ? (
          <span className="status">
            <span className={`status__dot ${loading ? 'is-loading' : ''}`} />
            {lastUpdated && <span>{t('dataAge', { age: ago((now - lastUpdated) / 1000, lang) })}</span>}
            <span className="muted">· {t('fetchedAge', { age: ago((now - fetchedAt) / 1000, lang) })}</span>
          </span>
        ) : (
          <span className="status">{t('loading')}</span>
        )}
        <button type="button" className="btn btn--ghost btn--sm" onClick={onRefresh} disabled={loading}>
          ⟳ {t('refreshNow')}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onToggleLang}>
          {t('language')}
        </button>
        <button type="button" className="btn btn--ghost btn--sm header__settings-toggle" onClick={onToggleSettings}>
          ⚙ {t('settings')}
        </button>
      </div>
    </header>
  );
}
