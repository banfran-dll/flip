import { describe, expect, it } from 'vitest';
import type { BazaarProduct } from '../src/api/bazaar';
import {
  DEFAULT_FLIP_FILTERS,
  DEFAULT_FLIP_SETTINGS,
  MAX_ORDER_SIZE,
  computeFlip,
  passesFilters,
  planFlip,
  rankFlips,
  walkBook,
} from '../src/lib/flip';

function product(overrides: Partial<BazaarProduct> & { id?: string } = {}): BazaarProduct {
  const { id = 'TEST', ...rest } = overrides;
  return {
    product_id: id,
    // sell offers (instabuy side), ascending
    buy_summary: [
      { amount: 1000, pricePerUnit: 110, orders: 4 },
      { amount: 5000, pricePerUnit: 111, orders: 10 },
    ],
    // buy orders (instasell side), descending
    sell_summary: [
      { amount: 2000, pricePerUnit: 100, orders: 6 },
      { amount: 8000, pricePerUnit: 99.5, orders: 12 },
    ],
    quick_status: {
      productId: id,
      buyPrice: 110.5,
      buyVolume: 6000,
      buyMovingWeek: 168_000, // 1000 instabuys / hour
      buyOrders: 14,
      sellPrice: 99.8,
      sellVolume: 10_000,
      sellMovingWeek: 336_000, // 2000 instasells / hour
      sellOrders: 18,
    },
    ...rest,
  };
}

describe('computeFlip', () => {
  it('places our orders one tick inside the current best orders', () => {
    const f = computeFlip(product(), DEFAULT_FLIP_SETTINGS)!;
    expect(f.buyOrderPrice).toBe(100.1);
    expect(f.sellOfferPrice).toBe(109.9);
    expect(f.instaBuyPrice).toBe(110);
    expect(f.instaSellPrice).toBe(100);
  });

  it('applies tax only to the sell side', () => {
    const f = computeFlip(product(), { ...DEFAULT_FLIP_SETTINGS, taxRate: 0.0125 })!;
    expect(f.taxPerUnit).toBeCloseTo(109.9 * 0.0125, 6);
    expect(f.profitPerUnit).toBeCloseTo(109.9 * (1 - 0.0125) - 100.1, 6);
    expect(f.marginPct).toBeCloseTo((f.profitPerUnit / 100.1) * 100, 6);
  });

  it('derives hourly flow from the moving-week volumes', () => {
    const f = computeFlip(product(), DEFAULT_FLIP_SETTINGS)!;
    expect(f.instaSellsPerHour).toBeCloseTo(2000, 6);
    expect(f.instaBuysPerHour).toBeCloseTo(1000, 6);
    // harmonic combination: 2000*1000/(3000)
    expect(f.flowPerHour).toBeCloseTo(666.666, 2);
  });

  it('caps units by budget and by the per-order maximum', () => {
    const small = computeFlip(product(), { ...DEFAULT_FLIP_SETTINGS, budget: 1_001 })!;
    expect(small.units).toBe(10); // floor(1001 / 100.1)
    const huge = computeFlip(product(), { ...DEFAULT_FLIP_SETTINGS, budget: 1e12 })!;
    expect(huge.units).toBe(MAX_ORDER_SIZE);
  });

  it('estimates the cycle time as buy fill + sell fill and respects the minimum cycle', () => {
    const f = computeFlip(product(), { ...DEFAULT_FLIP_SETTINGS, budget: 100_100, minCycleMinutes: 0 })!;
    expect(f.units).toBe(1000);
    expect(f.cycleHours).toBeCloseTo(1000 / 2000 + 1000 / 1000, 6); // 1.5h
    expect(f.profitPerHour).toBeCloseTo(f.profitPerCycle / 1.5, 6);

    const floored = computeFlip(product(), { ...DEFAULT_FLIP_SETTINGS, budget: 1_001, minCycleMinutes: 30 })!;
    // 10 units would cycle in 0.015h; the 30-minute floor dominates
    expect(floored.profitPerHour).toBeCloseTo(floored.profitPerCycle / 0.5, 6);
  });

  it('returns null when one side of the book is empty', () => {
    expect(computeFlip(product({ buy_summary: [] }))).toBeNull();
    expect(computeFlip(product({ sell_summary: [] }))).toBeNull();
  });

  it('reports a negative profit when the spread is too tight', () => {
    const f = computeFlip(
      product({
        buy_summary: [{ amount: 1, pricePerUnit: 100.2, orders: 1 }],
        sell_summary: [{ amount: 1, pricePerUnit: 100, orders: 1 }],
      }),
    )!;
    expect(f.profitPerUnit).toBeLessThan(0);
  });
});

