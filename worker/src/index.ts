import { BUCKET_MS, HOUR_MS, computeDerived, emptyState, ingest, metaOf, rollup, seriesOf, stateFrom, type Derived, type Finished, type GroupRow, type Meta, type Snapshot } from './aggregate';
import { fromBlob, fromBlob64, textFromBlob, toBlob } from './codec';
import { postCrashAlerts } from './discord';
import { parseSnapshotFast } from './parse';

export interface Env {
  DB: D1Database;
  DISCORD_WEBHOOK_URL?: string;
  SITE_URL?: string;
  CRASH_MIN_DROP?: string;
  CRASH_MIN_TRADES?: string;
}

const BAZAAR_URL = 'https://api.hypixel.net/v2/skyblock/bazaar';
const RETENTION_5M_MS = 7 * 24 * HOUR_MS;
const RETENTION_HOURLY_MS = 90 * 24 * HOUR_MS;
const ALERT_COOLDOWN_MS = 6 * HOUR_MS;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...CORS, ...extra } });

// ---------- state persistence ----------

async function loadState(db: D1Database) {
  const rows = await db.prepare('SELECT k, v FROM state').all<{ k: string; v: unknown }>();
  const map = new Map(rows.results.map((r) => [r.k, r.v]));
  if (!map.has('meta')) return emptyState();
  const meta = JSON.parse(textFromBlob(map.get('meta'))) as Meta;
  return stateFrom(meta, map.has('acc') ? fromBlob64(map.get('acc')) : new Float64Array(0), map.has('last') ? fromBlob64(map.get('last')) : new Float64Array(0));
}

function saveStateStatements(db: D1Database, s: ReturnType<typeof emptyState>) {
  const up = db.prepare('INSERT INTO state (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v');
  return [
    up.bind('meta', new TextEncoder().encode(JSON.stringify(metaOf(s))).buffer),
    up.bind('acc', toBlob(s.acc)),
    up.bind('last', toBlob(s.last)),
  ];
}

// ---------- collection ----------

async function fetchSnapshot(): Promise<Snapshot> {
  const res = await fetch(BAZAAR_URL, { headers: { accept: 'application/json', 'user-agent': 'bzflip-data-collector' } });
  if (!res.ok) throw new Error(`bazaar HTTP ${res.status}`);
  // Regex extraction instead of JSON.parse: ~6 ms vs ~30 ms of CPU (see parse.ts).
  return parseSnapshotFast(await res.text());
}

async function readGroupRows(db: D1Database, table: 'buckets5' | 'hourly', from: number, to: number, g?: number): Promise<GroupRow[]> {
  const sql = g == null ? `SELECT t, g, data FROM ${table} WHERE t >= ? AND t < ? ORDER BY t` : `SELECT t, g, data FROM ${table} WHERE t >= ? AND t < ? AND g = ? ORDER BY t`;
  const stmt = g == null ? db.prepare(sql).bind(from, to) : db.prepare(sql).bind(from, to, g);
  const rows = await stmt.all<{ t: number; g: number; data: unknown }>();
  return rows.results.map((r) => ({ t: r.t, g: r.g, data: fromBlob(r.data) }));
}

async function collect(env: Env): Promise<void> {
  const db = env.DB;
  const before = await loadState(db);
  const snap = await fetchSnapshot();
  const { state, finished } = ingest(before, snap);
  if (state === before) return; // same snapshot as last minute

  const statements: D1PreparedStatement[] = [];
  if (finished) {
    const ins = db.prepare('INSERT OR REPLACE INTO buckets5 (t, g, data) VALUES (?, ?, ?)');
    finished.groups.forEach((row, g) => statements.push(ins.bind(finished.t, g, toBlob(row))));
    await db.batch(statements);
    statements.length = 0;

    await afterBucket(env, state.idx, finished);
  }
  statements.push(...saveStateStatements(db, state));
  await db.batch(statements);
}

