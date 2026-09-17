import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SNAPSHOT_INTERVAL_MS,
  INITIAL_LIVE_STATE,
  MAX_RETRIES,
  PUBLISH_MARGIN_MS,
  RETRY_MS,
  nextErrorDelay,
  nextExpectedAt,
  nextLiveDelay,
  observe,
} from '../src/lib/schedule';

describe('observe', () => {
  it('records the first snapshot without changing the interval', () => {
    const s = observe(INITIAL_LIVE_STATE, 1_000_000);
    expect(s).toEqual({ intervalMs: DEFAULT_SNAPSHOT_INTERVAL_MS, lastUpdated: 1_000_000, retries: 0 });
  });

  it('counts unchanged fetches as retries', () => {
    let s = observe(INITIAL_LIVE_STATE, 1_000_000);
    s = observe(s, 1_000_000);
    s = observe(s, 1_000_000);
    expect(s.retries).toBe(2);
  });

  it('learns the cadence from consecutive distinct snapshots', () => {
    let s = observe(INITIAL_LIVE_STATE, 0);
    s = observe(s, 25_000);
    expect(s.intervalMs).toBe(Math.round(20_000 * 0.7 + 25_000 * 0.3));
    expect(s.retries).toBe(0);
  });

  it('ignores gaps that span several cycles (tab was hidden)', () => {
    let s = observe(INITIAL_LIVE_STATE, 0);
    s = observe(s, 300_000);
    expect(s.intervalMs).toBe(DEFAULT_SNAPSHOT_INTERVAL_MS);
    expect(s.lastUpdated).toBe(300_000);
  });
});

describe('nextLiveDelay', () => {
  it('fetches soon when nothing is known yet', () => {
    expect(nextLiveDelay(INITIAL_LIVE_STATE, 0)).toBe(RETRY_MS);
  });

  it('waits until just after the next expected snapshot', () => {
    const s = observe(INITIAL_LIVE_STATE, 100_000);
    // fetched 2 s after the snapshot: wait the remaining 18 s + publish margin
    expect(nextLiveDelay(s, 102_000)).toBe(18_000 + PUBLISH_MARGIN_MS);
    expect(nextExpectedAt(s)).toBe(120_000);
  });

  it('never schedules sooner than the minimum delay or later than one cycle', () => {
    const s = observe(INITIAL_LIVE_STATE, 100_000);
    expect(nextLiveDelay(s, 200_000)).toBe(1_000);
    expect(nextLiveDelay(s, 0)).toBe(DEFAULT_SNAPSHOT_INTERVAL_MS + PUBLISH_MARGIN_MS);
  });

  it('retries quickly while the snapshot is late, then backs off', () => {
    let s = observe(INITIAL_LIVE_STATE, 100_000);
    for (let i = 0; i < MAX_RETRIES; i++) {
      s = observe(s, 100_000);
      expect(nextLiveDelay(s, 125_000)).toBe(RETRY_MS);
    }
    s = observe(s, 100_000);
    expect(nextLiveDelay(s, 125_000)).toBe(s.intervalMs);
  });
});

describe('nextErrorDelay', () => {
  it('doubles from 5 s and caps at 60 s', () => {
    expect(nextErrorDelay(1)).toBe(5_000);
    expect(nextErrorDelay(2)).toBe(10_000);
    expect(nextErrorDelay(3)).toBe(20_000);
    expect(nextErrorDelay(10)).toBe(60_000);
  });
});
