/// <reference types="node" />
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { headingsOf, parseHeading, parseItem, parseMarkdown, stripClosingHashes, textOf, type Block, type Inline } from '../../lib/markdown';

// WO-0062 items 4 and 6 (F4, A19, A21): the reader never takes long, whatever it is given; the closing-mark and budget rules are pinned by behaviour.
const here = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');
const ms = (source: string): number => { const t = performance.now(); parseMarkdown(source); return performance.now() - t; };
const N = 199_000; // just under MAX_SOURCE (200,000)
const LS = '\u2028';

describe('renderer time (F4): the worst inputs for each pattern in the reader', () => {
  // Before the fix, the first took 38 seconds, the LS lines 4 to 10 seconds. Limit: 200 ms (they take 1 to 10).
  it.each([
    ['a heading, a word, 199,000 spaces, a word (closing-hash pattern)', '# a' + ' '.repeat(N) + 'b'],
    ['a heading, a word, 199,000 tabs, a word', '# a' + '\t'.repeat(N / 4) + 'b'],
    ['a heading of spaces and hashes', '# a' + ' #'.repeat(90_000) + 'x'],
    ['a heading, then 199,000 closing hashes and a letter', '# a ' + '#'.repeat(N) + 'x'],
    ['a heading, then 199,000 closing hashes', '# a ' + '#'.repeat(N)],
    ['a hash and 199,000 spaces and a word', '#' + ' '.repeat(N) + 'text'],
    ['a heading with a long run of spaces, then a line separator inside', '# ' + ' '.repeat(100_000) + 'a' + LS + 'b'],
    ['a heading with a long run of spaces, then a paragraph separator inside', '# ' + ' '.repeat(100_000) + 'a\u2029b'],
    ['a bullet with a long run of spaces, then a line separator', '- ' + ' '.repeat(100_000) + 'a' + LS + 'b'],
    ['a numbered item with a long run of tabs, then a line separator', '1.' + '\t'.repeat(40_000) + 'a' + LS + 'b'],
    ['a block quote with a long run of spaces, then a line separator', '> ' + ' '.repeat(100_000) + 'a' + LS + 'b'],
    ['a rule marker with 199,000 dashes and a letter', '-'.repeat(N) + 'x'],
    ['a rule marker, 199,000 spaces, a letter', '---' + ' '.repeat(N) + 'x'],
    ['a heading of dashes (the id is built from it)', '# ' + '-'.repeat(N) + 'a'],
    ['a heading of 199,000 characters that are not letters', '# ' + '!?'.repeat(N / 2) + 'a'],
    ['the same heading again and again (ids)', '# same\n'.repeat(20_000)],
    ['a table separator row of dashes', '| a |\n| ' + '-'.repeat(N / 2) + ' |'],
    ['an address made of dots and slashes', '[a](' + '../'.repeat(600) + 'x)'],
    ['an address that looks like a file name', '[a](' + 'a-'.repeat(900) + 'x)'],
    ['a long run of backslashes and brackets', '\\['.repeat(N / 2)],
  ])('%s', (_label, source) => {
    expect(source.length).toBeLessThanOrEqual(200_000);
    expect(ms(source)).toBeLessThan(200);
  });
  it('a document of many such lines is also fast', () => {
    const lines = Array.from({ length: 400 }, (_, i) => `# h${i}` + ' '.repeat(400) + `x${i} ` + '#'.repeat(10)).join('\n');
    expect(ms(lines)).toBeLessThan(200);
  });
  it('regular expressions in the reader: none has a repeated group, and none follows a run of white space with a pattern that also matches white space', () => {
    // Checked by hand (see NOTES): safeHref x3, the escape test, slugify x2, RULE, QUOTE, isSeparator, the ordered-item digit test, `/^[ \t]{2,}\S/`, the line splitters. The
    // only repeated group is the optional run of `./` and `../` in safeHref, which is anchored, deterministic and applied to at most 2,000 characters.
    const source = here('../../lib/markdown.ts') + here('./Markdown.tsx') + here('./files.ts');
    const literals = [...source.matchAll(/(?<![\w)\]'"`])\/(?![/*])((?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n[])+)\/[dgimsuy]*/g)].map((m) => m[1]!);
    expect(literals.length).toBeGreaterThan(15);
    const repeatedGroups = literals.filter((r) => /\)[*+]|\)\{\d*,\d*\}/.test(r));
    expect(repeatedGroups).toEqual(['^(?:\\.{1,2}\\/)*([A-Za-z0-9-]+\\.md)(#[A-Za-z0-9_-]*)?$']);
    expect(literals.filter((r) => /\\s\+\(\.[+*]\)|\[ \\t\]\+\(\.[+*]\)/.test(r))).toEqual([]);
    expect(literals.some((r) => r.includes('#+$'))).toBe(false); // the quadratic closing-hash pattern is gone
  });
});

