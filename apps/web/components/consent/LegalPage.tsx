import { readLegal, LEGAL_FILES, type LegalDocument } from '../legal/files';
import { Markdown } from '../legal/Markdown';

/** A pilot document shown as a page: the file in legal/ is read when the page is built or served and drawn through the safe Markdown reader. */
export function LegalPage({ which }: { which: LegalDocument }) {
  return (
    <article>
      <Markdown source={readLegal(which)} />
      <p className="muted">This page shows the file <code>legal/{LEGAL_FILES[which]}</code> of the Sparta project repository.</p>
    </article>
  );
}
