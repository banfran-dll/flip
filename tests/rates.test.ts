import { describe, expect, it } from 'vitest';
import type { PricePoint } from '../src/lib/history';
import { LIVE_FULL_WINDOW_MS, LIVE_MIN_WINDOW_MS, blendRates, liveRates, liveWeight } from '../src/lib/rates';

const pt = (t: number, bmw: number, smw: number): PricePoint => ({ t, buy: 10, sell: 9, bmw, smw });

describe('liveRates', () => {
  it('needs two points', () => {
    expect(liveRates([])).toBeNull();
    expect(liveRates([pt(0, 0, 0)])).toBeNull();
  });

  it('sums positive counter deltas over the window', () => {
    // 3 snapshots over 60 s: 30 instabuys, 90 instasells
    const points = [pt(0, 1000, 5000), pt(30_000, 1010, 5050), pt(60_000, 1030, 5090)];
    const r = liveRates(points)!;
    expect(r.windowMs).toBe(60_000);
    expect(r.instaBuysPerHour).toBeCloseTo(30 * 60, 6);
    expect(r.instaSellsPerHour).toBeCloseTo(90 * 60, 6);
  });

  it('ignores bucket expiries (negative steps)', () => {
    const points = [pt(0, 1000, 5000), pt(30_000, 800, 5050), pt(60_000, 820, 5090)];
    const r = liveRates(points)!;
    expect(r.instaBuysPerHour).toBeCloseTo(20 * 60, 6);
  });

  it('only looks at the trailing window', () => {
    const points = [pt(0, 0, 0), pt(5 * 60_000, 1_000_000, 0), pt(20 * 60_000, 1_000_000, 0), pt(25 * 60_000, 1_000_100, 0)];
    const r = liveRates(points)!;
    expect(r.windowMs).toBe(5 * 60_000);
    expect(r.instaBuysPerHour).toBeCloseTo(100 * 12, 6);
  });
});

describe('liveWeight / blendRates', () => {
  it('ramps from 0 to 1 between the minimum and full windows', () => {
    expect(liveWeight(0)).toBe(0);
    expect(liveWeight(LIVE_MIN_WINDOW_MS)).toBe(0);
    expect(liveWeight((LIVE_MIN_WINDOW_MS + LIVE_FULL_WINDOW_MS) / 2)).toBeCloseTo(0.5, 6);
    expect(liveWeight(LIVE_FULL_WINDOW_MS * 2)).toBe(1);
  });

  it('falls back to weekly averages without live data', () => {
    const r = blendRates(100, 50, null);
    expect(r).toEqual({ instaSellsPerHour: 100, instaBuysPerHour: 50, liveWeight: 0, activity: NaN });
  });

  it('blends and reports activity relative to the weekly average', () => {
    const live = { windowMs: LIVE_FULL_WINDOW_MS, samples: 30, instaSellsPerHour: 300, instaBuysPerHour: 150 };
    const r = blendRates(100, 50, live);
    expect(r.liveWeight).toBe(1);
    expect(r.instaSellsPerHour).toBe(300);
    expect(r.activity).toBeCloseTo(3, 6);
    const half = blendRates(100, 50, { ...live, windowMs: (LIVE_MIN_WINDOW_MS + LIVE_FULL_WINDOW_MS) / 2 });
    expect(half.instaSellsPerHour).toBeCloseTo(200, 6);
  });
});
