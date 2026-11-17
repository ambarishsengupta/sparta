import Link from 'next/link';
import type { ReactNode } from 'react';
import { parseMarkdown, type Block, type Inline } from '../../lib/markdown';

const isSite = (href: string): boolean => !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(href);

/** One inline node as an element. Text is always a text child, so React escapes it; the only attributes are the checked `href` and, for other sites, `rel`. */
export function InlineNodes({ nodes }: { nodes: Inline[] }): ReactNode {
  return nodes.map((n, i) => {
    if (n.t === 'text') return n.text;
    const kids = <InlineNodes nodes={n.children} />;
    if (n.t === 'strong') return <strong key={i}>{kids}</strong>;
    if (n.t === 'em') return <em key={i}>{kids}</em>;
    return isSite(n.href) ? <Link key={i} href={n.href} prefetch={false}>{kids}</Link> : <a key={i} href={n.href} rel="noopener noreferrer">{kids}</a>;
  });
}

function BlockNode({ b }: { b: Block }): ReactNode {
  switch (b.t) {
    case 'heading': {
      const H = `h${b.level}` as 'h1';
      return <H id={b.id}><InlineNodes nodes={b.children} /></H>;
    }
    case 'p': return <p><InlineNodes nodes={b.children} /></p>;
    case 'hr': return <hr />;
    case 'quote': return <blockquote>{b.children.map((c, i) => <BlockNode key={i} b={c} />)}</blockquote>;
    case 'list': {
      const L = b.ordered ? 'ol' : 'ul';
      return <L>{b.items.map((item, i) => <li key={i}><InlineNodes nodes={item} /></li>)}</L>;
    }
    case 'table': return (
      <table>
        <thead><tr>{b.head.map((h, i) => <th key={i} scope="col"><InlineNodes nodes={h} /></th>)}</tr></thead>
        <tbody>{b.rows.map((r, i) => <tr key={i}>{r.map((c, k) => <td key={k}><InlineNodes nodes={c} /></td>)}</tr>)}</tbody>
      </table>
    );
  }
}

/** A Markdown document as HTML, through the small safe reader of lib/markdown.ts. */
export function Markdown({ source }: { source: string }) {
  return <>{parseMarkdown(source).map((b, i) => <BlockNode key={i} b={b} />)}</>;
}
