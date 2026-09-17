import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertToasts } from './components/AlertToasts';
import { OrdersPanel, type OrderRow } from './components/OrdersPanel';
import { Header } from './components/Header';
import { TopPicks } from './components/TopPicks';
import { SettingsPanel } from './components/SettingsPanel';
import { DataTable } from './components/DataTable';
import { ItemDetail } from './components/ItemDetail';
import { flipColumns, lookupColumns, npcColumns, type LookupRow } from './components/columns';
import { useBazaar } from './hooks/useBazaar';
import { useLocalState } from './hooks/useLocalState';
import { useNow } from './hooks/useNow';
import { useT } from './hooks/useT';
import type { Lang } from './i18n';
import { newMatches, type AlertEvent } from './lib/alerts';
import type { BazaarProduct } from './api/bazaar';
import { HOURS_PER_WEEK, computeAllFlips, rankFlips, type FlipResult } from './lib/flip';
import { coins, compact, pct } from './lib/format';
import { PriceHistory } from './lib/history';
import { itemName, itemNpcPrice } from './lib/names';
import { computeAllNpcFlips } from './lib/npc';
import { ATTENTION_STATES, IN_BOOK_STATES, evaluateOrder, newOrderId, type OrderState, type TrackedOrder } from './lib/orders';
import { blendRates, liveRates } from './lib/rates';
import { computeSignals, scoreFlip, type ScoredFlip } from './lib/signals';
import { playAlertSound } from './lib/sound';
import { matchesQuery, scoreMatch } from './lib/search';
import { DEFAULT_SETTINGS, toFlipFilters, toFlipSettings, type AppSettings } from './settings';

type Tab = 'flips' | 'lookup' | 'favorites' | 'orders' | 'npc';

