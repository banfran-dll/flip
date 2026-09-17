import { useEffect, useState } from 'react';
import { fetchCoflnetHistory, type HistoryPoint } from '../api/coflnet';
import type { T } from '../hooks/useT';
import { seriesOf, type Bucket } from '../lib/buckets';
import { Sparkline } from './Sparkline';

interface Props {
  id: string;
  buckets: Bucket[];
  t: T;
}

type Range = 'session' | 'day' | 'week';

/** Long-range chart: Coflnet day/week history when reachable, else the locally collected buckets. */
export function HistoryChart({ id, buckets, t }: Props) {
  const [range, setRange] = useState<Range>('day');
  const [remote, setRemote] = useState<{ id: string; range: Range; points: HistoryPoint[] } | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (range === 'session') return;
    const ac = new AbortController();
    setError(false);
    setLoading(true);
    fetchCoflnetHistory(id, range, ac.signal)
      .then((points) => {
        setRemote({ id, range, points });
        setLoading(false);
      })
      .catch(() => {
        if (!ac.signal.aborted) {
          setError(true);
          setLoading(false);
        }
      });
    return () => ac.abort();
  }, [id, range]);

  const local = seriesOf(buckets, id).map((p) => ({ t: p.t, buy: p.buyAvg, sell: p.sellAvg }));
  const usingRemote = range !== 'session' && remote && remote.id === id && remote.range === range && remote.points.length > 1;
  const points = usingRemote ? remote.points : local;

  return (
    <div>
      <div className="segmented segmented--sm">
        {(['day', 'week', 'session'] as Range[]).map((r) => (
          <button key={r} type="button" className={`segmented__btn ${range === r ? 'is-active' : ''}`} onClick={() => setRange(r)}>
            {t(r === 'day' ? 'range24h' : r === 'week' ? 'range7d' : 'rangeLocal')}
          </button>
        ))}
      </div>
      {points.length > 1 ? <Sparkline points={points} height={110} /> : <p className="muted">{loading && range !== 'session' ? t('loading') : t('notEnoughPoints')}</p>}
      <p className="field__hint">
        {usingRemote ? t('chartSourceCoflnet') : t('chartSourceLocal', { h: (local.length * 5) / 60 >= 1 ? `${((local.length * 5) / 60).toFixed(1)}h` : `${local.length * 5}m` })}
        {error && range !== 'session' && ` · ${t('chartRemoteFailed')}`}
      </p>
    </div>
  );
}
