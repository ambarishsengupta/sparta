'use client';
import { useState } from 'react';
import type { ReactNode } from 'react';

/**
 * The one component that shows an item's picture: the H&M product photograph of an item of the `hm-demo` source, from the same-origin route `/hm-image/<10 digits>`.
 * With no id, an id that is not 10 digits, or a photograph that fails to load (route off, file missing), it shows a plain neutral tile that says "No photo yet".
 * Nothing is drawn in its place: no illustration, no colour fill.
 */
export function ProductPhoto({ id, name }: { id: string | null | undefined; name: string; /** Accepted so older callers compile; never shown (no drawing stands in for a missing photo). */ children?: ReactNode }) {
  const [failed, setFailed] = useState(false);
  if (!id || failed || !/^[0-9]{10}$/.test(id)) return <span className="no-photo" role="img" aria-label={`No photo yet for ${name}`}><span aria-hidden="true">No photo yet</span></span>;
  return <img className="photo" src={`/hm-image/${id}`} alt={name} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}
