import type { T } from '../hooks/useT';
import type { Lang } from '../i18n';
import { coins, compact, duration, integer, parseCoins, pct } from '../lib/format';
import { itemName } from '../lib/names';
import type { Plan, PlanLine } from '../lib/planner';
import { DataTable, type Column } from './DataTable';
import { ItemName } from './ItemName';
import { NumField } from './NumField';
import { RiskBadges } from './RiskBadges';

interface Props {
  plan: Plan;
  budget: number;
  slots: number;
  minCycleMinutes: number;
  onBudget: (n: number) => void;
  onSlots: (n: number) => void;
  onTrackAll: () => void;
  onOpen: (id: string) => void;
  t: T;
  lang: Lang;
}

export function PlannerPanel({ plan, budget, slots, minCycleMinutes, onBudget, onSlots, onTrackAll, onOpen, t, lang }: Props) {
  const columns: Column<PlanLine>[] = [
    { key: 'rank', header: '#', align: 'right', render: (l) => plan.lines.indexOf(l) + 1 },
    { key: 'item', header: t('colItem'), render: (l) => <ItemName id={l.id} />, sortValue: (l) => itemName(l.id), className: 'col-item' },
    { key: 'capital', header: t('colCapital'), align: 'right', render: (l) => <span className="strong" title={coins(l.capital)}>{compact(l.capital)}</span>, sortValue: (l) => l.capital },
    { key: 'units', header: t('colUnits'), align: 'right', render: (l) => integer(l.units), sortValue: (l) => l.units },
    { key: 'buy', header: t('colBuyOrder'), align: 'right', render: (l) => coins(l.flip.buyOrderPrice), sortValue: (l) => l.flip.buyOrderPrice },
    { key: 'sell', header: t('colSellOffer'), align: 'right', render: (l) => coins(l.flip.sellOfferPrice), sortValue: (l) => l.flip.sellOfferPrice },
    { key: 'margin', header: t('colMargin'), align: 'right', render: (l) => pct(l.flip.marginPct), sortValue: (l) => l.flip.marginPct },
    { key: 'cycle', header: t('colCycle'), align: 'right', render: (l) => duration(Math.max(l.cycleHours, minCycleMinutes / 60), lang), sortValue: (l) => l.cycleHours },
    {
      key: 'rate',
      header: t('colLineRate'),
      align: 'right',
      render: (l) => (
        <span className="pos strong" title={`${t('planRawRate')} ${coins(l.rawRatePerHour)}`}>
          {compact(l.ratePerHour)}
        </span>
      ),
      sortValue: (l) => l.ratePerHour,
    },
    {
      key: 'sat',
      header: t('colSaturation'),
      tip: t('colSaturationTip'),
      align: 'right',
      render: (l) => (
        <span className="sat">
          <span className="sat__bar" style={{ width: `${Math.round(l.saturation * 100)}%` }} aria-hidden />
          <span className="sat__label">{pct(l.saturation * 100, 0)}</span>
        </span>
      ),
      sortValue: (l) => l.saturation,
    },
    { key: 'conf', header: t('confidence'), align: 'right', render: (l) => pct(l.flip.confidence * 100, 0), sortValue: (l) => l.flip.confidence },
    { key: 'flags', header: t('colFlags'), align: 'center', render: (l) => <RiskBadges flags={l.flip.flags} t={t} /> },
  ];

  return (
    <div className="planner">
      <p className="hint">{t('plannerHint')}</p>
      <div className="planner-form">
        <label className="field">
          <span className="field__label">{t('budget')}</span>
          <NumField className="input" value={budget} onChange={(n) => onBudget(Math.max(0, n))} parse={parseCoins} format={integer} />
        </label>
        <label className="field">
          <span className="field__label">{t('plannerSlots')}</span>
          <NumField className="input" value={slots} onChange={(n) => onSlots(Math.max(1, Math.min(50, Math.round(n))))} />
          <span className="field__hint">{t('plannerSlotsHint')}</span>
        </label>
        <div className="field planner-form__action">
          <button type="button" className="btn" disabled={plan.lines.length === 0} onClick={onTrackAll}>
            {t('trackPlan', { n: plan.lines.length })}
          </button>
        </div>
      </div>

      <div className="stats stats--row">
        <Tile label={t('planRate')} value={compact(plan.totalRatePerHour)} accent />
        <Tile label={t('planRawRate')} value={compact(plan.totalRawRatePerHour)} />
        <Tile label={t('planTotalCapital')} value={compact(plan.totalCapital)} />
        <Tile label={t('planLeftover')} value={compact(plan.leftover)} sub={plan.leftover > budget * 0.2 ? t('planLeftoverHint') : undefined} />
        <Tile label={t('planSlotsUsed')} value={`${plan.slotsUsed} / ${slots}`} />
      </div>

      <DataTable
        columns={columns}
        rows={plan.lines}
        rowKey={(l) => l.id}
        defaultSort={{ key: 'capital', dir: 'desc' }}
        onRowClick={(l) => onOpen(l.id)}
        emptyMessage={t('planEmpty')}
        moreLabel={(n) => t('showMore', { n })}
      />
    </div>
  );
}

function Tile({ label, value, sub, accent = false }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className={`stat__value ${accent ? 'pos' : ''}`}>{value}</div>
      {sub && <div className="stat__sub stat__sub--wrap">{sub}</div>}
    </div>
  );
}