describe('the heading, item and closing-hash readers mean what the patterns meant (property)', () => {
  const OLD_HEADING = /^(#{1,6})\s+(.+)$/;
  const OLD_ITEM = /^ {0,3}([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
  const oldStrip = (t: string): string => t.replace(/[ \t]+#+$/, '').trim();
  const piece = fc.constantFrom('#', '#', ' ', ' ', '\t', '-', '*', '+', '1', '2', '.', ')', 'a', 'b', 'C', LS, '\u2029', '\u00a0', '\u3000', '|');
  const text = fc.array(piece, { maxLength: 14 }).map((xs) => xs.join(''));
  it('parseHeading', () => fc.assert(fc.property(text, (raw) => {
    const line = raw.trim();
    const old = OLD_HEADING.exec(line);
    const now = parseHeading(line);
    return old ? now !== null && now.level === old[1]!.length && now.text === old[2] : now === null;
  }), { numRuns: 20_000 }));
  it('parseItem', () => fc.assert(fc.property(text, (line) => {
    const old = OLD_ITEM.exec(line);
    const now = parseItem(line);
    return old ? now !== null && now.marker === old[1] && now.text === old[2] : now === null;
  }), { numRuns: 20_000 }));
  it('stripClosingHashes', () => fc.assert(fc.property(text, (t) => stripClosingHashes(t) === oldStrip(t)), { numRuns: 20_000 }));
  it('and on the long inputs of the sweep above, for as far as the old pattern can still answer', () => {
    const sample = '# a' + ' '.repeat(2000) + 'b ' + '#'.repeat(30);
    expect(headingsOf(parseMarkdown(sample))).toEqual(['a' + ' '.repeat(2000) + 'b']);
    expect(stripClosingHashes('a' + ' '.repeat(2000) + 'b ' + '#'.repeat(30))).toBe(oldStrip('a' + ' '.repeat(2000) + 'b ' + '#'.repeat(30)));
  });
});

describe('closing hashes of a heading (A21)', () => {
  const heading = (source: string): string[] => headingsOf(parseMarkdown(source));
  it.each([
    ['# Title #', 'Title'], ['# Title ##', 'Title'], ['## Title ##########', 'Title'], ['### Title \t ###', 'Title'], ['# Title    #   ', 'Title'],
    ['# C#', 'C#'], ['# C##', 'C##'], ['## Use C# ##', 'Use C#'], ['# a#b', 'a#b'], ['# a #b', 'a #b'], ['# #', '#'], ['# ##', '##'], ['# Title', 'Title'], ['# Two # words', 'Two # words'],
  ])('%j reads as the heading %j', (source, expected) => { expect(heading(source)).toEqual([expected]); });
  it('the ids are built from the text without the closing hashes', () => {
    const [h] = parseMarkdown('## Retention ##') as Extract<Block, { t: 'heading' }>[];
    expect(h!.id).toBe('doc-retention');
    expect(h!.level).toBe(2);
  });
  it('seven hashes are not a heading; a hash with no space after it is not a heading', () => {
    expect(heading('####### x')).toEqual([]);
    expect(heading('#x')).toEqual([]);
  });
});

describe('the work budget (A19): link candidates share one budget for the whole document', () => {
  const links = (nodes: Block[]): string[] => {
    const out: string[] = [];
    const walk = (xs: Inline[]) => xs.forEach((n) => { if (n.t === 'link') out.push(n.href); if (n.t !== 'text') walk(n.children); });
    nodes.forEach((b) => { if (b.t === 'p' || b.t === 'heading') walk(b.children); });
    return out;
  };
  const doc = (candidates: number) => parseMarkdown('[a](x'.repeat(candidates) + ' [ok](/privacy)');
  it('a link is found after a few unfinished ones (the control: the test is not about links being refused)', () => {
    expect(links(doc(100))).toEqual(['/privacy']);
    expect(links(parseMarkdown('[ok](/privacy)'))).toEqual(['/privacy']);
  });
  it('after thousands of unfinished link addresses, each of which makes the reader look 2,000 characters ahead, the budget is spent and the last link is plain text', () => {
    // 3,000 candidates x (300 for the label + 2,000 for the address) is 6.9 million units against a budget of 3 million; without the address scan spending the budget it would be 0.9 million.
    const blocks = doc(3_000);
    expect(links(blocks)).toEqual([]);
    expect(textOf((blocks[0] as Extract<Block, { t: 'p' }>).children)).toContain('[ok](/privacy)');
  });
  it('the budget is per document: the next document starts afresh', () => {
    doc(3_000);
    expect(links(doc(100))).toEqual(['/privacy']);
  });
  it('and the scans are quick', () => { expect(ms('[a](x'.repeat(3_000) + ' [ok](/privacy)')).toBeLessThan(200); });
});

describe('the work budget also covers emphasis look-aheads, and numbers have at most nine digits', () => {
  const emphasised = (blocks: Block[]): string[] => {
    const out: string[] = [];
    const walk = (xs: Inline[]) => xs.forEach((n) => { if (n.t === 'em') out.push(textOf(n.children)); if (n.t !== 'text') walk(n.children); });
    blocks.forEach((b) => { if (b.t === 'p') walk(b.children); });
    return out;
  };
  it('after 4,000 unfinished star words (each looks 1,000 characters ahead: 4 million units against 3 million) the last emphasis stays as typed; after 100 it is found', () => {
    expect(emphasised(parseMarkdown('*a '.repeat(100) + ' *ok*'))).toEqual(['ok']);
    const blocks = parseMarkdown('*a '.repeat(4_000) + ' *ok*');
    expect(emphasised(blocks)).toEqual([]);
    expect(textOf((blocks[0] as Extract<Block, { t: 'p' }>).children)).toContain('*ok*');
  });
  it('a list marker of ten digits is not a list; nine digits is', () => {
    expect(parseItem('123456789. x')).toEqual({ marker: '123456789.', text: 'x' });
    expect(parseItem('1234567890. x')).toBeNull();
    expect(parseMarkdown('1234567890. x')[0]!.t).toBe('p');
    expect(parseMarkdown('123456789. x')[0]!.t).toBe('list');
  });
});
