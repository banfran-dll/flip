import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchBazaar, type BazaarSnapshot } from '../api/bazaar';
import { INITIAL_LIVE_STATE, nextErrorDelay, nextExpectedAt, nextLiveDelay, observe, type LiveState } from '../lib/schedule';

export type RefreshMode = 'live' | 'interval';

export interface BazaarState {
  snapshot: BazaarSnapshot | null;
  error: string | null;
  loading: boolean;
  fetchedAt: number | null;
  /** Server-clock time the next upstream snapshot is expected (live mode). */
  nextExpectedAt: number | null;
  /** Learned upstream cadence. */
  snapshotIntervalMs: number;
}

interface Options {
  mode: RefreshMode;
  /** Fixed polling period used in 'interval' mode. */
  intervalSec: number;
}

/**
 * Polls the bazaar endpoint. In 'live' mode the next fetch is timed to land
 * right after Hypixel publishes its next snapshot (see lib/schedule.ts); in
 * 'interval' mode it is a fixed timer. Polling pauses while the tab is hidden.
 */
export function useBazaar({ mode, intervalSec }: Options) {
  const [state, setState] = useState<BazaarState>({
    snapshot: null,
    error: null,
    loading: true,
    fetchedAt: null,
    nextExpectedAt: null,
    snapshotIntervalMs: INITIAL_LIVE_STATE.intervalMs,
  });

  const live = useRef<LiveState>(INITIAL_LIVE_STATE);
  const timer = useRef<number | undefined>(undefined);
  const inflight = useRef<AbortController | null>(null);
  const errors = useRef(0);
  const pendingWhileHidden = useRef(false);
  const dueAt = useRef<number | null>(null);
  const options = useRef({ mode, intervalSec });
  options.current = { mode, intervalSec };
  const runRef = useRef<() => void>(() => {});

  const clear = () => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = undefined;
  };

  const schedule = useCallback((ms: number) => {
    clear();
    dueAt.current = Date.now() + ms;
    timer.current = window.setTimeout(() => runRef.current(), ms);
  }, []);

  const delayForMode = useCallback(() => {
    const { mode: m, intervalSec: s } = options.current;
    return m === 'live' ? nextLiveDelay(live.current, Date.now()) : Math.max(5, s) * 1000;
  }, []);

  const run = useCallback(async () => {
    clear();
    if (document.visibilityState === 'hidden') {
      pendingWhileHidden.current = true;
      return;
    }
    inflight.current?.abort();
    const ac = new AbortController();
    inflight.current = ac;
    setState((s) => ({ ...s, loading: true }));
    try {
      const fresh = await fetchBazaar(ac.signal);
      if (ac.signal.aborted) return;
      errors.current = 0;
      live.current = observe(live.current, fresh.lastUpdated);
      setState((s) => ({
        // Keep the previous object when the upstream snapshot has not changed so memoised work is reused.
        snapshot: s.snapshot && s.snapshot.lastUpdated === fresh.lastUpdated ? s.snapshot : fresh,
        error: null,
        loading: false,
        fetchedAt: Date.now(),
        nextExpectedAt: nextExpectedAt(live.current),
        snapshotIntervalMs: live.current.intervalMs,
      }));
      schedule(delayForMode());
    } catch (e) {
      if (ac.signal.aborted) return;
      errors.current += 1;
      setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : String(e) }));
      schedule(nextErrorDelay(errors.current));
    }
  }, [schedule, delayForMode]);
  runRef.current = run;

  // Initial fetch.
  useEffect(() => {
    void run();
    return () => {
      clear();
      inflight.current?.abort();
    };
  }, [run]);

  // Re-plan (without an extra fetch) when the mode or interval changes.
  useEffect(() => {
    if (live.current.lastUpdated == null || inflight.current === null) return;
    schedule(delayForMode());
  }, [mode, intervalSec, schedule, delayForMode]);

  // Pause while hidden; catch up as soon as the tab is visible again.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        const overdue = dueAt.current != null && Date.now() >= dueAt.current;
        if (pendingWhileHidden.current || overdue || timer.current === undefined) {
          pendingWhileHidden.current = false;
          void runRef.current();
        }
      } else {
        clear();
        pendingWhileHidden.current = true;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  return { ...state, refresh: run };
}