/** Hourly roll-up, derived baselines, alerts and retention, run once per finished bucket. */
async function afterBucket(env: Env, idx: Record<string, number>, finished: Finished): Promise<void> {
  const db = env.DB;
  const hourStart = Math.floor(finished.t / HOUR_MS) * HOUR_MS;
  const hourComplete = finished.t + BUCKET_MS === hourStart + HOUR_MS;

  if (hourComplete) {
    const rows = await readGroupRows(db, 'buckets5', hourStart, hourStart + HOUR_MS);
    const byGroup = new Map<number, Float32Array[]>();
    for (const r of rows) byGroup.set(r.g, [...(byGroup.get(r.g) ?? []), r.data]);
    const ins = db.prepare('INSERT OR REPLACE INTO hourly (t, g, data) VALUES (?, ?, ?)');
    const stmts = [...byGroup.entries()].map(([g, list]) => ins.bind(hourStart, g, toBlob(rollup(list))));
    if (stmts.length) await db.batch(stmts);
    await db.batch([
      db.prepare('DELETE FROM buckets5 WHERE t < ?').bind(finished.t - RETENTION_5M_MS),
      db.prepare('DELETE FROM hourly WHERE t < ?').bind(finished.t - RETENTION_HOURLY_MS),
      db.prepare('DELETE FROM alerts WHERE t < ?').bind(finished.t - 2 * ALERT_COOLDOWN_MS),
    ]);
  }

  // Baselines: the last 24 h of hourly rows plus the 5-minute buckets of the unfinished hour.
  const windowStart = finished.t + BUCKET_MS - 24 * HOUR_MS;
  const hourly = await readGroupRows(db, 'hourly', windowStart, hourComplete ? hourStart + HOUR_MS : hourStart);
  const recent = hourComplete ? [] : await readGroupRows(db, 'buckets5', hourStart, finished.t + BUCKET_MS);
  const derived = computeDerived(idx, [...hourly, ...recent], finished, Number(env.CRASH_MIN_DROP ?? 15), Number(env.CRASH_MIN_TRADES ?? 5000));
  await db.batch([
    db.prepare('INSERT OR REPLACE INTO derived (t, data) VALUES (?, ?)').bind(derived.t, JSON.stringify(derived)),
    db.prepare('DELETE FROM derived WHERE t < ?').bind(derived.t),
  ]);

  if (env.DISCORD_WEBHOOK_URL && derived.crashes.length > 0) {
    const keys = derived.crashes.map((c) => `crash:${c.id}`);
    const seen = await db
      .prepare(`SELECT k FROM alerts WHERE t > ? AND k IN (${keys.map(() => '?').join(',')})`)
      .bind(finished.t - ALERT_COOLDOWN_MS, ...keys)
      .all<{ k: string }>();
    const muted = new Set(seen.results.map((r) => r.k));
    const fresh = derived.crashes.filter((c) => !muted.has(`crash:${c.id}`));
    if (fresh.length > 0) {
      await postCrashAlerts(env.DISCORD_WEBHOOK_URL, fresh, env.SITE_URL);
      const up = db.prepare('INSERT OR REPLACE INTO alerts (k, t) VALUES (?, ?)');
      await db.batch(fresh.map((c) => up.bind(`crash:${c.id}`, finished.t)));
    }
  }
}

// ---------- API ----------

const RANGES: Record<string, { table: 'buckets5' | 'hourly'; ms: number }> = {
  '24h': { table: 'buckets5', ms: 24 * HOUR_MS },
  '7d': { table: 'buckets5', ms: 7 * 24 * HOUR_MS },
  '30d': { table: 'hourly', ms: 30 * 24 * HOUR_MS },
  '90d': { table: 'hourly', ms: 90 * 24 * HOUR_MS },
};

async function handle(req: Request, env: Env): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405);
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '');

  if (path === '' || path === '/v1/status') {
    const meta = await env.DB.prepare("SELECT v FROM state WHERE k = 'meta'").first<{ v: unknown }>();
    const m = meta ? (JSON.parse(textFromBlob(meta.v)) as Meta) : null;
    const oldest = await env.DB.prepare('SELECT MIN(t) AS t FROM hourly').first<{ t: number | null }>();
    const oldest5 = await env.DB.prepare('SELECT MIN(t) AS t FROM buckets5').first<{ t: number | null }>();
    const latest = await env.DB.prepare('SELECT MAX(t) AS t FROM derived').first<{ t: number | null }>();
    return json(
      {
        ok: true,
        items: m?.count ?? 0,
        lastSnapshot: m && m.lastSeen >= 0 ? m.lastSeen : null,
        currentBucket: m && m.bucketT >= 0 ? m.bucketT : null,
        latestDerived: latest?.t ?? null,
        historySince: Math.min(oldest?.t ?? Infinity, oldest5?.t ?? Infinity) === Infinity ? null : Math.min(oldest?.t ?? Infinity, oldest5?.t ?? Infinity),
      },
      200,
      { 'cache-control': 'public, max-age=30' },
    );
  }

  if (path === '/v1/derived') {
    const row = await env.DB.prepare('SELECT data FROM derived ORDER BY t DESC LIMIT 1').first<{ data: string }>();
    if (!row) return json({ error: 'no data yet' }, 404);
    return new Response(row.data, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60', ...CORS } });
  }

  const hist = path.match(/^\/v1\/history\/([^/]+)$/);
  if (hist) {
    const id = decodeURIComponent(hist[1]);
    const range = RANGES[url.searchParams.get('range') ?? '24h'];
    if (!range) return json({ error: 'range must be 24h, 7d, 30d or 90d' }, 400);
    const meta = await env.DB.prepare("SELECT v FROM state WHERE k = 'meta'").first<{ v: unknown }>();
    if (!meta) return json({ error: 'no data yet' }, 404);
    const m = JSON.parse(textFromBlob(meta.v)) as Meta;
    const slot = m.idx[id];
    if (slot === undefined) return json({ error: 'unknown item' }, 404);
    const now = Date.now();
    const rows = await readGroupRows(env.DB, range.table, now - range.ms, now + BUCKET_MS, Math.floor(slot / 100));
    return json({ id, range: url.searchParams.get('range') ?? '24h', points: seriesOf(rows, slot) }, 200, { 'cache-control': 'public, max-age=120' });
  }

  return json({ error: 'not found', routes: ['/v1/status', '/v1/derived', '/v1/history/:id?range=24h|7d|30d|90d'] }, 404);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      return await handle(req, env);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(collect(env));
  },
} satisfies ExportedHandler<Env>;

export type { Derived };
