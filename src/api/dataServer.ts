/**
 * Client for the optional Cloudflare Worker in worker/ that collects bazaar
 * snapshots around the clock. Everything degrades gracefully when no server
 * URL is configured or the server is unreachable.
 */
import type { HistoryPoint } from './coflnet';

export interface ServerBaseline {
  /** Median instabuy price over the last 24 h. */
  b: number;
  /** Median instasell price over the last 24 h. */
  s: number;
  /** Hours of history behind the medians. */
  h: number;
  /** Units traded in the last 24 h. */
  v: number;
  /** Latest 5-minute average instabuy price on the server. */
  c: number;
}

export interface ServerDerived {
  t: number;
  items: Record<string, ServerBaseline>;
  crashes: { id: string; now: number; baseline: number; dropPct: number; trades24: number }[];
}

export interface ServerStatus {
  ok: boolean;
  items: number;
  lastSnapshot: number | null;
  currentBucket: number | null;
  latestDerived: number | null;
  historySince: number | null;
}

export type ServerRange = '24h' | '7d' | '30d' | '90d';

export const normalizeServerUrl = (url: string) => url.trim().replace(/\/+$/, '');

async function get<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`data server HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const fetchServerStatus = (base: string, signal?: AbortSignal) => get<ServerStatus>(`${normalizeServerUrl(base)}/v1/status`, signal);
export const fetchServerDerived = (base: string, signal?: AbortSignal) => get<ServerDerived>(`${normalizeServerUrl(base)}/v1/derived`, signal);

const historyCache = new Map<string, { at: number; points: HistoryPoint[] }>();
const HISTORY_TTL_MS = 2 * 60_000;

export async function fetchServerHistory(base: string, id: string, range: ServerRange, signal?: AbortSignal): Promise<HistoryPoint[]> {
  const key = `${base}|${id}|${range}`;
  const hit = historyCache.get(key);
  if (hit && Date.now() - hit.at < HISTORY_TTL_MS) return hit.points;
  const data = await get<{ points: { t: number; buyAvg: number; sellAvg: number }[] }>(`${normalizeServerUrl(base)}/v1/history/${encodeURIComponent(id)}?range=${range}`, signal);
  const points = data.points.map((p) => ({ t: p.t, buy: p.buyAvg, sell: p.sellAvg }));
  historyCache.set(key, { at: Date.now(), points });
  return points;
}