describe('risk flags', () => {
  it('flags nothing for a healthy market', () => {
    expect(computeFlip(product())!.flags).toEqual([]);
  });

  it('flags low volume and thin books', () => {
    const p = product();
    p.quick_status.sellMovingWeek = 168 * 5; // 5 / hour
    p.quick_status.buyOrders = 2;
    const f = computeFlip(p)!;
    expect(f.flags).toContain('LOW_VOLUME');
    expect(f.flags).toContain('THIN_BOOK');
  });

  it('flags a stray top buy order far above the weighted price', () => {
    const p = product();
    p.sell_summary[0].pricePerUnit = 108; // weighted sellPrice stays 99.8
    expect(computeFlip(p)!.flags).toContain('OUTLIER_BUY');
  });

  it('flags a stray lowest sell offer far below the weighted price', () => {
    const p = product();
    p.buy_summary[0].pricePerUnit = 104; // weighted buyPrice stays 110.5
    expect(computeFlip(p)!.flags).toContain('OUTLIER_SELL');
  });

  it('flags heavily imbalanced volume', () => {
    const p = product();
    p.quick_status.buyMovingWeek = 168 * 100; // 100/h vs 2000/h
    expect(computeFlip(p)!.flags).toContain('IMBALANCE');
  });

  it('flags absurd spreads', () => {
    const p = product({ sell_summary: [{ amount: 1, pricePerUnit: 10, orders: 1 }] });
    p.quick_status.sellPrice = 10;
    expect(computeFlip(p)!.flags).toContain('HUGE_SPREAD');
  });
});

describe('filters and ranking', () => {
  it('drops unprofitable flips and honours thresholds', () => {
    const f = computeFlip(product())!;
    expect(passesFilters(f, DEFAULT_FLIP_FILTERS)).toBe(true);
    expect(passesFilters(f, { ...DEFAULT_FLIP_FILTERS, minMarginPct: 50 })).toBe(false);
    expect(passesFilters(f, { ...DEFAULT_FLIP_FILTERS, minWeeklyVolume: 200_000 })).toBe(false);
    expect(passesFilters(f, { ...DEFAULT_FLIP_FILTERS, maxPrice: 50 })).toBe(false);
    expect(passesFilters(f, { ...DEFAULT_FLIP_FILTERS, minPrice: 500 })).toBe(false);
    expect(passesFilters({ ...f, profitPerUnit: -1 }, DEFAULT_FLIP_FILTERS)).toBe(false);
    expect(passesFilters({ ...f, flags: ['THIN_BOOK'] }, { ...DEFAULT_FLIP_FILTERS, hideFlags: 'danger' })).toBe(false);
    expect(passesFilters({ ...f, flags: ['LOW_VOLUME'] }, { ...DEFAULT_FLIP_FILTERS, hideFlags: 'danger' })).toBe(true);
    expect(passesFilters({ ...f, flags: ['LOW_VOLUME'] }, { ...DEFAULT_FLIP_FILTERS, hideFlags: 'all' })).toBe(false);
    expect(passesFilters({ ...f, flags: ['HUGE_SPREAD'] }, { ...DEFAULT_FLIP_FILTERS, hideFlags: 'none' })).toBe(true);
    expect(passesFilters(f, { ...DEFAULT_FLIP_FILTERS, onlyIds: new Set(['OTHER']) })).toBe(false);
  });

  it('ranks by budget-aware profit per hour', () => {
    const fast = computeFlip(product({ id: 'FAST' }))!;
    const slowP = product({ id: 'SLOW' });
    slowP.quick_status.buyMovingWeek = 168 * 50;
    slowP.quick_status.sellMovingWeek = 168 * 50;
    const slow = computeFlip(slowP)!;
    const ranked = rankFlips([slow, fast], { ...DEFAULT_FLIP_FILTERS, minWeeklyVolume: 0 });
    expect(ranked.map((r) => r.id)).toEqual(['FAST', 'SLOW']);
  });
});

describe('walkBook', () => {
  const levels = [
    { amount: 10, pricePerUnit: 100, orders: 1 },
    { amount: 20, pricePerUnit: 101, orders: 2 },
  ];

  it('prices a quantity across levels', () => {
    const w = walkBook(levels, 15);
    expect(w.filled).toBe(15);
    expect(w.total).toBe(10 * 100 + 5 * 101);
    expect(w.averagePrice).toBeCloseTo(w.total / 15, 6);
    expect(w.partial).toBe(false);
  });

  it('marks partial fills when the book is too shallow', () => {
    const w = walkBook(levels, 100);
    expect(w.filled).toBe(30);
    expect(w.partial).toBe(true);
  });

  it('handles zero quantity', () => {
    expect(walkBook(levels, 0)).toEqual({ filled: 0, total: 0, averagePrice: 0, partial: false });
  });
});

describe('planFlip', () => {
  it('breaks down cost, tax, revenue, profit and fill times', () => {
    const f = computeFlip(product())!;
    const plan = planFlip(f, 500, 0.0125);
    expect(plan.units).toBe(500);
    expect(plan.cost).toBeCloseTo(500 * 100.1, 6);
    expect(plan.tax).toBeCloseTo(500 * 109.9 * 0.0125, 6);
    expect(plan.revenue).toBeCloseTo(500 * 109.9 - plan.tax, 6);
    expect(plan.profit).toBeCloseTo(plan.revenue - plan.cost, 6);
    expect(plan.buyFillHours).toBeCloseTo(500 / 2000, 6);
    expect(plan.sellFillHours).toBeCloseTo(500 / 1000, 6);
  });
});
