import type { Snapshot } from './aggregate';

/**
 * Extracts only what the collector needs from the 3.6 MB bazaar payload with a
 * single regex pass (~6 ms) instead of JSON.parse (~25–35 ms), so a cron run
 * fits inside the Workers free plan's 10 ms CPU budget. Verified against
 * JSON.parse on a full snapshot in the tests.
 */
const PRODUCT =
  /"product_id":"([^"]+)","sell_summary":\[(\{"amount":\d+,"pricePerUnit":([0-9.eE+-]+))?[^\]]*\],"buy_summary":\[(\{"amount":\d+,"pricePerUnit":([0-9.eE+-]+))?[^\]]*\],"quick_status":\{([^}]*)\}/g;

export function parseSnapshotFast(text: string): Snapshot {
  const lu = /"lastUpdated":(\d+)/.exec(text);
  if (!lu) throw new Error('lastUpdated missing');
  const products: Snapshot['products'] = {};
  PRODUCT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PRODUCT.exec(text))) {
    const qs = m[6];
    const smw = /"sellMovingWeek":(\d+)/.exec(qs);
    const bmw = /"buyMovingWeek":(\d+)/.exec(qs);
    products[m[1]] = {
      sell_summary: m[3] ? [{ pricePerUnit: Number(m[3]) }] : [],
      buy_summary: m[5] ? [{ pricePerUnit: Number(m[5]) }] : [],
      quick_status: { sellMovingWeek: smw ? Number(smw[1]) : 0, buyMovingWeek: bmw ? Number(bmw[1]) : 0 },
    };
  }
  if (Object.keys(products).length === 0) throw new Error('no products parsed');
  return { lastUpdated: Number(lu[1]), products };
}
