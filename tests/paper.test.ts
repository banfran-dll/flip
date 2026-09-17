import { describe, expect, it } from 'vitest';
import type { PricePoint } from '../src/lib/history';
import { EXPIRE_HOURS, openTrade, realizedProfit, stepTrade, summarize, type PaperTrade } from '../src/lib/paper';
import { DEFAULT_FLIP_SETTINGS, computeFlip } from '../src/lib/flip';
import { scoreFlip, EMPTY_SIGNALS } from '../src/lib/signals';

const pt = (t: number, buy: number, sell: number, bmw: number, smw: number): PricePoint => ({ t, buy, sell, bmw, smw });

function trade(units = 10): PaperTrade {
  const f = computeFlip(
    {
      product_id: 'X',
      buy_summary: [{ pricePerUnit: 110, amount: 1e6, orders: 1 }],
      sell_summary: [{ pricePerUnit: 100, amount: 1e6, orders: 1 }],
      quick_status: { productId: 'X', buyPrice: 110, buyVolume: 0, buyMovingWeek: 168_000, buyOrders: 1, sellPrice: 100, sellVolume: 0, sellMovingWeek: 168_000, sellOrders: 1 },
    },
    { ...DEFAULT_FLIP_SETTINGS, budget: units * 100.1, taxRate: 0 },
  )!;
  return openTrade(scoreFlip(f, EMPTY_SIGNALS), 0, 'T');
}

describe('paper trading', () => {
  it('opens at the suggested prices', () => {
    const t = trade();
    expect(t.status).toBe('buying');
    expect(t.buyPrice).toBe(100.1);
    expect(t.sellPrice).toBe(109.9);
    expect(t.units).toBe(10);
  });

  it('fills the buy leg from instasells, re-bidding when outbid, then sells from instabuys', () => {
    let t = trade(10);
    // 4 instasells while we sit at the top
    t = stepTrade(t, pt(0, 110, 100, 0, 0), pt(20_000, 110, 100, 0, 4), 0);
    expect(t.boughtUnits).toBe(4);
    expect(t.cost).toBeCloseTo(4 * 100.1, 6);
    // someone outbids us at 100.5 → we re-bid to 100.6 and receive the next 6
    t = stepTrade(t, pt(20_000, 110, 100, 0, 4), pt(40_000, 110, 100.5, 0, 10), 0);
    expect(t.buyPrice).toBe(100.6);
    expect(t.boughtUnits).toBe(10);
    expect(t.status).toBe('selling');
    expect(t.cost).toBeCloseTo(4 * 100.1 + 6 * 100.6, 6);
    // undercut to 109.5 → we go to 109.4; 10 instabuys close the trade
    t = stepTrade(t, pt(40_000, 110, 100.5, 0, 10), pt(60_000, 109.5, 100.5, 10, 10), 0.0125);
    expect(t.sellPrice).toBe(109.4);
    expect(t.status).toBe('closed');
    expect(t.revenue).toBeCloseTo(10 * 109.4 * 0.9875, 6);
    expect(realizedProfit(t)).toBeCloseTo(10 * 109.4 * 0.9875 - (4 * 100.1 + 6 * 100.6), 6);
  });

  it('does not apply the same point twice', () => {
    const t0 = trade();
    const t1 = stepTrade(t0, pt(0, 110, 100, 0, 0), pt(20_000, 110, 100, 0, 5), 0);
    expect(stepTrade(t1, pt(0, 110, 100, 0, 0), pt(20_000, 110, 100, 0, 5), 0)).toBe(t1);
  });

  it('expires stale trades and liquidates unsold units at the instasell price', () => {
    let t = trade(10);
    t = stepTrade(t, pt(0, 110, 100, 0, 0), pt(20_000, 110, 100, 0, 10), 0); // fully bought
    const late = EXPIRE_HOURS * 3_600_000 + 1;
    t = stepTrade(t, pt(20_000, 110, 100, 0, 10), pt(late, 110, 95, 0, 10), 0);
    expect(t.status).toBe('expired');
    expect(t.soldUnits).toBe(10);
    expect(t.revenue).toBeCloseTo(10 * 95, 6);
  });

  it('summarises finished trades', () => {
    let a = trade(10);
    a = stepTrade(a, pt(0, 110, 100, 0, 0), pt(20_000, 110, 100, 0, 10), 0);
    a = stepTrade(a, pt(20_000, 110, 100, 0, 10), pt(40_000, 110, 100, 10, 10), 0);
    const b = trade(10); // still open
    const s = summarize([a, b]);
    expect(s.total).toBe(2);
    expect(s.open).toBe(1);
    expect(s.closed).toBe(1);
    expect(s.realizedTotal).toBeCloseTo(10 * 109.9 - 10 * 100.1, 6);
    expect(s.expectedTotal).toBeCloseTo(a.expectedProfit, 6);
    expect(s.winRate).toBe(1);
    expect(s.avgHours).toBeCloseTo(40_000 / 3_600_000, 6);
    expect(s.captureRatio).toBeCloseTo(s.realizedTotal / s.expectedTotal, 6);
  });
});
