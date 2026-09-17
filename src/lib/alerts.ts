import type { ScoredFlip } from './signals';

export interface AlertRule {
  enabled: boolean;
  sound: boolean;
  /** Fire when a flip's score (profit/h × confidence) reaches this. */
  minScore: number;
  minMarginPct: number;
  onlyFavorites: boolean;
  /** Ignore flips carrying any risk flag. */
  cleanOnly: boolean;
}

export const DEFAULT_ALERT_RULE: AlertRule = {
  enabled: false,
  sound: true,
  minScore: 5_000_000,
  minMarginPct: 5,
  onlyFavorites: false,
  cleanOnly: true,
};

export interface AlertEvent {
  id: string;
  at: number;
  buyOrderPrice: number;
  sellOfferPrice: number;
  marginPct: number;
  profitPerHour: number;
  score: number;
  units: number;
}

export function matchesRule(f: ScoredFlip, rule: AlertRule, favorites: ReadonlySet<string>): boolean {
  if (!rule.enabled) return false;
  if (rule.onlyFavorites && !favorites.has(f.id)) return false;
  if (rule.cleanOnly && f.flags.length > 0) return false;
  if (f.marginPct < rule.minMarginPct) return false;
  if (f.score < rule.minScore) return false;
  return true;
}

/**
 * Returns the flips that match now but did not match in the previous snapshot.
 * Also returns the new "matching" set to carry forward.
 */
export function newMatches(
  flips: ScoredFlip[],
  rule: AlertRule,
  favorites: ReadonlySet<string>,
  previouslyMatching: ReadonlySet<string>,
): { fresh: ScoredFlip[]; matching: Set<string> } {
  const matching = new Set<string>();
  const fresh: ScoredFlip[] = [];
  for (const f of flips) {
    if (!matchesRule(f, rule, favorites)) continue;
    matching.add(f.id);
    if (!previouslyMatching.has(f.id)) fresh.push(f);
  }
  return { fresh, matching };
}

export function toEvent(f: ScoredFlip, at: number): AlertEvent {
  return {
    id: f.id,
    at,
    buyOrderPrice: f.buyOrderPrice,
    sellOfferPrice: f.sellOfferPrice,
    marginPct: f.marginPct,
    profitPerHour: f.profitPerHour,
    score: f.score,
    units: f.units,
  };
}
