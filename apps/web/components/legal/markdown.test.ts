/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_SOURCE, TOO_LONG, headingsOf, parseMarkdown, safeHref, sectionParagraphs, textOf } from '../../lib/markdown';
import { Markdown } from './Markdown';

const html = (source: string): string => renderToStaticMarkup(createElement(Markdown, { source }));
const legal = (name: string): string => readFileSync(new URL(`../../../../legal/${name}`, import.meta.url), 'utf8');
const unescape = (s: string): string => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');

// ---- what the reader makes of ordinary Markdown -----------------------------------------------------------------------
describe('structure', () => {
  it('headings keep their level and get a stable id; repeated headings get different ids', () => {
    const doc = parseMarkdown('# One\n\n## Two words\n\n## Two words\n\n###### Six');
    expect(doc.map((b) => b.t === 'heading' && [b.level, b.id])).toEqual([[1, 'doc-one'], [2, 'doc-two-words'], [2, 'doc-two-words-2'], [6, 'doc-six']]);
    expect(html('## 7. How long we keep it')).toContain('<h2 id="doc-7-how-long-we-keep-it">7. How long we keep it</h2>');
  });
  it('lines of one paragraph are joined; a blank line starts a new paragraph', () => {
    expect(html('one\ntwo\n\nthree')).toBe('<p>one two</p><p>three</p>');
  });
  it('lists: bullets and numbers are separate kinds, a blank line between items keeps one list, an indented line continues an item', () => {
    expect(html('- a\n- b\n  more\n\n- c')).toBe('<ul><li>a</li><li>b more</li><li>c</li></ul>');
    expect(html('1. a\n2. b')).toBe('<ol><li>a</li><li>b</li></ol>');
    expect(html('- a\n\ntext\n\n1. b')).toBe('<ul><li>a</li></ul><p>text</p><ol><li>b</li></ol>');
  });
  it('tables: header cells with scope, body rows padded or cut to the header, an escaped bar stays in its cell', () => {
    const out = html('| A | B |\n| --- | --- |\n| 1 | x \\| y |\n| 2 |\n| 3 | 4 | 5 |');
    expect(out).toBe('<table><thead><tr><th scope="col">A</th><th scope="col">B</th></tr></thead><tbody><tr><td>1</td><td>x | y</td></tr><tr><td>2</td><td></td></tr><tr><td>3</td><td>4</td></tr></tbody></table>');
  });
  it('a bar line without a separator row is a paragraph, not a table', () => { expect(html('a | b\nc | d')).toBe('<p>a | b c | d</p>'); });
  it('block quotes hold blocks; nesting stops after three levels and the rest is text', () => {
    expect(html('> **Hi**\n>\n> there')).toBe('<blockquote><p><strong>Hi</strong></p><p>there</p></blockquote>');
    expect(html('>>>>> deep')).toContain('<blockquote><blockquote><blockquote><p>&gt;&gt; deep</p>');
  });
  it('emphasis, strong, escapes and a rule', () => {
    expect(html('**a** *b* \\*c\\* 2 * 3 * 4\n\n---')).toBe('<p><strong>a</strong> <em>b</em> *c* 2 * 3 * 4</p><hr/>');
    expect(html('**one *two* three**')).toBe('<p><strong>one <em>two</em> three</strong></p>');
    expect(html('**unclosed and *also')).toBe('<p>**unclosed and *also</p>');
  });
  it('links: a site path becomes a link, another site gets rel, a title is dropped, the label may hold emphasis, a link inside a link label is not nested', () => {
    expect(html('[Privacy](/privacy)')).toBe('<p><a href="/privacy">Privacy</a></p>');
    expect(html('[x](https://example.org/a?b=1 "title")')).toBe('<p><a href="https://example.org/a?b=1" rel="noopener noreferrer">x</a></p>');
    expect(html('[**b** c](/x)')).toBe('<p><a href="/x"><strong>b</strong> c</a></p>');
    expect(html('[a [b](/y) c](/x)')).not.toMatch(/<a[^>]*><a/);
  });
  it('the legal files link to each other by file name; those links go to the pages', () => {
    expect(html('[P](PRIVACY-POLICY.md) [T](./TERMS-OF-USE.md#13-contact) [O](OTHER.md)')).toBe('<p><a href="/privacy">P</a> <a href="/terms#13-contact">T</a> <a href="OTHER.md">O</a></p>');
  });
  it('square brackets that are not a link stay as written (the notice in section 13 shows [Privacy Policy])', () => { expect(html('Read [Privacy Policy] now')).toBe('<p>Read [Privacy Policy] now</p>'); });
  it('control characters become the replacement character; CRLF and tabs are read like newlines and spaces', () => {
    expect(html('a\u0000b\r\n\r\nc')).toBe('<p>a�b</p><p>c</p>');
  });
  it('sectionParagraphs returns the paragraphs of one section only', () => {
    const doc = parseMarkdown('## 1. A\n\nx\n\n## 2. B\n\ny\n\nz');
    expect(sectionParagraphs(doc, '2. B').map(textOf)).toEqual(['y', 'z']);
    expect(sectionParagraphs(doc, '9. none')).toEqual([]);
  });
});

