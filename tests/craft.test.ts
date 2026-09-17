import { describe, expect, it } from 'vitest';
import type { BazaarProduct } from '../src/api/bazaar';
import { computeAllCraftFlips, computeCraftFlip, type Recipe } from '../src/lib/craft';

const product = (id: string, ask: number, bid: number, askAmount = 1e6, weeklyBuys = 168_000): BazaarProduct => ({
  product_id: id,
  buy_summary: [{ pricePerUnit: ask, amount: askAmount, orders: 1 }],
  sell_summary: [{ pricePerUnit: bid, amount: 1e6, orders: 1 }],
  quick_status: { productId: id, buyPrice: ask, buyVolume: 0, buyMovingWeek: weeklyBuys, buyOrders: 1, sellPrice: bid, sellVolume: 0, sellMovingWeek: 0, sellOrders: 1 },
});

const products = {
  DIAMOND: product('DIAMOND', 8, 7),
  ENCHANTED_DIAMOND: product('ENCHANTED_DIAMOND', 1500, 1400),
};
const recipe: Recipe = { type: 'crafting', count: 1, inputs: { DIAMOND: 160 } };

describe('computeCraftFlip', () => {
  it('prices materials and product in all three modes', () => {
    const f = computeCraftFlip(products, 'ENCHANTED_DIAMOND', recipe, 0, 1e9)!;
    expect(f.materialCostInstant).toBe(160 * 8);
    expect(f.materialCostOrders).toBeCloseTo(160 * 7.1, 6);
    expect(f.revenueInstant).toBe(1400);
    expect(f.revenueOffer).toBeCloseTo(1499.9, 6);
    expect(f.profitInstant).toBe(1400 - 1280);
    expect(f.profitMixed).toBeCloseTo(1499.9 - 1280, 6);
    expect(f.profitOrders).toBeCloseTo(1499.9 - 1136, 6);
  });

  it('applies tax to the product sale only', () => {
    const f = computeCraftFlip(products, 'ENCHANTED_DIAMOND', recipe, 0.0125, 1e9)!;
    expect(f.revenueOffer).toBeCloseTo(1499.9 * 0.9875, 6);
    expect(f.materialCostInstant).toBe(1280);
  });

  it('sizes the batch to the budget and the visible book', () => {
    const f = computeCraftFlip(products, 'ENCHANTED_DIAMOND', recipe, 0, 12_800)!;
    expect(f.crafts).toBe(10);
    expect(f.batchCost).toBe(12_800);
    expect(f.batchProfitMixed).toBeCloseTo(10 * 1499.9 - 12_800, 6);
    expect(f.partial).toBe(false);
    expect(f.sellHours).toBeCloseTo(10 / 1000, 6);
    expect(f.profitPerHour).toBeCloseTo(f.batchProfitMixed, 6); // sells within the hour → batch profit per hour

    const shallow = { ...products, DIAMOND: product('DIAMOND', 8, 7, 800) };
    const g = computeCraftFlip(shallow, 'ENCHANTED_DIAMOND', recipe, 0, 1e9)!;
    expect(g.partial).toBe(true);
    expect(g.crafts).toBe(5);
  });

  it('uses forge time as a floor on the selling time', () => {
    const forge: Recipe = { type: 'forge', count: 1, inputs: { DIAMOND: 160 }, duration: 7200 };
    const f = computeCraftFlip(products, 'ENCHANTED_DIAMOND', forge, 0, 12_800)!;
    expect(f.sellHours).toBe(2);
    expect(f.profitPerHour).toBeCloseTo(f.batchProfitMixed / 2, 6);
  });

  it('honours the output count', () => {
    const nine: Recipe = { type: 'crafting', count: 9, inputs: { DIAMOND: 160 } };
    const f = computeCraftFlip(products, 'ENCHANTED_DIAMOND', nine, 0, 1e9)!;
    expect(f.materialCostInstant).toBeCloseTo(1280 / 9, 6);
  });

  it('returns null when a side of any book is missing', () => {
    expect(computeCraftFlip({ ...products, DIAMOND: { ...products.DIAMOND, buy_summary: [] } }, 'ENCHANTED_DIAMOND', recipe, 0, 1e9)).toBeNull();
    expect(computeCraftFlip(products, 'MISSING', recipe, 0, 1e9)).toBeNull();
  });
});

describe('computeAllCraftFlips', () => {
  it('keeps the best recipe per product and ranks by profit per hour', () => {
    const book = {
      ENCHANTED_DIAMOND: [recipe, { type: 'crafting' as const, count: 1, inputs: { DIAMOND: 200 } }],
      DIAMOND: [{ type: 'crafting' as const, count: 1, inputs: { ENCHANTED_DIAMOND: 1 } }],
    };
    const flips = computeAllCraftFlips(products, book, 0, 1e6);
    expect(flips[0].id).toBe('ENCHANTED_DIAMOND');
    expect(flips[0].recipe.inputs.DIAMOND).toBe(160);
    expect(flips[1].batchProfitMixed).toBeLessThan(0);
  });
});
