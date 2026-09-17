import { useEffect, useState } from 'react';
import { fetchCoflnetHistory, type HistoryPoint } from '../api/coflnet';
import { fetchServerHistory } from '../api/dataServer';
import type { T } from '../hooks/useT';
import { seriesOf, type Bucket } from '../lib/buckets';
import { Sparkline } from './Sparkline';

interface Props {
  id: string;
  buckets: Bucket[];
  serverUrl: string;
  t: T;
}

type Range = 'session' | 'day' | 'week' | 'month';

/** Long-range chart: Coflnet day/week history when reachable, else the locally collected buckets. */
export function HistoryChart({ id, buckets, serverUrl, t }: Props) {
  const [range, setRange] = useState<Range>('day');
  const [remote, setRemote] = useState<{ id: string; range: Range; points: HistoryPoint[]; source: 'server' | 'coflnet' } | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (range === 'session') return;
    const ac = new AbortController();
    setError(false);
    setLoading(true);
    const load = async (): Promise<{ points: HistoryPoint[]; source: 'server' | 'coflnet' }> => {
      if (serverUrl) {
        try {
          const points = await fetchServerHistory(serverUrl, id, range === 'day' ? '24h' : range === 'week' ? '7d' : '30d', ac.signal);
          if (points.length > 1) return { points, source: 'server' };
        } catch {
          /* fall through to Coflnet */
        }
      }
      if (range === 'month') throw new Error('no server');
      return { points: await fetchCoflnetHistory(id, range, ac.signal), source: 'coflnet' };
    };
    load()
      .then(({ points, source }) => {
        setRemote({ id, range, points, source });
        setLoading(false);
      })
      .catch(() => {
        if (!ac.signal.aborted) {
          setError(true);
          setLoading(false);
        }
      });
    return () => ac.abort();
  }, [id, range, serverUrl]);

  const local = seriesOf(buckets, id).map((p) => ({ t: p.t, buy: p.buyAvg, sell: p.sellAvg }));
  const usingRemote = range !== 'session' && remote && remote.id === id && remote.range === range && remote.points.length > 1;
  const points = usingRemote ? remote.points : local;

  return (
    <div>
      <div className="segmented segmented--sm">
        {(serverUrl ? (['day', 'week', 'month', 'session'] as Range[]) : (['day', 'week', 'session'] as Range[])).map((r) => (
          <button key={r} type="button" className={`segmented__btn ${range === r ? 'is-active' : ''}`} onClick={() => setRange(r)}>
            {t(r === 'day' ? 'range24h' : r === 'week' ? 'range7d' : r === 'month' ? 'range30d' : 'rangeLocal')}
          </button>
        ))}
      </div>
      {points.length > 1 ? <Sparkline points={points} height={110} /> : <p className="muted">{loading && range !== 'session' ? t('loading') : t('notEnoughPoints')}</p>}
      <p className="field__hint">
        {usingRemote
          ? remote.source === 'server'
            ? t('chartSourceServer', { r: t(range === 'day' ? 'range24h' : range === 'week' ? 'range7d' : 'range30d') })
            : t('chartSourceCoflnet')
          : t('chartSourceLocal', { h: (local.length * 5) / 60 >= 1 ? `${((local.length * 5) / 60).toFixed(1)}h` : `${local.length * 5}m` })}
        {error && range !== 'session' && ` · ${t('chartRemoteFailed')}`}
      </p>
    </div>
  );
}
