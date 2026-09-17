import { describe, expect, it } from 'vitest';
import { itemName, itemTier, prettifyId } from '../src/lib/names';

describe('prettifyId', () => {
  it('formats enchantment books with roman numerals', () => {
    expect(prettifyId('ENCHANTMENT_ULTIMATE_WISE_5')).toBe('Ultimate Wise V');
    expect(prettifyId('ENCHANTMENT_TURBO_ROSE_2')).toBe('Turbo-Rose II');
    expect(prettifyId('ENCHANTMENT_SHARPNESS_7')).toBe('Sharpness VII');
  });

  it('formats shards and essence', () => {
    expect(prettifyId('SHARD_WIKI_TIKI')).toBe('Wiki Tiki Shard');
    expect(prettifyId('ESSENCE_WITHER')).toBe('Wither Essence');
  });

  it('knows legacy damage-value ids', () => {
    expect(prettifyId('INK_SACK:3')).toBe('Cocoa Beans');
    expect(prettifyId('LOG_2:1')).toBe('Dark Oak Log');
  });

  it('title-cases anything else', () => {
    expect(prettifyId('FACTION_RABBIT_WALKER')).toBe('Faction Rabbit Walker');
  });
});

describe('catalogue lookup', () => {
  it('prefers the catalogue name and exposes the tier', () => {
    expect(itemName('ENCHANTED_DIAMOND')).toBe('Enchanted Diamond');
    expect(itemTier('ENCHANTED_DIAMOND')).toBeDefined();
  });

  it('falls back to a generated name for unknown ids', () => {
    expect(itemName('ENCHANTMENT_ULTIMATE_WISE_1')).toBe('Ultimate Wise I');
    expect(itemTier('ENCHANTMENT_ULTIMATE_WISE_1')).toBeUndefined();
  });
});
