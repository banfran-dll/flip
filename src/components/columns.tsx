import type { BazaarProduct } from '../api/bazaar';
import type { T } from '../hooks/useT';
import type { Lang } from '../i18n';
import type { FlipResult } from '../lib/flip';
import { coins, compact, duration, integer, pct } from '../lib/format';
import { itemName } from '../lib/names';
import type { Column } from './DataTable';
import { Changed } from './Changed';
import { ItemName } from './ItemName';
import { RiskBadges } from './RiskBadges';
import { Trend } from './Trend';
import type { ScoredFlip } from '../lib/signals';
import type { NpcFlip } from '../lib/npc';

export interface LookupRow {
  id: string;
  product: BazaarProduct;
  flip: ScoredFlip | null;
}

export interface ChangeContext {
  /** Flip results from the previous distinct snapshot, for change flashes. */
  prev: ReadonlyMap<string, FlipResult>;
  /** Identifier of the current snapshot; changes replay the flash animation. */
  stamp: number;
}

export function flipColumns(t: T, lang: Lang, favorites: ReadonlySet<string>, ctx: ChangeContext): Column<ScoredFlip>[] {
  const chg = (f: ScoredFlip, pick: (x: FlipResult) => number, node: React.ReactNode, title?: string) => {
    const p = ctx.prev.get(f.id);
    return (
      <Changed value={pick(f)} prev={p ? pick(p) : undefined} stamp={ctx.stamp} title={title ?? (p ? `${t('prevValue')}: ${coins(pick(p))}` : undefined)}>
        {node}
      </Changed>
    );
  };
  return [
    {
      key: 'item',
      header: t('colItem'),
      render: (f) => <ItemName id={f.id} favorite={favorites.has(f.id)} />,
      sortValue: (f) => itemName(f.id),
      className: 'col-item',
    },
    {
      key: 'buy',
      header: t('colBuyOrder'),
      tip: t('colBuyOrderTip'),
      align: 'right',
      render: (f) => chg(f, (x) => x.buyOrderPrice, coins(f.buyOrderPrice)),
      sortValue: (f) => f.buyOrderPrice,
    },
    {
      key: 'sell',
      header: t('colSellOffer'),
      tip: t('colSellOfferTip'),
      align: 'right',
      render: (f) => chg(f, (x) => x.sellOfferPrice, coins(f.sellOfferPrice)),
      sortValue: (f) => f.sellOfferPrice,
    },
    {
      key: 'profitUnit',
      header: t('colProfitUnit'),
      tip: t('colProfitUnitTip'),
      align: 'right',
      render: (f) => chg(f, (x) => x.profitPerUnit, <span className="pos">{coins(f.profitPerUnit)}</span>),
      sortValue: (f) => f.profitPerUnit,
    },
    { key: 'margin', header: t('colMargin'), align: 'right', render: (f) => pct(f.marginPct), sortValue: (f) => f.marginPct },
    {
      key: 'flow',
      header: t('colFlow'),
      tip: t('colFlowTip'),
      align: 'right',
      render: (f) => (
        <span
          className="flow"
          title={
            f.liveWeight > 0
              ? t('rateTip', {
                  ws: compact(f.weeklyInstaSellsPerHour),
                  wb: compact(f.weeklyInstaBuysPerHour),
                  ls: compact(f.instaSellsPerHour),
                  lb: compact(f.instaBuysPerHour),
                  w: Math.round(f.liveWeight * 100),
                  a: Number.isFinite(f.activity) ? f.activity.toFixed(2) : '—',
                })
              : undefined
          }
        >
          <span className={f.instaSellsPerHour <= f.instaBuysPerHour ? 'flow__slow' : ''}>{compact(f.instaSellsPerHour)}</span>
          <span className="muted"> → </span>
          <span className={f.instaBuysPerHour < f.instaSellsPerHour ? 'flow__slow' : ''}>{compact(f.instaBuysPerHour)}</span>
          {f.liveWeight > 0 && (
            <span className="live-tag" style={{ opacity: 0.35 + 0.65 * f.liveWeight }}>
              {t('liveRate')}
            </span>
          )}
          {Number.isFinite(f.activity) && (f.activity >= 1.5 || f.activity <= 0.5) && (
            <span className={`activity ${f.activity >= 1.5 ? 'pos' : 'neg'}`} title={t('activityTip')}>
              ×{f.activity.toFixed(1)}
            </span>
          )}
        </span>
      ),
      sortValue: (f) => Math.min(f.instaSellsPerHour, f.instaBuysPerHour),
    },
    { key: 'units', header: t('colUnits'), tip: t('colUnitsTip'), align: 'right', render: (f) => integer(f.units), sortValue: (f) => f.units },
    { key: 'cycle', header: t('colCycle'), tip: t('colCycleTip'), align: 'right', render: (f) => duration(f.cycleHours, lang), sortValue: (f) => f.cycleHours },
    {
      key: 'profitHour',
      header: t('colProfitHour'),
      tip: t('colProfitHourTip'),
      align: 'right',
      render: (f) => chg(f, (x) => x.profitPerHour, <span className="pos strong">{compact(f.profitPerHour)}</span>, coins(f.profitPerHour)),
      sortValue: (f) => f.profitPerHour,
    },
    {
      key: 'score',
      header: t('colScore'),
      tip: t('colScoreTip'),
      align: 'right',
      render: (f) => (
        <span className="score" title={`${t('confidence')} ${pct(f.confidence * 100, 0)}`}>
          {compact(f.score)}
        </span>
      ),
      sortValue: (f) => f.score,
    },
    {
      key: 'stability',
      header: t('colStability'),
      tip: t('colStabilityTip'),
      align: 'right',
      render: (f) =>
        f.signals.samples < 2 ? (
          <span className="muted">…</span>
        ) : (
          <span>
            <span className={f.signals.persisted >= 5 ? 'pos' : f.signals.persisted <= 1 ? 'neg' : ''}>{f.signals.persisted}</span>
            <span className="muted"> / </span>
            <span className={f.signals.undercut >= 0.5 ? 'neg' : ''}>{Math.round(f.signals.undercut * 100)}%</span>
          </span>
        ),
      sortValue: (f) => f.confidence,
    },
    {
      key: 'trend',
      header: t('colTrend'),
      tip: t('colTrendTip'),
      align: 'right',
      render: (f) => <Trend buyPct={f.signals.trendSellPct} sellPct={f.signals.trendBuyPct} />,
      sortValue: (f) => (Number.isFinite(f.signals.trendBuyPct) && Number.isFinite(f.signals.trendSellPct) ? f.signals.trendBuyPct - f.signals.trendSellPct : NaN),
    },
    {
      key: 'orders',
      header: t('colOrders'),
      tip: t('colOrdersTip'),
      align: 'right',
      render: (f) => `${integer(f.competingBuyOrders)} / ${integer(f.competingSellOffers)}`,
      sortValue: (f) => f.competingBuyOrders + f.competingSellOffers,
    },
    { key: 'flags', header: t('colFlags'), align: 'center', render: (f) => <RiskBadges flags={f.flags} t={t} />, sortValue: (f) => f.flags.length },
  ];
}

