import type { ComponentType } from 'react';
import type { Category } from '@sparta/taxonomy';
import { Accessories } from './Accessories';
import { Activewear } from './Activewear';
import { Bottoms } from './Bottoms';
import { EthnicWear } from './EthnicWear';
import { Footwear } from './Footwear';
import { OccasionWear } from './OccasionWear';
import { Outerwear } from './Outerwear';
import { Tops } from './Tops';
import { Underwear } from './Underwear';
import { paintFor } from './paint';
import type { Paint } from './paint';

export const GARMENTS: Record<Category, ComponentType<Paint>> = {
  Tops, Bottoms, Outerwear, Footwear, Accessories, 'Underwear and socks': Underwear, Activewear, 'Ethnic wear': EthnicWear, 'Occasion wear': OccasionWear,
};

/** A flat garment silhouette in the item's stored colour, with an outline that keeps 3:1 against the tile (`tile` defaults to the paper token). */
export function CategoryIllustration({ category, hex, label, tile }: { category: Category; hex: string | null | undefined; label: string; tile?: string }) {
  const paint = paintFor(hex, tile);
  const Garment = GARMENTS[category];
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%" role="img" aria-label={label || category} focusable="false" data-category={category}>
      <g strokeWidth={1.5} strokeLinejoin="miter" strokeLinecap="butt">
        {Garment ? <Garment {...paint} /> : <polygon points="20,20 80,20 80,80 20,80" fill={paint.fill} stroke={paint.outline} />}
      </g>
    </svg>
  );
}
