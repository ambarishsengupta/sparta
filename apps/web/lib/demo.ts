import { rgbToHex } from '@sparta/taxonomy';
import { WARDROBES } from '../../../packages/rules/src/fixtures/wardrobes';
import { EventLog, createItemLogged } from './events';
import { HM_ARTICLES, hmWardrobes } from './demo-hm';
import type { ItemInput, WardrobeRepository } from './repository';

const HM_WARDROBES = hmWardrobes(HM_ARTICLES);
/** In the local H&M demo the two H&M wardrobes come first and the 'Office regular' fixture is left out of the list, so the Outfits screen's one-press load picks an H&M wardrobe (it can still be loaded by name). */
export const DEMO_WARDROBE_NAMES = [...Object.keys(HM_WARDROBES), ...Object.keys(WARDROBES).filter((n) => Object.keys(HM_WARDROBES).length === 0 || n !== 'Office regular')];

/** Copy one of the R1 fixture wardrobes (read-only) into the repository, one `item_added` event (origin 'demo') per item; returns how many items were added. */
export async function loadDemoWardrobe(repo: WardrobeRepository, name: string, log: EventLog = new EventLog()): Promise<number> {
  const items = HM_WARDROBES[name] ?? WARDROBES[name] ?? [];
  for (const item of items) {
    const input: ItemInput & { id?: string } = {
      ...item, hex: rgbToHex(...item.rgb), fit: null, material: null, neverWorn: false,
      archiveReason: item.status === 'archived' ? 'sold' : null,
    };
    delete input.id; // the repository assigns ids, so loading twice never collides
    await createItemLogged(repo, log, input, 'demo');
  }
  return items.length;
}
