/**
 * A small Markdown reader for the pilot documents (legal/*.md). It builds a tree of known node types and nothing else: the renderer turns each
 * node into a fixed element, and every piece of text reaches the page as a text child, which React escapes. No HTML is ever read or written, so
 * `<script>`, `onerror=` and entity tricks are plain text. Supported: headings, paragraphs, flat lists, tables, block quotes, rules, `**strong**`,
 * `*emphasis*`, backslash escapes and links to http(s) addresses or to this site. Images become their alt text. Nothing else is interpreted.
 * Hostile or huge input cannot hang a page: the source is capped at MAX_SOURCE characters, every look-ahead for a closing mark (`]`, `)`, `*`) is bounded in length and
 * spends from one budget shared by the whole document, and everything else is a single linear pass. There is no regular expression with a repeated group or with two
 * quantifiers that can match the same characters (the old heading and list-item patterns had one, and a closing-hash pattern that was quadratic: WO-0062); the
 * heading, list-item and closing-hash readers below are loops. components/legal/markdown.test.ts times the worst inputs.
 */
export type Inline =
  | { t: 'text'; text: string }
  | { t: 'strong'; children: Inline[] }
  | { t: 'em'; children: Inline[] }
  | { t: 'link'; href: string; children: Inline[] };
export type Block =
  | { t: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; id: string; children: Inline[] }
  | { t: 'p'; children: Inline[] }
  | { t: 'list'; ordered: boolean; items: Inline[][] }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][] }
  | { t: 'quote'; children: Block[] }
  | { t: 'hr' };

export const MAX_SOURCE = 200_000;
export const TOO_LONG = 'This document is too long to show here.';
const MAX_DEPTH = 4;
const MAX_QUOTE_DEPTH = 3;
const LABEL_MAX = 300;
const URL_MAX = 2000;
const SPAN_MAX = 1000;
const WORK_BUDGET = 3_000_000;
const MAX_INLINE_SOURCE = 20_000;
const MAX_ROWS = 1000;
const MAX_COLUMNS = 20;

/** The legal files link to each other by file name; in the app those are pages. */
const LEGAL_ROUTES: Record<string, string> = { 'PRIVACY-POLICY.md': '/privacy', 'TERMS-OF-USE.md': '/terms' };

const unsafeUrlChar = (c: string): boolean => {
  const n = c.charCodeAt(0);
  return n <= 0x20 || (n >= 0x7f && n <= 0x9f) || c === '\\' || c === '<' || c === '>' || c === '"';
};

