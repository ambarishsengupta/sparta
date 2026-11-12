/// <reference types="node" />
/** Values the team sets for the deployment (FR-67). Both are public, set at build time, and empty by default: the About page then says so. */
const EMAIL = /^[^\s@<>"'\\]+@[^\s@<>"'\\]+\.[^\s@<>"'\\]+$/;

/** The sentence shown where the privacy contact address would be when the build has none (the About page and the vendor Account page say the same). */
export const CONTACT_NOT_SET = 'The privacy contact address is not configured in this build, so it cannot be shown here. Ask the person who invited you.';

/** The privacy contact address (NEXT_PUBLIC_CONTACT_EMAIL), or null when it is empty or not an email address. */
export function contactEmail(): string | null {
  const value = (process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? '').trim();
  return value.length <= 254 && EMAIL.test(value) ? value : null;
}

/** The hosting region (NEXT_PUBLIC_HOSTING_REGION) as plain text, or null when it is empty. */
export function hostingRegion(): string | null {
  const value = [...(process.env.NEXT_PUBLIC_HOSTING_REGION ?? '')].filter((c) => c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) !== 0x7f).join('').trim();
  return value === '' ? null : value.slice(0, 100);
}
