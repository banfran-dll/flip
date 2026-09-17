#!/usr/bin/env node
/**
 * Regenerates src/data/item-names.json.
 *
 * Pulls the current list of bazaar products and the SkyBlock item catalogue
 * from the public Hypixel API and writes a compact { PRODUCT_ID: [name, tier] }
 * map for every product that the item catalogue knows about. Products the
 * catalogue does not list (enchantment books, attribute shards, essence, …)
 * are omitted here and get a generated name at runtime (see src/lib/names.ts).
 *
 * Usage:
 *   node scripts/update-item-names.mjs
 *   node scripts/update-item-names.mjs --bazaar ./bazaar.json --items ./items.json   # offline
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BAZAAR_URL = 'https://api.hypixel.net/v2/skyblock/bazaar';
const ITEMS_URL = 'https://api.hypixel.net/v2/resources/skyblock/items';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../src/data/item-names.json');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function loadJson(localPath, url) {
  if (localPath) return JSON.parse(await readFile(localPath, 'utf8'));
  const res = await fetch(url, { headers: { 'user-agent': 'skyblock-bazaar-flipper/update-names' } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

/** Strip Minecraft § colour codes. */
const clean = (s) => String(s).replace(/§./g, '').trim();

const [bazaar, items] = await Promise.all([
  loadJson(arg('--bazaar'), BAZAAR_URL),
  loadJson(arg('--items'), ITEMS_URL),
]);

if (!bazaar?.products || !Array.isArray(items?.items)) {
  throw new Error('Unexpected API response shape');
}

const catalogue = new Map();
for (const it of items.items) {
  if (it?.id && it?.name) catalogue.set(it.id, it);
}

const out = {};
let missing = 0;
for (const id of Object.keys(bazaar.products).sort()) {
  const it = catalogue.get(id);
  if (!it) { missing++; continue; }
  const entry = [clean(it.name)];
  if (it.tier) entry.push(it.tier);
  out[id] = entry;
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(out, null, 0) + '\n');
console.log(`Wrote ${Object.keys(out).length} names to ${OUT} (${missing} products fall back to generated names).`);
