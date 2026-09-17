import rawNames from '../data/item-names.json';

type NameEntry = [name: string, tier?: string];
const KNOWN = rawNames as unknown as Record<string, NameEntry>;

export type Tier =
  | 'COMMON' | 'UNCOMMON' | 'RARE' | 'EPIC' | 'LEGENDARY' | 'MYTHIC'
  | 'DIVINE' | 'SPECIAL' | 'VERY_SPECIAL' | 'SUPREME' | 'UNOBTAINABLE';

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

/** Legacy Minecraft ids whose names cannot be derived from the id. */
const LEGACY: Record<string, string> = {
  'INK_SACK:3': 'Cocoa Beans',
  'INK_SACK:4': 'Lapis Lazuli',
  'LOG:1': 'Spruce Log',
  'LOG:2': 'Birch Log',
  'LOG:3': 'Jungle Log',
  'LOG_2': 'Acacia Log',
  'LOG_2:1': 'Dark Oak Log',
  'RAW_FISH:1': 'Raw Salmon',
  'RAW_FISH:2': 'Clownfish',
  'RAW_FISH:3': 'Pufferfish',
  'SAND:1': 'Red Sand',
  'HUGE_MUSHROOM_1': 'Brown Mushroom Block',
  'HUGE_MUSHROOM_2': 'Red Mushroom Block',
};

function titleCase(words: string[]): string {
  return words
    .filter(Boolean)
    .map((w) => (w.length <= 2 && /^[A-Z]+$/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()))
    .join(' ');
}

/** Best-effort human name for a product id the catalogue does not know. */
export function prettifyId(id: string): string {
  if (LEGACY[id]) return LEGACY[id];

  const ench = id.match(/^ENCHANTMENT_(.+?)_(\d+)$/);
  if (ench) {
    const level = Number(ench[2]);
    let name = titleCase(ench[1].split('_'));
    name = name.replace(/^Turbo /, 'Turbo-');
    return `${name} ${ROMAN[level] ?? level}`;
  }

  const shard = id.match(/^SHARD_(.+)$/);
  if (shard) return `${titleCase(shard[1].split('_'))} Shard`;

  const essence = id.match(/^ESSENCE_(.+)$/);
  if (essence) return `${titleCase(essence[1].split('_'))} Essence`;

  return titleCase(id.replace(/:\d+$/, '').split('_'));
}

export function itemName(id: string): string {
  return KNOWN[id]?.[0] ?? prettifyId(id);
}

export function itemTier(id: string): Tier | undefined {
  return KNOWN[id]?.[1] as Tier | undefined;
}

export function isEnchantmentBook(id: string): boolean {
  return id.startsWith('ENCHANTMENT_');
}
