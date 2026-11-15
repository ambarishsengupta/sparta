/// <reference types="node" />
import { resolve, sep } from 'node:path';

/**
 * THE ONLY MODULE THAT READS `HM_DEMO_IMAGE_ROOT` (WO-0121, local demo only).
 *
 * The variable names the local H&M folder (the one with `images/<first three digits>/<id>.jpg`). It is set by the demo start script in the
 * process environment only. Unset (or empty) means the photograph route is off and answers 404. Nothing from that folder is ever committed.
 */
const ARTICLE_ID = /^[0-9]{10}$/;

const imageRoot = (): string | null => {
  const root = process.env.HM_DEMO_IMAGE_ROOT;
  return root ? resolve(root) : null;
};

/** True when the demo photograph route is switched on. */
export const hmImageEnabled = (): boolean => imageRoot() !== null;

/** `<root>/images/<first three digits>/<id>.jpg` for a 10-digit article id, or null when the route is off, the id is not 10 digits, or the path would leave the root. */
export function hmImagePath(id: string): string | null {
  const root = imageRoot();
  if (root === null || !ARTICLE_ID.test(id)) return null;
  const file = resolve(root, 'images', id.slice(0, 3), `${id}.jpg`);
  return file.startsWith(root + sep) ? file : null;
}
