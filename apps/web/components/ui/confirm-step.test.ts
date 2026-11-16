import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { a11yProblems } from '../../test-support/a11y';
import { findAll, mount, textOf, type Found } from '../hook-shim';
import { ItemPurchases } from '../purchases/ItemPurchases';
import { ItemForm } from '../wardrobe/ItemForm';
import { ConfirmStep } from './ConfirmStep';

// WO-0125: the in-page confirmation that replaces window.confirm. Keyboard and cancel paths are run on the component function with hook stand-ins (no browser in these tests).
vi.mock('react', async (orig) => ({ ...(await orig<object>()), ...(await import('../hook-shim')).hookStandIns }));
const { push, remove, removePurchase } = vi.hoisted(() => ({ push: vi.fn(), remove: vi.fn(async () => undefined), removePurchase: vi.fn(async () => undefined) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
const ITEM = { id: 'i1', name: 'Shirt', category: 'Tops', subType: 'Shirt', hex: '#336699', fit: null, pattern: null, material: null, seasons: [], occasions: [], favourite: false, neverWorn: false, condition: null, status: 'active', archiveReason: null, photoId: null };
const PURCHASE = { id: 'p1', itemId: 'i1', date: '2026-11-01', store: null, price: 10, currency: 'USD', quantity: 1, notes: null, createdAt: '', itemName: 'Shirt', category: null, brand: null };
vi.mock('../use-repository', () => ({
  useRepository: () => ({ items: { get: async () => ITEM, remove }, purchases: { forItem: async () => [PURCHASE], remove: removePurchase }, catalogue: {} }),
}));
vi.mock('../purchases/use-prices', () => ({ usePrices: () => ({ currency: 'USD', rates: null }) }));
afterEach(() => { push.mockClear(); remove.mockClear(); removePurchase.mockClear(); vi.unstubAllGlobals(); });

const props = () => ({ label: 'Confirm deleting this thing', question: 'Delete this thing?', confirmLabel: 'Delete thing', onConfirm: vi.fn(), onCancel: vi.fn() });
const button = (el: unknown, name: string) => findAll(el, (e) => e.type === 'button' && textOf(e) === name)[0]!;
const key = (e: Found, k: string) => { const ev = { key: k, preventDefault: vi.fn(), stopPropagation: vi.fn() }; (e.props.onKeyDown as (x: unknown) => void)(ev); return ev; };

describe('ConfirmStep', () => {
  it('is a labelled group with the question, a red confirm button and Cancel, and no accessibility problem', () => {
    const c = mount(ConfirmStep, props());
    const el = c.render();
    const page = renderToStaticMarkup(el as ReactElement);
    expect(page).toContain('role="group" aria-label="Confirm deleting this thing"');
    expect(page).toContain('Delete this thing?');
    expect(page).toMatch(/<button type="button" class="danger">Delete thing<\/button>/);
    expect(a11yProblems(page)).toEqual([]);
    expect(findAll(el, (e) => e.type === 'button' && e.props.className === 'danger')).toHaveLength(1);
  });
  it('nothing happens until the red button is pressed; pressing it confirms once and does not cancel', () => {
    const p = props();
    const el = mount(ConfirmStep, p).render();
    expect(p.onConfirm).not.toHaveBeenCalled();
    (button(el, 'Delete thing').props.onClick as () => void)();
    expect(p.onConfirm).toHaveBeenCalledTimes(1);
    expect(p.onCancel).not.toHaveBeenCalled();
  });
  it('Cancel cancels and does not confirm', () => {
    const p = props();
    (button(mount(ConfirmStep, p).render(), 'Cancel').props.onClick as () => void)();
    expect(p.onCancel).toHaveBeenCalledTimes(1);
    expect(p.onConfirm).not.toHaveBeenCalled();
  });
  it('Escape anywhere in the step cancels (and is not passed on to the page); other keys do nothing', () => {
    const p = props();
    const root = findAll(mount(ConfirmStep, p).render(), (e) => e.props.role === 'group')[0]!;
    for (const k of ['Enter', ' ', 'Tab', 'a']) key(root, k);
    expect(p.onCancel).not.toHaveBeenCalled();
    expect(p.onConfirm).not.toHaveBeenCalled();
    const ev = key(root, 'Escape');
    expect(p.onCancel).toHaveBeenCalledTimes(1);
    expect(ev.stopPropagation).toHaveBeenCalled();
    expect(p.onConfirm).not.toHaveBeenCalled();
  });
  it('focus moves to Cancel when the step opens, the question is read with it, and focus goes back to the opener when it closes', () => {
    const opener = { focus: vi.fn() };
    vi.stubGlobal('HTMLElement', class {});
    vi.stubGlobal('document', { activeElement: Object.assign(new (globalThis as unknown as { HTMLElement: new () => object }).HTMLElement(), opener) });
    const c = mount(ConfirmStep, props());
    const cancel = button(c.render(), 'Cancel');
    const ref = cancel.props.ref as { current: { focus: () => void } | null };
    ref.current = { focus: vi.fn() };
    c.flush();
    expect(ref.current.focus).toHaveBeenCalledTimes(1);
    expect(opener.focus).not.toHaveBeenCalled();
    const said = cancel.props['aria-describedby'];
    expect(findAll(c.render(), (e) => e.props.id === said)[0] && textOf(findAll(c.render(), (e) => e.props.id === said)[0])).toBe('Delete this thing?');
    c.unmount();
    expect(opener.focus).toHaveBeenCalledTimes(1);
  });
});

const flushAll = async (c: ReturnType<typeof mount>) => { c.render(); c.flush(); for (let i = 0; i < 10; i++) await Promise.resolve(); c.render(); c.flush(); for (let i = 0; i < 10; i++) await Promise.resolve(); };
const steps = (el: unknown) => findAll(el, (e) => e.type === ConfirmStep);

describe('Delete item (ItemForm): two presses, a cancel path, and no browser dialog', () => {
  it('the first press only opens the step; Cancel closes it with nothing deleted; Delete item permanently deletes and goes home', async () => {
    const c = mount(ItemForm, { itemId: 'i1' });
    await flushAll(c);
    expect(steps(c.render())).toHaveLength(0);
    (button(c.render(), 'Delete item').props.onClick as () => void)();
    const open = steps(c.render());
    expect(open).toHaveLength(1);
    expect(open[0]!.props.question).toBe('Delete this item permanently?');
    expect(remove).not.toHaveBeenCalled();
    (open[0]!.props.onCancel as () => void)();
    expect(steps(c.render())).toHaveLength(0);
    expect(remove).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    (button(c.render(), 'Delete item').props.onClick as () => void)();
    (steps(c.render())[0]!.props.onConfirm as () => void)();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(remove).toHaveBeenCalledWith('i1');
    expect(push).toHaveBeenCalledWith('/');
    expect(steps(c.render())).toHaveLength(0);
  });
});

describe('Delete a purchase (ItemPurchases): two presses, a cancel path, and no browser dialog', () => {
  it('the first press opens the step under that purchase; Cancel closes it; the confirm button deletes it', async () => {
    const c = mount(ItemPurchases, { itemId: 'i1' });
    await flushAll(c);
    expect(steps(c.render())).toHaveLength(0);
    const focus = vi.fn();
    (findAll(c.render(), (e) => e.type === 'h2')[0]!.props.ref as { current: unknown }).current = { focus };
    const del = () => findAll(c.render(), (e) => e.type === 'button' && e.props['aria-label'] === 'Delete the purchase of 2026-11-01')[0]!;
    (del().props.onClick as () => void)();
    const open = steps(c.render());
    expect(open).toHaveLength(1);
    expect(open[0]!.props.question).toBe('Delete this purchase?');
    expect(del()).toBeDefined();   // the opener stays on the page, so focus has somewhere to return to
    (open[0]!.props.onCancel as () => void)();
    expect(steps(c.render())).toHaveLength(0);
    expect(removePurchase).not.toHaveBeenCalled();
    (del().props.onClick as () => void)();
    (steps(c.render())[0]!.props.onConfirm as () => void)();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(removePurchase).toHaveBeenCalledWith('p1');
    expect(focus).toHaveBeenCalledTimes(1);   // the row's own Delete button is gone: focus goes to the section heading, which can take focus
    expect(steps(c.render())).toHaveLength(0);
  });
});
