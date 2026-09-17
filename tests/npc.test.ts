import { describe, expect, it } from 'vitest';
import type { BazaarProduct } from '../src/api/bazaar';
import { computeAllNpcFlips, computeNpcFlip } from '../src/lib/npc';

const product = (id: string, levels: [number, number][]): BazaarProduct => ({
  product_id: id,
  buy_summary: levels.map(([price, amount]) => ({ pricePerUnit: price, amount, orders: 1 })),
  sell_summary: [],
  quick_status: { productId: id, buyPrice: 0, buyVolume: 0, buyMovingWeek: 0, buyOrders: 0, sellPrice: 0, sellVolume: 0, sellMovingWeek: 0, sellOrders: 0 },
});

describe('computeNpcFlip', () => {
  it('returns null when nothing is cheaper than the NPC price', () => {
    expect(computeNpcFlip(product('A', [[10, 100]]), 10, 1e9)).toBeNull();
    expect(computeNpcFlip(product('A', []), 10, 1e9)).toBeNull();
    expect(computeNpcFlip(product('A', [[5, 100]]), 0, 1e9)).toBeNull();
  });

  it('buys every level below the NPC price', () => {
    const f = computeNpcFlip(product('A', [[6, 100], [8, 50], [10, 1000], [12, 5]]), 10, 1e9)!;
    expect(f.units).toBe(150);
    expect(f.cost).toBe(600 + 400);
    expect(f.profit).toBe(1500 - 1000);
    expect(f.profitPerUnit).toBe(4);
    expect(f.budgetLimited).toBe(false);
  });

  it('stops at the budget', () => {
    const f = computeNpcFlip(product('A', [[6, 100], [8, 50]]), 10, 700)!;
    expect(f.units).toBe(100 + 12);
    expect(f.budgetLimited).toBe(true);
  });

  it('ranks by total profit', () => {
    const products = { A: product('A', [[6, 10]]), B: product('B', [[6, 1000]]), C: product('C', [[20, 5]]) };
    const npc = (id: string) => ({ A: 10, B: 10, C: 10 })[id];
    expect(computeAllNpcFlips(products, npc, 1e9).map((f) => f.id)).toEqual(['B', 'A']);
  });
});
