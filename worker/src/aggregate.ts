import { FIELDS, GROUP } from './codec';

/**
 * Pure aggregation logic for the collector.
 *
 * Every minute the cron fetches one bazaar snapshot. Items get a stable slot
 * index the first time they are seen; slots are grouped 100 per database row
 * so a whole 5-minute bucket is 22-ish rows and a single item's history is
 * one row per bucket of its group. Trade counts come from the moving-week
 * counters, which grow with every trade and only shrink on rare expiries.
 */
export const BUCKET_MS = 5 * 60_000;
export const HOUR_MS = 3_600_000;
const ACC = 7; // buySum, sellSum, buyMin, sellMax, count, tradesBuy, tradesSell
const LAST = 2; // bmw, smw

export interface SnapshotProduct {
  buy_summary: { pricePerUnit: number }[];
  sell_summary: { pricePerUnit: number }[];
  quick_status: { buyMovingWeek: number; sellMovingWeek: number };
}
export interface Snapshot {
  lastUpdated: number;
  products: Record<string, SnapshotProduct>;
}

export interface State {
  idx: Record<string, number>;
  count: number;
  /** lastUpdated of the last ingested snapshot; −1 before the first one. */
  lastSeen: number;
  /** Start of the bucket being accumulated; −1 before the first snapshot. */
  bucketT: number;
  n: number;
  acc: Float64Array;
  last: Float64Array;
}

export interface Meta {
  idx: Record<string, number>;
  count: number;
  lastSeen: number;
  bucketT: number;
  n: number;
}

export function emptyState(): State {
  return { idx: {}, count: 0, lastSeen: -1, bucketT: -1, n: 0, acc: new Float64Array(0), last: new Float64Array(0) };
}

export function metaOf(s: State): Meta {
  return { idx: s.idx, count: s.count, lastSeen: s.lastSeen, bucketT: s.bucketT, n: s.n };
}

export function stateFrom(meta: Meta, acc: Float64Array, last: Float64Array): State {
  const s: State = { ...meta, acc, last };
  if (s.acc.length !== s.count * ACC) s.acc = grow(s.acc, s.count * ACC, true);
  if (s.last.length !== s.count * LAST) s.last = grow(s.last, s.count * LAST, false);
  return s;
}

function grow(a: Float64Array, length: number, accLayout: boolean): Float64Array {
  const out = new Float64Array(length);
  out.set(a.subarray(0, Math.min(a.length, length)));
  if (accLayout) {
    for (let i = a.length; i < length; i++) {
      const f = i % ACC;
      out[i] = f === 2 ? Infinity : f === 3 ? -Infinity : 0;
    }
  } else {
    for (let i = a.length; i < length; i++) out[i] = NaN;
  }
  return out;
}

export interface Finished {
  t: number;
  n: number;
  groups: Float32Array[];
}

/** Fold one snapshot into the state; returns the finished bucket when a new one starts. */
export function ingest(state: State, snap: Snapshot): { state: State; finished: Finished | null } {
  if (!(snap.lastUpdated > state.lastSeen)) return { state, finished: null };
  const s: State = { ...state, idx: { ...state.idx } };

  // Assign slots to new products.
  for (const id of Object.keys(snap.products)) {
    if (s.idx[id] === undefined) s.idx[id] = s.count++;
  }
  if (s.acc.length !== s.count * ACC) s.acc = grow(s.acc, s.count * ACC, true);
  if (s.last.length !== s.count * LAST) s.last = grow(s.last, s.count * LAST, false);

  const bucketT = Math.floor(snap.lastUpdated / BUCKET_MS) * BUCKET_MS;
  let finished: Finished | null = null;
  if (s.bucketT >= 0 && bucketT !== s.bucketT) {
    finished = { t: s.bucketT, n: s.n, groups: finalize(s) };
    s.acc = grow(new Float64Array(0), s.count * ACC, true);
    s.n = 0;
  }
  s.bucketT = bucketT;
  s.n += 1;
  s.lastSeen = snap.lastUpdated;

  for (const [id, p] of Object.entries(snap.products)) {
    const i = s.idx[id];
    const o = i * ACC;
    const buy = p.buy_summary[0]?.pricePerUnit;
    const sell = p.sell_summary[0]?.pricePerUnit;
    if (buy != null && sell != null) {
      s.acc[o] += buy;
      s.acc[o + 1] += sell;
      s.acc[o + 2] = Math.min(s.acc[o + 2], buy);
      s.acc[o + 3] = Math.max(s.acc[o + 3], sell);
      s.acc[o + 4] += 1;
    }
    const bmw = p.quick_status.buyMovingWeek;
    const smw = p.quick_status.sellMovingWeek;
    const l = i * LAST;
    if (Number.isFinite(s.last[l])) {
      if (bmw > s.last[l]) s.acc[o + 5] += bmw - s.last[l];
      if (smw > s.last[l + 1]) s.acc[o + 6] += smw - s.last[l + 1];
    }
    s.last[l] = bmw;
    s.last[l + 1] = smw;
  }
  return { state: s, finished };
}

