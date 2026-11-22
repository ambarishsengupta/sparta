import type { ReactNode } from 'react';
import { DEMO_VENDOR_NAME } from '../../../lib/demo-vendor';
import { ProductPhoto } from '../../ui/ProductPhoto';
import type { Product } from '../../../lib/demo-vendor-retail';

/** The heading block of every screen of the vendor actions: the title, the demo vendor and the "Simulated demo data" line. */
export function ActionsHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <>
      <h1>{title}</h1>
      <p className="muted">{DEMO_VENDOR_NAME}</p>
      <p className="muted">Simulated demo data: no real users or sales.</p>
      {children}
    </>
  );
}

/** A small product photograph (the real H&M photo, or the neutral "No photo yet" tile). */
export function Thumb({ product }: { product: Product }) {
  return <span className="thumb vd-mini"><ProductPhoto id={product.articleId} name={product.name} /></span>;
}
