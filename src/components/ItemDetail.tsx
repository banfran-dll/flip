import { useEffect, useMemo, useState } from 'react';
import type { BazaarProduct } from '../api/bazaar';
import type { T } from '../hooks/useT';
import type { Lang } from '../i18n';
import { MAX_ORDER_SIZE, planFlip, walkBook } from '../lib/flip';
import { confidenceParts, type ScoredFlip } from '../lib/signals';
import { Trend } from './Trend';
import { coins, compact, duration, integer, parseCoins, pct } from '../lib/format';
import type { PricePoint } from '../lib/history';
import { itemName } from '../lib/names';
import { ItemName } from './ItemName';
import { NumField } from './NumField';
import { OrderBook } from './OrderBook';
import { RiskBadges } from './RiskBadges';
import { Sparkline } from './Sparkline';

interface Props {
  product: BazaarProduct;
  flip: ScoredFlip | null;
  taxRate: number;
  budget: number;
  history: PricePoint[];
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onClose: () => void;
  t: T;
  lang: Lang;
}

export function ItemDetail({ product, flip, taxRate, budget, history, isFavorite, onToggleFavorite, onClose, t, lang }: Props) {
  const id = product.product_id;
  const q = product.quick_status;
  const [qty, setQty] = useState<number>(flip?.units ?? 64);
  const [copied, setCopied] = useState(false);

  // Reset the calculator when the user opens a different item.
  useEffect(() => {
    setQty(flip?.units ?? 64);
    setCopied(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const plan = useMemo(() => (flip ? planFlip(flip, qty, taxRate) : null), [flip, qty, taxRate]);
  const instaBuy = useMemo(() => walkBook(product.buy_summary, qty), [product, qty]);
  const instaSell = useMemo(() => walkBook(product.sell_summary, qty), [product, qty]);

  const wikiUrl = `https://wiki.hypixel.net/${encodeURIComponent(itemName(id).replace(/ /g, '_'))}`;

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <aside className="detail" aria-label={t('detailTitle')}>
      <header className="detail__header">
        <div className="detail__title">
          <ItemName id={id} />
        </div>
        <div className="detail__actions">
          <button type="button" className={`btn btn--icon ${isFavorite ? 'is-active' : ''}`} onClick={onToggleFavorite} title={isFavorite ? t('unfavorite') : t('favorite')}>
            {isFavorite ? '★' : '☆'}
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={copyId}>
            {copied ? t('copied') : t('copyId')}
          </button>
          <a className="btn btn--ghost btn--sm" href={wikiUrl} target="_blank" rel="noreferrer">
            {t('wiki')} ↗
          </a>
          <button type="button" className="btn btn--icon" onClick={onClose} title={t('close')} aria-label={t('close')}>
            ✕
          </button>
        </div>
      </header>

      <section className="stats">
        <Stat label={t('instaBuy')} value={product.buy_summary[0] ? coins(product.buy_summary[0].pricePerUnit) : '—'} sub={`${t('weightedBuy')} ${coins(q.buyPrice)}`} />
        <Stat label={t('instaSell')} value={product.sell_summary[0] ? coins(product.sell_summary[0].pricePerUnit) : '—'} sub={`${t('weightedSell')} ${coins(q.sellPrice)}`} />
        <Stat label={t('weekVolume')} value={`${compact(q.sellMovingWeek)} → ${compact(q.buyMovingWeek)}`} sub={`${t('colWeekSell')} → ${t('colWeekBuy')}`} />
        <Stat label={t('openOrders')} value={`${integer(q.sellOrders)} / ${integer(q.buyOrders)}`} sub={`${t('colOpenVolume')}: ${compact(q.sellVolume)} / ${compact(q.buyVolume)}`} />
      </section>

      {flip ? (
        <section className="panel">
          <h3 className="panel__title">{t('flipSummary')}</h3>
          <div className="kv">
            <Row k={t('colBuyOrder')} v={coins(flip.buyOrderPrice)} />
            <Row k={t('colSellOffer')} v={coins(flip.sellOfferPrice)} />
            <Row k={t('colProfitUnit')} v={<span className={flip.profitPerUnit > 0 ? 'pos' : 'neg'}>{coins(flip.profitPerUnit)}</span>} />
            <Row k={t('colMargin')} v={pct(flip.marginPct)} />
            <Row k={t('colFlow')} v={`${compact(flip.instaSellsPerHour)} → ${compact(flip.instaBuysPerHour)}`} />
            <Row k={t('colProfitHour')} v={<span className="pos strong">{compact(flip.profitPerHour)}</span>} />
            <Row k={t('colOrders')} v={`${integer(flip.competingBuyOrders)} / ${integer(flip.competingSellOffers)}`} />
          </div>
          <RiskBadges flags={flip.flags} t={t} verbose />
          <h4 className="panel__subtitle">{t('signals')}</h4>
          <SignalRows flip={flip} t={t} />
        </section>
      ) : (
        <section className="panel muted">{t('noFlipPossible')}</section>
      )}

      <section className="panel">
        <h3 className="panel__title">{t('calculator')}</h3>
        <div className="field__row">
          <NumField className="input" value={qty} onChange={(n) => setQty(Math.max(0, Math.floor(n)))} parse={parseCoins} format={integer} aria-label={t('quantity')} />
          {flip && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setQty(Math.min(Math.floor(budget / flip.buyOrderPrice), MAX_ORDER_SIZE))}>
              {t('useBudget')}
            </button>
          )}
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setQty(MAX_ORDER_SIZE)}>
            {t('maxOrder')}
          </button>
        </div>
        {plan && (
          <div className="kv">
            <Row k={t('cost')} v={compact(plan.cost)} title={coins(plan.cost)} />
            <Row k={t('revenue')} v={compact(plan.revenue)} title={coins(plan.revenue)} />
            <Row k={t('tax')} v={compact(plan.tax)} title={coins(plan.tax)} />
            <Row k={t('profit')} v={<span className={plan.profit > 0 ? 'pos strong' : 'neg strong'}>{compact(plan.profit)}</span>} title={coins(plan.profit)} />
            <Row k={t('buyFill')} v={duration(plan.buyFillHours, lang)} />
            <Row k={t('sellFill')} v={duration(plan.sellFillHours, lang)} />
          </div>
        )}
        <h4 className="panel__subtitle">{t('instantSim')}</h4>
        <div className="kv">
          <Row
            k={t('instantBuyCost', { n: integer(qty) })}
            v={instaBuy.filled > 0 ? `${compact(instaBuy.total)} (${t('avgPrice')} ${coins(instaBuy.averagePrice)})` : '—'}
          />
          <Row
            k={t('instantSellRevenue', { n: integer(qty) })}
            v={instaSell.filled > 0 ? `${compact(instaSell.total * (1 - taxRate))} (${t('avgPrice')} ${coins(instaSell.averagePrice)})` : '—'}
          />
        </div>
        {(instaBuy.partial || instaSell.partial) && <p className="field__hint">{t('partialFill')}</p>}
      </section>

      <section className="panel">
        <h3 className="panel__title">{t('sessionChart')}</h3>
        {history.length >= 2 ? <Sparkline points={history} /> : <p className="muted">{t('notEnoughPoints')}</p>}
        <p className="field__hint">{t('sessionChartHint')}</p>
      </section>

      <section className="panel">
        <h3 className="panel__title">{t('orderBook')}</h3>
        <div className="books">
          <OrderBook levels={product.sell_summary} side="buy" title={t('buyOrdersSide')} highlight={product.sell_summary[0]?.pricePerUnit} t={t} />
          <OrderBook levels={product.buy_summary} side="sell" title={t('sellOffersSide')} highlight={product.buy_summary[0]?.pricePerUnit} t={t} />
        </div>
      </section>
    </aside>
  );
}

