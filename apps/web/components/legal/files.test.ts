/// <reference types="node" />
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { textOf } from '../../lib/markdown';
import { LEGAL_FILES, endOfPilotPlan, legalDir, readLegal } from './files';

const repoLegal = (name: string) => readFileSync(new URL(`../../../../legal/${name}`, import.meta.url), 'utf8');

describe('finding legal/ (the build runs in apps/web, the tests at the repository root)', () => {
  it('finds it from the repository root, from apps/web and from a folder below it', () => {
    const root = new URL('../../../..', import.meta.url).pathname;
    const expected = join(root, 'legal').replace(/\/$/, '');
    for (const from of [root, join(root, 'apps/web'), join(root, 'apps/web/app/privacy')]) expect(legalDir(from).replace(/\/$/, '')).toBe(expected);
  });
  it('refuses with a clear error when there is no legal/ folder above', () => {
    const dir = mkdtempSync(join(tmpdir(), 'no-legal-'));
    try { expect(() => legalDir(dir)).toThrow('legal/ folder was not found'); } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('a folder named legal/ that lacks the Privacy Policy is not taken for it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wrong-legal-'));
    try { mkdirSync(join(dir, 'legal')); writeFileSync(join(dir, 'legal', 'OTHER.md'), 'x'); expect(() => legalDir(dir)).toThrow(); } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('reads the two real files, byte for byte', () => {
    expect(readLegal('privacy')).toBe(repoLegal('PRIVACY-POLICY.md'));
    expect(readLegal('terms')).toBe(repoLegal('TERMS-OF-USE.md'));
    expect(LEGAL_FILES).toEqual({ privacy: 'PRIVACY-POLICY.md', terms: 'TERMS-OF-USE.md' });
  });
});

describe('the plan for the end of the pilot (FR-67, FR-69): Privacy Policy section 7', () => {
  it('is the paragraph that starts "When the pilot ends" in the real file', () => {
    const plan = textOf(endOfPilotPlan(readLegal('privacy')));
    expect(plan).toMatch(/^When the pilot ends \(planned after 3 months\), we will tell you and you can export your data\./);
    expect(plan).toContain('close the pilot and delete all participants');
  });
  it('is empty, not a guess, when the section or the paragraph is gone or renamed', () => {
    expect(endOfPilotPlan('## 7. How long we keep it\n\nNothing here.')).toEqual([]);
    expect(endOfPilotPlan('## 8. Elsewhere\n\n**When the pilot ends** we stop.')).toEqual([]);
    expect(endOfPilotPlan('')).toEqual([]);
    expect(endOfPilotPlan(readLegal('privacy').replace('## 7. How long we keep it', '## 7. Retention'))).toEqual([]);
  });
  it('does not take the paragraph of another section', () => {
    expect(endOfPilotPlan('## 7. How long we keep it\n\nx\n\n## 8. Rights\n\n**When the pilot ends** nothing.')).toEqual([]);
  });
});
