import type { BazaarProduct, OrderLevel } from '../api/bazaar';

/** Default bazaar sales tax (1.25%). */
export const DEFAULT_TAX_RATE = 0.0125;
/** Largest single bazaar order the game allows (1,120 stacks of 64). */
export const MAX_ORDER_SIZE = 71_680;
/** Hours in the 7-day "moving week" window the API reports volume over. */
export const HOURS_PER_WEEK = 168;
/** Smallest price increment on the bazaar. */
export const TICK = 0.1;

export interface FlipSettings {
  /** Sales tax as a fraction, e.g. 0.0125 for 1.25%. */
  taxRate: number;
  /** Coins available for one flip. */
  budget: number;
  /**
   * Minimum wall-clock time one buy→sell cycle takes regardless of volume
   * (walking to the bazaar, placing and claiming orders). Prevents tiny,
   * ultra-fast flips from reporting absurd hourly profits.
   */
  minCycleMinutes: number;
  /** Per-order item cap (see MAX_ORDER_SIZE). */
  maxOrderSize: number;
}

export const DEFAULT_FLIP_SETTINGS: FlipSettings = {
  taxRate: DEFAULT_TAX_RATE,
  budget: 10_000_000,
  minCycleMinutes: 5,
  maxOrderSize: MAX_ORDER_SIZE,
};

export type RiskFlag =
  | 'EMPTY_BOOK'   // one side of the book has no orders at all
  | 'LOW_VOLUME'   // fewer than LOW_VOLUME_PER_HOUR units/h move on the slower side
  | 'THIN_BOOK'    // very few open orders on one side
  | 'OUTLIER_BUY'  // top buy order sits far above the weighted market price
  | 'OUTLIER_SELL' // lowest sell offer sits far below the weighted market price
  | 'IMBALANCE'    // one side moves >10× faster than the other
  | 'HUGE_SPREAD'; // margin > 100%, usually an illiquid or manipulated item

/** Flags that usually mean the quoted spread is not real (stray orders, dead markets). */
export const DANGER_FLAGS: ReadonlySet<RiskFlag> = new Set<RiskFlag>(['EMPTY_BOOK', 'THIN_BOOK', 'OUTLIER_BUY', 'OUTLIER_SELL', 'HUGE_SPREAD']);
export const isDangerFlag = (f: RiskFlag): boolean => DANGER_FLAGS.has(f);

export type HideFlags = 'none' | 'danger' | 'all';

export const LOW_VOLUME_PER_HOUR = 10;
export const THIN_BOOK_ORDERS = 5;
export const OUTLIER_RATIO = 0.03;
export const IMBALANCE_RATIO = 10;

