/**
 * Data that lives only in this browser and belongs to the person's use of Sparta: the usage log (`sparta.events.v1`, occasions, seasons and rule ids,
 * no names) and the settings kept beside it (`sparta.settings.v1`). It is removed when the person signs out and when they leave the pilot, so a shared
 * device keeps nothing of them. Every key that starts with one of these prefixes goes, whatever its version suffix. The device-local wardrobe of the
 * no-account mode (`sparta.wardrobe.v1`) is not usage data and is not touched here (see NOTES).
 */
export const USAGE_KEY_PREFIXES = ['sparta.events.', 'sparta.settings.'] as const;

/** The part of the browser's Storage this needs, so tests can pass a fake. */
export interface ClearableStorage { readonly length: number; key(index: number): string | null; removeItem(key: string): void }

function defaultStorage(): ClearableStorage | null {
  try { return (globalThis as { localStorage?: ClearableStorage }).localStorage ?? null; } catch { return null; } // access can throw when site data is blocked
}

/** Removes the usage log and settings keys; returns the keys it removed. Never throws: blocked or missing storage means nothing to remove. */
export function clearBrowserUsage(storage: ClearableStorage | null = defaultStorage()): string[] {
  if (!storage) return [];
  let names: string[] = [];
  try {
    for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k !== null) names.push(k); } // take the list first: removing shifts the indexes
    names = names.filter((k) => USAGE_KEY_PREFIXES.some((p) => k.startsWith(p)));
  } catch { return []; }
  const removed: string[] = [];
  for (const k of names) { try { storage.removeItem(k); removed.push(k); } catch { /* one blocked key does not stop the rest */ } }
  return removed;
}
