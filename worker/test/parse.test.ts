import { describe, expect, it } from 'vitest';
import { parseSnapshotFast } from '../src/parse';

const payload = {
  success: true,
  lastUpdated: 1789674921036,
  products: {
    ENCHANTED_DIAMOND: {
      product_id: 'ENCHANTED_DIAMOND',
      sell_summary: [
        { amount: 25053, pricePerUnit: 1275.8, orders: 1 },
        { amount: 1024, pricePerUnit: 1275.7, orders: 1 },
      ],
      buy_summary: [{ amount: 448, pricePerUnit: 1347.5, orders: 1 }],
      quick_status: { productId: 'ENCHANTED_DIAMOND', sellPrice: 1275.6, sellVolume: 9208308, sellMovingWeek: 28810069, sellOrders: 319, buyPrice: 1370.7, buyVolume: 3241115, buyMovingWeek: 8387822, buyOrders: 638 },
    },
    'INK_SACK:3': {
      product_id: 'INK_SACK:3',
      sell_summary: [],
      buy_summary: [{ amount: 1, pricePerUnit: 4.4, orders: 1 }],
      quick_status: { productId: 'INK_SACK:3', sellPrice: 0, sellVolume: 0, sellMovingWeek: 113480974, sellOrders: 0, buyPrice: 4.4, buyVolume: 6186545, buyMovingWeek: 31277405, buyOrders: 118 },
    },
    DEAD_ITEM: {
      product_id: 'DEAD_ITEM',
      sell_summary: [],
      buy_summary: [],
      quick_status: { productId: 'DEAD_ITEM', sellPrice: 0, sellVolume: 0, sellMovingWeek: 0, sellOrders: 0, buyPrice: 0, buyVolume: 0, buyMovingWeek: 0, buyOrders: 0 },
    },
    BIG: {
      product_id: 'BIG',
      sell_summary: [{ amount: 1, pricePerUnit: 1.2893295e7, orders: 1 }],
      buy_summary: [{ amount: 5, pricePerUnit: 13019999.8, orders: 1 }],
      quick_status: { productId: 'BIG', sellPrice: 1, sellVolume: 1, sellMovingWeek: 62609, sellOrders: 1, buyPrice: 1, buyVolume: 1, buyMovingWeek: 90210, buyOrders: 1 },
    },
  },
};

describe('parseSnapshotFast', () => {
  it('matches JSON.parse for every field the collector uses', () => {
    const text = JSON.stringify(payload);
    const fast = parseSnapshotFast(text);
    const slow = JSON.parse(text) as typeof payload;
    expect(fast.lastUpdated).toBe(slow.lastUpdated);
    expect(Object.keys(fast.products).sort()).toEqual(Object.keys(slow.products).sort());
    for (const [id, p] of Object.entries(slow.products)) {
      const f = fast.products[id];
      expect(f.sell_summary[0]?.pricePerUnit ?? null).toBe(p.sell_summary[0]?.pricePerUnit ?? null);
      expect(f.buy_summary[0]?.pricePerUnit ?? null).toBe(p.buy_summary[0]?.pricePerUnit ?? null);
      expect(f.quick_status.sellMovingWeek).toBe(p.quick_status.sellMovingWeek);
      expect(f.quick_status.buyMovingWeek).toBe(p.quick_status.buyMovingWeek);
    }
  });

  it('rejects payloads without products', () => {
    expect(() => parseSnapshotFast('{"success":true,"lastUpdated":1,"products":{}}')).toThrow();
    expect(() => parseSnapshotFast('{}')).toThrow();
  });
});
