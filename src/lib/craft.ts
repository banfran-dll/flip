import type { BazaarProduct } from '../api/bazaar';
import { HOURS_PER_WEEK, TICK, walkBook } from './flip';

export interface Recipe {
  type: 'crafting' | 'forge';
  /** Units of output per craft. */
  count: number;
  /** Ingredient product id → units per craft. */
  inputs: Record<string, number>;
  /** Forge time in seconds (forge recipes only). */
  duration?: number;
}

export type RecipeBook = Record<string, Recipe[]>;

/**
 * Craft flip: buy the ingredients on the bazaar, craft, sell the product on the bazaar.
 * Three ways to execute, from fastest to most profitable:
 *  - instant:  instabuy materials, instasell product          (zero waiting)
 *  - mixed:    instabuy materials, post a sell offer          (the usual craft flip)
 *  - orders:   buy orders for materials, sell offer product   (slowest, best margin)
 */
export interface CraftFlip {
  id: string;
  recipe: Recipe;
  /** Per output unit. */
  materialCostInstant: number;
  materialCostOrders: number;
  revenueInstant: number;
  revenueOffer: number;
  profitInstant: number;
  profitMixed: number;
  profitOrders: number;
  marginMixedPct: number;
  /** Batch sized to the budget with instabought materials and a sell offer (visible book depth). */
  crafts: number;
  units: number;
  batchCost: number;
  batchProfitMixed: number;
  /** True when the visible book could not supply all materials for the batch. */
  partial: boolean;
  /** Hours to sell the batch through a sell offer at the product's instabuy rate (forge time is a floor). */
  sellHours: number;
  /** Batch profit spread over max(sellHours, 1 h): what the recommender ranks by. */
  profitPerHour: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function computeCraftFlip(
  products: Record<string, BazaarProduct>,
  id: string,
  recipe: Recipe,
  taxRate: number,
  budget: number,
): CraftFlip | null {
  const out = products[id];
  const outOffer = out?.buy_summary[0]?.pricePerUnit;
  const outBid = out?.sell_summary[0]?.pricePerUnit;
  if (!out || outOffer == null || outBid == null || !(recipe.count > 0)) return null;

  let costInstant = 0;
  let costOrders = 0;
  for (const [mat, qty] of Object.entries(recipe.inputs)) {
    const p = products[mat];
    const ask = p?.buy_summary[0]?.pricePerUnit;
    const bid = p?.sell_summary[0]?.pricePerUnit;
    if (!p || ask == null || bid == null) return null;
    costInstant += qty * ask;
    costOrders += qty * round1(bid + TICK);
  }
  const perUnitInstant = costInstant / recipe.count;
  const perUnitOrders = costOrders / recipe.count;
  const revenueInstant = outBid * (1 - taxRate);
  const revenueOffer = round1(outOffer - TICK) * (1 - taxRate);

  // Batch: how many crafts the budget affords at top-of-book prices, then re-price by walking the books.
  const crafts = Math.floor(budget / costInstant);
  let batchCost = 0;
  let partial = false;
  let feasibleCrafts = crafts;
  if (crafts > 0) {
    for (const [mat, qty] of Object.entries(recipe.inputs)) {
      const walk = walkBook(products[mat].buy_summary, qty * crafts);
      if (walk.partial) {
        partial = true;
        feasibleCrafts = Math.min(feasibleCrafts, Math.floor(walk.filled / qty));
      }
    }
    for (const [mat, qty] of Object.entries(recipe.inputs)) {
      batchCost += walkBook(products[mat].buy_summary, qty * feasibleCrafts).total;
    }
  }
  const units = feasibleCrafts * recipe.count;
  const batchProfitMixed = units * revenueOffer - batchCost;
  const outInstaBuysPerHour = out.quick_status.buyMovingWeek / HOURS_PER_WEEK;
  const forgeHours = recipe.type === 'forge' ? (recipe.duration ?? 0) / 3600 : 0;
  const sellHours = Math.max(outInstaBuysPerHour > 0 ? units / outInstaBuysPerHour : Infinity, forgeHours);

  return {
    id,
    recipe,
    materialCostInstant: perUnitInstant,
    materialCostOrders: perUnitOrders,
    revenueInstant,
    revenueOffer,
    profitInstant: revenueInstant - perUnitInstant,
    profitMixed: revenueOffer - perUnitInstant,
    profitOrders: revenueOffer - perUnitOrders,
    marginMixedPct: perUnitInstant > 0 ? ((revenueOffer - perUnitInstant) / perUnitInstant) * 100 : 0,
    crafts: feasibleCrafts,
    units,
    batchCost,
    batchProfitMixed,
    partial,
    sellHours,
    profitPerHour: Number.isFinite(sellHours) ? batchProfitMixed / Math.max(sellHours, 1) : 0,
  };
}

/** Best recipe per product (by mixed profit per unit), sorted by profit per hour. */
export function computeAllCraftFlips(products: Record<string, BazaarProduct>, book: RecipeBook, taxRate: number, budget: number): CraftFlip[] {
  const out: CraftFlip[] = [];
  for (const [id, recipes] of Object.entries(book)) {
    let best: CraftFlip | null = null;
    for (const r of recipes) {
      const f = computeCraftFlip(products, id, r, taxRate, budget);
      if (f && (!best || f.profitMixed > best.profitMixed)) best = f;
    }
    if (best) out.push(best);
  }
  return out.sort((a, b) => b.profitPerHour - a.profitPerHour);
}
