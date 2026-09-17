import { describe, expect, it } from 'vitest';
import { BUCKET_MS, HOUR_MS, computeDerived, emptyState, finalize, ingest, median, metaOf, rollup, seriesOf, stateFrom, type Snapshot } from '../src/aggregate';
import { FIELDS, GROUP, fromBlob, fromBlob64, toBlob } from '../src/codec';

function snap(t: number, items: Record<string, [ask: number, bid: number, bmw: number, smw: number]>): Snapshot {
  const products: Snapshot['products'] = {};
  for (const [id, [ask, bid, bmw, smw]] of Object.entries(items)) {
    products[id] = { buy_summary: [{ pricePerUnit: ask }], sell_summary: [{ pricePerUnit: bid }], quick_status: { buyMovingWeek: bmw, sellMovingWeek: smw } };
  }
  return { lastUpdated: t, products };
}

describe('ingest / finalize', () => {
  it('assigns stable slots, averages prices and counts trades across snapshots', () => {
    let s = emptyState();
    let r = ingest(s, snap(1_000, { A: [100, 90, 1000, 2000], B: [10, 9, 0, 0] }));
    s = r.state;
    expect(r.finished).toBeNull();
    expect(s.idx).toEqual({ A: 0, B: 1 });
    r = ingest(s, snap(61_000, { A: [110, 80, 1010, 2050], B: [10, 9, 0, 0], C: [5, 4, 7, 7] }));
    s = r.state;
    expect(s.idx.C).toBe(2);
    expect(s.n).toBe(2);
    // same snapshot again is ignored
    expect(ingest(s, snap(61_000, { A: [999, 999, 9999, 9999] })).state).toBe(s);
    // next bucket → previous one is finished
    r = ingest(s, snap(BUCKET_MS + 1_000, { A: [120, 70, 1010, 2100], B: [10, 9, 0, 0], C: [5, 4, 7, 7] }));
    const f = r.finished!;
    expect(f.t).toBe(0);
    expect(f.n).toBe(2);
    expect(f.groups.length).toBe(1);
    const a = f.groups[0];
    expect(a[0]).toBeCloseTo(105, 4); // buyAvg
    expect(a[1]).toBeCloseTo(85, 4); // sellAvg
    expect(a[2]).toBe(100); // buyMin
    expect(a[3]).toBe(90); // sellMax
    expect(a[4]).toBe(10); // instabuys
    expect(a[5]).toBe(50); // instasells
    // C had one sample in the finished bucket
    expect(a[2 * FIELDS]).toBe(5);
    // trades carried across the bucket boundary land in the new bucket
    expect(r.state.acc[6]).toBe(50); // A instasells since the last snapshot (2100-2050)
    expect(r.state.n).toBe(1);
  });

  it('ignores counter expiries', () => {
    let s = ingest(emptyState(), snap(0, { A: [1, 1, 1000, 1000] })).state;
    s = ingest(s, snap(20_000, { A: [1, 1, 500, 1010] })).state;
    const row = finalize(s)[0];
    expect(row[4]).toBe(0);
    expect(row[5]).toBe(10);
  });

  it('round-trips state through meta + blobs', () => {
    const s = ingest(emptyState(), snap(0, { A: [1, 2, 3, 4] })).state;
    const back = stateFrom(JSON.parse(JSON.stringify(metaOf(s))), fromBlob64(toBlob(s.acc)), fromBlob64(toBlob(s.last)));
    expect(back.idx).toEqual(s.idx);
    expect([...back.acc]).toEqual([...s.acc]);
    expect([...back.last]).toEqual([...s.last]);
    expect(fromBlob(toBlob(new Float32Array([1.5, 2]))).length).toBe(2);
  });

  it('spreads items over groups of 100', () => {
    const items: Record<string, [number, number, number, number]> = {};
    for (let i = 0; i < 250; i++) items[`I${i}`] = [i + 1, i, 0, 0];
    const s = ingest(emptyState(), snap(0, items)).state;
    const groups = finalize(s);
    expect(groups.length).toBe(3);
    expect(groups[2][(49 % GROUP) * FIELDS]).toBe(250); // I249 → slot 249 → group 2, position 49
  });
});

describe('rollup / median / derived', () => {
  it('rolls buckets up into an hour', () => {
    const a = new Float32Array(GROUP * FIELDS).fill(NaN);
    const b = new Float32Array(GROUP * FIELDS).fill(NaN);
    a.set([100, 90, 95, 92, 10, 20], 0);
    b.set([110, 80, 105, 85, 5, 5], 0);
    const h = rollup([a, b]);
    expect(h[0]).toBeCloseTo(105, 4);
    expect(h[1]).toBeCloseTo(85, 4);
    expect(h[2]).toBe(95);
    expect(h[3]).toBe(92);
    expect(h[4]).toBe(15);
    expect(h[5]).toBe(25);
    expect(Number.isNaN(h[FIELDS])).toBe(true);
  });

  it('computes medians', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(Number.isNaN(median([]))).toBe(true);
  });

  it('derives baselines and crashes', () => {
    const idx = { A: 0, B: 1 };
    const rows = [];
    for (let h = 0; h < 6; h++) {
      const data = new Float32Array(GROUP * FIELDS).fill(NaN);
      data.set([100, 90, 99, 91, 1000, 1000], 0); // A stable at 100
      data.set([50, 45, 49, 46, 10, 10], FIELDS); // B stable at 50 but illiquid
      rows.push({ t: h * HOUR_MS, g: 0, data });
    }
    const latest = new Float32Array(GROUP * FIELDS).fill(NaN);
    latest.set([70, 60, 70, 60, 5, 5], 0); // A crashed to 70
    latest.set([30, 25, 30, 25, 1, 1], FIELDS); // B crashed too, but too few trades
    const d = computeDerived(idx, rows, { t: 6 * HOUR_MS, n: 1, groups: [latest] }, 15, 5000);
    expect(d.items.A.b).toBe(100);
    expect(d.items.A.h).toBe(6);
    expect(d.items.A.v).toBe(12_000);
    expect(d.items.A.c).toBe(70);
    expect(d.crashes.map((c) => c.id)).toEqual(['A']);
    expect(d.crashes[0].dropPct).toBeCloseTo(30, 4);
    expect(seriesOf(rows, 1).map((p) => p.buyAvg)).toEqual([50, 50, 50, 50, 50, 50]);
  });
});
