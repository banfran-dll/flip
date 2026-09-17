import type { BazaarSnapshot } from '../api/bazaar';

export interface PricePoint {
  t: number;
  /** Cheapest sell offer (instabuy price). */
  buy: number;
  /** Highest buy order (instasell price). */
  sell: number;
}

/**
 * In-memory ring buffer of top-of-book prices per product, filled from every
 * distinct snapshot while the page is open. Enough for a session sparkline;
 * not a substitute for a real price-history service.
 */
export class PriceHistory {
  private points = new Map<string, PricePoint[]>();
  private lastSeen = 0;

  constructor(private readonly maxPoints = 240) {}

  record(snapshot: BazaarSnapshot): void {
    if (snapshot.lastUpdated === this.lastSeen) return;
    this.lastSeen = snapshot.lastUpdated;
    for (const p of Object.values(snapshot.products)) {
      const buy = p.buy_summary[0]?.pricePerUnit;
      const sell = p.sell_summary[0]?.pricePerUnit;
      if (buy == null && sell == null) continue;
      let arr = this.points.get(p.product_id);
      if (!arr) {
        arr = [];
        this.points.set(p.product_id, arr);
      }
      arr.push({ t: snapshot.lastUpdated, buy: buy ?? NaN, sell: sell ?? NaN });
      if (arr.length > this.maxPoints) arr.splice(0, arr.length - this.maxPoints);
    }
  }

  get(id: string): PricePoint[] {
    return this.points.get(id) ?? [];
  }
}
