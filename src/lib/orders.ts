import type { BazaarProduct, OrderLevel } from '../api/bazaar';
import { TICK } from './flip';

/** A bazaar order the user placed in game and wants watched. */
export interface TrackedOrder {
  id: string;
  itemId: string;
  /** 'buy' = a buy order we placed, 'sell' = a sell offer we placed. */
  side: 'buy' | 'sell';
  price: number;
  amount: number;
  createdAt: number;
  /** Set once the order has been observed in the book; needed to tell "filled" from "not placed yet". */
  seenAt?: number;
}

export type OrderState =
  | 'top'      // our price is the best on our side of the book
  | 'outbid'   // buy order: someone is paying more than us
  | 'undercut' // sell offer: someone is asking less than us
  | 'filled'   // our price was in the book earlier and is gone now: filled (or cancelled)
  | 'pending'  // our price is beyond the best price but we never saw it in the book: not placed yet, or the snapshot predates it
  | 'unknown'; // product missing or the book side is empty

export interface OrderStatus {
  state: OrderState;
  /** Best price currently on our side (highest buy order / lowest sell offer). */
  bestPrice: number;
  /** How far the best price is ahead of ours (0 when we are at the top). */
  gap: number;
  /** Units queued strictly ahead of our price (from the visible top 30 levels). */
  aheadUnits: number;
  /** Units and orders at exactly our price (includes our own order). */
  samePriceUnits: number;
  samePriceOrders: number;
  /** Estimated hours until everything ahead of us plus our order is consumed. */
  fillHours: number;
  /** Price we would re-list at to be first again. */
  relistPrice: number;
  /** Best price on the opposite side of the book (what we could flip against). */
  counterPrice: number;
  /** Buy orders: margin % if we sold at (lowest sell offer − tick) after tax; sell offers: NaN. */
  marginPctNow: number;
}

export interface OrderRates {
  instaSellsPerHour: number;
  instaBuysPerHour: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function evaluateOrder(order: TrackedOrder, product: BazaarProduct | undefined, rates: OrderRates, taxRate: number): OrderStatus {
  const empty: OrderStatus = {
    state: 'unknown',
    bestPrice: NaN,
    gap: 0,
    aheadUnits: 0,
    samePriceUnits: 0,
    samePriceOrders: 0,
    fillHours: Infinity,
    relistPrice: NaN,
    counterPrice: NaN,
    marginPctNow: NaN,
  };
  if (!product) return empty;

  // Our side of the book and the direction "ahead" means.
  const ours: OrderLevel[] = order.side === 'buy' ? product.sell_summary : product.buy_summary;
  const theirs: OrderLevel[] = order.side === 'buy' ? product.buy_summary : product.sell_summary;
  const best = ours[0];
  if (!best) return { ...empty, counterPrice: theirs[0]?.pricePerUnit ?? NaN };

  const ahead = (level: OrderLevel) => (order.side === 'buy' ? level.pricePerUnit > order.price : level.pricePerUnit < order.price);
  const same = (level: OrderLevel) => Math.abs(level.pricePerUnit - order.price) < TICK / 2;

  let aheadUnits = 0;
  let samePriceUnits = 0;
  let samePriceOrders = 0;
  for (const level of ours) {
    if (ahead(level)) aheadUnits += level.amount;
    else if (same(level)) {
      samePriceUnits += level.amount;
      samePriceOrders += level.orders;
    }
  }

  const bestPrice = best.pricePerUnit;
  const behind = order.side === 'buy' ? bestPrice > order.price + TICK / 2 : bestPrice < order.price - TICK / 2;
  const gone = order.side === 'buy' ? bestPrice < order.price - TICK / 2 : bestPrice > order.price + TICK / 2;
  const state: OrderState = gone ? (order.seenAt ? 'filled' : 'pending') : behind ? (order.side === 'buy' ? 'outbid' : 'undercut') : 'top';

  const rate = order.side === 'buy' ? rates.instaSellsPerHour : rates.instaBuysPerHour;
  const queue = aheadUnits + Math.max(0, samePriceUnits - order.amount) + order.amount;
  const fillHours = state === 'filled' ? 0 : state === 'pending' ? (rate > 0 ? order.amount / rate : Infinity) : rate > 0 ? queue / rate : Infinity;

  const counterPrice = theirs[0]?.pricePerUnit ?? NaN;
  const relistPrice = order.side === 'buy' ? round1(bestPrice + TICK) : round1(bestPrice - TICK);
  const marginPctNow =
    order.side === 'buy' && Number.isFinite(counterPrice) && order.price > 0
      ? (((counterPrice - TICK) * (1 - taxRate) - order.price) / order.price) * 100
      : NaN;

  return {
    state,
    bestPrice,
    gap: state === 'outbid' || state === 'undercut' ? Math.abs(bestPrice - order.price) : 0,
    aheadUnits,
    samePriceUnits,
    samePriceOrders,
    fillHours,
    relistPrice,
    counterPrice,
    marginPctNow,
  };
}

/** States in which the order is visibly sitting in the book. */
export const IN_BOOK_STATES: ReadonlySet<OrderState> = new Set<OrderState>(['top', 'outbid', 'undercut']);

/** States that deserve a notification when an order enters them. */
export const ATTENTION_STATES: ReadonlySet<OrderState> = new Set<OrderState>(['outbid', 'undercut', 'filled']);

export function newOrderId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
