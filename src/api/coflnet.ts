/**
 * Optional long-range price history from Coflnet's public API (CORS-enabled).
 * Used only for the chart in the item detail panel; failures fall back to the
 * locally collected history.
 */
export interface HistoryPoint {
  t: number;
  /** Instabuy price (lowest sell offer). */
  buy: number;
  /** Instasell price (highest buy order). */
  sell: number;
}

const cache = new Map<string, { at: number; points: HistoryPoint[] }>();
const TTL_MS = 5 * 60_000;

export async function fetchCoflnetHistory(id: string, range: 'day' | 'week', signal?: AbortSignal): Promise<HistoryPoint[]> {
  const key = `${id}:${range}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.points;
  const res = await fetch(`https://sky.coflnet.com/api/bazaar/${encodeURIComponent(id)}/history/${range}`, { signal, headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Coflnet HTTP ${res.status}`);
  const raw = (await res.json()) as Array<{ timestamp: string; buy: number; sell: number }>;
  const points = raw
    .map((r) => ({ t: Date.parse(r.timestamp.endsWith('Z') ? r.timestamp : `${r.timestamp}Z`), buy: r.buy, sell: r.sell }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
  cache.set(key, { at: Date.now(), points });
  return points;
}
