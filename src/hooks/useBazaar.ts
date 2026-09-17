import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchBazaar, type BazaarSnapshot } from '../api/bazaar';

export interface BazaarState {
  snapshot: BazaarSnapshot | null;
  error: string | null;
  loading: boolean;
  fetchedAt: number | null;
}

/** Polls the bazaar endpoint, pausing while the tab is hidden. */
export function useBazaar(refreshSec: number) {
  const [state, setState] = useState<BazaarState>({ snapshot: null, error: null, loading: true, fetchedAt: null });
  const inflight = useRef<AbortController | null>(null);
  const lastFetch = useRef(0);

  const refresh = useCallback(async () => {
    inflight.current?.abort();
    const ac = new AbortController();
    inflight.current = ac;
    lastFetch.current = Date.now();
    setState((s) => ({ ...s, loading: true }));
    try {
      const snapshot = await fetchBazaar(ac.signal);
      if (ac.signal.aborted) return;
      setState({ snapshot, error: null, loading: false, fetchedAt: Date.now() });
    } catch (e) {
      if (ac.signal.aborted) return;
      setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : String(e) }));
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => inflight.current?.abort();
  }, [refresh]);

  useEffect(() => {
    const ms = Math.max(10, refreshSec) * 1000;
    let timer: number | undefined;
    const stop = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    };
    const start = () => {
      stop();
      timer = window.setInterval(() => {
        if (document.visibilityState === 'visible') void refresh();
      }, ms);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (Date.now() - lastFetch.current > ms) void refresh();
        start();
      } else {
        stop();
      }
    };
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refreshSec, refresh]);

  return { ...state, refresh };
}