// ---- addresses ----------------------------------------------------------------------------------------------------------
const GOOD: [string, string][] = [
  ['https://example.org/a?b=1#c', 'https://example.org/a?b=1#c'], ['http://example.org', 'http://example.org/'], ['HTTPS://EXAMPLE.ORG/x', 'https://example.org/x'], ['/privacy', '/privacy'],
  ['/privacy#doc-7-x', '/privacy#doc-7-x'], ['https:///x', 'https://x/'], ['./x', './x'], ['../x', '../x'], ['#top', '#top'], ['?a=1', '?a=1'], ['page', 'page'], ['PRIVACY-POLICY.md', '/privacy'], ['../TERMS-OF-USE.md', '/terms'],
];
const BAD = [
  '', '   ', 'javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'java\nscript:alert(1)', 'java\u0000script:alert(1)', 'javascript&colon;alert(1)', '&#106;avascript:alert(1)',
  'jav&#x61;script:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)', 'file:///etc/passwd', 'ftp://example.org/x', 'mailto:a@example.org', 'blob:https://example.org/x', 'about:blank',
  'javascript://example.org/%0aalert(1)', 'JAVASCRIPT://x/%0Aalert(1)', 'data://example.org/x', 'file://host/x', 'ws://example.org/', 'ftp://example.org/', 'chrome://settings',
  '//evil.example', '//evil.example/x', '\\\\evil.example', '/\\evil.example', 'https://user:pass@example.org/', 'https://user@example.org/', 'http://', 'http://exa mple.org', '/a:b', 'a;b', '/a(b)', '/%0d%0a:x',
  'https://example.org/"onmouseover="x', 'https://example.org/<script>', 'x:y', 'a:b/c', `https://example.org/${'a'.repeat(3000)}`,
];
describe('safeHref', () => {
  it.each(GOOD)('accepts %j as %j', (raw, expected) => { expect(safeHref(raw)).toBe(expected); });
  it.each(BAD)('refuses %j', (raw) => { expect(safeHref(raw)).toBeNull(); });
});

// ---- hostile input ------------------------------------------------------------------------------------------------------
const TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'blockquote', 'hr', 'strong', 'em', 'a']);
const ATTRS: Record<string, string[]> = { a: ['href', 'rel'], th: ['scope'] };
/** Everything wrong with rendered markup: a tag or attribute outside the list, a '<' outside a tag, an address that leaves the site by anything but http(s). */
function violations(markup: string): string[] {
  const out: string[] = [];
  for (const m of markup.matchAll(/<(\/?)([A-Za-z0-9]+)([^>]*?)(\/?)>/g)) {
    const [, close, tag = '', attrs = ''] = m;
    if (!TAGS.has(tag)) out.push(`tag ${tag}`);
    if (close && attrs.trim() !== '') out.push(`attributes on a closing tag ${tag}`);
    for (const a of attrs.matchAll(/\s([^\s=]+)(?:="([^"]*)")?/g)) {
      const [, name = '', value = ''] = a;
      const allowed = name === 'id' && /^h[1-6]$/.test(tag) ? /^doc-[a-z0-9-]*$/.test(value) : (ATTRS[tag] ?? []).includes(name);
      if (!allowed) out.push(`attribute ${name} on ${tag}`);
      if (name === 'href') {
        const url = new URL(unescape(value), 'https://site.example/dir/');
        if (!['http:', 'https:'].includes(url.protocol)) out.push(`href ${value}`);
        if (!/^https?:/i.test(unescape(value)) && url.origin !== 'https://site.example') out.push(`relative href leaves the site ${value}`);
      }
    }
    if (/\s(on\w+|style|src|srcset|formaction|action)\s*=/i.test(attrs)) out.push(`event or source attribute ${attrs}`);
  }
  if (markup.replace(/<(\/?)([A-Za-z0-9]+)([^>]*?)(\/?)>/g, '').includes('<')) out.push('a raw < outside a tag');
  return out;
}

