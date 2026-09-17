/**
 * Thin client for the public Hypixel Bazaar endpoint.
 *
 * Naming in the API is from the *player's action* point of view, which trips
 * people up constantly, so the field docs below spell it out:
 *
 *  - `buy_summary`  = other players' SELL OFFERS. This is the side you hit when
 *                     you *instabuy*. Sorted ascending; index 0 is the cheapest offer.
 *  - `sell_summary` = other players' BUY ORDERS. This is the side you hit when
 *                     you *instasell*. Sorted descending; index 0 is the highest order.
 *  - `quick_status.buyPrice`  ≈ instabuy price (weighted average of the top 2% of sell offers by volume)
 *  - `quick_status.sellPrice` ≈ instasell price (weighted average of the top 2% of buy orders)
 *  - `buyMovingWeek`  = units instabought in the last 7 days (those fill *your sell offers*)
 *  - `sellMovingWeek` = units instasold  in the last 7 days (those fill *your buy orders*)
 *  - `buyOrders`  = number of open sell offers, `buyVolume`  = units in them
 *  - `sellOrders` = number of open buy orders,  `sellVolume` = units in them
 */

export const BAZAAR_URL = 'https://api.hypixel.net/v2/skyblock/bazaar';

export interface OrderLevel {
  amount: number;
  pricePerUnit: number;
  orders: number;
}

export interface QuickStatus {
  productId: string;
  sellPrice: number;
  sellVolume: number;
  sellMovingWeek: number;
  sellOrders: number;
  buyPrice: number;
  buyVolume: number;
  buyMovingWeek: number;
  buyOrders: number;
}

export interface BazaarProduct {
  product_id: string;
  /** Sell offers (what you instabuy from), ascending by price. */
  buy_summary: OrderLevel[];
  /** Buy orders (what you instasell into), descending by price. */
  sell_summary: OrderLevel[];
  quick_status: QuickStatus;
}

export interface BazaarSnapshot {
  success: boolean;
  lastUpdated: number;
  products: Record<string, BazaarProduct>;
}

export async function fetchBazaar(signal?: AbortSignal): Promise<BazaarSnapshot> {
  // The endpoint is served with `cache-control: max-age=60`, which would let the
  // browser answer our polls from its own cache for a minute. `no-cache` forces a
  // conditional revalidation instead: the CDN replies 304 (no body) until a new
  // snapshot exists, then 200 with the fresh payload.
  const res = await fetch(BAZAAR_URL, { signal, cache: 'no-cache', headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Hypixel API responded with HTTP ${res.status}`);
  const data = (await res.json()) as Partial<BazaarSnapshot>;
  if (!data.success || !data.products) throw new Error('Hypixel API returned an unsuccessful payload');
  return data as BazaarSnapshot;
}
