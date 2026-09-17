import type { BazaarProduct } from '../api/bazaar';
import { HOURS_PER_WEEK, TICK } from './flip';
import { seriesOf, type Bucket, type BucketPoint } from './buckets';

/**
 * Crash detection: an item whose price sits far below its recent baseline is
 * a candidate for a mean-reversion buy (buy now, sell offer when it recovers).
 * The baseline is the median of the last day's bucket averages so a single
 * spike or dump does not move it.
 */
export interface CrashCandidate {
  id: string;
  /** Cheapest sell offer now (what a buy costs instantly). */
  instaBuyPrice: number;
  /** Highest buy order now. */
  instaSellPrice: number;
  /** Median instabuy price over the window. */
  baselineBuy: number;
  /** Median instasell price over the window. */
  baselineSell: number;
  /** (baseline − now) / baseline, in %. Positive = below baseline. */
  dropPct: number;
  /** Margin if bought now (instabuy) and later sold with an offer at the baseline instabuy price − tick, after tax. */
  recoveryMarginPct: number;
  /** Hours of history behind the baseline. */
  historyHours: number;
  /** Units traded (instabuys + instasells) over the window. */
  windowTrades: number;
  weeklyVolume: number;
  series: BucketPoint[];
}

export const CRASH_WINDOW_MS = 24 * 3_600_000;
export const MIN_HISTORY_HOURS = 2;

export function median(values: number[]): number {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return NaN;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function crashCandidate(product: BazaarProduct, buckets: Bucket[], taxRate: number, now: number): CrashCandidate | null {
  const ask = product.buy_summary[0]?.pricePerUnit;
  const bid = product.sell_summary[0]?.pricePerUnit;
  if (ask == null || bid == null) return null;
  const series = seriesOf(
    buckets.filter((b) => b.t >= now - CRASH_WINDOW_MS),
    product.product_id,
  );
  if (series.length === 0) return null;
  const historyHours = (series[series.length - 1].t - series[0].t) / 3_600_000 + 5 / 60;
  if (historyHours < MIN_HISTORY_HOURS) return null;
  const baselineBuy = median(series.map((p) => p.buyAvg));
  const baselineSell = median(series.map((p) => p.sellAvg));
  if (!(baselineBuy > 0)) return null;
  const dropPct = ((baselineBuy - ask) / baselineBuy) * 100;
  const recoveryMarginPct = ((Math.max(0, baselineBuy - TICK) * (1 - taxRate) - ask) / ask) * 100;
  const q = product.quick_status;
  return {
    id: product.product_id,
    instaBuyPrice: ask,
    instaSellPrice: bid,
    baselineBuy,
    baselineSell,
    dropPct,
    recoveryMarginPct,
    historyHours,
    windowTrades: series.reduce((s, p) => s + p.tradesBuy + p.tradesSell, 0),
    weeklyVolume: Math.min(q.buyMovingWeek, q.sellMovingWeek),
    series,
  };
}

export interface CrashFilters {
  minDropPct: number;
  minWeeklyVolume: number;
}

export function findCrashes(products: Record<string, BazaarProduct>, buckets: Bucket[], taxRate: number, filters: CrashFilters, now = Date.now()): CrashCandidate[] {
  const out: CrashCandidate[] = [];
  for (const p of Object.values(products)) {
    if (Math.min(p.quick_status.buyMovingWeek, p.quick_status.sellMovingWeek) < filters.minWeeklyVolume) continue;
    const c = crashCandidate(p, buckets, taxRate, now);
    if (c && c.dropPct >= filters.minDropPct) out.push(c);
  }
  return out.sort((a, b) => b.dropPct - a.dropPct);
}

export const weeklyPerHour = (weekly: number) => weekly / HOURS_PER_WEEK;
