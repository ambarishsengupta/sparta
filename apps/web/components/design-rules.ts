/** WO-0093: the design system's rules as pure checks over source text, so a test can run them on the real files and on mutated copies.
 * Each check returns problem ids; an empty list means the rule holds. Nothing here is imported by the app. */
export interface Rule { selector: string; media: string; decls: [string, string][]; }

export const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

function declsOf(body: string): [string, string][] {
  return body.split(';').map((d) => d.trim()).filter(Boolean).flatMap((d) => {
    const i = d.indexOf(':');
    return i < 0 ? [] : [[d.slice(0, i).trim().toLowerCase(), d.slice(i + 1).trim()] as [string, string]];
  });
}

export function parseRules(css: string, media = ''): Rule[] {
  const text = stripComments(css);
  const out: Rule[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) break;
    let depth = 1, j = open + 1;
    while (j < text.length && depth > 0) { if (text[j] === '{') depth++; else if (text[j] === '}') depth--; j++; }
    const selector = text.slice(i, open).trim();
    const body = text.slice(open + 1, j - 1);
    if (/^@(media|supports)/.test(selector)) out.push(...parseRules(body, `${media} ${selector}`.trim()));
    else out.push({ selector, media, decls: declsOf(body) });
    i = j;
  }
  return out;
}

const isRoot = (r: Rule) => r.selector === ':root';
/** The tokens of one theme: the plain :root block, plus the dark block's overrides when `dark`. */
export function tokensOf(rules: Rule[], dark = false): Record<string, string> {
  const t: Record<string, string> = {};
  for (const r of rules.filter(isRoot)) {
    const isDark = r.media.includes('prefers-color-scheme: dark');
    const isWide = r.media.includes('min-width');
    if (isDark && !dark) continue;
    if (isWide) continue; // the wide-screen override of the heading size is checked on its own
    for (const [p, v] of r.decls) if (p.startsWith('--')) t[p.slice(2)] = v;
  }
  return t;
}

/** A length in px, following var(--token) references; null when it cannot be told (calc, inherit and so on). */
export function px(value: string, tokens: Record<string, string>, depth = 0): number | null {
  const v = value.trim();
  const ref = /^var\(--([\w-]+)\)$/.exec(v);
  if (ref) return depth > 6 || tokens[ref[1]!] === undefined ? null : px(tokens[ref[1]!]!, tokens, depth + 1);
  const m = /^(-?[\d.]+)(px|rem)$/.exec(v);
  return m ? Number(m[1]) * (m[2] === 'rem' ? 16 : 1) : null;
}

