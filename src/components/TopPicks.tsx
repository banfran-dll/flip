import type { T } from '../hooks/useT';
import type { Lang } from '../i18n';
import { coins, compact, duration, integer, pct } from '../lib/format';
import type { ScoredFlip } from '../lib/signals';
import { ItemName } from './ItemName';
import { RiskBadges } from './RiskBadges';
import { Trend } from './Trend';

interface Props {
  picks: ScoredFlip[];
  onSelect: (id: string) => void;
  t: T;
  lang: Lang;
}

/** The three best flips right now, phrased as concrete orders to place. */
export function TopPicks({ picks, onSelect, t, lang }: Props) {
  if (picks.length === 0) return null;
  return (
    <section className="picks" aria-label={t('topPicks')}>
      <div className="picks__header">
        <h2 className="picks__title">{t('topPicks')}</h2>
        <span className="picks__hint">{t('topPicksHint')}</span>
      </div>
      <div className="picks__grid">
        {picks.map((f, i) => (
          <button type="button" key={f.id} className="pick" onClick={() => onSelect(f.id)}>
            <div className="pick__head">
              <span className="pick__rank">#{i + 1}</span>
              <ItemName id={f.id} />
              <span className="pick__score" title={t('colScoreTip')}>
                {t('pickScore')} {compact(f.score)}
              </span>
            </div>
            <div className="pick__plan">
              {t('pickPlan', { units: integer(f.units), buy: coins(f.buyOrderPrice), sell: coins(f.sellOfferPrice) })}
            </div>
            <div className="pick__row">
              <span>
                {t('pickProfit')} <b className="pos">{compact(f.profitPerCycle)}</b>
              </span>
              <span>
                {t('pickCycle')} <b>{duration(f.cycleHours, lang)}</b>
              </span>
              <span>
                {t('colProfitHour')} <b className="pos">{compact(f.profitPerHour)}</b>
              </span>
              <span>
                {t('colMargin')} <b>{pct(f.marginPct)}</b>
              </span>
            </div>
            <div className="pick__row muted">
              <span>{f.signals.samples < 2 ? t('collectingHistory') : t('persisted', { n: f.signals.persisted })}</span>
              <span>{t('undercut', { p: Math.round(f.signals.undercut * 100) })}</span>
              <span>
                {t('confidence')} {pct(f.confidence * 100, 0)}
              </span>
              <Trend buyPct={f.signals.trendSellPct} sellPct={f.signals.trendBuyPct} />
              <RiskBadges flags={f.flags} t={t} />
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
