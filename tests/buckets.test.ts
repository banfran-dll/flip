import { describe, expect, it } from 'vitest';
import type { BazaarSnapshot } from '../src/api/bazaar';
import { BUCKET_MS, BucketBuilder, FIELDS, pointOf, seriesOf } from '../src/lib/buckets';
import { crashCandidate, findCrashes, median } from '../src/lib/crash';

function snapshot(t: number, ask: number, bid: number, bmw: number, smw: number): BazaarSnapshot {
  return {
    success: true,
    lastUpdated: t,
    products: {
      X: {
        product_id: 'X',
        buy_summary: [{ pricePerUnit: ask, amount: 10, orders: 1 }],
        sell_summary: [{ pricePerUnit: bid, amount: 10, orders: 1 }],
        quick_status: { productId: 'X', buyPrice: ask, buyVolume: 0, buyMovingWeek: bmw, buyOrders: 1, sellPrice: bid, sellVolume: 0, sellMovingWeek: smw, sellOrders: 1 },
      },
    },
  };
}

describe('BucketBuilder', () => {
  it('aggregates snapshots of one bucket and emits it when the next bucket starts', () => {
    const b = new BucketBuilder();
    expect(b.add(snapshot(0, 100, 90, 1000, 2000))).toBeNull();
    expect(b.add(snapshot(20_000, 110, 80, 1010, 2000))).toBeNull();
    expect(b.add(snapshot(20_000, 999, 999, 9999, 9999))).toBeNull(); // duplicate snapshot ignored
    const done = b.add(snapshot(BUCKET_MS, 120, 70, 1010, 2100))!;
    expect(done.t).toBe(0);
    expect(done.n).toBe(2);
    expect(done.ids).toEqual(['X']);
    expect(done.v.length).toBe(FIELDS);
    const p = pointOf(done, 'X')!;
    expect(p.buyAvg).toBeCloseTo(105, 4);
    expect(p.sellAvg).toBeCloseTo(85, 4);
    expect(p.buyMin).toBe(100);
    expect(p.sellMax).toBe(90);
    expect(p.tradesBuy).toBe(10);
    expect(p.tradesSell).toBe(0);
    const current = b.peek()!;
    expect(current.t).toBe(BUCKET_MS);
    expect(pointOf(current, 'X')!.tradesSell).toBe(100); // delta since the previous bucket's last snapshot
  });

  it('ignores counter expiries', () => {
    const b = new BucketBuilder();
    b.add(snapshot(0, 100, 90, 1000, 2000));
    b.add(snapshot(20_000, 100, 90, 500, 2050));
    const p = pointOf(b.peek()!, 'X')!;
    expect(p.tradesBuy).toBe(0);
    expect(p.tradesSell).toBe(50);
  });
});

describe('crash detection', () => {
  it('computes medians', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(Number.isNaN(median([]))).toBe(true);
  });

  it('flags an item trading far below its 24h median', () => {
    const b = new BucketBuilder();
    // 3 hours of a stable 100/90 market, one snapshot per bucket
    const buckets = [];
    for (let i = 0; i < 36; i++) {
      const done = b.add(snapshot(i * BUCKET_MS, 100, 90, 1000 + i * 10, 2000 + i * 10));
      if (done) buckets.push(done);
    }
    buckets.push(b.peek()!);
    const crashed = snapshot(36 * BUCKET_MS, 60, 55, 1400, 2400).products.X;
    const c = crashCandidate(crashed, buckets, 0.0125, 36 * BUCKET_MS)!;
    expect(c.baselineBuy).toBeCloseTo(100, 4);
    expect(c.dropPct).toBeCloseTo(40, 4);
    expect(c.recoveryMarginPct).toBeCloseTo(((99.9 * 0.9875 - 60) / 60) * 100, 3);
    expect(c.historyHours).toBeGreaterThanOrEqual(2);
    expect(c.windowTrades).toBeGreaterThan(0);
    expect(seriesOf(buckets, 'X').length).toBe(36);

    const list = findCrashes({ X: crashed }, buckets, 0.0125, { minDropPct: 10, minWeeklyVolume: 0 }, 36 * BUCKET_MS);
    expect(list.map((x) => x.id)).toEqual(['X']);
    expect(findCrashes({ X: crashed }, buckets, 0.0125, { minDropPct: 50, minWeeklyVolume: 0 }, 36 * BUCKET_MS)).toEqual([]);
  });

  it('needs enough history', () => {
    const b = new BucketBuilder();
    b.add(snapshot(0, 100, 90, 0, 0));
    expect(crashCandidate(snapshot(0, 50, 45, 0, 0).products.X, [b.peek()!], 0, 0)).toBeNull();
  });
});
