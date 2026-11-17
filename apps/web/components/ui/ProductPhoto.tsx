'use client';
import { useState } from 'react';
import type { ReactNode } from 'react';

/**
 * WO-0121 (local demo only): the H&M product photograph of an item of the `hm-demo` source, from the same-origin route `/hm-image/<10 digits>`.
 * With no id, an id that is not 10 digits, or a photograph that fails to load (route off, file missing), it shows its children: the tinted illustration.
 */
export function ProductPhoto({ id, name, children }: { id: string | null | undefined; name: string; children: ReactNode }) {
  const [failed, setFailed] = useState(false);
  if (!id || failed || !/^[0-9]{10}$/.test(id)) return <>{children}</>;
  const photoSrc = `/hm-image/${id}`;
  return <img className="photo" src={photoSrc} alt={name} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}
