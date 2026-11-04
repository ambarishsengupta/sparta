import type { Occasion } from '@sparta/taxonomy';
import type { CurrentSeason, Slot } from '@sparta/rules';
import { browserStorage } from './local-repository';
import type { StorageLike } from './local-repository';

/** Bump the suffix when the stored shape changes; a log of another version is read as empty. */
export const EVENTS_KEY = 'sparta.events.v1';
/** FDD 16 `engine_config`: garment model 1, embedding swap off, pairing prior off, unlock list fallback, base weights. All learned parts are off in R3. */
export const ENGINE_CONFIG = 'gm1;emb0;pair0;ul:fb;w:base';
export const EVENT_TYPES = ['suggestion_accepted', 'suggestion_rejected', 'suggestion_swapped', 'item_added'] as const;
export type EventType = (typeof EVENT_TYPES)[number];
const MAX_EVENTS = 1000;

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

  constructor(private storage: StorageLike | null = browserStorage(), private now: () => string = () => new Date().toISOString()) {}

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
      type, at: this.now(), occasion: d.occasion ?? null, season: d.season ?? null, engine_config: ENGINE_CONFIG,
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