/** The address a link may point to, or null. Allowed: http(s) addresses without credentials, and addresses on this site (`/x`, `./x`, `../x`, `#x`, `x`). */
export function safeHref(raw: string): string | null {
  const url = raw.trim();
  if (url === '' || url.length > URL_MAX || [...url].some(unsafeUrlChar)) return null;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(url)) {
    try {
      const u = new URL(url);
      return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname !== '' && u.username === '' && u.password === '' ? u.href : null;
    } catch { return null; }
  }
  if (url.startsWith('//') || !/^[A-Za-z0-9/._~#?=&%+,@-]+$/.test(url)) return null; // another site by the same scheme; or characters no plain path needs (':' ';' '(' ...)
  const file = /^(?:\.{1,2}\/)*([A-Za-z0-9-]+\.md)(#[A-Za-z0-9_-]*)?$/.exec(url);
  const route = file ? LEGAL_ROUTES[file[1]!] : undefined;
  return route ? route + (file![2] ?? '') : url;
}

interface Ctx { budget: number }
/** Position of the first `token` within `max` characters after `from`, or -1. Each call spends the budget by the length it looked at. */
function find(ctx: Ctx, s: string, token: string, from: number, max: number): number {
  if (ctx.budget <= 0) return -1;
  const window = s.slice(from, from + max + token.length);
  ctx.budget -= window.length;
  const j = window.indexOf(token);
  return j === -1 ? -1 : from + j;
}
/** The `)` that closes the address opened just before `from`, counting inner pairs (`alert(1)`), within URL_MAX characters; -1 if none. */
function closeParen(ctx: Ctx, s: string, from: number): number {
  const window = s.slice(from, from + URL_MAX);
  ctx.budget -= window.length;
  if (ctx.budget <= 0) return -1;
  let depth = 0;
  for (let k = 0; k < window.length; k++) {
    if (window[k] === '(') depth++;
    else if (window[k] === ')') { if (depth === 0) return from + k; depth--; }
  }
  return -1;
}
const plain = (nodes: Inline[]): string => nodes.map((n) => (n.t === 'text' ? n.text : plain(n.children))).join('');

function inline(ctx: Ctx, s: string, depth: number, links = true): Inline[] {
  if (s.length > MAX_INLINE_SOURCE) return [{ t: 'text', text: s }];
  const out: Inline[] = [];
  let buf = '';
  let i = 0;
  const flush = () => { if (buf !== '') { out.push({ t: 'text', text: buf }); buf = ''; } };
  while (i < s.length) {
    const c = s[i]!;
    const next = s[i + 1];
    if (c === '\\' && next !== undefined && /[!-/:-@[-`{-~]/.test(next)) { buf += next; i += 2; continue; }
    if (depth < MAX_DEPTH && c === '*') {
      const mark = next === '*' ? '**' : '*';
      const j = find(ctx, s, mark, i + mark.length, SPAN_MAX);
      const inner = j === -1 ? '' : s.slice(i + mark.length, j);
      if (j !== -1 && inner.trim() === inner && inner !== '') {
        flush();
        out.push({ t: mark === '**' ? 'strong' : 'em', children: inline(ctx, inner, depth + 1, links) });
        i = j + mark.length;
        continue;
      }
    }
    const image = c === '!' && next === '[';
    if (depth < MAX_DEPTH && links && (c === '[' || image)) {
      const open = image ? i + 1 : i;
      const close = find(ctx, s, ']', open + 1, LABEL_MAX);
      const end = close !== -1 && s[close + 1] === '(' ? closeParen(ctx, s, close + 2) : -1;
      if (end !== -1) {
        const label = inline(ctx, s.slice(open + 1, close), depth + 1, false);
        const href = image ? null : safeHref(s.slice(close + 2, end).trim().split(/\s+/)[0] ?? '');
        flush();
        if (href) out.push({ t: 'link', href, children: label });
        else out.push(...label); // an unsafe address or an image: the words stay, the address is dropped
        i = end + 1;
        continue;
      }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

/** Heading ids start with `doc-`, so a heading called "Main" can never take the id of the page's own `main`. */
const slugify = (text: string): string => `doc-${text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'section'}`;
// Line readers written as loops. (As regular expressions the heading and item patterns followed a run of white space with `.+` / `.*`, which cannot match a
// line separator (U+2028, U+2029): a long run of spaces and then a separator took quadratic time.) Same meaning as before: `.` never matched those two characters.
const isSpace = (c: string): boolean => /\s/.test(c);
const hasLineSeparator = (s: string): boolean => s.includes('\u2028') || s.includes('\u2029');
/** `#` to `######`, white space, then at least one character with no line separator in it. `line` is already trimmed. */
export function parseHeading(line: string): { level: number; text: string } | null {
  let level = 0;
  while (level < 7 && line[level] === '#') level++;
  if (level < 1 || level > 6 || level >= line.length || !isSpace(line[level]!)) return null;
  let at = level;
  while (at < line.length && isSpace(line[at]!)) at++;
  const text = line.slice(at);
  return text === '' || hasLineSeparator(text) ? null : { level, text };
}
/** Up to three spaces, a bullet (`-`, `*`, `+`) or a number of at most nine digits and `.` or `)`, spaces or tabs, then the item text (no line separator in it). */
export function parseItem(line: string): { marker: string; text: string } | null {
  let at = 0;
  while (at < 3 && line[at] === ' ') at++;
  let marker: string;
  if (line[at] === '-' || line[at] === '*' || line[at] === '+') { marker = line[at]!; at++; } else {
    let digits = 0;
    while (digits < 10 && at + digits < line.length && line[at + digits]! >= '0' && line[at + digits]! <= '9') digits++;
    const after = line[at + digits];
    if (digits < 1 || digits > 9 || (after !== '.' && after !== ')')) return null;
    marker = line.slice(at, at + digits + 1);
    at += digits + 1;
  }
  if (line[at] !== ' ' && line[at] !== '\t') return null;
  while (line[at] === ' ' || line[at] === '\t') at++;
  const text = line.slice(at);
  return hasLineSeparator(text) ? null : { marker, text };
}
/** A heading's text without its closing hashes (`## Title ##` is `Title`); the hashes must follow a space or tab, so `C#` keeps its `#`. A loop, not a pattern. */
export function stripClosingHashes(text: string): string {
  let end = text.length;
  while (end > 0 && text[end - 1] === '#') end--;
  if (end === text.length || end === 0 || (text[end - 1] !== ' ' && text[end - 1] !== '\t')) return text.trim();
  while (end > 0 && (text[end - 1] === ' ' || text[end - 1] === '\t')) end--;
  return text.slice(0, end).trim();
}
const RULE = /^ {0,3}(?:-{3,}|_{3,}|\*{3,})[ \t]*$/;
const QUOTE = /^ {0,3}> ?(.*)$/;

/** Cells of a table row; `\|` is a literal bar. */
function cells(line: string): string[] {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
  const out: string[] = [];
  let cur = '';
  for (let k = 0; k < t.length; k++) {
    const c = t[k]!;
    if (c === '\\' && t[k + 1] === '|') { cur += '|'; k++; } else if (c === '|') { out.push(cur.trim()); cur = ''; } else cur += c;
  }
  out.push(cur.trim());
  return out;
}
const isSeparator = (line: string): boolean => line.includes('-') && cells(line).every((c) => /^:?-{3,}:?$/.test(c));
const startsTable = (lines: string[], i: number): boolean => lines[i]!.includes('|') && i + 1 < lines.length && isSeparator(lines[i + 1]!) && cells(lines[i]!).length === cells(lines[i + 1]!).length;
const startsBlock = (lines: string[], i: number): boolean => {
  const line = lines[i]!;
  return parseHeading(line.trim()) !== null || RULE.test(line) || QUOTE.test(line) || parseItem(line) !== null || startsTable(lines, i);
};

function blocks(ctx: Ctx, lines: string[], depth: number, ids: Map<string, number>): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '') { i++; continue; }
    const heading = parseHeading(line.trim());
    if (heading) {
      const text = stripClosingHashes(heading.text);
      const base = slugify(text);
      const seen = ids.get(base) ?? 0;
      ids.set(base, seen + 1);
      out.push({ t: 'heading', level: heading.level as 1, id: seen === 0 ? base : `${base}-${seen + 1}`, children: inline(ctx, text, 0) });
      i++;
    } else if (RULE.test(line)) {
      out.push({ t: 'hr' });
      i++;
    } else if (QUOTE.test(line) && depth < MAX_QUOTE_DEPTH) {
      const inner: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) { inner.push(QUOTE.exec(lines[i]!)![1]!); i++; }
      out.push({ t: 'quote', children: blocks(ctx, inner, depth + 1, ids) });
    } else if (parseItem(line)) {
      const ordered = /\d/.test(parseItem(line)!.marker);
      const items: string[] = [];
      while (i < lines.length) {
        const here = lines[i]!;
        const m = parseItem(here);
        if (m && /\d/.test(m.marker) === ordered) { items.push(m.text.trim()); i++; continue; }
        if (here.trim() === '') {
          let k = i;
          while (k < lines.length && lines[k]!.trim() === '') k++;
          const after = k < lines.length ? parseItem(lines[k]!) : null;
          if (after && /\d/.test(after.marker) === ordered) { i = k; continue; }
          break;
        }
        if (/^[ \t]{2,}\S/.test(here) && items.length > 0) { items[items.length - 1] += ` ${here.trim()}`; i++; continue; }
        break;
      }
      out.push({ t: 'list', ordered, items: items.map((x) => inline(ctx, x, 0)) });
    } else if (startsTable(lines, i)) {
      const head = cells(line).slice(0, MAX_COLUMNS);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i]!.trim() !== '' && lines[i]!.includes('|') && rows.length < MAX_ROWS) {
        const row = cells(lines[i]!);
        rows.push(head.map((_, k) => inline(ctx, row[k] ?? '', 0)));
        i++;
      }
      out.push({ t: 'table', head: head.map((h) => inline(ctx, h, 0)), rows });
    } else {
      const text: string[] = [line.trim()];
      i++;
      while (i < lines.length && lines[i]!.trim() !== '' && !startsBlock(lines, i)) text.push(lines[i++]!.trim());
      out.push({ t: 'p', children: inline(ctx, text.join(' '), 0) });
    }
  }
  return out;
}

/** Control characters other than newline, carriage return and tab become the replacement character. */
function clean(source: string): string {
  let out = '';
  for (let i = 0; i < source.length; i++) {
    const n = source.charCodeAt(i);
    out += (n < 0x20 && n !== 0x0a && n !== 0x09 && n !== 0x0d) || n === 0x7f ? '�' : source[i];
  }
  return out;
}

export function parseMarkdown(source: string): Block[] {
  if (source.length > MAX_SOURCE) return [{ t: 'p', children: [{ t: 'text', text: TOO_LONG }] }];
  const lines = clean(source).replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  return blocks({ budget: WORK_BUDGET }, lines, 0, new Map());
}

/** The words of a node tree, for tests and for pulling a paragraph out of a document. */
export const textOf = (nodes: Inline[]): string => plain(nodes);

/** The heading texts of a document, in order, as the reader sees them (a test keeps the rendered page equal to this). */
export const headingsOf = (doc: Block[]): string[] =>
  doc.flatMap((b) => (b.t === 'heading' ? [plain(b.children)] : b.t === 'quote' ? headingsOf(b.children) : []));

/** The paragraphs of the section whose heading starts with `heading` (up to the next heading of the same or a higher level). */
export function sectionParagraphs(doc: Block[], heading: string): Inline[][] {
  const start = doc.findIndex((b) => b.t === 'heading' && plain(b.children).startsWith(heading));
  const at = doc[start];
  if (!at || at.t !== 'heading') return [];
  const out: Inline[][] = [];
  for (const b of doc.slice(start + 1)) {
    if (b.t === 'heading' && b.level <= at.level) break;
    if (b.t === 'p') out.push(b.children);
  }
  return out;
}
