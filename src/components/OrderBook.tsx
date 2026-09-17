import type { OrderLevel } from '../api/bazaar';
import { coins, integer } from '../lib/format';
import type { T } from '../hooks/useT';

interface Props {
  levels: OrderLevel[];
  side: 'buy' | 'sell';
  title: string;
  highlight?: number;
  t: T;
  rows?: number;
}

/** One side of the book, with a depth bar behind each level. */
export function OrderBook({ levels, side, title, highlight, t, rows = 12 }: Props) {
  const shown = levels.slice(0, rows);
  let cumulative = 0;
  const withCum = shown.map((l) => ({ ...l, cum: (cumulative += l.amount) }));
  const total = cumulative || 1;

  return (
    <div className={`book book--${side}`}>
      <div className="book__title">{title}</div>
      {shown.length === 0 ? (
        <div className="muted book__empty">{t('noOrders')}</div>
      ) : (
        <table className="book__table">
          <thead>
            <tr>
              <th>{t('price')}</th>
              <th>{t('amount')}</th>
              <th>{t('orders')}</th>
              <th>{t('cumulative')}</th>
            </tr>
          </thead>
          <tbody>
            {withCum.map((l, i) => (
              <tr key={i} className={highlight === l.pricePerUnit ? 'book__row--top' : undefined}>
                <td className="num">
                  <span className="book__bar" style={{ width: `${(l.cum / total) * 100}%` }} aria-hidden />
                  <span className="book__cell">{coins(l.pricePerUnit)}</span>
                </td>
                <td className="num">{integer(l.amount)}</td>
                <td className="num">{integer(l.orders)}</td>
                <td className="num muted">{integer(l.cum)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
