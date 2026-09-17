import { itemName, itemTier, isEnchantmentBook } from '../lib/names';

interface Props {
  id: string;
  showId?: boolean;
  favorite?: boolean;
}

export function ItemName({ id, showId = true, favorite = false }: Props) {
  const tier = itemTier(id) ?? (isEnchantmentBook(id) ? 'BOOK' : undefined);
  return (
    <span className="item-name">
      <span className={`item-name__label tier-${tier ?? 'NONE'}`}>
        {favorite && <span className="item-name__star" aria-hidden>★</span>}
        {itemName(id)}
      </span>
      {showId && <span className="item-name__id">{id}</span>}
    </span>
  );
}
