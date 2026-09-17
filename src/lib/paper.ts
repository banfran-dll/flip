import { TICK } from './flip';
import type { PricePoint } from './history';
import type { ScoredFlip } from './signals';

/**
 * Paper trading: the recommender's top pick is opened as a virtual flip and
 * then driven by the real snapshots that follow, so the app can show how much
 * of the predicted profit actually materialises.
 *
 * Fill model (deliberately simple and stated in the UI):
 *  - while buying, the virtual buy order is re-bid to `top buy order + 0.1`
 *    whenever it gets outbid, and receives every instasell that happens while
 *    it sits at the top (we assume we are alone at the top);
 *  - while selling, the virtual sell offer is re-priced to `lowest offer − 0.1`
 *    whenever it gets undercut and receives every instabuy;
 *  - a trade older than EXPIRE_HOURS is abandoned: unfilled buys are cancelled
 *    and bought-but-unsold units are instasold.
 */
export const EXPIRE_HOURS = 6;

export type PaperStatus = 'buying' | 'selling' | 'closed' | 'expired';

export interface PaperTrade {
  id: string;
  itemId: string;
  openedAt: number;
  units: number;
  /** Current virtual buy order price (may have been re-bid). */
  buyPrice: number;
  /** Current virtual sell offer price (may have been undercut). */
  sellPrice: number;
  boughtUnits: number;
  cost: number;
  soldUnits: number;
  /** After tax. */
  revenue: number;
  status: PaperStatus;
  expectedProfit: number;
  expectedHours: number;
  closedAt?: number;
  /** Timestamp of the last history point applied, to avoid double counting. */
  lastT: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function openTrade(flip: ScoredFlip, at: number, id: string): PaperTrade {
  return {
    id,
    itemId: flip.id,
    openedAt: at,
    units: Math.max(1, flip.units),
    buyPrice: flip.buyOrderPrice,
    sellPrice: flip.sellOfferPrice,
    boughtUnits: 0,
    cost: 0,
    soldUnits: 0,
    revenue: 0,
    status: 'buying',
    expectedProfit: flip.profitPerCycle,
    expectedHours: flip.cycleHours,
    lastT: at,
  };
}

/** Apply one snapshot transition (prev → cur) to a trade. Pure; returns a new object when anything changed. */
export function stepTrade(trade: PaperTrade, prev: PricePoint, cur: PricePoint, taxRate: number): PaperTrade {
  if (trade.status === 'closed' || trade.status === 'expired') return trade;
  if (cur.t <= trade.lastT) return trade;
  const t = { ...trade, lastT: cur.t };

  if (t.status === 'buying') {
    if (Number.isFinite(cur.sell) && cur.sell > t.buyPrice + TICK / 2) t.buyPrice = round1(cur.sell + TICK);
    const instasells = Math.max(0, cur.smw - prev.smw);
    const fill = Math.min(t.units - t.boughtUnits, instasells);
    if (fill > 0) {
      t.boughtUnits += fill;
      t.cost += fill * t.buyPrice;
    }
    if (t.boughtUnits >= t.units) {
      t.status = 'selling';
      if (Number.isFinite(cur.buy)) t.sellPrice = Math.min(t.sellPrice, round1(cur.buy - TICK));
    }
  }

  if (t.status === 'selling') {
    if (Number.isFinite(cur.buy) && cur.buy < t.sellPrice - TICK / 2) t.sellPrice = round1(cur.buy - TICK);
    const instabuys = Math.max(0, cur.bmw - prev.bmw);
    const fill = Math.min(t.boughtUnits - t.soldUnits, instabuys);
    if (fill > 0) {
      t.soldUnits += fill;
      t.revenue += fill * t.sellPrice * (1 - taxRate);
    }
    if (t.soldUnits >= t.boughtUnits) {
      t.status = 'closed';
      t.closedAt = cur.t;
    }
  }

  if (t.status !== 'closed' && cur.t - t.openedAt > EXPIRE_HOURS * 3_600_000) {
    const unsold = t.boughtUnits - t.soldUnits;
    if (unsold > 0 && Number.isFinite(cur.sell)) {
      t.soldUnits += unsold;
      t.revenue += unsold * cur.sell * (1 - taxRate);
    }
    t.status = 'expired';
    t.closedAt = cur.t;
  }
  return t;
}

export function realizedProfit(t: PaperTrade): number {
  return t.revenue - t.cost;
}

export interface PaperSummary {
  total: number;
  open: number;
  closed: number;
  expired: number;
  expectedTotal: number;
  realizedTotal: number;
  /** Closed trades with positive realized profit ÷ closed trades. */
  winRate: number;
  /** Mean hours from open to close over closed trades. */
  avgHours: number;
  /** realizedTotal ÷ expectedTotal over finished trades, as a fraction. */
  captureRatio: number;
}

export function summarize(trades: PaperTrade[]): PaperSummary {
  const finished = trades.filter((t) => t.status === 'closed' || t.status === 'expired');
  const closed = finished.filter((t) => t.status === 'closed');
  const expectedTotal = finished.reduce((s, t) => s + t.expectedProfit, 0);
  const realizedTotal = finished.reduce((s, t) => s + realizedProfit(t), 0);
  return {
    total: trades.length,
    open: trades.length - finished.length,
    closed: closed.length,
    expired: finished.length - closed.length,
    expectedTotal,
    realizedTotal,
    winRate: closed.length ? closed.filter((t) => realizedProfit(t) > 0).length / closed.length : NaN,
    avgHours: closed.length ? closed.reduce((s, t) => s + ((t.closedAt ?? t.openedAt) - t.openedAt) / 3_600_000, 0) / closed.length : NaN,
    captureRatio: expectedTotal > 0 ? realizedTotal / expectedTotal : NaN,
  };
}
