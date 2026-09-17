import { describe, expect, it } from 'vitest';
import type { PricePoint } from '../src/lib/history';
import { DEFAULT_FLIP_SETTINGS, computeFlip, type FlipResult } from '../src/lib/flip';
import { computeSignals, confidenceParts, marginAt, scoreFlip, EMPTY_SIGNALS } from '../src/lib/signals';
import { DEFAULT_ALERT_RULE, matchesRule, newMatches } from '../src/lib/alerts';

const TAX = 0.0125;
const pt = (t: number, buy: number, sell: number): PricePoint => ({ t, buy, sell });

describe('marginAt', () => {
  it('matches computeFlip for the same top of book', () => {
    const m = marginAt(pt(0, 110, 100), TAX);
    expect(m).toBeCloseTo(((109.9 * (1 - TAX) - 100.1) / 100.1) * 100, 6);
  });
});

describe('computeSignals', () => {
  it('returns empty signals without history', () => {
    expect(computeSignals([], TAX)).toEqual(EMPTY_SIGNALS);
  });

  it('counts trailing snapshots with a viable margin', () => {
    const points = [pt(0, 101, 100), pt(20_000, 101, 100), pt(40_000, 110, 100), pt(60_000, 110, 100), pt(80_000, 110, 100)];
    const s = computeSignals(points, TAX);
    expect(s.samples).toBe(5);
    expect(s.persisted).toBe(3); // the first two points had a negative margin
  });

  it('detects competing flippers from outbids and undercuts', () => {
    const points = [
      pt(0, 110, 100),
      pt(20_000, 110, 100.1), // someone outbid the top buy order
      pt(40_000, 109.9, 100.1), // someone undercut the sell offer
      pt(60_000, 109.9, 99.5), // buy order consumed: not competition
      pt(80_000, 111, 99.5), // sell offer consumed: not competition
    ];
    expect(computeSignals(points, TAX).undercut).toBeCloseTo(2 / 4, 6);
  });

  it('measures trend over the window', () => {
    const points = [pt(0, 100, 90), pt(60_000, 105, 90), pt(120_000, 110, 99)];
    const s = computeSignals(points, TAX);
    expect(s.trendBuyPct).toBeCloseTo(10, 6);
    expect(s.trendSellPct).toBeCloseTo(10, 6);
  });

  it('reports NaN trend with a single point', () => {
    const s = computeSignals([pt(0, 100, 90)], TAX);
    expect(Number.isNaN(s.trendBuyPct)).toBe(true);
  });
});

function flip(overrides: Partial<FlipResult> = {}): FlipResult {
  const base = computeFlip(
    {
      product_id: 'X',
      buy_summary: [{ amount: 100, pricePerUnit: 110, orders: 5 }],
      sell_summary: [{ amount: 100, pricePerUnit: 100, orders: 5 }],
      quick_status: { productId: 'X', buyPrice: 110, buyVolume: 1, buyMovingWeek: 168_000, buyOrders: 10, sellPrice: 100, sellVolume: 1, sellMovingWeek: 168_000, sellOrders: 10 },
    },
    DEFAULT_FLIP_SETTINGS,
  )!;
  return { ...base, ...overrides };
}

describe('confidence and score', () => {
  it('is neutral without history and full with a persisted, uncontested spread', () => {
    const unknown = confidenceParts(flip(), EMPTY_SIGNALS);
    expect(unknown.stability).toBe(0.6);
    const solid = confidenceParts(flip(), { samples: 10, persisted: 10, undercut: 0, trendBuyPct: 0, trendSellPct: 0 });
    expect(solid.stability).toBe(1);
    expect(solid.competition).toBe(1);
    expect(solid.flagPenalty).toBe(1);
  });

  it('discounts fresh spreads, competition and flags', () => {
    const fresh = confidenceParts(flip(), { samples: 5, persisted: 1, undercut: 1, trendBuyPct: 0, trendSellPct: 0 });
    expect(fresh.stability).toBeCloseTo(0.52, 6);
    expect(fresh.competition).toBeCloseTo(0.6, 6);
    expect(confidenceParts(flip({ flags: ['LOW_VOLUME'] }), EMPTY_SIGNALS).flagPenalty).toBe(0.75);
    expect(confidenceParts(flip({ flags: ['THIN_BOOK'] }), EMPTY_SIGNALS).flagPenalty).toBe(0.3);
  });

  it('scales profit per hour by confidence', () => {
    const f = flip();
    const scored = scoreFlip(f, EMPTY_SIGNALS);
    expect(scored.score).toBeCloseTo(f.profitPerHour * 0.6, 6);
  });
});

describe('alerts', () => {
  const rule = { ...DEFAULT_ALERT_RULE, enabled: true, minScore: 1000, minMarginPct: 1 };
  const good = scoreFlip(flip(), { samples: 10, persisted: 10, undercut: 0, trendBuyPct: 0, trendSellPct: 0 });

  it('applies every rule clause', () => {
    const none = new Set<string>();
    expect(matchesRule(good, rule, none)).toBe(true);
    expect(matchesRule(good, { ...rule, enabled: false }, none)).toBe(false);
    expect(matchesRule(good, { ...rule, onlyFavorites: true }, none)).toBe(false);
    expect(matchesRule(good, { ...rule, onlyFavorites: true }, new Set(['X']))).toBe(true);
    expect(matchesRule({ ...good, flags: ['LOW_VOLUME'] }, rule, none)).toBe(false);
    expect(matchesRule({ ...good, flags: ['LOW_VOLUME'] }, { ...rule, cleanOnly: false }, none)).toBe(true);
    expect(matchesRule(good, { ...rule, minMarginPct: 50 }, none)).toBe(false);
    expect(matchesRule(good, { ...rule, minScore: 1e12 }, none)).toBe(false);
  });

  it('only reports flips that started matching in this snapshot', () => {
    const first = newMatches([good], rule, new Set(), new Set());
    expect(first.fresh.map((f) => f.id)).toEqual(['X']);
    const second = newMatches([good], rule, new Set(), first.matching);
    expect(second.fresh).toEqual([]);
    const third = newMatches([], rule, new Set(), second.matching);
    expect(third.matching.size).toBe(0);
  });
});