export interface FlipResult {
  id: string;
  /** Price we would post a buy order at: highest existing buy order + one tick. */
  buyOrderPrice: number;
  /** Price we would post a sell offer at: lowest existing sell offer − one tick. */
  sellOfferPrice: number;
  /** Cheapest sell offer on the book (what an instabuy pays). */
  instaBuyPrice: number;
  /** Highest buy order on the book (what an instasell receives before tax). */
  instaSellPrice: number;
  /** Gross gap between our two orders, before tax. */
  spread: number;
  /** Tax paid per unit when our sell offer fills. */
  taxPerUnit: number;
  /** Net coins gained per unit. */
  profitPerUnit: number;
  /** profitPerUnit / buyOrderPrice, in percent. */
  marginPct: number;
  /** Units instasold per hour; these fill OUR buy orders. */
  instaSellsPerHour: number;
  /** Units instabought per hour; these fill OUR sell offers. */
  instaBuysPerHour: number;
  /** Sustainable round-trip throughput: harmonic combination of the two sides. */
  flowPerHour: number;
  /** How many units the budget buys (capped by maxOrderSize). */
  units: number;
  /** Coins tied up in the buy order. */
  cost: number;
  /** Estimated hours for one buy→sell cycle of `units` (queue-front assumption). */
  cycleHours: number;
  /** Net profit from one full cycle. */
  profitPerCycle: number;
  /** Budget-aware estimate of coins/hour. This is what the recommender ranks by. */
  profitPerHour: number;
  /** Budget-unlimited upper bound: flowPerHour × profitPerUnit. */
  profitPerHourMax: number;
  /** Open buy orders competing with ours. */
  competingBuyOrders: number;
  /** Open sell offers competing with ours. */
  competingSellOffers: number;
  sellMovingWeek: number;
  buyMovingWeek: number;
  flags: RiskFlag[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Compute every flip metric for one product. Returns null when no flip is possible. */
export function computeFlip(product: BazaarProduct, settings: FlipSettings = DEFAULT_FLIP_SETTINGS): FlipResult | null {
  const q = product.quick_status;
  const bestSellOffer = product.buy_summary[0];
  const bestBuyOrder = product.sell_summary[0];
  if (!bestSellOffer || !bestBuyOrder) return null;

  const instaBuyPrice = bestSellOffer.pricePerUnit;
  const instaSellPrice = bestBuyOrder.pricePerUnit;
  const buyOrderPrice = round1(instaSellPrice + TICK);
  const sellOfferPrice = round1(instaBuyPrice - TICK);

  const spread = sellOfferPrice - buyOrderPrice;
  const taxPerUnit = sellOfferPrice * settings.taxRate;
  const profitPerUnit = sellOfferPrice - taxPerUnit - buyOrderPrice;
  const marginPct = buyOrderPrice > 0 ? (profitPerUnit / buyOrderPrice) * 100 : 0;

  const instaSellsPerHour = q.sellMovingWeek / HOURS_PER_WEEK;
  const instaBuysPerHour = q.buyMovingWeek / HOURS_PER_WEEK;
  const flowPerHour =
    instaSellsPerHour > 0 && instaBuysPerHour > 0
      ? (instaSellsPerHour * instaBuysPerHour) / (instaSellsPerHour + instaBuysPerHour)
      : 0;

  const units = buyOrderPrice > 0 ? Math.min(Math.floor(settings.budget / buyOrderPrice), settings.maxOrderSize) : 0;
  const cost = units * buyOrderPrice;
  const cycleHours =
    units > 0 && instaSellsPerHour > 0 && instaBuysPerHour > 0
      ? units / instaSellsPerHour + units / instaBuysPerHour
      : Infinity;
  const profitPerCycle = units * profitPerUnit;
  const minCycleHours = Math.max(settings.minCycleMinutes, 0) / 60;
  const effectiveCycle = Math.max(cycleHours, minCycleHours);
  const profitPerHour = Number.isFinite(effectiveCycle) && effectiveCycle > 0 ? profitPerCycle / effectiveCycle : 0;
  const profitPerHourMax = flowPerHour * profitPerUnit;

  const flags: RiskFlag[] = [];
  const slower = Math.min(instaSellsPerHour, instaBuysPerHour);
  if (slower < LOW_VOLUME_PER_HOUR) flags.push('LOW_VOLUME');
  if (q.sellOrders < THIN_BOOK_ORDERS || q.buyOrders < THIN_BOOK_ORDERS) flags.push('THIN_BOOK');
  if (isOutlier(instaSellPrice, q.sellPrice, 'above')) flags.push('OUTLIER_BUY');
  if (isOutlier(instaBuyPrice, q.buyPrice, 'below')) flags.push('OUTLIER_SELL');
  if (slower > 0 && Math.max(instaSellsPerHour, instaBuysPerHour) / slower > IMBALANCE_RATIO) flags.push('IMBALANCE');
  if (marginPct > 100) flags.push('HUGE_SPREAD');

  return {
    id: product.product_id,
    buyOrderPrice,
    sellOfferPrice,
    instaBuyPrice,
    instaSellPrice,
    spread,
    taxPerUnit,
    profitPerUnit,
    marginPct,
    instaSellsPerHour,
    instaBuysPerHour,
    flowPerHour,
    units,
    cost,
    cycleHours,
    profitPerCycle,
    profitPerHour,
    profitPerHourMax,
    competingBuyOrders: q.sellOrders,
    competingSellOffers: q.buyOrders,
    sellMovingWeek: q.sellMovingWeek,
    buyMovingWeek: q.buyMovingWeek,
    flags,
  };
}

/**
 * A top-of-book price that sits far from the volume-weighted quick_status price
 * is usually a single stray order, not the real market.
 */
function isOutlier(top: number, weighted: number, direction: 'above' | 'below'): boolean {
  if (!(weighted > 0)) return false;
  const tolerance = Math.max(weighted * OUTLIER_RATIO, 3 * TICK);
  return direction === 'above' ? top - weighted > tolerance : weighted - top > tolerance;
}

export interface FlipFilters {
  /** Hide flips whose slower side moves fewer units per week than this. */
  minWeeklyVolume: number;
  minMarginPct: number;
  minProfitPerUnit: number;
  minPrice: number;
  /** 0 or less means "no upper bound". */
  maxPrice: number;
  /** 'danger' hides stray-order/illiquid flips, 'all' also hides warnings, 'none' shows everything. */
  hideFlags: HideFlags;
  /** Restrict to these product ids (e.g. favourites). Empty = no restriction. */
  onlyIds?: ReadonlySet<string>;
}

export const DEFAULT_FLIP_FILTERS: FlipFilters = {
  minWeeklyVolume: 1_000,
  minMarginPct: 1,
  minProfitPerUnit: 0,
  minPrice: 0,
  maxPrice: 0,
  hideFlags: 'danger',
};

export function passesFilters(f: FlipResult, filters: FlipFilters): boolean {
  if (filters.onlyIds && filters.onlyIds.size > 0 && !filters.onlyIds.has(f.id)) return false;
  if (f.profitPerUnit <= 0) return false;
  if (Math.min(f.sellMovingWeek, f.buyMovingWeek) < filters.minWeeklyVolume) return false;
  if (f.marginPct < filters.minMarginPct) return false;
  if (f.profitPerUnit < filters.minProfitPerUnit) return false;
  if (f.buyOrderPrice < filters.minPrice) return false;
  if (filters.maxPrice > 0 && f.buyOrderPrice > filters.maxPrice) return false;
  if (filters.hideFlags === 'all' && f.flags.length > 0) return false;
  if (filters.hideFlags === 'danger' && f.flags.some(isDangerFlag)) return false;
  return true;
}

/** Compute flips for every product; unflippable products are dropped. */
export function computeAllFlips(products: Record<string, BazaarProduct>, settings: FlipSettings): FlipResult[] {
  const out: FlipResult[] = [];
  for (const p of Object.values(products)) {
    const f = computeFlip(p, settings);
    if (f) out.push(f);
  }
  return out;
}

/** Filter, then sort descending by `key` (profit/h by default; the app passes the confidence-weighted score). */
export function rankFlips<T extends FlipResult>(flips: T[], filters: FlipFilters, key: (f: T) => number = (f) => f.profitPerHour): T[] {
  return flips.filter((f) => passesFilters(f, filters)).sort((a, b) => key(b) - key(a));
}

export interface BookWalk {
  /** Units actually available at the levels we could see. */
  filled: number;
  /** Coins paid (instabuy) or received before tax (instasell). */
  total: number;
  /** total / filled. */
  averagePrice: number;
  /** True when the visible book was too shallow to fill the whole request. */
  partial: boolean;
}

/**
 * Walk a side of the order book to price an instant transaction of `quantity` units.
 * Pass `buy_summary` to price an instabuy, `sell_summary` to price an instasell.
 */
export function walkBook(levels: OrderLevel[], quantity: number): BookWalk {
  let remaining = Math.max(0, Math.floor(quantity));
  let total = 0;
  let filled = 0;
  for (const level of levels) {
    if (remaining <= 0) break;
    const take = Math.min(level.amount, remaining);
    total += take * level.pricePerUnit;
    filled += take;
    remaining -= take;
  }
  return { filled, total, averagePrice: filled > 0 ? total / filled : 0, partial: remaining > 0 };
}

export interface FlipPlan {
  units: number;
  cost: number;
  revenue: number;
  tax: number;
  profit: number;
  buyFillHours: number;
  sellFillHours: number;
}

/** Profit breakdown for flipping an explicit quantity of one item. */
export function planFlip(f: FlipResult, units: number, taxRate: number): FlipPlan {
  const u = Math.max(0, Math.floor(units));
  const cost = u * f.buyOrderPrice;
  const gross = u * f.sellOfferPrice;
  const tax = gross * taxRate;
  return {
    units: u,
    cost,
    revenue: gross - tax,
    tax,
    profit: gross - tax - cost,
    buyFillHours: f.instaSellsPerHour > 0 ? u / f.instaSellsPerHour : Infinity,
    sellFillHours: f.instaBuysPerHour > 0 ? u / f.instaBuysPerHour : Infinity,
  };
}
