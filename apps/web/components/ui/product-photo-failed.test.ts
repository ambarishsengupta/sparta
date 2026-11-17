import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProductPhoto } from './ProductPhoto';

// The state after the photograph failed to load (the route is off or the file is missing): `failed` is true, so the illustration is drawn instead of the picture.
vi.mock('react', async (original) => ({ ...(await original<typeof import('react')>()), useState: () => [true, () => undefined] }));

describe('ProductPhoto after a load failure (WO-0121)', () => {
  it('draws its children, the tinted illustration, and no <img>', () => {
    expect(renderToStaticMarkup(createElement(ProductPhoto, { id: '0990000001', name: 'n', children: createElement('svg') }))).toBe('<svg></svg>');
  });
});