/** Convert the accumulator into per-group Float32 rows. */
export function finalize(s: State): Float32Array[] {
  const groups = Math.ceil(s.count / GROUP);
  const out: Float32Array[] = [];
  for (let g = 0; g < groups; g++) {
    const row = new Float32Array(GROUP * FIELDS).fill(NaN);
    for (let k = 0; k < GROUP; k++) {
      const i = g * GROUP + k;
      if (i >= s.count) break;
      const o = i * ACC;
      const cnt = s.acc[o + 4];
      const r = k * FIELDS;
      row[r] = cnt ? s.acc[o] / cnt : NaN;
      row[r + 1] = cnt ? s.acc[o + 1] / cnt : NaN;
      row[r + 2] = cnt ? s.acc[o + 2] : NaN;
      row[r + 3] = cnt ? s.acc[o + 3] : NaN;
      row[r + 4] = s.acc[o + 5];
      row[r + 5] = s.acc[o + 6];
    }
    out.push(row);
  }
  return out;
}

/** Roll several bucket rows of one group up into one row (mean of averages, min/max, summed trades). */
export function rollup(rows: Float32Array[]): Float32Array {
  const out = new Float32Array(GROUP * FIELDS).fill(NaN);
  for (let k = 0; k < GROUP; k++) {
    const r = k * FIELDS;
    let buySum = 0;
    let sellSum = 0;
    let cnt = 0;
    let min = Infinity;
    let max = -Infinity;
    let tb = 0;
    let ts = 0;
    for (const row of rows) {
      if (Number.isFinite(row[r])) {
        buySum += row[r];
        sellSum += row[r + 1];
        min = Math.min(min, row[r + 2]);
        max = Math.max(max, row[r + 3]);
        cnt++;
      }
      tb += row[r + 4] || 0;
      ts += row[r + 5] || 0;
    }
    out[r] = cnt ? buySum / cnt : NaN;
    out[r + 1] = cnt ? sellSum / cnt : NaN;
    out[r + 2] = cnt ? min : NaN;
    out[r + 3] = cnt ? max : NaN;
    out[r + 4] = tb;
    out[r + 5] = ts;
  }
  return out;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function median(values: number[]): number {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return NaN;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export interface Baseline {
  /** Median instabuy (lowest sell offer) over the window. */
  b: number;
  /** Median instasell (highest buy order). */
  s: number;
  /** Hours of history behind the medians. */
  h: number;
  /** Units traded in the window (instabuys + instasells). */
  v: number;
  /** Latest 5-minute average instabuy price. */
  c: number;
}

export interface Crash {
  id: string;
  now: number;
  baseline: number;
  dropPct: number;
  trades24: number;
}

export interface Derived {
  t: number;
  items: Record<string, Baseline>;
  crashes: Crash[];
}

export interface GroupRow {
  t: number;
  g: number;
  data: Float32Array;
}

/**
 * 24 h baselines from hourly rows (plus the newest 5-minute buckets of the
 * unfinished hour) and the crash list derived from them.
 */
export function computeDerived(
  idx: Record<string, number>,
  windowRows: GroupRow[],
  latest: Finished,
  minDropPct: number,
  minTrades: number,
): Derived {
  const byGroup = new Map<number, GroupRow[]>();
  for (const r of windowRows) {
    const list = byGroup.get(r.g) ?? [];
    list.push(r);
    byGroup.set(r.g, list);
  }
  const items: Record<string, Baseline> = {};
  const crashes: Crash[] = [];
  for (const [id, i] of Object.entries(idx)) {
    const g = Math.floor(i / GROUP);
    const k = (i % GROUP) * FIELDS;
    const rows = byGroup.get(g) ?? [];
    const buys: number[] = [];
    const sells: number[] = [];
    let trades = 0;
    let tMin = Infinity;
    let tMax = -Infinity;
    for (const r of rows) {
      const b = r.data[k];
      if (Number.isFinite(b)) {
        buys.push(b);
        sells.push(r.data[k + 1]);
        tMin = Math.min(tMin, r.t);
        tMax = Math.max(tMax, r.t);
      }
      trades += (r.data[k + 4] || 0) + (r.data[k + 5] || 0);
    }
    const current = latest.groups[g]?.[k];
    if (buys.length === 0 || !Number.isFinite(current)) continue;
    const hours = Math.round(((tMax - tMin) / HOUR_MS + 1) * 10) / 10;
    const b = round1(median(buys));
    const base: Baseline = { b, s: round1(median(sells)), h: hours, v: Math.round(trades), c: round1(current) };
    items[id] = base;
    if (hours >= 2 && b > 0 && trades >= minTrades) {
      const dropPct = ((b - current) / b) * 100;
      if (dropPct >= minDropPct) crashes.push({ id, now: current, baseline: b, dropPct, trades24: trades });
    }
  }
  crashes.sort((a, b) => b.dropPct - a.dropPct);
  return { t: latest.t, items, crashes };
}

/** Extract one item's series from group rows. */
export function seriesOf(rows: GroupRow[], slot: number): { t: number; buyAvg: number; sellAvg: number; buyMin: number; sellMax: number; tradesBuy: number; tradesSell: number }[] {
  const k = (slot % GROUP) * FIELDS;
  const out = [];
  for (const r of rows) {
    const b = r.data[k];
    if (!Number.isFinite(b)) continue;
    out.push({ t: r.t, buyAvg: b, sellAvg: r.data[k + 1], buyMin: r.data[k + 2], sellMax: r.data[k + 3], tradesBuy: r.data[k + 4], tradesSell: r.data[k + 5] });
  }
  return out.sort((a, b) => a.t - b.t);
}
