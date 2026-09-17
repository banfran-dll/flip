/**
 * Snapshot-aligned polling.
 *
 * Measured behaviour of https://api.hypixel.net/v2/skyblock/bazaar (Sept 2026):
 * `lastUpdated` advances every 20 s and the CDN serves the new snapshot within
 * 1–2 s of that timestamp. Polling on a fixed timer therefore wastes up to a
 * whole cycle; instead we learn the cadence from consecutive snapshots and
 * fetch just after the next one is due. If the fetched snapshot has not
 * changed yet we retry every couple of seconds, bounded, then back off.
 */

export const DEFAULT_SNAPSHOT_INTERVAL_MS = 20_000;
/** How long after `lastUpdated` a new snapshot is typically visible at the CDN. */
export const PUBLISH_MARGIN_MS = 1_500;
/** Retry spacing while the expected snapshot has not appeared yet. */
export const RETRY_MS = 2_000;
/** Consecutive unchanged fetches before backing off to a full interval. */
export const MAX_RETRIES = 6;
export const MIN_DELAY_MS = 1_000;

export interface LiveState {
  /** Learned cadence of the upstream snapshots. */
  intervalMs: number;
  /** `lastUpdated` of the most recent snapshot we have seen. */
  lastUpdated: number | null;
  /** Consecutive fetches that returned the same snapshot. */
  retries: number;
}

export const INITIAL_LIVE_STATE: LiveState = { intervalMs: DEFAULT_SNAPSHOT_INTERVAL_MS, lastUpdated: null, retries: 0 };

/** Fold a fetched `lastUpdated` into the state, learning the cadence from distinct consecutive snapshots. */
export function observe(state: LiveState, lastUpdated: number): LiveState {
  if (state.lastUpdated == null) return { ...state, lastUpdated, retries: 0 };
  if (lastUpdated === state.lastUpdated) return { ...state, retries: state.retries + 1 };
  const delta = lastUpdated - state.lastUpdated;
  let intervalMs = state.intervalMs;
  // Only learn from a single step (not from gaps while the tab was hidden).
  if (delta >= 5_000 && delta <= 120_000 && delta < state.intervalMs * 1.5) {
    intervalMs = Math.round(state.intervalMs * 0.7 + delta * 0.3);
  }
  return { intervalMs, lastUpdated, retries: 0 };
}

/** Server-clock time at which the next snapshot is expected. */
export function nextExpectedAt(state: LiveState): number | null {
  return state.lastUpdated == null ? null : state.lastUpdated + state.intervalMs;
}

/** Milliseconds to wait before the next live-mode fetch. */
export function nextLiveDelay(state: LiveState, now: number): number {
  if (state.lastUpdated == null) return RETRY_MS;
  if (state.retries > 0) {
    if (state.retries <= MAX_RETRIES) return RETRY_MS;
    // The upstream snapshot is late or stuck: stop hammering and wait a full cycle.
    return state.intervalMs;
  }
  const expected = state.lastUpdated + state.intervalMs + PUBLISH_MARGIN_MS;
  return clamp(expected - now, MIN_DELAY_MS, state.intervalMs + PUBLISH_MARGIN_MS);
}

/** Exponential back-off after network/API errors: 5 s, 10 s, 20 s, … capped at 60 s. */
export function nextErrorDelay(consecutiveErrors: number): number {
  return Math.min(5_000 * 2 ** Math.max(0, consecutiveErrors - 1), 60_000);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
