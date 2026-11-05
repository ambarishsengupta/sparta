/** Accessibility problems in rendered HTML (R2c): the structural checks that need no browser. Test support only. */
const TAG = /<(\/?)([a-z0-9]+)([^>]*?)(\/?)>/gi;

/** Problems with controls, headings, tables and ids in a page. An empty list is a pass. */
export function a11yProblems(markup: string): string[] {
  const out: string[] = [];
  const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!);
  for (const id of new Set(ids)) if (ids.filter((x) => x === id).length > 1) out.push(`id ${id} is used twice`);
  const forIds = new Set([...markup.matchAll(/<label\b[^>]*\sfor="([^"]+)"/g)].map((m) => m[1]));
  // text of each label, element by element
  const stack: { tag: string; text: string; controls: number }[] = [];
  for (const m of markup.matchAll(/<(\/?)([a-z0-9]+)([^>]*?)(\/?)>|([^<]+)/gi)) {
    const [, close, tag = '', attrs = '', , text] = m;
    if (text !== undefined) { stack.forEach((f) => { f.text += text; }); continue; }
    const named = /aria-label="[^"]+"/.test(attrs) || /aria-labelledby="[^"]+"/.test(attrs);
    if (!close && ['input', 'select', 'textarea'].includes(tag) && !/type="hidden"/.test(attrs)) {
      const id = /\sid="([^"]+)"/.exec(attrs)?.[1];
      const inLabel = stack.some((f) => f.tag === 'label');
      if (!named && !(id && forIds.has(id)) && !inLabel) out.push(`<${tag}${attrs}> has no label`);
      stack.filter((f) => f.tag === 'label').forEach((f) => { f.controls++; });
    }
    for (const ref of /aria-describedby="([^"]+)"/.exec(attrs)?.[1]?.split(' ') ?? []) if (!ids.includes(ref)) out.push(`aria-describedby points at ${ref}, which is not on the page`);
    if (close) {
      const f = stack.pop();
      const empty = (f?.text ?? '').trim() === '';
      if (f?.tag === 'label' && empty && !named) out.push('an empty label');
      if (f && ['button', 'a', 'summary', 'th', 'legend'].includes(f.tag) && empty) out.push(`an empty ${f.tag}`);
    } else if (!['input', 'br', 'hr', 'meta', 'link', 'img'].includes(tag) && !m[0].endsWith('/>')) stack.push({ tag, text: '', controls: 0 });
  }
  const levels = [...markup.matchAll(/<h([1-6])[ >]/g)].map((m) => Number(m[1]));
  if (levels.filter((l) => l === 1).length > 1) out.push('more than one h1');
  levels.forEach((l, i) => { if (i > 0 && l > levels[i - 1]! + 1) out.push(`heading level jumps from h${levels[i - 1]} to h${l}`); });
  for (const t of markup.matchAll(/<table\b[\s\S]*?<\/table>/g)) if (!/<th\b[^>]*scope="col"/.test(t[0])) out.push('a table without column headers');
  if (/<img\b(?![^>]*\balt=)/.test(markup)) out.push('an image without alt text');
  for (const m of markup.matchAll(TAG)) if (/\btabindex="[1-9]/.test(m[3]!)) out.push('a positive tabindex');
  for (const m of markup.matchAll(/<p [^>]*class="error"[^>]*>/g)) if (!m[0].includes('role="alert"')) out.push('an error message that is not announced');
  return out;
}

/** True when some `<tag ...>` in the markup carries every one of the attribute strings. */
export const hasTag = (markup: string, tag: string, ...attrs: string[]): boolean =>
  [...markup.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'g'))].some((m) => attrs.every((a) => m[0].includes(a)));
