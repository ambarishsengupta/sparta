import type { Occasion } from '@sparta/taxonomy';
import type { CurrentSeason, Slot } from '@sparta/rules';
import { browserStorage } from './local-repository';
import type { StorageLike } from './local-repository';
import { currentEngineConfig } from './engine-config';
import type { ItemInput, StoredItem, WardrobeRepository } from './repository';

/** Bump the suffix when the stored shape changes; a log of another version is read as empty. */
export const EVENTS_KEY = 'sparta.events.v1';
/** FDD 16 `engine_config` with every learned part off (what an event carries unless a switch is on; see lib/engine-config.ts). */
export const ENGINE_CONFIG = 'gm1;emb0;pair0;ul:fb;w:base';
export const EVENT_TYPES = ['suggestion_accepted', 'suggestion_rejected', 'suggestion_swapped', 'item_added'] as const;
/** The four R3 types plus `wishlist_added` (R4: origin 'user' or 'unlock'). */
export type EventType = (typeof EVENT_TYPES)[number] | 'wishlist_added';
const MAX_EVENTS = 1000;

let lastMs = 0;
/** The clock events use: ISO time that never repeats within a page, so two events logged in the same millisecond still differ. */
export function tickingNow(): string {
  lastMs = Math.max(Date.now(), lastMs + 1);
  return new Date(lastMs).toISOString();
}

/** One usage event. It holds no item name, item id or free text (FR-53, FDD 16): only the occasion, season, rules involved and slot. */
export interface UsageEvent {
  type: EventType;
  at: string;
  occasion: Occasion | null;
  season: CurrentSeason | null;
  engine_config: string;
  rule_ids: string[];
  slot: Slot | null;
  origin: string | null;
}
export type EventDetails = Partial<Pick<UsageEvent, 'occasion' | 'season' | 'slot' | 'origin'>> & { ruleIds?: readonly string[] };

/**
 * A local, append-only usage log in the browser's storage (kept to the newest 1000 events). Nothing here sends anything anywhere:
 * the pilot's server-side recorder is a later release. Without storage the events live in memory for this session.
 */
export class EventLog {
  private memory: UsageEvent[] = [];

  constructor(private storage: StorageLike | null = browserStorage(), private now: () => string = tickingNow, private config: () => string = currentEngineConfig) {}

  list(): UsageEvent[] {
    try {
      const raw = this.storage?.getItem(EVENTS_KEY);
      if (!raw) return [...this.memory];
      const doc = JSON.parse(raw) as { version?: number; events?: unknown };
      return doc.version === 1 && Array.isArray(doc.events) ? (doc.events as UsageEvent[]) : [...this.memory];
    } catch {
      return [...this.memory];
    }
  }

  count(type: EventType): number {
    return this.list().filter((e) => e.type === type).length;
  }

  record(type: EventType, d: EventDetails = {}): UsageEvent {
    const event: UsageEvent = {
      type, at: this.now(), occasion: d.occasion ?? null, season: d.season ?? null, engine_config: this.config(),
      rule_ids: [...(d.ruleIds ?? [])], slot: d.slot ?? null, origin: d.origin ?? null,
    };
    this.memory = [...this.list(), event].slice(-MAX_EVENTS);
    try {
      this.storage?.setItem(EVENTS_KEY, JSON.stringify({ version: 1, events: this.memory }));
    } catch {
      /* quota or blocked: the event stays in memory */
    }
    return event;
  }
}

/** Create one item and log one `item_added` event for it (origin 'manual' from the form, 'photo' from add-by-photo, 'demo' from the demo loader). */
export async function createItemLogged(repo: WardrobeRepository, log: EventLog, input: ItemInput, origin: 'manual' | 'demo' | 'photo'): Promise<StoredItem> {
  const item = await repo.items.create(input);
  log.record('item_added', { origin });
  return item;
}
