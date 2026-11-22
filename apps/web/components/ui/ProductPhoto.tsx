'use client';
import { useState } from 'react';
import type { ReactNode } from 'react';

export type PhotoSize = 'thumb' | 'card' | 'hero';

/**
 * The one component that shows an item's picture: the H&M product photograph of an item of the `hm-demo` source, from the same-origin route `/hm-image/<10 digits>`.
 * With no id, an id that is not 10 digits, or a photograph that fails to load (route off, file missing), it shows a plain neutral tile that says "No photo yet".
 * Nothing is drawn in its place: no illustration, no colour fill.
 */
export function ProductPhoto({ id, name, src, size }: { id: string | null | undefined; name: string; /** A picture stored in this browser (a data URL, no-login demo only): shown instead of `/hm-image/<id>`. */ src?: string | undefined; /** With a size the photo sits in a fixed 3:4 box on the paper background, never cropped or stretched: `thumb` is 40 by 53 px, `card` and `hero` fill the width of their parent. Without one, the picture fills whatever box the caller made. */ size?: PhotoSize | undefined; /** Accepted so older callers compile; never shown (no drawing stands in for a missing photo). */ children?: ReactNode }) {
  const [failed, setFailed] = useState(false);
  const own = src !== undefined && src.startsWith('data:image/') ? src : null;
  const inner = failed || (!own && (!id || !/^[0-9]{10}$/.test(id)))
    ? <span className="no-photo" role="img" aria-label={`No photo yet for ${name}`}><span aria-hidden="true">No photo yet</span></span>
    : <img className="photo" src={own ?? `/hm-image/${id}`} alt={name} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
  return size ? <span className={`pp pp-${size}`}>{inner}</span> : inner;
}
