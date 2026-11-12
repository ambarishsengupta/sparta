/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseMarkdown, sectionParagraphs, type Inline } from '../../lib/markdown';

/** The pilot documents live in legal/ at the root of the repository (the pages show them; they are never copied or edited here). */
export const LEGAL_FILES = { privacy: 'PRIVACY-POLICY.md', terms: 'TERMS-OF-USE.md' } as const;
export type LegalDocument = keyof typeof LEGAL_FILES;

/** The legal/ folder, found by walking up from the working directory: the app folder during `next build` and `next start`, the repository root in tests. */
export function legalDir(from: string = process.cwd()): string {
  let dir = from;
  for (let step = 0; step < 6; step++) {
    const candidate = join(dir, 'legal');
    if (existsSync(join(candidate, LEGAL_FILES.privacy))) return candidate;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error('the legal/ folder was not found above the app folder');
}

export const readLegal = (which: LegalDocument): string => readFileSync(join(legalDir(), LEGAL_FILES[which]), 'utf8');
/** WO-0103: the Vendor Pilot Agreement, shown read-only on /vendor/agreement (it is not a document of the consumer sign-up, so it is not in LEGAL_FILES). */
export const VENDOR_AGREEMENT_FILE = 'VENDOR-PILOT-AGREEMENT.md';
export const readVendorAgreement = (): string => readFileSync(join(legalDir(), VENDOR_AGREEMENT_FILE), 'utf8');

/** Section 7 of the Privacy Policy, the paragraph that starts "When the pilot ends": the plan for the end of the pilot (FR-67, FR-69). Empty if the section changed. */
export function endOfPilotPlan(privacyMarkdown: string): Inline[] {
  const found = sectionParagraphs(parseMarkdown(privacyMarkdown), '7. How long we keep it');
  return found.find((p) => p[0]?.t === 'strong' && p[0].children[0]?.t === 'text' && p[0].children[0].text.startsWith('When the pilot ends')) ?? [];
}
