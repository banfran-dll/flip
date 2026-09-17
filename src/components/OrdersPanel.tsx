import { useMemo, useState } from 'react';
import type { BazaarProduct } from '../api/bazaar';
import type { T } from '../hooks/useT';
import type { Lang } from '../i18n';
import { coins, duration, integer, parseCoins, pct } from '../lib/format';
import { itemName } from '../lib/names';
import { newOrderId, type OrderStatus, type TrackedOrder } from '../lib/orders';
import { matchesQuery, scoreMatch } from '../lib/search';
import type { ScoredFlip } from '../lib/signals';
import { DataTable, type Column } from './DataTable';
import { ItemName } from './ItemName';
import { NumField } from './NumField';

export interface OrderRow {
  order: TrackedOrder;
  status: OrderStatus;
}

interface Props {
  rows: OrderRow[];
  products: Record<string, BazaarProduct> | null;
  flipsById: ReadonlyMap<string, ScoredFlip>;
  onAdd: (order: TrackedOrder) => void;
  onUpdatePrice: (id: string, price: number) => void;
  onRemove: (id: string) => void;
  onOpen: (itemId: string) => void;
  t: T;
  lang: Lang;
}

export function OrdersPanel({ rows, products, flipsById, onAdd, onUpdatePrice, onRemove, onOpen, t, lang }: Props) {
  const [query, setQuery] = useState('');
  const [itemId, setItemId] = useState<string | null>(null);
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [price, setPrice] = useState(0);
  const [amount, setAmount] = useState(64);
  const [focus, setFocus] = useState(false);

  const suggestions = useMemo(() => {
    if (!products || !query.trim() || itemId) return [];
    return Object.keys(products)
      .filter((id) => matchesQuery(id, query))
      .sort((a, b) => scoreMatch(a, query) - scoreMatch(b, query))
      .slice(0, 8);
  }, [products, query, itemId]);

  const bestPrice = (id: string | null, s: 'buy' | 'sell') => {
    if (!id) return null;
    const f = flipsById.get(id);
    if (f) return s === 'buy' ? f.buyOrderPrice : f.sellOfferPrice;
    const p = products?.[id];
    const top = s === 'buy' ? p?.sell_summary[0]?.pricePerUnit : p?.buy_summary[0]?.pricePerUnit;
    return top == null ? null : Math.round((s === 'buy' ? top + 0.1 : top - 0.1) * 10) / 10;
  };

  const pick = (id: string) => {
    setItemId(id);
    setQuery(itemName(id));
    const p = bestPrice(id, side);
    if (p != null) setPrice(p);
  };

  const submit = () => {
    if (!itemId || !(price > 0) || !(amount > 0)) return;
    onAdd({ id: newOrderId(), itemId, side, price, amount: Math.floor(amount), createdAt: Date.now() });
    setItemId(null);
    setQuery('');
  };

  const columns: Column<OrderRow>[] = [
    { key: 'item', header: t('colItem'), render: (r) => <ItemName id={r.order.itemId} />, sortValue: (r) => itemName(r.order.itemId), className: 'col-item' },
    {
      key: 'side',
      header: t('orderSide'),
      render: (r) => <span className={r.order.side === 'buy' ? 'pos' : 'neg'}>{r.order.side === 'buy' ? t('sideBuy') : t('sideSell')}</span>,
      sortValue: (r) => r.order.side,
    },
    { key: 'price', header: t('orderPrice'), align: 'right', render: (r) => coins(r.order.price), sortValue: (r) => r.order.price },
    { key: 'amount', header: t('orderAmount'), align: 'right', render: (r) => integer(r.order.amount), sortValue: (r) => r.order.amount },
    {
      key: 'state',
      header: t('colState'),
      align: 'center',
      render: (r) => (
        <span className={`state state--${r.status.state}`} title={r.status.state === 'pending' ? t('statePendingTip') : undefined}>
          {t(`state_${r.status.state}`)}
          {r.status.gap > 0 && ` −${coins(r.status.gap)}`}
        </span>
      ),
      sortValue: (r) => ({ outbid: 0, undercut: 0, filled: 1, pending: 2, unknown: 3, top: 4 })[r.status.state],
    },
    {
      key: 'best',
      header: t('colBest'),
      align: 'right',
      render: (r) => (Number.isFinite(r.status.bestPrice) ? coins(r.status.bestPrice) : '—'),
      sortValue: (r) => r.status.bestPrice,
    },
    {
      key: 'ahead',
      header: t('colAhead'),
      align: 'right',
      render: (r) =>
        r.status.state === 'filled' || r.status.state === 'unknown' || r.status.state === 'pending' ? (
          '—'
        ) : (
          <span>
            {integer(r.status.aheadUnits)}
            {r.status.samePriceOrders > 1 && <span className="muted"> · {t('samePrice', { n: r.status.samePriceOrders })}</span>}
          </span>
        ),
      sortValue: (r) => r.status.aheadUnits,
    },
    { key: 'fill', header: t('colFill'), align: 'right', render: (r) => (r.status.state === 'filled' ? '—' : duration(r.status.fillHours, lang)), sortValue: (r) => r.status.fillHours },
    {
      key: 'margin',
      header: t('colMarginNow'),
      align: 'right',
      render: (r) => (Number.isFinite(r.status.marginPctNow) ? <span className={r.status.marginPctNow > 0 ? 'pos' : 'neg'}>{pct(r.status.marginPctNow)}</span> : '—'),
      sortValue: (r) => r.status.marginPctNow,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        <span className="row-actions" onClick={(e) => e.stopPropagation()}>
          {Number.isFinite(r.status.relistPrice) && r.status.state !== 'top' && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => onUpdatePrice(r.order.id, r.status.relistPrice)} title={coins(r.status.relistPrice)}>
              {t('relist')} {coins(r.status.relistPrice)}
            </button>
          )}
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => onRemove(r.order.id)}>
            {t('remove')}
          </button>
        </span>
      ),
    },
  ];

  return (
    <div className="orders">
      <p className="hint">{t('ordersHint')}</p>
      <form
        className="orders-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="field orders-form__item">
          <span className="field__label">{t('orderItem')}</span>
          <input
            className="input"
            value={query}
            placeholder={t('searchPlaceholder')}
            onChange={(e) => {
              setQuery(e.target.value);
              setItemId(null);
            }}
            onFocus={() => setFocus(true)}
            onBlur={() => window.setTimeout(() => setFocus(false), 150)}
          />
          {focus && suggestions.length > 0 && (
            <ul className="suggest">
              {suggestions.map((id) => (
                <li key={id}>
                  <button type="button" className="suggest__item" onMouseDown={() => pick(id)}>
                    <ItemName id={id} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </label>
        <div className="field">
          <span className="field__label">{t('orderSide')}</span>
          <div className="segmented">
            {(['buy', 'sell'] as const).map((s) => (
              <button
                key={s}
                type="button"
                className={`segmented__btn ${side === s ? 'is-active' : ''}`}
                onClick={() => {
                  setSide(s);
                  const p = bestPrice(itemId, s);
                  if (p != null) setPrice(p);
                }}
              >
                {s === 'buy' ? t('sideBuy') : t('sideSell')}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span className="field__label">{t('orderPrice')}</span>
          <div className="field__row">
            <NumField className="input" value={price} onChange={(n) => setPrice(n)} parse={parseCoins} format={coins} />
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={!itemId}
              onClick={() => {
                const p = bestPrice(itemId, side);
                if (p != null) setPrice(p);
              }}
            >
              {t('useBestPrice')}
            </button>
          </div>
        </label>
        <label className="field">
          <span className="field__label">{t('orderAmount')}</span>
          <NumField className="input" value={amount} onChange={(n) => setAmount(Math.max(1, Math.floor(n)))} parse={parseCoins} format={integer} />
        </label>
        <div className="field orders-form__submit">
          <button type="submit" className="btn" disabled={!itemId || !(price > 0)}>
            {t('track')}
          </button>
        </div>
      </form>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.order.id}
        defaultSort={{ key: 'state', dir: 'asc' }}
        onRowClick={(r) => onOpen(r.order.itemId)}
        emptyMessage={t('ordersEmpty')}
        moreLabel={(n) => t('showMore', { n })}
      />
    </div>
  );
}
