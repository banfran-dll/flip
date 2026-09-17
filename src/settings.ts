import type { RefreshMode } from './hooks/useBazaar';
import { DEFAULT_FLIP_FILTERS, DEFAULT_FLIP_SETTINGS, MAX_ORDER_SIZE, type FlipFilters, type FlipSettings, type HideFlags } from './lib/flip';

export interface AppSettings {
  budget: number;
  taxRate: number;
  minCycleMinutes: number;
  minWeeklyVolume: number;
  minMarginPct: number;
  minProfitPerUnit: number;
  minPrice: number;
  maxPrice: number;
  hideFlags: HideFlags;
  refreshMode: RefreshMode;
  /** Polling period in 'interval' mode. */
  refreshSec: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  budget: DEFAULT_FLIP_SETTINGS.budget,
  taxRate: DEFAULT_FLIP_SETTINGS.taxRate,
  minCycleMinutes: DEFAULT_FLIP_SETTINGS.minCycleMinutes,
  minWeeklyVolume: DEFAULT_FLIP_FILTERS.minWeeklyVolume,
  minMarginPct: DEFAULT_FLIP_FILTERS.minMarginPct,
  minProfitPerUnit: DEFAULT_FLIP_FILTERS.minProfitPerUnit,
  minPrice: DEFAULT_FLIP_FILTERS.minPrice,
  maxPrice: DEFAULT_FLIP_FILTERS.maxPrice,
  hideFlags: DEFAULT_FLIP_FILTERS.hideFlags,
  refreshMode: 'live',
  refreshSec: 30,
};

export const TAX_PRESETS = [
  { key: 'taxDefault', rate: 0.0125 },
  { key: 'taxFlipper1', rate: 0.01125 },
  { key: 'taxFlipper2', rate: 0.011 },
] as const;

export function toFlipSettings(s: AppSettings): FlipSettings {
  return { taxRate: s.taxRate, budget: s.budget, minCycleMinutes: s.minCycleMinutes, maxOrderSize: MAX_ORDER_SIZE };
}

export function toFlipFilters(s: AppSettings, onlyIds?: ReadonlySet<string>): FlipFilters {
  return {
    minWeeklyVolume: s.minWeeklyVolume,
    minMarginPct: s.minMarginPct,
    minProfitPerUnit: s.minProfitPerUnit,
    minPrice: s.minPrice,
    maxPrice: s.maxPrice,
    hideFlags: s.hideFlags,
    onlyIds,
  };
}