export function lookupColumns(t: T, favorites: ReadonlySet<string>, ctx: ChangeContext): Column<LookupRow>[] {
  const top = (r: LookupRow, side: 'buy_summary' | 'sell_summary') => r.product[side][0]?.pricePerUnit ?? NaN;
  const flash = (r: LookupRow, value: number, pick: (x: FlipResult) => number) => {
    const p = ctx.prev.get(r.id);
    return (
      <Changed value={value} prev={p ? pick(p) : undefined} stamp={ctx.stamp} title={p ? `${t('prevValue')}: ${coins(pick(p))}` : undefined}>
        {Number.isFinite(value) ? coins(value) : '—'}
      </Changed>
    );
  };
  return [
    {
      key: 'item',
      header: t('colItem'),
      render: (r) => <ItemName id={r.id} favorite={favorites.has(r.id)} />,
      sortValue: (r) => itemName(r.id),
      className: 'col-item',
    },
    {
      key: 'instaBuy',
      header: t('colInstaBuy'),
      align: 'right',
      render: (r) => flash(r, top(r, 'buy_summary'), (x) => x.instaBuyPrice),
      sortValue: (r) => top(r, 'buy_summary'),
    },
    {
      key: 'instaSell',
      header: t('colInstaSell'),
      align: 'right',
      render: (r) => flash(r, top(r, 'sell_summary'), (x) => x.instaSellPrice),
      sortValue: (r) => top(r, 'sell_summary'),
    },
    {
      key: 'spread',
      header: t('colSpread'),
      align: 'right',
      render: (r) => (r.flip ? `${coins(r.flip.spread)} (${pct(r.flip.marginPct)})` : '—'),
      sortValue: (r) => r.flip?.marginPct ?? NaN,
    },
    { key: 'weekSell', header: t('colWeekSell'), align: 'right', render: (r) => compact(r.product.quick_status.sellMovingWeek), sortValue: (r) => r.product.quick_status.sellMovingWeek },
    { key: 'weekBuy', header: t('colWeekBuy'), align: 'right', render: (r) => compact(r.product.quick_status.buyMovingWeek), sortValue: (r) => r.product.quick_status.buyMovingWeek },
    {
      key: 'open',
      header: t('colOpenVolume'),
      align: 'right',
      render: (r) => `${compact(r.product.quick_status.sellVolume)} / ${compact(r.product.quick_status.buyVolume)}`,
      sortValue: (r) => r.product.quick_status.buyVolume + r.product.quick_status.sellVolume,
    },
    {
      key: 'orders',
      header: t('colOrders'),
      tip: t('colOrdersTip'),
      align: 'right',
      render: (r) => `${integer(r.product.quick_status.sellOrders)} / ${integer(r.product.quick_status.buyOrders)}`,
      sortValue: (r) => r.product.quick_status.sellOrders + r.product.quick_status.buyOrders,
    },
    { key: 'flags', header: t('colFlags'), align: 'center', render: (r) => (r.flip ? <RiskBadges flags={r.flip.flags} t={t} /> : <RiskBadges flags={['EMPTY_BOOK']} t={t} />) },
  ];
}

