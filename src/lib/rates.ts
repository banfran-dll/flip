import type { PricePoint } from './history';

/**
 * Live trade rates from the moving-week counters.
 *
 * `buyMovingWeek` / `sellMovingWeek` grow with every instabuy / instasell and
 * only shrink when an old bucket of trades expires (rare, in one step), so the
 * sum of positive deltas over a trailing window is the number of units that
 * actually traded in that window — a far better fill-time estimate than the
 * 7-day average while the market is unusually busy or quiet.
 */
export interface LiveRates {
  windowMs: number;
  samples: number;
  instaBuysPerHour: number;
  instaSellsPerHour: number;
}

export const LIVE_WINDOW_MS = 10 * 60_000;
/** Below this much history the live rate is ignored. */
export const LIVE_MIN_WINDOW_MS = 2 * 60_000;
/** At this much history the live rate fully replaces the weekly average. */
export const LIVE_FULL_WINDOW_MS = 10 * 60_000;

export function liveRates(points: PricePoint[]): LiveRates | null {
  if (points.length < 2) return null;
  const last = points[points.length - 1];
  let j = points.length - 1;
  while (j > 0 && last.t - points[j - 1].t <= LIVE_WINDOW_MS) j--;
  const windowMs = last.t - points[j].t;
  if (windowMs <= 0) return null;
  let buys = 0;
  let sells = 0;
  for (let i = j + 1; i < points.length; i++) {
    const db = points[i].bmw - points[i - 1].bmw;
    const ds = points[i].smw - points[i - 1].smw;
    if (db > 0) buys += db;
    if (ds > 0) sells += ds;
  }
  const hours = windowMs / 3_600_000;
  return { windowMs, samples: points.length - j, instaBuysPerHour: buys / hours, instaSellsPerHour: sells / hours };
}

/** 0 until LIVE_MIN_WINDOW_MS of history, 1 from LIVE_FULL_WINDOW_MS on. */
export function liveWeight(windowMs: number): number {
  const w = (windowMs - LIVE_MIN_WINDOW_MS) / (LIVE_FULL_WINDOW_MS - LIVE_MIN_WINDOW_MS);
  return Math.min(1, Math.max(0, w));
}

export interface RateOverride {
  instaSellsPerHour: number;
  instaBuysPerHour: number;
  /** How much of the rate comes from live data (0 = weekly average only). */
  liveWeight: number;
  /** Live throughput relative to the weekly average (both sides combined). NaN when unknown. */
  activity: number;
}

/** Blend the weekly averages with the live rates according to how much history exists. */
export function blendRates(weeklySellsPerHour: number, weeklyBuysPerHour: number, live: LiveRates | null): RateOverride {
  const w = live ? liveWeight(live.windowMs) : 0;
  if (!live || w === 0) return { instaSellsPerHour: weeklySellsPerHour, instaBuysPerHour: weeklyBuysPerHour, liveWeight: 0, activity: NaN };
  const weeklyTotal = weeklySellsPerHour + weeklyBuysPerHour;
  return {
    instaSellsPerHour: w * live.instaSellsPerHour + (1 - w) * weeklySellsPerHour,
    instaBuysPerHour: w * live.instaBuysPerHour + (1 - w) * weeklyBuysPerHour,
    liveWeight: w,
    activity: weeklyTotal > 0 ? (live.instaSellsPerHour + live.instaBuysPerHour) / weeklyTotal : NaN,
  };
}
