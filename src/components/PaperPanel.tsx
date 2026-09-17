import type { T } from '../hooks/useT';
import type { Lang } from '../i18n';
import { coins, compact, duration, integer, pct } from '../lib/format';
import { itemName } from '../lib/names';
import { realizedProfit, summarize, type PaperTrade } from '../lib/paper';
import { DataTable, type Column } from './DataTable';
import { ItemName } from './ItemName';

interface Props {
  trades: PaperTrade[];
  enabled: boolean;
  now: number;
  onToggle: (on: boolean) => void;
  onClear: () => void;
  onOpen: (itemId: string) => void;
  t: T;
  lang: Lang;
}

export function PaperPanel({ trades, enabled, now, onToggle, onClear, onOpen, t, lang }: Props) {
  const s = summarize(trades);
  const columns: Column<PaperTrade>[] = [
    { key: 'opened', header: t('colOpened'), render: (x) => new Date(x.openedAt).toLocaleTimeString(), sortValue: (x) => x.openedAt },
    { key: 'item', header: t('colItem'), render: (x) => <ItemName id={x.itemId} />, sortValue: (x) => itemName(x.itemId), className: 'col-item' },
    {
      key: 'status',
      header: t('colStatus'),
      align: 'center',
      render: (x) => <span className={`state state--paper-${x.status}`}>{t(`paper_${x.status}`)}</span>,
      sortValue: (x) => ({ buying: 0, selling: 1, closed: 2, expired: 3 })[x.status],
    },
    {
      key: 'progress',
      header: t('colUnits'),
      align: 'right',
      render: (x) => `${integer(x.soldUnits)} / ${integer(x.boughtUnits)} / ${integer(x.units)}`,
      sortValue: (x) => x.units,
    },
    { key: 'buy', header: t('colAvgBuy'), align: 'right', render: (x) => (x.boughtUnits > 0 ? coins(x.cost / x.boughtUnits) : coins(x.buyPrice)), sortValue: (x) => x.buyPrice },
    { key: 'sell', header: t('colSellOffer'), align: 'right', render: (x) => coins(x.sellPrice), sortValue: (x) => x.sellPrice },
    { key: 'expected', header: t('colExpected'), align: 'right', render: (x) => <span title={coins(x.expectedProfit)}>{compact(x.expectedProfit)}</span>, sortValue: (x) => x.expectedProfit },
    {
      key: 'realized',
      header: t('colRealized'),
      align: 'right',
      render: (x) => {
        const r = realizedProfit(x);
        const done = x.status === 'closed' || x.status === 'expired';
        return <span className={done ? (r >= 0 ? 'pos strong' : 'neg strong') : 'muted'} title={coins(r)}>{done || x.soldUnits > 0 ? compact(r) : '—'}</span>;
      },
      sortValue: (x) => realizedProfit(x),
    },
    {
      key: 'elapsed',
      header: t('colElapsed'),
      align: 'right',
      render: (x) => duration(((x.closedAt ?? now) - x.openedAt) / 3_600_000, lang),
      sortValue: (x) => (x.closedAt ?? now) - x.openedAt,
    },
  ];

  return (
    <div className="paper">
      <p className="hint">{t('paperHint')}</p>
      <div className="field__row crash-controls">
        <label className="checkbox">
          <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
          <span>{t('paperEnable')}</span>
        </label>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onClear} disabled={trades.length === 0}>
          {t('paperClear')}
        </button>
      </div>
      <div className="stats stats--row">
        <Tile label={t('paperRealized')} value={compact(s.realizedTotal)} cls={s.realizedTotal >= 0 ? 'pos' : 'neg'} />
        <Tile label={t('paperExpected')} value={compact(s.expectedTotal)} />
        <Tile label={t('paperCapture')} value={Number.isFinite(s.captureRatio) ? pct(s.captureRatio * 100, 0) : '—'} />
        <Tile label={t('paperWinRate')} value={Number.isFinite(s.winRate) ? pct(s.winRate * 100, 0) : '—'} />
        <Tile label={t('paperAvgHours')} value={Number.isFinite(s.avgHours) ? duration(s.avgHours, lang) : '—'} />
        <Tile label={t('paperCounts')} value={`${s.open} / ${s.closed} / ${s.expired}`} />
      </div>
      <DataTable
        columns={columns}
        rows={trades}
        rowKey={(x) => x.id}
        defaultSort={{ key: 'opened', dir: 'desc' }}
        onRowClick={(x) => onOpen(x.itemId)}
        emptyMessage={t('paperEmpty')}
        moreLabel={(n) => t('showMore', { n })}
      />
    </div>
  );
}

function Tile({ label, value, cls = '' }: { label: string; value: string; cls?: string }) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className={`stat__value ${cls}`}>{value}</div>
    </div>
  );
}
