import { describe, expect, it } from 'vitest';
import { MAX_ORDER_SIZE, computeFlip, DEFAULT_FLIP_SETTINGS } from '../src/lib/flip';
import { scoreFlip, type ScoredFlip } from '../src/lib/signals';
import { allocate, candidate, planBudget, type PlanInput } from '../src/lib/planner';

const solid = { samples: 10, persisted: 10, undercut: 0, trendBuyPct: 0, trendSellPct: 0 };

/** A flip with the given buy price, sell price and symmetric hourly flow on both sides. */
function flip(id: string, buy: number, sell: number, perHour: number, confidence = 1): ScoredFlip {
  const f = computeFlip(
    {
      product_id: id,
      buy_summary: [{ amount: 1e9, pricePerUnit: sell + 0.1, orders: 9 }],
      sell_summary: [{ amount: 1e9, pricePerUnit: buy - 0.1, orders: 9 }],
      quick_status: {
        productId: id,
        buyPrice: sell + 0.1,
        buyVolume: 1e9,
        buyMovingWeek: perHour * 168,
        buyOrders: 9,
        sellPrice: buy - 0.1,
        sellVolume: 1e9,
        sellMovingWeek: perHour * 168,
        sellOrders: 9,
      },
    },
    { ...DEFAULT_FLIP_SETTINGS, taxRate: 0 },
  )!;
  const scored = scoreFlip(f, solid);
  return { ...scored, confidence, score: f.profitPerHour * confidence };
}

const input: PlanInput = { budget: 10_000_000, slots: 14, minCycleMinutes: 6, maxOrderSize: MAX_ORDER_SIZE };

describe('candidate', () => {
  it('caps capital where the cycle floor is reached', () => {
    // flow (harmonic of 1000/1000) = 500/h; 6 min floor → 50 units cap
    const c = candidate(flip('A', 100, 110, 1000), input)!;
    expect(c.unitsCap).toBe(50);
    expect(c.capCapital).toBeCloseTo(50 * 100, 6);
    // at the cap the rate is profit × flow = 10 × 500
    expect(c.rateMax).toBeCloseTo(10 * 500, 3);
    expect(c.density).toBeCloseTo(5000 / 5000, 6);
  });

  it('rejects unprofitable or dead flips', () => {
    expect(candidate(flip('B', 110, 100, 1000), input)).toBeNull();
    expect(candidate(flip('C', 100, 110, 0), input)).toBeNull();
  });

  it('weights the rate by confidence', () => {
    const half = candidate(flip('D', 100, 110, 1000, 0.5), input)!;
    expect(half.rateMax).toBeCloseTo(2500, 3);
  });
});

describe('allocate', () => {
  it('funds the densest candidate first and respects the budget', () => {
    const dense = candidate(flip('DENSE', 100, 120, 1000), input)!; // 20% margin
    const thin = candidate(flip('THIN', 100, 105, 1000), input)!; // 5% margin
    const plan = allocate([thin, dense], { ...input, budget: 6000 });
    expect(plan.lines.map((l) => l.id)).toEqual(['DENSE', 'THIN']);
    expect(plan.lines[0].capital).toBe(5000); // full cap
    expect(plan.lines[1].capital).toBe(1000); // remainder
    expect(plan.totalCapital).toBe(6000);
    expect(plan.leftover).toBe(0);
  });

  it('never allocates more than the cap', () => {
    const plan = allocate([candidate(flip('A', 100, 110, 1000), input)!], input);
    expect(plan.lines[0].capital).toBe(5000);
    expect(plan.lines[0].saturation).toBe(1);
    expect(plan.leftover).toBe(input.budget - 5000);
  });
});

describe('planBudget', () => {
  it('returns an empty plan without budget or candidates', () => {
    expect(planBudget([], input).lines).toEqual([]);
    expect(planBudget([flip('A', 100, 110, 1000)], { ...input, budget: 0 }).lines).toEqual([]);
  });

  it('respects the slot limit', () => {
    const flips = Array.from({ length: 20 }, (_, i) => flip(`F${i}`, 100, 110 + i, 1000));
    const plan = planBudget(flips, { ...input, slots: 3, budget: 1e9 });
    expect(plan.slotsUsed).toBe(3);
    expect(plan.lines.length).toBe(3);
  });

  it('prefers a large earner over several tiny dense flips when slots are scarce', () => {
    // tiny: 50% margin but only 2 units/h of flow → cap of 1 unit (100 coins, ~50 coins/h × ...)
    const tiny = Array.from({ length: 5 }, (_, i) => flip(`T${i}`, 100, 150, 2));
    // big: 10% margin, 20000/h flow → cap 1000 units (100k coins), 10 × 10000 = 100k coins/h
    const big = flip('BIG', 100, 110, 20_000);
    const plan = planBudget([...tiny, big], { ...input, slots: 1, budget: 1e6 });
    expect(plan.lines.map((l) => l.id)).toEqual(['BIG']);
  });

  it('keeps the total within budget and sorts lines by capital', () => {
    const flips = Array.from({ length: 30 }, (_, i) => flip(`F${i}`, 50 + i * 10, 60 + i * 12, 200 + i * 100));
    const plan = planBudget(flips, input);
    expect(plan.totalCapital).toBeLessThanOrEqual(input.budget + 1e-6);
    expect(plan.leftover).toBeGreaterThanOrEqual(-1e-6);
    for (let i = 1; i < plan.lines.length; i++) expect(plan.lines[i - 1].capital).toBeGreaterThanOrEqual(plan.lines[i].capital);
    expect(plan.totalRatePerHour).toBeCloseTo(plan.lines.reduce((s, l) => s + l.ratePerHour, 0), 6);
  });
});