export function npcColumns(t: T, favorites: ReadonlySet<string>): Column<NpcFlip>[] {
  return [
    { key: 'item', header: t('colItem'), render: (f) => <ItemName id={f.id} favorite={favorites.has(f.id)} />, sortValue: (f) => itemName(f.id), className: 'col-item' },
    { key: 'npc', header: t('colNpcPrice'), align: 'right', render: (f) => coins(f.npcPrice), sortValue: (f) => f.npcPrice },
    { key: 'buy', header: t('colInstaBuy'), align: 'right', render: (f) => coins(f.instaBuyPrice), sortValue: (f) => f.instaBuyPrice },
    { key: 'unit', header: t('colProfitUnit'), align: 'right', render: (f) => <span className="pos">{coins(f.profitPerUnit)}</span>, sortValue: (f) => f.profitPerUnit },
    { key: 'margin', header: t('colMargin'), align: 'right', render: (f) => pct(f.marginPct), sortValue: (f) => f.marginPct },
    {
      key: 'units',
      header: t('colNpcUnits'),
      align: 'right',
      render: (f) => (
        <span>
          {integer(f.units)}
          {f.budgetLimited && <span className="muted"> · {t('budgetLimited')}</span>}
        </span>
      ),
      sortValue: (f) => f.units,
    },
    { key: 'cost', header: t('colNpcCost'), align: 'right', render: (f) => <span title={coins(f.cost)}>{compact(f.cost)}</span>, sortValue: (f) => f.cost },
    { key: 'profit', header: t('colNpcProfit'), align: 'right', render: (f) => <span className="pos strong" title={coins(f.profit)}>{compact(f.profit)}</span>, sortValue: (f) => f.profit },
  ];
}