describe('the checker used below', () => {
  it('finds a script tag, an event attribute, a javascript address, an unknown attribute and a stray <', () => {
    expect(violations('<script>x</script>')).not.toEqual([]);
    expect(violations('<p onclick="x">a</p>')).not.toEqual([]);
    expect(violations('<a href="javascript:alert(1)" rel="noopener noreferrer">a</a>')).not.toEqual([]);
    expect(violations('<a href="//evil.example/x">a</a>')).not.toEqual([]);
    expect(violations('<img src="x"/>')).not.toEqual([]);
    expect(violations('a < b')).not.toEqual([]);
    expect(violations('<p>fine</p><a href="/x">y</a><h2 id="doc-a">z</h2>')).toEqual([]);
  });
});

describe('hostile markdown becomes text, never markup', () => {
  const PAYLOADS = [
    '<script>alert(1)</script>', '<SCRIPT SRC=//evil.example/x.js></SCRIPT>', '<img src=x onerror=alert(1)>', '<IMG SRC="javascript:alert(1)">', '<svg/onload=alert(1)>', '<a href="javascript:alert(1)">x</a>',
    '<div><b onclick="alert(1)">hi</b></div>', '<div><div><div><p style="x">nested</p></div></div></div>', '<iframe src="https://evil.example"></iframe>', '<form action="https://evil.example"><input name=x></form>',
    '<style>body{display:none}</style>', '<meta http-equiv="refresh" content="0;url=https://evil.example">', '<base href="https://evil.example/">', '<object data="x"></object>', '<!-- comment --><p>x</p>',
    '<![CDATA[x]]>', '<?php echo 1; ?>', '</p><script>alert(1)</script><p>', '"><script>alert(1)</script>', "'><img src=x onerror=alert(1)>",
    '[x](javascript:alert(1))', '[x](JAVASCRIPT:alert(1))', '[x]( javascript:alert(1))', '[x](java\tscript:alert(1))', '[x](&#106;avascript:alert(1))', '[x](jav&#x61;script:alert(1))', '[x](data:text/html;base64,PHNjcmlwdD4=)',
    '[x](vbscript:msgbox(1))', '[x](//evil.example)', '[x](\\\\evil.example)', '[x](https://example.org/"onmouseover="alert(1))', '[<script>alert(1)</script>](/x)', '[x](https://example.org/ onmouseover=alert(1))',
    '![x](javascript:alert(1))', '![<script>](https://example.org/a.png)', '![x](/a.png "onerror=alert(1)")', '[![x](https://example.org/a.png)](javascript:alert(1))', '[x]: javascript:alert(1)\n\n[x]',
    '<https://example.org>', 'https://example.org/bare', '&lt;script&gt;alert(1)&lt;/script&gt;', '&#60;script&#62;alert(1)&#60;/script&#62;', '&#x3C;script&#x3E;', '&amp;lt;script&amp;gt;', '&nbsp;&copy;&unknown;',
    '`<script>`', '```html\n<script>alert(1)</script>\n```', '    <script>alert(1)</script>', '| <script> | b |\n| --- | --- |\n| <img src=x onerror=1> | [x](javascript:1) |', '> <script>alert(1)</script>', '- <script>alert(1)</script>',
    '# <script>alert(1)</script>', '## [x](javascript:alert(1))', '\\<script\\>alert(1)\\</script\\>', '**<script>**alert(1)**</script>**', '*<img src=x onerror=1>*',
    '‮<script>', '\u0000<script>\u0000', 'java\u0000script:alert(1)', '[x](java\u0000script:alert(1))', '＜script＞alert(1)＜/script＞', '[x](javascript：alert(1))',
  ];
  it.each(PAYLOADS)('payload %j gives only the allowed elements and attributes', (payload) => {
    expect(violations(html(payload))).toEqual([]);
    expect(violations(html(`# Title\n\n${payload}\n\nafter`))).toEqual([]);
  });
  it('the words of a hostile payload are shown as text, escaped', () => {
    expect(html('<script>alert(1)</script>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
    expect(html('<img src=x onerror=alert(1)>')).toBe('<p>&lt;img src=x onerror=alert(1)&gt;</p>');
    expect(html('<div><b onclick="x">hi</b></div>')).toBe('<p>&lt;div&gt;&lt;b onclick=&quot;x&quot;&gt;hi&lt;/b&gt;&lt;/div&gt;</p>');
  });
  it('entities are not decoded: they are shown as typed, and cannot rebuild a tag or a scheme', () => {
    expect(html('&lt;script&gt; &#60;b&#62; &amp;')).toBe('<p>&amp;lt;script&amp;gt; &amp;#60;b&amp;#62; &amp;amp;</p>');
    expect(html('[x](&#106;avascript:alert(1))')).toBe('<p>x</p>');
  });
  it('an unsafe link keeps its words and loses its address; an image keeps its alt text and loses everything else', () => {
    expect(html('see [the page](javascript:alert(1)) now')).toBe('<p>see the page now</p>');
    expect(html('![alt text](https://example.org/a.png)')).toBe('<p>alt text</p>');
    expect(html('[**bold**](data:x)')).toBe('<p><strong>bold</strong></p>');
  });
  it('a quote character in an address cannot break out of the attribute', () => {
    const out = html('[x](https://example.org/a"b) [y](https://example.org/?q=%22%20onmouseover%3D1)');
    expect(violations(out)).toEqual([]);
    expect(out).not.toMatch(/onmouseover=/);
  });
  it('a page never holds a script tag, an event attribute or a javascript address, whatever is mixed in', () => {
    const mixed = PAYLOADS.join('\n\n');
    const out = html(mixed);
    expect(violations(out)).toEqual([]);
    expect(out).not.toMatch(/<script|<img|<iframe|<svg|<style|href="javascript/i);
  });
});

describe('very long and very deep input', () => {
  const time = (source: string): { ms: number; out: string } => { const t = Date.now(); const out = html(source); return { ms: Date.now() - t, out }; };
  it(`input over ${MAX_SOURCE} characters is replaced by one sentence`, () => {
    const { out, ms } = time('x'.repeat(MAX_SOURCE + 1));
    expect(out).toBe(`<p>${TOO_LONG}</p>`);
    expect(ms).toBeLessThan(500);
    expect(html('[a](/x)'.repeat(50_000))).toBe(`<p>${TOO_LONG}</p>`);
  });
  it.each([
    ['open brackets', '['.repeat(190_000)], ['open brackets and parentheses', '[a](' .repeat(40_000)], ['stars', '*'.repeat(190_000)], ['star words', '*a '.repeat(60_000)], ['double stars', '**a '.repeat(40_000)],
    ['quote marks', '>'.repeat(190_000)], ['quote lines', '> a\n'.repeat(40_000)], ['bars', '|'.repeat(190_000)], ['table rows', '| a | b |\n| --- | --- |\n'.concat('| 1 | 2 |\n'.repeat(15_000))],
    ['backslashes', '\\'.repeat(190_000)], ['one long word', 'a'.repeat(190_000)], ['list items', '- a\n'.repeat(50_000)], ['hashes', '# a\n'.repeat(50_000)], ['unclosed link labels', '[a'.repeat(90_000)],
    ['image openers', '!['.repeat(90_000)], ['nested emphasis', '*a'.repeat(5_000).concat('b'.repeat(1_000), '*'.repeat(5_000))], ['link in link', '[a'.repeat(50) + '](/x)'.repeat(50)], ['spaces', ' '.repeat(190_000) + 'x'],
    ['ten paragraphs of open links (the work budget)', Array<string>(10).fill('[a'.repeat(9_500)).join('\n\n')], ['ten paragraphs of star words', Array<string>(10).fill('*a '.repeat(6_000)).join('\n\n')],
    ['ten paragraphs of double stars', Array<string>(10).fill('**a '.repeat(4_800)).join('\n\n')], ['ten paragraphs of unclosed link addresses', Array<string>(10).fill('[a](('.repeat(6_000)).join('\n\n')],
    ['nested lists', '- a\n  - b\n    - c\n'.repeat(10_000)], ['mixed', '[*a**](<>\\|\n> - # '.repeat(10_000)],
  ])('%s: finished quickly, still only allowed elements', (_name, source) => {
    const { out, ms } = time(source);
    expect(ms).toBeLessThan(4000);
    expect(violations(out)).toEqual([]);
  });
  it('a headline of ten thousand characters and a cell of ten thousand characters are fine', () => {
    expect(violations(html(`# ${'a'.repeat(10_000)}\n\n| a |\n| --- |\n| ${'b'.repeat(10_000)} |`))).toEqual([]);
  });
});

describe('random input (property)', () => {
  const piece = fc.constantFrom('<', '>', '&', '"', "'", '`', '*', '**', '_', '[', ']', '(', ')', '!', '|', '\\', '#', '-', '1.', ' ', '\n', '\n\n', '> ', '- ', '---', ':', '/', '//', 'javascript:', 'http', 'https://a.example/', 'script', 'onerror=', '=', '&#106;', '%22', '\u0000', '\t', 'x', 'é', '‮');
  const source = fc.array(piece, { maxLength: 80 }).map((xs) => xs.join(''));
  it('whatever is typed, only the allowed elements, attributes and addresses come out', () => {
    fc.assert(fc.property(source, (s) => violations(html(s)).length === 0), { numRuns: 1500 });
  });
  it('any text at all (any characters) gives only the allowed elements', () => {
    fc.assert(fc.property(fc.string({ maxLength: 300 }), (s) => violations(html(s)).length === 0), { numRuns: 800 });
  });
  it('parsing never throws and is deterministic', () => {
    fc.assert(fc.property(source, (s) => JSON.stringify(parseMarkdown(s)) === JSON.stringify(parseMarkdown(s))), { numRuns: 300 });
  });
  it('safeHref only ever answers an http(s) address or a path that stays on the site', () => {
    fc.assert(fc.property(source, (s) => {
      const href = safeHref(s);
      if (href === null) return true;
      const url = new URL(href, 'https://site.example/dir/');
      return ['http:', 'https:'].includes(url.protocol) && (/^https?:/i.test(href) || url.origin === 'https://site.example');
    }), { numRuns: 3000 });
  });
});

// ---- the real documents (drift) -----------------------------------------------------------------------------------------
const words = (s: string): string[] => (s.match(/[\p{L}\p{N}]+/gu) ?? []).sort();
/** The words of a source file as a reader would see them: syntax removed (markers at line starts, table separator rows, link addresses, emphasis and quote marks). */
const sourceWords = (md: string): string[] => words(md.split('\n').filter((l) => !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l)).map((l) => l.replace(/^\s*(>\s?)*/, '').replace(/^\s*(#{1,6}\s|[-*+]\s|\d+\.\s)/, '')).join('\n').replace(/\]\([^)]*\)/g, ']'));
const pageWords = (md: string): string[] => words(unescape(html(md).replace(/<[^>]*>/g, ' ')));

describe.each([['PRIVACY-POLICY.md'], ['TERMS-OF-USE.md']])('the real file legal/%s', (file) => {
  const md = legal(file);
  const out = html(md);
  it('renders with only the allowed elements and attributes', () => { expect(violations(out)).toEqual([]); });
  it('shows every heading of the file, in order, at its level, and nothing else as a heading', () => {
    const source = md.split('\n').flatMap((l) => { const m = /^(#{1,6}) (.+)$/.exec(l); return m ? [`${m[1]!.length}:${m[2]}`] : []; });
    const shown = [...out.matchAll(/<h([1-6])[^>]*>(.*?)<\/h\1>/g)].map((m) => `${m[1]}:${unescape(m[2]!.replace(/<[^>]*>/g, ''))}`);
    expect(shown).toEqual(source);
    expect(headingsOf(parseMarkdown(md)).length).toBe(source.length);
    expect(source.length).toBeGreaterThanOrEqual(10);
  });
  it('has exactly one h1, and the heading ids are unique', () => {
    expect(out.match(/<h1[ >]/g)).toHaveLength(1);
    const ids = [...out.matchAll(/<h[1-6] id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('shows every table row and every list item of the file', () => {
    const lines = md.split('\n');
    const rows = lines.filter((l) => l.startsWith('|') && !/^\|(\s*:?-{3,}:?\s*\|)+$/.test(l)).length;
    expect(out.match(/<tr>/g)?.length ?? 0).toBe(rows);
    expect(out.match(/<li>/g)?.length ?? 0).toBe(lines.filter((l) => /^(- |\d+\. )/.test(l)).length);
  });
  it('drops no word and adds none: the words of the page are the words of the file', () => { expect(pageWords(md)).toEqual(sourceWords(md)); });
});

describe('the Terms of Use link to the Privacy Policy by its file name; the page links to /privacy', () => {
  it('turns that link into the page address', () => { expect(html(legal('TERMS-OF-USE.md'))).toContain('<a href="/privacy">Privacy Policy</a>'); });
});
