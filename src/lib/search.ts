import { itemName } from './names';

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9가-힣]+/g, ' ').trim();

/**
 * Case-insensitive, token-based match against the display name and the raw id.
 * "ench dia" matches "Enchanted Diamond"; "wise 5" matches "Ultimate Wise V" / ENCHANTMENT_ULTIMATE_WISE_5.
 */
export function matchesQuery(id: string, query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  const hay = `${normalize(itemName(id))} ${normalize(id)}`;
  return q.split(' ').every((token) => hay.includes(token));
}

/** Rank search hits: exact name > prefix > substring, then shorter names first. */
export function scoreMatch(id: string, query: string): number {
  const q = normalize(query);
  const name = normalize(itemName(id));
  if (!q) return 0;
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (name.includes(q)) return 2;
  return 3 + name.length / 100;
}
