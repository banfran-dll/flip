import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertToasts } from './components/AlertToasts';
import { OrdersPanel, type OrderRow } from './components/OrdersPanel';
import { PlannerPanel } from './components/PlannerPanel';
import { PaperPanel } from './components/PaperPanel';
import { Header } from './components/Header';
import { TopPicks } from './components/TopPicks';
import { SettingsPanel } from './components/SettingsPanel';
import { DataTable } from './components/DataTable';
import { ItemDetail } from './components/ItemDetail';
import { craftColumns, crashColumns, flipColumns, lookupColumns, npcColumns, type LookupRow } from './components/columns';
import { useBazaar } from './hooks/useBazaar';
import { useLocalState } from './hooks/useLocalState';
import { useNow } from './hooks/useNow';
import { useT } from './hooks/useT';
import type { Lang } from './i18n';
import { newMatches, type AlertEvent } from './lib/alerts';
import type { BazaarProduct } from './api/bazaar';
import { HOURS_PER_WEEK, MAX_ORDER_SIZE, computeAllFlips, rankFlips, type FlipResult } from './lib/flip';
import { planBudget } from './lib/planner';
import { computeAllCraftFlips, type RecipeBook } from './lib/craft';
import { BucketBuilder, type Bucket } from './lib/buckets';
import { loadBuckets, saveBucket } from './lib/histdb';
import { findCrashes } from './lib/crash';
import { openTrade, stepTrade, type PaperTrade } from './lib/paper';
import { NumField } from './components/NumField';
import recipeData from './data/recipes.json';
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

type Tab = 'flips' | 'planner' | 'lookup' | 'favorites' | 'orders' | 'npc' | 'craft' | 'crash' | 'paper';

const PAPER_OPEN_INTERVAL_MS = 5 * 60_000;
const PAPER_MAX = 200;

const RECIPES = recipeData as unknown as RecipeBook;
const HAS_RECIPES = Object.keys(RECIPES).length > 0;

