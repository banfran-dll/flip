#!/usr/bin/env node
/**
 * Regenerates src/data/recipes.json from the NotEnoughUpdates item repository.
 *
 * For every bazaar product it downloads the NEU item file and keeps the
 * crafting and forge recipes whose ingredients are *all* bazaar products, so
 * the app can price "buy materials on the bazaar → craft → sell on the bazaar".
 *
 * Usage:
 *   node scripts/update-recipes.mjs                       # ~2,200 small requests, a few minutes
 *   node scripts/update-recipes.mjs --bazaar ./bazaar.json --concurrency 8
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BAZAAR_URL = 'https://api.hypixel.net/v2/skyblock/bazaar';
/** jsDelivr mirrors the repo with generous rate limits; raw.githubusercontent.com is the fallback. */
const SOURCES = [
  'https://cdn.jsdelivr.net/gh/NotEnoughUpdates/NotEnoughUpdates-REPO@master/items/',
  'https://raw.githubusercontent.com/NotEnoughUpdates/NotEnoughUpdates-REPO/master/items/',
];

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../src/data/recipes.json');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const concurrency = Number(arg('--concurrency', 4));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET with retry on 429/5xx (exponential back-off) and per-source fallback. */
async function getJson(name) {
  for (const base of SOURCES) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await fetch(`${base}${encodeURIComponent(name)}.json`);
      if (res.status === 404) break; // try the next source
      if (res.status === 429 || res.status >= 500) {
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
      try {
        return await res.json();
      } catch {
        return null; // malformed file (e.g. enchantment stubs)
      }
    }
  }
  return null;
}

async function loadBazaar() {
  const local = arg('--bazaar');
  if (local) return JSON.parse(await readFile(local, 'utf8'));
  const res = await fetch(BAZAAR_URL);
  if (!res.ok) throw new Error(`${BAZAAR_URL} -> HTTP ${res.status}`);
  return res.json();
}

/** NEU stores damage-value ids with a dash: INK_SACK:3 → INK_SACK-3. */
const toNeu = (id) => id.replace(':', '-');
const fromNeu = (id) => id.replace(/-(\d+)$/, ':$1');

function parseIngredient(s) {
  if (!s) return null;
  const m = String(s).match(/^(.*?)(?::(\d+))?$/);
  if (!m || !m[1]) return null;
  return { id: fromNeu(m[1]), qty: m[2] ? Number(m[2]) : 1 };
}

function gridInputs(r) {
  const inputs = {};
  for (const slot of ['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3']) {
    const ing = parseIngredient(r[slot]);
    if (!ing) continue;
    inputs[ing.id] = (inputs[ing.id] ?? 0) + ing.qty;
  }
  return inputs;
}

function extractRecipes(item) {
  const out = [];
  if (item.recipe && typeof item.recipe === 'object') {
    out.push({ type: 'crafting', count: 1, inputs: gridInputs(item.recipe) });
  }
  for (const r of item.recipes ?? []) {
    if (r.type === 'crafting') out.push({ type: 'crafting', count: Number(r.count ?? 1) || 1, inputs: gridInputs(r) });
    else if (r.type === 'forge' && Array.isArray(r.inputs)) {
      const inputs = {};
      for (const s of r.inputs) {
        const ing = parseIngredient(s);
        if (ing) inputs[ing.id] = (inputs[ing.id] ?? 0) + ing.qty;
      }
      out.push({ type: 'forge', count: Number(r.count ?? 1) || 1, inputs, duration: Number(r.duration ?? 0) || 0 });
    }
  }
  return out.filter((r) => Object.keys(r.inputs).length > 0);
}

async function fetchItem(id) {
  for (const name of [toNeu(id), id]) {
    const item = await getJson(name);
    if (item) return item;
    if (name === id) break;
  }
  return null;
}

const bazaar = await loadBazaar();
const ids = Object.keys(bazaar.products).sort();
const idSet = new Set(ids);
const result = {};
let done = 0;
let missing = 0;
let failed = 0;

async function worker(queue) {
  for (;;) {
    const id = queue.shift();
    if (!id) return;
    try {
      const item = await fetchItem(id);
      if (!item) missing++;
      else {
        const recipes = extractRecipes(item).filter((r) => Object.keys(r.inputs).every((i) => idSet.has(i)));
        if (recipes.length > 0) result[id] = recipes;
      }
    } catch (e) {
      failed++;
      console.error(`! ${id}: ${e.message}`);
    }
    done++;
    if (done % 200 === 0) console.log(`${done}/${ids.length} …`);
  }
}

const queue = [...ids];
await Promise.all(Array.from({ length: concurrency }, () => worker(queue)));

const sorted = Object.fromEntries(Object.keys(result).sort().map((k) => [k, result[k]]));
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(sorted) + '\n');
console.log(`Wrote ${Object.keys(sorted).length} craftable products to ${OUT} (${missing} not in NEU, ${failed} failed).`);
