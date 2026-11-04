import { rgbToHex } from '@sparta/taxonomy';
import { WARDROBES } from '../../../packages/rules/src/fixtures/wardrobes';
import { EventLog, createItemLogged } from './events';
import type { ItemInput, WardrobeRepository } from './repository';

export const DEMO_WARDROBE_NAMES = Object.keys(WARDROBES);

/** Copy one of the R1 fixture wardrobes (read-only) into the repository, one `item_added` event (origin 'demo') per item; returns how many items were added. */
export async function loadDemoWardrobe(repo: WardrobeRepository, name: string, log: EventLog = new EventLog()): Promise<number> {
  const items = WARDROBES[name] ?? [];
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
