import { describe, expect, it } from 'vitest';
import { compact, coins, duration, parseCoins } from '../src/lib/format';
import { matchesQuery } from '../src/lib/search';

describe('compact', () => {
  it('abbreviates large numbers', () => {
    expect(compact(1_234_567)).toBe('1.23M');
    expect(compact(12_345)).toBe('12.3K');
    expect(compact(2_500_000_000)).toBe('2.5B');
    expect(compact(999)).toBe('999');
    expect(compact(12.34)).toBe('12.3');
    expect(compact(-1500)).toBe('-1,500');
  });
});

describe('coins', () => {
  it('keeps one decimal with separators', () => {
    expect(coins(1275.9)).toBe('1,275.9');
    expect(coins(100)).toBe('100.0');
  });
});

describe('duration', () => {
  it('formats minutes, hours and days', () => {
    expect(duration(0.25, 'en')).toBe('15m');
    expect(duration(1.5, 'en')).toBe('1.5h');
    expect(duration(30, 'en')).toBe('1d 6h');
    expect(duration(48, 'ko')).toBe('2일');
    expect(duration(Infinity)).toBe('∞');
  });
});

describe('parseCoins', () => {
  it('accepts k/m/b suffixes and separators', () => {
    expect(parseCoins('10m')).toBe(10_000_000);
    expect(parseCoins('1.5B')).toBe(1_500_000_000);
    expect(parseCoins('1,000,000')).toBe(1_000_000);
    expect(parseCoins('250k')).toBe(250_000);
    expect(parseCoins('abc')).toBeNull();
    expect(parseCoins('')).toBeNull();
  });
});

describe('matchesQuery', () => {
  it('matches tokens against name and id', () => {
    expect(matchesQuery('ENCHANTED_DIAMOND', 'ench dia')).toBe(true);
    expect(matchesQuery('ENCHANTMENT_ULTIMATE_WISE_5', 'wise 5')).toBe(true);
    expect(matchesQuery('ENCHANTMENT_ULTIMATE_WISE_5', 'wise v')).toBe(true);
    expect(matchesQuery('ENCHANTED_DIAMOND', 'gold')).toBe(false);
    expect(matchesQuery('ENCHANTED_DIAMOND', '')).toBe(true);
  });
});
