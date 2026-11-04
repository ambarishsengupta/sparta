import { describe, expect, it } from 'vitest';
import { WARDROBES } from '../../../packages/rules/src/fixtures/wardrobes';
import { ENGINE_CONFIG, EVENTS_KEY, EVENT_TYPES, EventLog } from './events';
import type { StorageLike } from './local-repository';
import { buildCtx, seasonOf, startView } from './suggestions-view-model';

const mem = (): StorageLike & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
};
const AT = '2026-11-04T10:00:00.000Z';

describe('local usage-event log (FDD 16)', () => {
  it('uses the configuration string with every learned part off', () => {
    expect(ENGINE_CONFIG).toBe('gm1;emb0;pair0;ul:fb;w:base');
  });
  it('records the four R3 event types, each with engine_config', () => {
    const log = new EventLog(mem(), () => AT);
    for (const type of EVENT_TYPES) expect(log.record(type, { occasion: 'Work', season: 'Spring' })).toMatchObject({ type, engine_config: ENGINE_CONFIG, at: AT });
    expect(EVENT_TYPES).toEqual(['suggestion_accepted', 'suggestion_rejected', 'suggestion_swapped', 'item_added']);
    expect(log.list()).toHaveLength(4);
  });
  it('carries the occasion, season, rules involved and slot, and nothing else', () => {
    const log = new EventLog(mem(), () => AT);
    log.record('suggestion_swapped', { occasion: 'Casual', season: 'Autumn', ruleIds: ['R1', 'R2'], slot: 'top' });
    expect(log.list()[0]).toEqual({
      type: 'suggestion_swapped', at: AT, occasion: 'Casual', season: 'Autumn', engine_config: ENGINE_CONFIG, rule_ids: ['R1', 'R2'], slot: 'top', origin: null,
    });
  });
  it('an item_added event carries its origin and no occasion', () => {
    expect(new EventLog(mem(), () => AT).record('item_added', { origin: 'demo' })).toMatchObject({ occasion: null, season: null, origin: 'demo' });
  });
  it('holds no item name or id when it is recorded from a real suggestion', () => {
    const items = WARDROBES['Office regular']!;
    const ctx = buildCtx('Work', 'north', new Date('2026-04-15T12:00:00Z'));
    const view = startView(items, ctx);
    if (view.kind !== 'cards') throw new Error('expected cards');
    const log = new EventLog(mem(), () => AT);
    log.record('suggestion_accepted', { occasion: ctx.occasion, season: seasonOf(ctx), ruleIds: view.cards[0]!.ruleIds });
    const text = JSON.stringify(log.list());
    for (const item of items) { expect(text).not.toContain(item.name); expect(text).not.toContain(item.id); }
  });
  it('keeps events under its own versioned key and survives a reload', () => {
    const storage = mem();
    new EventLog(storage, () => AT).record('suggestion_accepted', { occasion: 'Party' });
    expect(EVENTS_KEY).toBe('sparta.events.v1');
    expect(JSON.parse(storage.map.get(EVENTS_KEY)!)).toMatchObject({ version: 1 });
    expect(new EventLog(storage).list().map((e) => e.occasion)).toEqual(['Party']);
    expect([...storage.map.keys()]).toEqual([EVENTS_KEY]);
  });
  it('counts by type', () => {
    const log = new EventLog(mem(), () => AT);
    log.record('suggestion_rejected');
    log.record('suggestion_rejected');
    log.record('suggestion_accepted');
    expect([log.count('suggestion_rejected'), log.count('suggestion_accepted'), log.count('item_added')]).toEqual([2, 1, 0]);
  });
  it('reads a corrupt or other-version log as empty and starts a fresh one', () => {
    for (const raw of ['{', '[]', '{"version":9,"events":[]}', '{"version":1,"events":"x"}']) {
      const storage = mem();
      storage.map.set(EVENTS_KEY, raw);
      const log = new EventLog(storage, () => AT);
      expect(log.list()).toEqual([]);
      log.record('item_added');
      expect(log.list()).toHaveLength(1);
    }
  });
  it('keeps only the newest 1000 events', () => {
    const log = new EventLog(mem(), () => AT);
    for (let i = 0; i < 1005; i++) log.record('item_added', { origin: String(i) });
    const list = log.list();
    expect(list).toHaveLength(1000);
    expect(list[0]!.origin).toBe('5');
  });
  it('works in memory when storage is missing or blocked', () => {
    const blocked: StorageLike = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    for (const storage of [null, blocked]) {
      const log = new EventLog(storage, () => AT);
      log.record('suggestion_rejected');
      log.record('suggestion_accepted');
      expect(log.list().map((e) => e.type)).toEqual(['suggestion_rejected', 'suggestion_accepted']);
    }
  });
});
