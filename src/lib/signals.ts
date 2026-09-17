import { TICK, isDangerFlag, type FlipResult } from './flip';
import type { PricePoint } from './history';

/**
 * Signals derived from the snapshots collected while the page has been open.
 * They answer the questions a flipper asks before committing coins:
 *  - has this spread been there for a while, or did it appear one snapshot ago?
 *  - are other flippers actively outbidding / undercutting the top of the book?
 *  - which way are the prices drifting?
 */
export interface Signals {
  /** Snapshots available for this product. */
  samples: number;
  /** Trailing consecutive snapshots (including the latest) whose margin stayed viable. */
  persisted: number;
  /**
   * Fraction of recent snapshot steps in which someone outbid the top buy order or
   * undercut the lowest sell offer: the signature of competing flippers. Natural
   * trading moves the book the other way (orders get consumed), so this isolates competition.
   */
  undercut: number;
  /** % change of the lowest sell offer (instabuy price) over the trend window. NaN when unknown. */
  trendBuyPct: number;
  /** % change of the highest buy order (instasell price) over the trend window. NaN when unknown. */
  trendSellPct: number;
}

export const UNDERCUT_WINDOW = 10;
export const TREND_WINDOW_MS = 5 * 60_000;
/** A snapshot counts as "persisted" while its margin is at least this fraction of the current one. */
export const PERSIST_MIN_MARGIN_RATIO = 0.5;
/** Snapshots of persistence at which the stability factor reaches its maximum. */
export const FULL_STABILITY_SAMPLES = 5;

export const EMPTY_SIGNALS: Signals = { samples: 0, persisted: 0, undercut: 0, trendBuyPct: NaN, trendSellPct: NaN };

/** Flip margin (%) implied by a historical top-of-book point. */
export function marginAt(p: PricePoint, taxRate: number): number {
  const buyOrder = p.sell + TICK;
  const sellOffer = p.buy - TICK;
  if (!(buyOrder > 0) || !Number.isFinite(sellOffer)) return NaN;
  return ((sellOffer * (1 - taxRate) - buyOrder) / buyOrder) * 100;
}

export function computeSignals(points: PricePoint[], taxRate: number): Signals {
  const n = points.length;
  if (n === 0) return EMPTY_SIGNALS;

  const current = marginAt(points[n - 1], taxRate);
  const floor = Math.max(0, current * PERSIST_MIN_MARGIN_RATIO);
  let persisted = 0;
  for (let i = n - 1; i >= 0; i--) {
    const m = marginAt(points[i], taxRate);
    if (Number.isFinite(m) && m > 0 && m >= floor) persisted++;
    else break;
  }

  const start = Math.max(1, n - UNDERCUT_WINDOW);
  let steps = 0;
  let moved = 0;
  for (let i = start; i < n; i++) {
    steps++;
    const prev = points[i - 1];
    const cur = points[i];
    if (cur.sell > prev.sell || cur.buy < prev.buy) moved++;
  }
  const undercut = steps > 0 ? moved / steps : 0;

  const last = points[n - 1];
  let j = n - 1;
  while (j > 0 && last.t - points[j - 1].t <= TREND_WINDOW_MS) j--;
  const base = points[j];
  const pct = (a: number, b: number) => (a > 0 && Number.isFinite(b) ? ((b - a) / a) * 100 : NaN);

  return {
    samples: n,
    persisted,
    undercut,
    trendBuyPct: j < n - 1 ? pct(base.buy, last.buy) : NaN,
    trendSellPct: j < n - 1 ? pct(base.sell, last.sell) : NaN,
  };
}

export interface ScoredFlip extends FlipResult {
  signals: Signals;
  /** 0–1 multiplier expressing how much of the theoretical profit/h to believe. */
  confidence: number;
  /** profitPerHour × confidence; what the recommender ranks by. */
  score: number;
}

export interface ConfidenceParts {
  stability: number;
  competition: number;
  flagPenalty: number;
}

export function confidenceParts(f: FlipResult, s: Signals): ConfidenceParts {
  // Unknown history is neither trusted nor punished; a spread seen in one snapshot only is discounted.
  const stability = s.samples < 2 ? 0.6 : Math.min(1, 0.4 + (Math.min(s.persisted, FULL_STABILITY_SAMPLES) / FULL_STABILITY_SAMPLES) * 0.6);
  const competition = 1 - 0.4 * s.undercut;
  const dangers = f.flags.filter(isDangerFlag).length;
  const warnings = f.flags.length - dangers;
  const flagPenalty = 0.75 ** warnings * 0.3 ** dangers;
  return { stability, competition, flagPenalty };
}

export function scoreFlip(f: FlipResult, s: Signals): ScoredFlip {
  const parts = confidenceParts(f, s);
  const confidence = parts.stability * parts.competition * parts.flagPenalty;
  return { ...f, signals: s, confidence, score: f.profitPerHour * confidence };
}