export default function App() {
  const [lang, setLang] = useLocalState<Lang>('bzflip.lang', navigator.language.startsWith('ko') ? 'ko' : 'en');
  const [settings, setSettings] = useLocalState<AppSettings>('bzflip.settings', DEFAULT_SETTINGS);
  const [favoriteList, setFavoriteList] = useLocalState<string[]>('bzflip.favorites', []);
  const [orders, setOrders] = useLocalState<TrackedOrder[]>('bzflip.orders', []);
  const [tab, setTab] = useState<Tab>('flips');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const t = useT(lang);
  const { snapshot, error, loading, fetchedAt, nextExpectedAt, refresh } = useBazaar({ mode: settings.refreshMode, intervalSec: settings.refreshSec });

  const historyRef = useRef(new PriceHistory());
  const [alertLog, setAlertLog] = useState<AlertEvent[]>([]);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );
  const now = useNow(1000);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = t('appTitle');
  }, [lang, t]);

  const favorites = useMemo(() => new Set(favoriteList), [favoriteList]);
  const flipSettings = useMemo(() => toFlipSettings(settings), [settings]);

  // Record the snapshot into the session history first (idempotent per lastUpdated),
  // then score every flip with the signals derived from that history.
  const allFlips = useMemo<ScoredFlip[]>(() => {
    if (!snapshot) return [];
    const history = historyRef.current;
    history.record(snapshot);
    const ratesFor = settings.useLiveRates
      ? (p: BazaarProduct) => {
          const q = p.quick_status;
          const r = blendRates(q.sellMovingWeek / HOURS_PER_WEEK, q.buyMovingWeek / HOURS_PER_WEEK, liveRates(history.get(p.product_id)));
          return r.liveWeight > 0 ? r : undefined;
        }
      : undefined;
    return computeAllFlips(snapshot.products, flipSettings, ratesFor).map((f) => scoreFlip(f, computeSignals(history.get(f.id), flipSettings.taxRate)));
  }, [snapshot, flipSettings, settings.useLiveRates]);
  const flipsById = useMemo(() => new Map(allFlips.map((f) => [f.id, f])), [allFlips]);

  // Flip results of the previous distinct snapshot, used to flash cells that moved.
  const prevRef = useRef<{ stamp: number; flips: Map<string, FlipResult> }>({ stamp: 0, flips: new Map() });
  const lastRef = useRef<{ stamp: number; flips: Map<string, FlipResult> } | null>(null);
  const stamp = snapshot?.lastUpdated ?? 0;
  if (lastRef.current && lastRef.current.stamp !== stamp) prevRef.current = lastRef.current;
  lastRef.current = { stamp, flips: flipsById };
  const changeCtx = useMemo(() => ({ prev: prevRef.current.flips, stamp }), [stamp]);

  const rankedFlips = useMemo(() => rankFlips(allFlips, toFlipFilters(settings), (f) => f.score), [allFlips, settings]);

  const searchFilter = <R,>(rows: R[], id: (r: R) => string): R[] => {
    if (!query.trim()) return rows;
    return rows.filter((r) => matchesQuery(id(r), query)).sort((a, b) => scoreMatch(id(a), query) - scoreMatch(id(b), query));
  };

  const flipRows = useMemo(() => searchFilter(rankedFlips, (f) => f.id), [rankedFlips, query]); // eslint-disable-line react-hooks/exhaustive-deps

  const favoriteRows = useMemo<ScoredFlip[]>(
    () => searchFilter(allFlips.filter((f) => favorites.has(f.id)), (f) => f.id).sort((a, b) => b.score - a.score),
    [allFlips, favorites, query], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const lookupRows = useMemo<LookupRow[]>(() => {
    if (!snapshot) return [];
    const rows = Object.values(snapshot.products).map((product) => ({ id: product.product_id, product, flip: flipsById.get(product.product_id) ?? null }));
    return searchFilter(rows, (r) => r.id);
  }, [snapshot, flipsById, query]); // eslint-disable-line react-hooks/exhaustive-deps

  const npcRows = useMemo(() => {
    if (!snapshot) return [];
    return searchFilter(computeAllNpcFlips(snapshot.products, itemNpcPrice, settings.budget), (f) => f.id);
  }, [snapshot, settings.budget, query]); // eslint-disable-line react-hooks/exhaustive-deps

  const orderRows = useMemo<OrderRow[]>(
    () =>
      orders.map((o) => {
        const product = snapshot?.products[o.itemId];
        const f = flipsById.get(o.itemId);
        const q = product?.quick_status;
        const rates = f
          ? { instaSellsPerHour: f.instaSellsPerHour, instaBuysPerHour: f.instaBuysPerHour }
          : { instaSellsPerHour: (q?.sellMovingWeek ?? 0) / HOURS_PER_WEEK, instaBuysPerHour: (q?.buyMovingWeek ?? 0) / HOURS_PER_WEEK };
        return { order: o, status: evaluateOrder(o, product, rates, settings.taxRate) };
      }),
    [orders, snapshot, flipsById, settings.taxRate],
  );
  const ordersNeedingAttention = orderRows.filter((r) => r.status.state === 'outbid' || r.status.state === 'undercut').length;

  const flipCols = useMemo(() => flipColumns(t, lang, favorites, changeCtx), [t, lang, favorites, changeCtx]);
  const npcCols = useMemo(() => npcColumns(t, favorites), [t, favorites]);
  const lookupCols = useMemo(() => lookupColumns(t, favorites, changeCtx), [t, favorites, changeCtx]);

  const selectedProduct = selectedId && snapshot ? snapshot.products[selectedId] ?? null : null;
  const toggleFavorite = (id: string) =>
    setFavoriteList((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  // Alerts: report items that newly satisfy the rule on each snapshot.
  const matchingRef = useRef<Set<string>>(new Set());
  const primedRef = useRef<string>('');
  useEffect(() => {
    if (!snapshot) return;
    const ruleKey = JSON.stringify(settings.alerts) + favoriteList.join(',');
    const { fresh, matching } = newMatches(rankedFlips, settings.alerts, favorites, matchingRef.current);
    matchingRef.current = matching;
    if (primedRef.current !== ruleKey) {
      // First snapshot, or the rule changed: everything matching now is a baseline, not news.
      primedRef.current = ruleKey;
      return;
    }
    if (fresh.length === 0) return;
    pushAlerts(fresh.map((f) => flipEvent(f, t)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot?.lastUpdated, rankedFlips, settings.alerts, favorites]);

  // Order tracking: notify when an order enters an attention state (outbid / undercut / filled).
  const orderStatesRef = useRef<Map<string, OrderState>>(new Map());
  useEffect(() => {
    if (!snapshot) return;
    const seen = orderStatesRef.current;
    const events: AlertEvent[] = [];
    const live = new Set<string>();
    for (const { order, status } of orderRows) {
      live.add(order.id);
      const prev = seen.get(order.id);
      seen.set(order.id, status.state);
      if (prev === undefined || prev === status.state || !ATTENTION_STATES.has(status.state)) continue;
      const title = `${t(status.state === 'outbid' ? 'orderAlertOutbid' : status.state === 'undercut' ? 'orderAlertUndercut' : 'orderAlertFilled')}: ${itemName(order.itemId)}`;
      const body =
        status.state === 'filled'
          ? t('orderAlertFilledBody', { mine: coins(order.price) })
          : t('orderAlertBody', { mine: coins(order.price), best: coins(status.bestPrice), relist: coins(status.relistPrice) });
      events.push({ kind: 'order', itemId: order.itemId, at: Date.now(), title, body });
    }
    for (const id of [...seen.keys()]) if (!live.has(id)) seen.delete(id);
    const firstSeen = orderRows.filter((r) => !r.order.seenAt && IN_BOOK_STATES.has(r.status.state)).map((r) => r.order.id);
    if (firstSeen.length > 0) {
      const at = Date.now();
      setOrders((list) => list.map((o) => (firstSeen.includes(o.id) && !o.seenAt ? { ...o, seenAt: at } : o)));
    }
    if (events.length > 0) pushAlerts(events);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot?.lastUpdated, orderRows]);

  function pushAlerts(events: AlertEvent[]) {
    setAlertLog((log) => [...events, ...log].slice(0, 30));
    if (settings.alerts.sound) playAlertSound();
    notify(events, t);
  }

  const requestPermission = () => {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') {
      void Notification.requestPermission().then((p) => setPermission(p));
    } else {
      setPermission(Notification.permission);
    }
  };

  const testAlert = () => {
    const sample = rankedFlips[0];
    if (!sample) return;
    pushAlerts([flipEvent(sample, t)]);
  };

  const addOrder = (order: TrackedOrder) => setOrders((list) => [order, ...list]);
  const trackFromDetail = (itemId: string, side: 'buy' | 'sell', price: number, amount: number) => {
    addOrder({ id: newOrderId(), itemId, side, price, amount: Math.max(1, Math.floor(amount)), createdAt: Date.now() });
    setTab('orders');
    setSelectedId(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const moreLabel = (n: number) => t('showMore', { n });

  return (
    <div className={`app ${settingsOpen ? 'app--settings-open' : ''} ${selectedProduct ? 'app--detail-open' : ''}`}>
      <Header
        t={t}
        lang={lang}
        query={query}
        onQuery={setQuery}
        loading={loading}
        error={error}
        fetchedAt={fetchedAt}
        lastUpdated={snapshot?.lastUpdated ?? null}
        nextExpectedAt={nextExpectedAt}
        live={settings.refreshMode === 'live'}
        onRefresh={() => void refresh()}
        onToggleLang={() => setLang((l) => (l === 'ko' ? 'en' : 'ko'))}
        onToggleSettings={() => setSettingsOpen((o) => !o)}
      />

      <div className="layout">
        <aside className="sidebar">
          <div className="sidebar__header">
            <h2 className="sidebar__title">{t('settings')}</h2>
            <button type="button" className="btn btn--icon sidebar__close" onClick={() => setSettingsOpen(false)} aria-label={t('close')}>
              ✕
            </button>
          </div>
          <SettingsPanel
            settings={settings}
            onChange={setSettings}
            onTestAlert={testAlert}
            notificationPermission={permission}
            onRequestPermission={requestPermission}
            t={t}
          />
        </aside>
        {settingsOpen && <div className="backdrop" onClick={() => setSettingsOpen(false)} />}

        <main className="main">
          <nav className="tabs" role="tablist">
            <TabButton active={tab === 'flips'} onClick={() => setTab('flips')} label={t('tabFlips')} count={flipRows.length} />
            <TabButton active={tab === 'favorites'} onClick={() => setTab('favorites')} label={t('tabFavorites')} count={favoriteRows.length} />
            <TabButton active={tab === 'lookup'} onClick={() => setTab('lookup')} label={t('tabLookup')} count={lookupRows.length} />
            <TabButton active={tab === 'npc'} onClick={() => setTab('npc')} label={t('tabNpc')} count={npcRows.length} highlight={npcRows.length > 0} />
            <TabButton active={tab === 'orders'} onClick={() => setTab('orders')} label={t('tabOrders')} count={orders.length} highlight={ordersNeedingAttention > 0} />
          </nav>

          {tab === 'flips' && <TopPicks picks={flipRows.slice(0, 3)} onSelect={setSelectedId} t={t} lang={lang} />}
          {tab === 'flips' && (
            <DataTable
              key="flips"
              columns={flipCols}
              rows={flipRows}
              rowKey={(f) => f.id}
              defaultSort={{ key: 'score', dir: 'desc' }}
              onRowClick={(f) => setSelectedId(f.id)}
              selectedKey={selectedId}
              emptyMessage={snapshot ? (query ? t('noResults') : t('noFlips')) : t('loading')}
              moreLabel={moreLabel}
            />
          )}
          {tab === 'favorites' && (
            <>
              <p className="hint">{t('favoritesFlipsHint')}</p>
              <DataTable
                key="favorites"
                columns={flipCols}
                rows={favoriteRows}
                rowKey={(f) => f.id}
                defaultSort={{ key: 'score', dir: 'desc' }}
                onRowClick={(f) => setSelectedId(f.id)}
                selectedKey={selectedId}
                emptyMessage={favoriteList.length === 0 ? t('noFavorites') : t('noResults')}
                moreLabel={moreLabel}
              />
            </>
          )}
          {tab === 'lookup' && (
            <DataTable
              key="lookup"
              columns={lookupCols}
              rows={lookupRows}
              rowKey={(r) => r.id}
              defaultSort={query ? { key: 'item', dir: 'asc' } : { key: 'weekBuy', dir: 'desc' }}
              onRowClick={(r) => setSelectedId(r.id)}
              selectedKey={selectedId}
              emptyMessage={snapshot ? t('noResults') : t('loading')}
              moreLabel={moreLabel}
            />
          )}

          {tab === 'npc' && (
            <>
              <p className="hint">{t('npcHint')}</p>
              <DataTable
                key="npc"
                columns={npcCols}
                rows={npcRows}
                rowKey={(f) => f.id}
                defaultSort={{ key: 'profit', dir: 'desc' }}
                onRowClick={(f) => setSelectedId(f.id)}
                selectedKey={selectedId}
                emptyMessage={snapshot ? t('npcEmpty') : t('loading')}
                moreLabel={moreLabel}
              />
            </>
          )}
          {tab === 'orders' && (
            <OrdersPanel
              rows={orderRows}
              products={snapshot?.products ?? null}
              flipsById={flipsById}
              onAdd={addOrder}
              onUpdatePrice={(id, price) => setOrders((list) => list.map((o) => (o.id === id ? { ...o, price } : o)))}
              onRemove={(id) => setOrders((list) => list.filter((o) => o.id !== id))}
              onOpen={setSelectedId}
              t={t}
              lang={lang}
            />
          )}

          <footer className="footer">{t('disclaimer')}</footer>
        </main>

        {selectedProduct && (
          <>
            <div className="backdrop backdrop--detail" onClick={() => setSelectedId(null)} />
            <ItemDetail
              product={selectedProduct}
              flip={flipsById.get(selectedProduct.product_id) ?? null}
              taxRate={settings.taxRate}
              budget={settings.budget}
              history={historyRef.current.get(selectedProduct.product_id)}
              isFavorite={favorites.has(selectedProduct.product_id)}
              onToggleFavorite={() => toggleFavorite(selectedProduct.product_id)}
              onClose={() => setSelectedId(null)}
              onTrack={(side, price, amount) => trackFromDetail(selectedProduct.product_id, side, price, amount)}
              t={t}
              lang={lang}
            />
          </>
        )}
      </div>

      <AlertToasts
        events={alertLog}
        now={now}
        onOpen={(id) => setSelectedId(id)}
        onDismiss={(at, id) => setAlertLog((log) => log.filter((e) => !(e.at === at && e.itemId === id)))}
        onClear={() => setAlertLog([])}
        t={t}
        lang={lang}
      />
    </div>
  );
}

function flipEvent(f: ScoredFlip, t: ReturnType<typeof useT>): AlertEvent {
  return {
    kind: 'flip',
    itemId: f.id,
    at: Date.now(),
    title: `${t('alertNew')}: ${itemName(f.id)}`,
    body: t('alertBody', { buy: coins(f.buyOrderPrice), sell: coins(f.sellOfferPrice), margin: pct(f.marginPct), perHour: compact(f.profitPerHour) }),
  };
}

/** Browser notifications for up to three events; more than that is summarised. */
function notify(events: AlertEvent[], t: ReturnType<typeof useT>) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    if (events.length > 3) {
      new Notification(t('alertMany', { n: events.length }), { body: events.map((e) => itemName(e.itemId)).join(', ') });
      return;
    }
    for (const e of events) new Notification(e.title, { body: e.body, tag: `bzflip-${e.kind}-${e.itemId}` });
  } catch {
    /* notifications unavailable */
  }
}

function TabButton({ active, onClick, label, count, highlight = false }: { active: boolean; onClick: () => void; label: string; count: number; highlight?: boolean }) {
  return (
    <button type="button" role="tab" aria-selected={active} className={`tab ${active ? 'is-active' : ''}`} onClick={onClick}>
      {label}
      <span className={`tab__count ${highlight ? 'tab__count--hot' : ''}`}>{count.toLocaleString('en-US')}</span>
    </button>
  );
}