const ALLOWED_FAMILIES = new Set(['ibm plex mono', 'helvetica', 'arial', 'sans-serif']);
const families = (list: string) => list.split(',').map((f) => f.trim().replace(/^['"]|['"]$/g, '').toLowerCase()).filter(Boolean);

export function cssProblems(css: string): string[] {
  const rules = parseRules(css);
  const tokens = tokensOf(rules);
  const body = rules.filter((r) => !isRoot(r));
  const all = rules.flatMap((r) => r.decls.map(([p, v]) => ({ r, p, v })));
  const bad: string[] = [];
  const lacks = (name: string, ok: boolean) => { if (!ok) bad.push(name); };

  // Tokens
  lacks('token-body-size', tokens['fs-body'] === '14px' && tokens['lh-body'] === '21px');
  lacks('token-label-size', tokens['fs-label'] === '12px');
  lacks('token-tight-tracking', tokens['track-tight'] === '-0.05em');
  lacks('token-hairline', tokens['hairline-w'] === '1px');
  lacks('token-radius-zero', tokens['radius'] === '0');
  lacks('token-touch-target', (px('var(--target)', tokens) ?? 0) >= 44);
  lacks('token-focus-ring', (px('var(--ring)', tokens) ?? 0) >= 2);
  const h1 = px('var(--fs-h1)', tokens) ?? 0;
  lacks('token-heading-size', h1 >= 32 && h1 <= 40);
  for (const r of rules.filter((x) => isRoot(x) && x.media.includes('min-width'))) for (const [p, v] of r.decls) if (p === '--fs-h1') lacks('token-heading-size', (px(v, tokens) ?? 0) <= 40 && (px(v, tokens) ?? 0) >= 32);
  const accent = tokens['accent'] ?? '#000000';
  const [ar, ag, ab] = [1, 3, 5].map((k) => parseInt(accent.slice(k, k + 2), 16)) as [number, number, number];
  lacks('accent-is-blue', ab > ar + 80 && ab > ag + 80);

  // Size, family, shape, effects
  for (const { r, p, v } of all) {
    if (p === 'font-size' || (p.startsWith('--fs-') && isRoot(r))) { const n = px(v, tokens); if (n !== null && n < 12) bad.push(`font-size-below-12:${v}`); }
    if (p === 'font-size' && /%$/.test(v) && parseFloat(v) < 75) bad.push(`font-size-below-12:${v}`);
    if (p === 'font' ) {
      const size = /(var\(--fs-[\w-]+\)|[\d.]+(?:px|rem))/.exec(v)?.[1];
      const n = size ? px(size, tokens) : null;
      if (n !== null && n < 12) bad.push(`font-size-below-12:${v}`);
      const left = v.replace(/var\([^)]*\)/g, '').replace(/[\d.]+(px|rem|em)?/g, '').replace(/\b(normal|italic|bold|inherit)\b/g, '').replace(/[/\s]/g, '');
      if (left) bad.push(`font-family-in-shorthand:${v}`);
    }
    if (p === 'font-family' || (p === '--font' && isRoot(r))) for (const f of families(v)) if (!ALLOWED_FAMILIES.has(f) && !f.startsWith('var(')) bad.push(`font-family:${f}`);
    if (/^border(-[a-z]+)*-radius$/.test(p) && !['0', '0px', 'var(--radius)'].includes(v)) bad.push(`radius:${v}`);
    if (/(box|text)-shadow$/.test(p) && v !== 'none') bad.push(`shadow:${v}`);
    if (/drop-shadow\(/.test(v)) bad.push('shadow:drop-shadow');
    if (/gradient\(/.test(v)) bad.push(`gradient:${p}`);
    if (p === 'text-align' && /justify/.test(v)) bad.push('justified-text');
    if (p === 'outline' && /^(none|0)\b/.test(v)) bad.push('outline-removed');
    if (p === 'outline-width' && px(v, tokens) === 0) bad.push('outline-removed');
    if (p === 'outline-style' && v === 'none') bad.push('outline-removed');
    if (p === 'content' && (/["]/.test(v) || /open-quote|close-quote|\\201[89CDcd]/.test(v))) bad.push('quote-styling');
    if (p === 'quotes' && v !== 'none') bad.push('quote-styling');
    if (!isRoot(r) && /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(v)) bad.push(`colour-outside-tokens:${p}`);
  }
  for (const r of rules.filter((x) => x.selector === '@font-face')) {
    const d = Object.fromEntries(r.decls);
    if (!d['font-family'] || families(d['font-family']).join() !== 'ibm plex mono') bad.push('font-face-family');
    if (/https?:|\/\//.test(d['src'] ?? '')) bad.push('font-face-remote');
  }

  // Focus, motion
  const focus = body.find((r) => r.selector === ':focus-visible');
  const ring = focus?.decls.find(([p]) => p === 'outline')?.[1] ?? '';
  lacks('focus-ring-visible', (px(ring.split(/\s+/)[0] ?? '', tokens) ?? 0) >= 2 && /solid/.test(ring) && ring.includes('var(--focus)'));
  const animated = all.some(({ p, v }) => (p === 'transition' || p === 'animation') && v !== 'none');
  const calm = rules.some((r) => r.media.includes('prefers-reduced-motion: reduce') && r.decls.some(([p, v]) => p === 'transition' && /^none/.test(v)));
  lacks('reduced-motion', !animated || calm);

  // Labels, headings, controls
  const rule = (sel: string) => body.find((r) => r.selector === sel);
  const has = (r: Rule | undefined, p: string, test: (v: string) => boolean) => !!r?.decls.some(([k, v]) => k === p && test(v));
  lacks('labels-uppercase-12', has(rule('label'), 'text-transform', (v) => v === 'uppercase') && has(rule('label'), 'font-size', (v) => v === 'var(--fs-label)'));
  lacks('headings-uppercase', has(rule('h1, h2, h3'), 'text-transform', (v) => v === 'uppercase') && has(rule('h1, h2, h3'), 'font-weight', (v) => v === '500'));
  lacks('heading-tight-tracking', has(rule('h1'), 'letter-spacing', (v) => v === 'var(--track-tight)'));
  lacks('buttons-uppercase', has(rule('button, .button'), 'text-transform', (v) => v === 'uppercase') && has(rule('button, .button'), 'font-weight', (v) => v === '500'));
  const target = (r: Rule | undefined) => has(r, 'min-height', (v) => (px(v, tokens) ?? 0) >= 44);
  lacks('touch-target-buttons', target(rule('button, .button')));
  lacks('touch-target-inputs', target(body.find((r) => r.selector.startsWith('select, input'))));
  lacks('touch-target-nav', target(rule('.bar nav a')));
  lacks('touch-target-summary', target(rule('summary')));
  // WO-0094: focus offsets stay bounded and inside the white box on a tile, standalone links reach the 44px target, the wordmark, measure and invalid border
  for (const { p, v } of all) if (p === 'outline-offset') { const n = px(v, tokens); if (n === null || n < -8 || n > 4) bad.push(`focus-offset-out-of-bounds:${v}`); }
  const focusRules = body.filter((r) => r.selector.includes(':focus-visible'));
  lacks('focus-offset-declared', focusRules.length > 0 && focusRules.every((r) => has(r, 'outline-offset', (v) => px(v, tokens) !== null) || r.selector !== ':focus-visible'));
  lacks('focus-on-tile-inside-box', has(rule('.item a.button.secondary:focus-visible'), 'outline-offset', (v) => { const n = px(v, tokens); return n !== null && n <= -3 && n >= -8; }));
  lacks('focus-tile-colours', has(rule('.item a.button.secondary:focus-visible'), 'outline-color', (v) => v === 'var(--focus-box)') && has(rule('.item a.button.secondary:hover:focus-visible'), 'outline-color', (v) => v === 'var(--paper)'));
  lacks('touch-target-linklike', target(rule('button.linklike')));
  lacks('touch-target-foot', target(rule('.foot a')));
  lacks('touch-target-item-title', target(rule('.item .title')) && has(rule('.item .title'), 'display', (v) => /^(block|flex|inline-flex|inline-block|grid)$/.test(v)));
  lacks('touch-target-auth-links', target(rule('.auth-links a')) && has(rule('.auth-links a'), 'font-size', (v) => v === 'var(--fs-label)') && has(rule('.auth-links a'), 'text-transform', (v) => v === 'uppercase'));
  lacks('signout-like-nav-item', has(rule('.bar button.linklike'), 'color', (v) => v === 'var(--text)') && has(rule('.bar button.linklike'), 'text-decoration', (v) => v === 'none'));
  lacks('wordmark-18px', tokens['fs-brand'] === '18px' && has(rule('.brand'), 'font-size', (v) => v === 'var(--fs-brand)'));
  lacks('tile-meta-min-height', has(rule('.item .muted'), 'min-height', (v) => (px(v, tokens) ?? 0) >= 36));
  lacks('invalid-border-2px', has(rule("input[aria-invalid='true'], select[aria-invalid='true']"), 'border-width', (v) => (px(v, tokens) ?? 0) >= 2));
  const measure = /^(\d+)ch$/.exec(tokens['measure'] ?? '')?.[1];
  lacks('line-length-under-70', !!measure && Number(measure) < 70 && has(rule('main > *'), 'max-width', (v) => v === 'var(--measure)') && has(rule('article'), 'max-width', (v) => v === 'var(--measure)'));
  lacks('nav-row-without-orphan', has(rule('.bar nav'), 'justify-content', (v) => v === 'space-between'));
  lacks('body-type', has(rule('body'), 'font', (v) => v.includes('var(--fs-body)/var(--lh-body)') && v.includes('var(--font)')));
  lacks('page-ground', has(rule('body'), 'background', (v) => v === 'var(--bg)') && has(rule('body'), 'color', (v) => v === 'var(--text)'));
  lacks('hairline-header', has(rule('.bar'), 'border-bottom', (v) => v.includes('var(--hairline-w) solid')));
  return [...new Set(bad)];
}

/** WO-0114: a row header of a vendor table takes the cells' hairline; the global `th` rule draws the black rule under a header cell. */
export function vendorTableProblems(vendorCss: string): string[] {
  const r = parseRules(vendorCss).filter((x) => /(^|\s)\.trend\s+(tbody\s+)?th$/.test(x.selector));
  return r.some((x) => x.decls.some(([p, v]) => p === 'border-bottom-color' && v === 'var(--hairline)')) ? [] : ['vendor-row-header-rule'];
}

/** Brand, trademark and proprietary-font strings that must appear nowhere in apps/web. Built from pieces so this file does not contain them whole. */
const j = (...p: string[]) => p.join('');
export const FORBIDDEN_STRINGS: string[] = [
  j('off', '-', 'white'), j('off', '---', 'white'), j('off', 'white'), j('off', ' ', 'white', '.com'),
  j('™'), j('®'), j('&', 'trade;'), j('&', 'reg;'), j('&#', '8482;'), j('&#x', '2122;'), j('&#', '174;'),
  j('helvetica', ' neue'), j('neue', ' haas'), j('akzi', 'denz'), j('fut', 'ura'), j('got', 'ham'), j('prox', 'ima nova'), j('av', 'enir'), j('uni', 'vers '),
  j('times new', ' roman'), j('did', 'ot'), j('bod', 'oni'), j('baskerv', 'ille'), j('garam', 'ond'), j('gt ', 'america'), j('sui', 'sse'), j('gra', 'phik'), j('circ', 'ular std'),
];
export function brandProblems(files: Record<string, string>): string[] {
  const bad: string[] = [];
  for (const [path, text] of Object.entries(files)) {
    const lower = text.toLowerCase();
    for (const s of FORBIDDEN_STRINGS) if (lower.includes(s.toLowerCase())) bad.push(`${path}: ${JSON.stringify(s)}`);
  }
  return bad;
}
/** Inline styles in the components may not bring back shape, shadow or type that the stylesheet forbids. */
export function inlineStyleProblems(files: Record<string, string>): string[] {
  const bad: string[] = [];
  for (const [path, text] of Object.entries(files)) for (const m of text.matchAll(/\b(borderRadius|boxShadow|textShadow|fontFamily|fontSize|background(?:Image)?)\s*:\s*([^,}]+)/g)) {
    if (m[1]!.startsWith('background') && /^\s*(item\??\.hex|item\?\.hex \?\? 'transparent')\s*$/.test(m[2]!)) continue; // the item's own colour fills a tile or a dot
    bad.push(`${path}: ${m[1]}`);
  }
  return bad;
}
