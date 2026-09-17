import { describe, expect, it } from 'vitest';
import type { BazaarProduct } from '../src/api/bazaar';
import { evaluateOrder, type TrackedOrder } from '../src/lib/orders';

const product: BazaarProduct = {
  product_id: 'X',
  // sell offers (ascending)
  buy_summary: [
    { amount: 50, pricePerUnit: 110, orders: 2 },
    { amount: 500, pricePerUnit: 111, orders: 3 },
  ],
  // buy orders (descending)
  sell_summary: [
    { amount: 40, pricePerUnit: 100.2, orders: 1 },
    { amount: 300, pricePerUnit: 100.1, orders: 2 },
    { amount: 1000, pricePerUnit: 100, orders: 5 },
  ],
  quick_status: { productId: 'X', buyPrice: 110, buyVolume: 550, buyMovingWeek: 0, buyOrders: 5, sellPrice: 100, sellVolume: 1340, sellMovingWeek: 0, sellOrders: 8 },
};
const rates = { instaSellsPerHour: 200, instaBuysPerHour: 100 };
const order = (side: 'buy' | 'sell', price: number, amount = 100): TrackedOrder => ({ id: 'o', itemId: 'X', side, price, amount, createdAt: 0 });

describe('evaluateOrder — buy orders', () => {
  it('is at the top when our price is the highest buy order', () => {
    const s = evaluateOrder(order('buy', 100.2, 40), product, rates, 0.0125);
    expect(s.state).toBe('top');
    expect(s.aheadUnits).toBe(0);
    expect(s.gap).toBe(0);
    expect(s.fillHours).toBeCloseTo(40 / 200, 6);
    expect(s.relistPrice).toBe(100.3);
    expect(s.marginPctNow).toBeCloseTo(((109.9 * (1 - 0.0125) - 100.2) / 100.2) * 100, 6);
  });

  it('is outbid when higher buy orders exist, with the queue ahead counted', () => {
    const s = evaluateOrder(order('buy', 100.1, 100), product, rates, 0.0125);
    expect(s.state).toBe('outbid');
    expect(s.gap).toBeCloseTo(0.1, 6);
    expect(s.aheadUnits).toBe(40);
    expect(s.samePriceUnits).toBe(300);
    expect(s.samePriceOrders).toBe(2);
    // 40 ahead + (300 − 100) others at our price + our 100
    expect(s.fillHours).toBeCloseTo(340 / 200, 6);
  });

  it('is pending until the order has been seen in the book, then filled once it disappears', () => {
    const fresh = evaluateOrder(order('buy', 105), product, rates, 0.0125);
    expect(fresh.state).toBe('pending');
    expect(fresh.gap).toBe(0);
    const seen = evaluateOrder({ ...order('buy', 105), seenAt: 1 }, product, rates, 0.0125);
    expect(seen.state).toBe('filled');
    expect(seen.fillHours).toBe(0);
  });
});

describe('evaluateOrder — sell offers', () => {
  it('is at the top at the lowest sell offer', () => {
    const s = evaluateOrder(order('sell', 110, 50), product, rates, 0.0125);
    expect(s.state).toBe('top');
    expect(s.relistPrice).toBe(109.9);
    expect(Number.isNaN(s.marginPctNow)).toBe(true);
  });

  it('is undercut when a cheaper offer exists', () => {
    const s = evaluateOrder(order('sell', 111, 100), product, rates, 0.0125);
    expect(s.state).toBe('undercut');
    expect(s.aheadUnits).toBe(50);
    expect(s.fillHours).toBeCloseTo((50 + 400 + 100) / 100, 6);
  });

  it('assumes filled when the lowest offer is above ours and the order was seen before', () => {
    expect(evaluateOrder(order('sell', 105), product, rates, 0.0125).state).toBe('pending');
    expect(evaluateOrder({ ...order('sell', 105), seenAt: 1 }, product, rates, 0.0125).state).toBe('filled');
  });
});

describe('evaluateOrder — edge cases', () => {
  it('is unknown without a product or an empty side', () => {
    expect(evaluateOrder(order('buy', 100), undefined, rates, 0.0125).state).toBe('unknown');
    expect(evaluateOrder(order('sell', 100), { ...product, buy_summary: [] }, rates, 0.0125).state).toBe('unknown');
  });

  it('reports an infinite fill time without volume', () => {
    expect(evaluateOrder(order('buy', 100.2), product, { instaSellsPerHour: 0, instaBuysPerHour: 0 }, 0.0125).fillHours).toBe(Infinity);
  });
});
