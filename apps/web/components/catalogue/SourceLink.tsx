import { sourceLink } from '../../lib/catalogue';

/** "View at source" (FR-24): a plain link to the source page, only for an https address. Nothing is fetched from it, so no image or script of the source ever loads. */
export function SourceLink({ url }: { url: string }) {
  const href = sourceLink(url);
  return href ? <a href={href} target="_blank" rel="noopener noreferrer nofollow">View at source</a> : null;
}
