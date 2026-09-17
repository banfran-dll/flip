import type { BazaarSnapshot } from '../api/bazaar';

/**
 * Five-minute aggregates of every product, the long-range companion to the
 * 20-second session history: small enough to keep for days in IndexedDB and
 * to scan for every item when looking for crashes.
 */
export const BUCKET_MS = 5 * 60_000;
export const FIELDS = 6; // buyAvg, sellAvg, buyMin, sellMax, tradesBuy, tradesSell

export interface Bucket {
  /** Bucket start (server clock, ms), aligned to BUCKET_MS. */
  t: number;
  ids: string[];
  /** FIELDS numbers per id, in `ids` order. */
  v: Float32Array;
  /** Snapshots aggregated into this bucket. */
  n: number;
}

export interface BucketPoint {
  t: number;
  buyAvg: number;
  sellAvg: number;
  buyMin: number;
  sellMax: number;
  tradesBuy: number;
  tradesSell: number;
}

export const bucketStart = (t: number) => Math.floor(t / BUCKET_MS) * BUCKET_MS;

interface Accum {
  t: number;
  n: number;
  per: Map<string, { buySum: number; sellSum: number; buyMin: number; sellMax: number; count: number; tb: number; ts: number }>;
}

/** Folds snapshots into the current bucket and emits finished buckets. */
export class BucketBuilder {
  private acc: Accum | null = null;
  private lastSeen: number | null = null;
  /** Last counter values per product, carried across buckets so no trades fall between them. */
  private counters = new Map<string, { bmw: number; smw: number }>();

  /** Returns the completed bucket when the snapshot starts a new one. */
  add(snapshot: BazaarSnapshot): Bucket | null {
    if (snapshot.lastUpdated === this.lastSeen) return null;
    this.lastSeen = snapshot.lastUpdated;
    const start = bucketStart(snapshot.lastUpdated);
    let finished: Bucket | null = null;
    if (this.acc && this.acc.t !== start) {
      finished = this.flush();
    }
    if (!this.acc) this.acc = { t: start, n: 0, per: new Map() };
    this.acc.n++;
    for (const p of Object.values(snapshot.products)) {
      const buy = p.buy_summary[0]?.pricePerUnit;
      const sell = p.sell_summary[0]?.pricePerUnit;
      const q = p.quick_status;
      let a = this.acc.per.get(p.product_id);
      if (!a) {
        a = { buySum: 0, sellSum: 0, buyMin: Infinity, sellMax: 0, count: 0, tb: 0, ts: 0 };
        this.acc.per.set(p.product_id, a);
      }
      if (buy != null && sell != null) {
        a.buySum += buy;
        a.sellSum += sell;
        a.buyMin = Math.min(a.buyMin, buy);
        a.sellMax = Math.max(a.sellMax, sell);
        a.count++;
      }
      // Trade counters only grow between snapshots except on rare bucket expiries.
      const prev = this.counters.get(p.product_id);
      if (prev) {
        if (q.buyMovingWeek > prev.bmw) a.tb += q.buyMovingWeek - prev.bmw;
        if (q.sellMovingWeek > prev.smw) a.ts += q.sellMovingWeek - prev.smw;
        prev.bmw = q.buyMovingWeek;
        prev.smw = q.sellMovingWeek;
      } else {
        this.counters.set(p.product_id, { bmw: q.buyMovingWeek, smw: q.sellMovingWeek });
      }
    }
    return finished;
  }

  /** The bucket in progress, or null. */
  flush(): Bucket | null {
    if (!this.acc) return null;
    const ids = [...this.acc.per.keys()];
    const v = new Float32Array(ids.length * FIELDS);
    ids.forEach((id, i) => {
      const a = this.acc!.per.get(id)!;
      const o = i * FIELDS;
      v[o] = a.count ? a.buySum / a.count : NaN;
      v[o + 1] = a.count ? a.sellSum / a.count : NaN;
      v[o + 2] = a.count ? a.buyMin : NaN;
      v[o + 3] = a.count ? a.sellMax : NaN;
      v[o + 4] = a.tb;
      v[o + 5] = a.ts;
    });
    const b: Bucket = { t: this.acc.t, ids, v, n: this.acc.n };
    this.acc = null;
    return b;
  }

  /** Snapshot of the in-progress bucket without ending it. */
  peek(): Bucket | null {
    if (!this.acc) return null;
    const saved = this.acc;
    const b = this.flush();
    this.acc = saved;
    return b;
  }
}

const INDEX = new WeakMap<Bucket, Map<string, number>>();

/** id → position lookup, built once per bucket. */
export function indexOf(b: Bucket): Map<string, number> {
  let m = INDEX.get(b);
  if (!m) {
    m = new Map(b.ids.map((id, i) => [id, i]));
    INDEX.set(b, m);
  }
  return m;
}

export function pointOf(b: Bucket, id: string): BucketPoint | null {
  const i = indexOf(b).get(id);
  if (i == null) return null;
  const o = i * FIELDS;
  return { t: b.t, buyAvg: b.v[o], sellAvg: b.v[o + 1], buyMin: b.v[o + 2], sellMax: b.v[o + 3], tradesBuy: b.v[o + 4], tradesSell: b.v[o + 5] };
}

/** Series of one product across buckets (ascending by time). */
export function seriesOf(buckets: Bucket[], id: string): BucketPoint[] {
  const out: BucketPoint[] = [];
  for (const b of buckets) {
    const p = pointOf(b, id);
    if (p && Number.isFinite(p.buyAvg)) out.push(p);
  }
  return out;
}
