import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ItemForm } from './ItemForm';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }) }));
afterEach(() => vi.unstubAllEnvs());

// WO-0183 (FR-16): the button is offered for both backends; the account backend deletes through the server route (the database grants no delete on items, LLD 4.6).
const html = (id?: string) => renderToStaticMarkup(createElement(ItemForm, id ? { itemId: id } : {}));
describe('the Delete item button', () => {
  it('is shown when editing an item with the browser-local backend (the default)', () => {
    vi.stubEnv('NEXT_PUBLIC_DATA_BACKEND', '');
    expect(html('item-1')).toContain('Delete item');
    vi.stubEnv('NEXT_PUBLIC_DATA_BACKEND', 'local');
    expect(html('item-1')).toContain('Delete item');
  });
  it('is shown with the Supabase backend too, on an existing item', () => {
    vi.stubEnv('NEXT_PUBLIC_DATA_BACKEND', 'supabase');
    const out = html('item-1');
    expect(out).toContain('Delete item');
    expect(out).toContain('Save item'); // the rest of the form is unchanged
  });
  it('is never shown on the new-item form', () => {
    for (const b of ['local', 'supabase']) { vi.stubEnv('NEXT_PUBLIC_DATA_BACKEND', b); expect(html()).not.toContain('Delete item'); }
  });
});
