/** Test support, no browser needed: runs a component function by hand with stand-ins for the React hooks it uses (useState, useReducer, useRef, useCallback, useEffect, useId), so a test can run its effects, let a
 * promise settle and read what the component would render next. Used from a test with `vi.mock('react', ...)`; nothing in the app imports this file. */
type Effect = { deps: readonly unknown[] | undefined; cleanup: (() => void) | undefined };
interface Instance { slots: unknown[]; effects: Effect[]; slot: number; effect: number; pending: { at: number; run: () => void | (() => void) }[]; next: number }
let current: Instance | null = null;
const here = (): Instance => { if (!current) throw new Error('a hook was called outside render()'); return current; };
const same = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) => !!a && !!b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));

/** The stand-ins, to spread over the real module: `vi.mock('react', async (orig) => ({ ...(await orig<object>()), ...hookStandIns }))`. */
export const hookStandIns = {
  useState<T>(init: T | (() => T)) {
    const h = here(); const i = h.slot++;
    if (!(i in h.slots)) h.slots[i] = typeof init === 'function' ? (init as () => T)() : init;
    return [h.slots[i] as T, (v: T | ((old: T) => T)) => { h.slots[i] = typeof v === 'function' ? (v as (old: T) => T)(h.slots[i] as T) : v; }] as const;
  },
  useReducer<S, A>(reducer: (s: S, a: A) => S, init: S) {
    const h = here(); const i = h.slot++;
    if (!(i in h.slots)) h.slots[i] = init;
    return [h.slots[i] as S, (a: A) => { h.slots[i] = reducer(h.slots[i] as S, a); }] as const;
  },
  useRef<T>(init: T) { const h = here(); const i = h.slot++; if (!(i in h.slots)) h.slots[i] = { current: init }; return h.slots[i] as { current: T }; },
  useCallback<T>(fn: T, deps: readonly unknown[]) {
    const h = here(); const i = h.slot++;
    const before = h.slots[i] as { deps: readonly unknown[]; fn: T } | undefined;
    if (before && same(before.deps, deps)) return before.fn;
    h.slots[i] = { deps, fn };
    return fn;
  },
  useId() { const h = here(); return `:test-${h.next++}:`; },
  useEffect(run: () => void | (() => void), deps?: readonly unknown[]) {
    const h = here(); const at = h.effect++;
    const before = h.effects[at];
    if (!before || !same(before.deps, deps)) { h.effects[at] = { deps, cleanup: before?.cleanup }; h.pending.push({ at, run }); }
  },
};

/** One mounted component: `render()` calls it (with the state so far) and returns its element; `flush()` runs the effects that render() queued (after the cleanup of the ones they replace); `unmount()` runs every cleanup. */
export function mount<P, R>(component: (props: P) => R, props: P) {
  const h: Instance = { slots: [], effects: [], slot: 0, effect: 0, pending: [], next: 0 };
  return {
    render(): R { current = h; h.slot = 0; h.effect = 0; h.next = 0; try { return component(props); } finally { current = null; } },
    flush() { const todo = h.pending; h.pending = []; for (const { at, run } of todo) { const e = h.effects[at]!; e.cleanup?.(); const back = run(); e.cleanup = typeof back === 'function' ? back : undefined; } },
    unmount() { for (const e of h.effects) { e.cleanup?.(); e.cleanup = undefined; } },
  };
}
/** Lets every promise that is already settled run its handlers (and the ones those start). */
export const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

/** Every element of a rendered tree (as returned by `render()`) that `pick` accepts, found through `props.children`. Components that were not called are not entered. */
export type Found = { type: unknown; props: Record<string, unknown> };
export function findAll(node: unknown, pick: (e: Found) => boolean): Found[] {
  if (Array.isArray(node)) return node.flatMap((n) => findAll(n, pick));
  if (typeof node !== 'object' || node === null || !('props' in node)) return [];
  const e = node as Found;
  return [...(pick(e) ? [e] : []), ...findAll(e.props.children, pick)];
}
/** The text inside an element, joined. */
export const textOf = (node: unknown): string => (typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(textOf).join('') : typeof node === 'object' && node !== null && 'props' in node ? textOf((node as Found).props.children) : '');
