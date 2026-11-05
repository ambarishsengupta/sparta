import Link from 'next/link';
import { NOTICE_LINKS, NOTICE_PARAGRAPHS, NOTICE_TITLE, pieces } from '../../lib/consent-form';

/** The pilot notice of the Privacy Policy section 13, drawn from lib/consent-form.ts (which a test keeps equal to the file). */
export function NoticeText({ heading: Heading = 'h1' }: { heading?: 'h1' | 'h2' }) {
  return (
    <>
      <Heading>{NOTICE_TITLE}</Heading>
      {NOTICE_PARAGRAPHS.map((p) => (
        <p key={p}>
          {pieces(p).map((x, i) =>
            x.kind === 'bold' ? <strong key={i}>{x.text}</strong>
              : x.kind === 'link' && NOTICE_LINKS[x.text] ? <Link key={i} href={NOTICE_LINKS[x.text]!}>{x.text}</Link>
                : x.text)}
        </p>
      ))}
    </>
  );
}
