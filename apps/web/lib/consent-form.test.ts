import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NOT_OPEN_MESSAGE, NOTICE_LINKS, NOTICE_PARAGRAPHS, NOTICE_TITLE, pieces, SHARING_LOCKED_TEXT, validateAcceptance } from './consent-form';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('the notice text is the text of the Privacy Policy section 13 (no invented legal wording)', () => {
  const policy = read('../../../legal/PRIVACY-POLICY.md');
  const section = policy.slice(policy.indexOf('## 13.'));
  const quoted = section.split('\n').filter((l) => l.startsWith('>')).map((l) => l.replace(/^>\s?/, ''));
  const blocks = quoted.join('\n').split(/\n\n/).map((b) => b.trim()).filter(Boolean);
  it('finds the five blocks of the quotation: title, three paragraphs, buttons', () => { expect(blocks).toHaveLength(5); });
  it('the title is the bold first line', () => { expect(blocks[0]).toBe(`**${NOTICE_TITLE}**`); });
  it('the three paragraphs are equal to the file, character for character', () => { expect(NOTICE_PARAGRAPHS).toEqual(blocks.slice(1, 4)); });
  it('the buttons are "I understand and join the pilot" and "No thanks"', () => {
    expect(blocks[4]).toBe('[ I understand and join the pilot ]   [ No thanks ]');
    expect(read('../components/consent/PilotNoticeForm.tsx')).toContain('I understand and join the pilot');
    expect(read('../app/(auth)/pilot-notice/page.tsx')).toContain('No thanks');
  });
  it('every link in the notice has a target page', () => {
    const labels = NOTICE_PARAGRAPHS.flatMap(pieces).filter((p) => p.kind === 'link').map((p) => p.text);
    expect(labels).toEqual(['Privacy Policy', 'Terms of Use']);
    expect(Object.keys(NOTICE_LINKS).sort()).toEqual([...labels].sort());
  });
  it('FR-61 and FR-9 wording is the wording of the FDD', () => {
    const fdd = read('../../../docs/FDD.md');
    expect(fdd).toContain(`"${SHARING_LOCKED_TEXT}"`);
    expect(fdd).toContain(`"${NOT_OPEN_MESSAGE}"`);
  });
});

describe('pieces', () => {
  it('splits bold text and link labels from plain text and keeps every character', () => {
    expect(pieces('a **b** c [d] e')).toEqual([
      { kind: 'text', text: 'a ' }, { kind: 'bold', text: 'b' }, { kind: 'text', text: ' c ' }, { kind: 'link', text: 'd' }, { kind: 'text', text: ' e' },
    ]);
    expect(pieces('plain')).toEqual([{ kind: 'text', text: 'plain' }]);
    expect(pieces('')).toEqual([]);
  });
  it('rebuilding the paragraphs from their pieces gives the paragraphs back', () => {
    for (const p of NOTICE_PARAGRAPHS) expect(pieces(p).map((x) => (x.kind === 'bold' ? `**${x.text}**` : x.kind === 'link' ? `[${x.text}]` : x.text)).join('')).toBe(p);
  });
});

describe('validateAcceptance (FR-2, FR-68)', () => {
  it.each([
    [true, true, {}],
    [false, true, { age: 'Confirm that you are 18 or over to continue.' }],
    [true, false, { agree: 'Tick the box to agree to the Terms of Use and the Privacy Policy.' }],
    [false, false, { age: 'Confirm that you are 18 or over to continue.', agree: 'Tick the box to agree to the Terms of Use and the Privacy Policy.' }],
  ])('age %s, agree %s', (age, agree, expected) => { expect(validateAcceptance(age, agree)).toEqual(expected); });
});