function SignalRows({ flip, t }: { flip: ScoredFlip; t: T }) {
  const sg = flip.signals;
  const parts = confidenceParts(flip, sg);
  const spread = Number.isFinite(sg.trendBuyPct) && Number.isFinite(sg.trendSellPct) ? sg.trendBuyPct - sg.trendSellPct : NaN;
  return (
    <div className="kv">
      <Row k={t('colScore')} v={<span className="strong">{compact(flip.score)}</span>} />
      <Row
        k={t('confidence')}
        v={`${pct(flip.confidence * 100, 0)}  (${t('stabilityFactor')} ${parts.stability.toFixed(2)} × ${t('competitionFactor')} ${parts.competition.toFixed(2)} × ${t('flagFactor')} ${parts.flagPenalty.toFixed(2)})`}
      />
      <Row k={t('colStability')} v={sg.samples < 2 ? t('collectingHistory') : `${t('persisted', { n: sg.persisted })} · ${t('undercut', { p: Math.round(sg.undercut * 100) })}`} />
      <Row k={`${t('colTrend')} (${t('colBuyOrder')} / ${t('colSellOffer')})`} v={Number.isFinite(sg.trendBuyPct) || Number.isFinite(sg.trendSellPct) ? <Trend buyPct={sg.trendSellPct} sellPct={sg.trendBuyPct} /> : t('collectingHistory')} />
      {Number.isFinite(spread) && Math.abs(spread) > 0.05 && (
        <Row k={t('colSpread')} v={<span className={spread > 0 ? 'pos' : 'neg'}>{spread > 0 ? t('spreadWidening') : t('spreadNarrowing')}</span>} />
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value">{value}</div>
      {sub && <div className="stat__sub">{sub}</div>}
    </div>
  );
}

function Row({ k, v, title }: { k: string; v: React.ReactNode; title?: string }) {
  return (
    <div className="kv__row" title={title}>
      <span className="kv__key">{k}</span>
      <span className="kv__value">{v}</span>
    </div>
  );
}
