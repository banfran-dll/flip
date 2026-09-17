import type { BazaarProduct } from '../api/bazaar';

/**
 * NPC flip: buy from the bazaar below the NPC sell price and sell to any NPC.
 * No bazaar tax applies to the NPC sale. Only the visible top-30 levels are
 * considered, and purchases stop at the budget or at the first level that is
 * not cheaper than the NPC price.
 */
export interface NpcFlip {
  id: string;
  npcPrice: number;
  /** Cheapest sell offer on the book. */
  instaBuyPrice: number;
  /** Profit on the very first unit. */
  profitPerUnit: number;
  units: number;
  cost: number;
  profit: number;
  averageBuyPrice: number;
  marginPct: number;
  /** True when more profitable levels existed beyond the budget. */
  budgetLimited: boolean;
}

export function computeNpcFlip(product: BazaarProduct, npcPrice: number, budget: number): NpcFlip | null {
  const first = product.buy_summary[0];
  if (!first || !(npcPrice > 0) || first.pricePerUnit >= npcPrice) return null;
  let remaining = budget;
  let units = 0;
  let cost = 0;
  let budgetLimited = false;
  for (const level of product.buy_summary) {
    if (level.pricePerUnit >= npcPrice) break;
    const affordable = Math.floor(remaining / level.pricePerUnit);
    const take = Math.min(level.amount, affordable);
    if (take <= 0) {
      budgetLimited = true;
      break;
    }
    units += take;
    cost += take * level.pricePerUnit;
    remaining -= take * level.pricePerUnit;
    if (take < level.amount) {
      budgetLimited = true;
      break;
    }
  }
  if (units === 0) return null;
  return {
    id: product.product_id,
    npcPrice,
    instaBuyPrice: first.pricePerUnit,
    profitPerUnit: npcPrice - first.pricePerUnit,
    units,
    cost,
    profit: units * npcPrice - cost,
    averageBuyPrice: cost / units,
    marginPct: cost > 0 ? ((units * npcPrice - cost) / cost) * 100 : 0,
    budgetLimited,
  };
}

export function computeAllNpcFlips(
  products: Record<string, BazaarProduct>,
  npcPriceFor: (id: string) => number | undefined,
  budget: number,
): NpcFlip[] {
  const out: NpcFlip[] = [];
  for (const p of Object.values(products)) {
    const npc = npcPriceFor(p.product_id);
    if (!npc) continue;
    const f = computeNpcFlip(p, npc, budget);
    if (f) out.push(f);
  }
  return out.sort((a, b) => b.profit - a.profit);
}