export default function App() {
  const [lang, setLang] = useLocalState<Lang>('bzflip.lang', navigator.language.startsWith('ko') ? 'ko' : 'en');
  const [settings, setSettings] = useLocalState<AppSettings>('bzflip.settings', DEFAULT_SETTINGS);
  const [favoriteList, setFavoriteList] = useLocalState<string[]>('bzflip.favorites', []);
  const [orders, setOrders] = useLocalState<TrackedOrder[]>('bzflip.orders', []);
  const [paper, setPaper] = useLocalState<PaperTrade[]>('bzflip.paper', []);
  const [tab, setTab] = useState<Tab>('flips');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const t = useT(lang);
  const { snapshot, error, loading, fetchedAt, nextExpectedAt, refresh } = useBazaar({ mode: settings.refreshMode, intervalSec: settings.refreshSec });

  const historyRef = useRef(new PriceHistory());
  const builderRef = useRef(new BucketBuilder());
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  useEffect(() => {
    let cancelled = false;
    void loadBuckets().then((rows) => {
      if (!cancelled && rows.length > 0) setBuckets((cur) => [...rows, ...cur.filter((b) => !rows.some((r) => r.t === b.t))].sort((a, b) => a.t - b.t));
    });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!snapshot) return;
    const done = builderRef.current.add(snapshot);
    if (done) {
      setBuckets((cur) => [...cur.filter((b) => b.t !== done.t), done].sort((a, b) => a.t - b.t));
      void saveBucket(done);
    }
  }, [snapshot]);
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

  const plan = useMemo(
    () => planBudget(rankedFlips, { budget: settings.budget, slots: settings.orderSlots, minCycleMinutes: settings.minCycleMinutes, maxOrderSize: MAX_ORDER_SIZE }),
    [rankedFlips, settings.budget, settings.orderSlots, settings.minCycleMinutes],
  );

  const craftRows = useMemo(() => {
    if (!snapshot) return [];
    return searchFilter(
      computeAllCraftFlips(snapshot.products, RECIPES, settings.taxRate, settings.budget).filter((f) => f.profitMixed > 0),
      (f) => f.id,
    );
  }, [snapshot, settings.taxRate, settings.budget, query]); // eslint-disable-line react-hooks/exhaustive-deps

  const crashRows = useMemo(() => {
    if (!snapshot) return [];
    const current = builderRef.current.peek();
    const all = current ? [...buckets, current] : buckets;
    return searchFilter(
      findCrashes(snapshot.products, all, settings.taxRate, { minDropPct: settings.crashMinDropPct, minWeeklyVolume: settings.minWeeklyVolume }, snapshot.lastUpdated),
      (c) => c.id,
    );
  }, [snapshot, buckets, settings.taxRate, settings.crashMinDropPct, settings.minWeeklyVolume, query]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const craftCols = useMemo(() => craftColumns(t, lang, favorites), [t, lang, favorites]);
  const crashCols = useMemo(() => crashColumns(t, favorites), [t, favorites]);
  const lookupCols = useMemo(() => lookupColumns(t, favorites, changeCtx), [t, favorites, changeCtx]);

  const selectedProduct = selectedId && snapshot ? snapshot.products[selectedId] ?? null : null;
  const toggleFavorite = (id: string) =>
    setFavoriteList((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  // Paper trading: step open trades with the newest history transition, open a new one every 5 minutes.
  const lastPaperOpenRef = useRef(0);
  useEffect(() => {
    if (!snapshot) return;
    const history = historyRef.current;
    setPaper((list) => {
      let next = list.map((tr) => {
        if (tr.status === 'closed' || tr.status === 'expired') return tr;
        const pts = history.get(tr.itemId);
        if (pts.length < 2) return tr;
        return stepTrade(tr, pts[pts.length - 2], pts[pts.length - 1], settings.taxRate);
      });
      const top = rankedFlips[0];
      if (settings.paperEnabled && top && Date.now() - lastPaperOpenRef.current >= PAPER_OPEN_INTERVAL_MS && !next.some((tr) => tr.itemId === top.id && (tr.status === 'buying' || tr.status === 'selling'))) {
        lastPaperOpenRef.current = Date.now();
        next = [openTrade(top, snapshot.lastUpdated, newOrderId()), ...next];
      }
      if (next.length > PAPER_MAX) {
        const finished = next.filter((tr) => tr.status === 'closed' || tr.status === 'expired');
        const drop = new Set(finished.slice(PAPER_MAX / 2).map((tr) => tr.id));
        next = next.filter((tr) => !drop.has(tr.id));
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot?.lastUpdated]);

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
  const trackPlan = () => {
    const at = Date.now();
    const fresh = plan.lines.map((l) => ({ id: newOrderId(), itemId: l.id, side: 'buy' as const, price: l.flip.buyOrderPrice, amount: l.units, createdAt: at }));
    if (fresh.length === 0) return;
    setOrders((list) => [...fresh, ...list]);
    setTab('orders');
  };
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
            <TabButton active={tab === 'planner'} onClick={() => setTab('planner')} label={t('tabPlanner')} count={plan.slotsUsed} />
            <TabButton active={tab === 'favorites'} onClick={() => setTab('favorites')} label={t('tabFavorites')} count={favoriteRows.length} />
            <TabButton active={tab === 'lookup'} onClick={() => setTab('lookup')} label={t('tabLookup')} count={lookupRows.length} />
            <TabButton active={tab === 'craft'} onClick={() => setTab('craft')} label={t('tabCraft')} count={craftRows.length} />
            <TabButton active={tab === 'crash'} onClick={() => setTab('crash')} label={t('tabCrash')} count={crashRows.length} highlight={crashRows.length > 0} />
            <TabButton active={tab === 'npc'} onClick={() => setTab('npc')} label={t('tabNpc')} count={npcRows.length} highlight={npcRows.length > 0} />
            <TabButton active={tab === 'orders'} onClick={() => setTab('orders')} label={t('tabOrders')} count={orders.length} highlight={ordersNeedingAttention > 0} />
            <TabButton active={tab === 'paper'} onClick={() => setTab('paper')} label={t('tabPaper')} count={paper.length} />
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
          {tab === 'planner' && (
            <PlannerPanel
              plan={plan}
              budget={settings.budget}
              slots={settings.orderSlots}
              minCycleMinutes={settings.minCycleMinutes}
              onBudget={(n) => setSettings((s) => ({ ...s, budget: n }))}
              onSlots={(n) => setSettings((s) => ({ ...s, orderSlots: n }))}
              onTrackAll={trackPlan}
              onOpen={setSelectedId}
              t={t}
              lang={lang}
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

          {tab === 'craft' && (
            <>
              <p className="hint">{t('craftHint')}</p>
              <DataTable
                key="craft"
                columns={craftCols}
                rows={craftRows}
                rowKey={(f) => f.id}
                defaultSort={{ key: 'perHour', dir: 'desc' }}
                onRowClick={(f) => setSelectedId(f.id)}
                selectedKey={selectedId}
                emptyMessage={!HAS_RECIPES ? t('craftNoData') : snapshot ? t('craftEmpty') : t('loading')}
                moreLabel={moreLabel}
              />
            </>
          )}
          {tab === 'crash' && (
            <>
              <p className="hint">{t('crashHint')}</p>
              <div className="field__row crash-controls">
                <label className="field">
                  <span className="field__label">{t('crashMinDrop')}</span>
                  <NumField className="input input--narrow" value={settings.crashMinDropPct} onChange={(n) => setSettings((s) => ({ ...s, crashMinDropPct: Math.max(0, n) }))} />
                </label>
                <span className="muted">{t('historyStored', { h: ((buckets.length * 5) / 60).toFixed(1) })}</span>
              </div>
              <DataTable
                key="crash"
                columns={crashCols}
                rows={crashRows}
                rowKey={(c) => c.id}
                defaultSort={{ key: 'drop', dir: 'desc' }}
                onRowClick={(c) => setSelectedId(c.id)}
                selectedKey={selectedId}
                emptyMessage={snapshot ? t('crashEmpty') : t('loading')}
                moreLabel={moreLabel}
              />
            </>
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

          {tab === 'paper' && (
            <PaperPanel
              trades={paper}
              enabled={settings.paperEnabled}
              now={now}
              onToggle={(on) => setSettings((s) => ({ ...s, paperEnabled: on }))}
              onClear={() => setPaper([])}
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
              buckets={buckets}
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
