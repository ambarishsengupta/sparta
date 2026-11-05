import type { ReactNode } from 'react';

/** The pilot documents are kept as files in the project repository (legal/); this build links to them and does not render them. */
export function LegalPage({ title, file, children }: { title: string; file: string; children?: ReactNode }) {
  return (
    <>
      <h1>{title}</h1>
      {children}
      <p>The full text of the {title} is the file <code>{file}</code> in the Sparta project repository. Ask the Sparta team for a copy if you cannot open it.</p>
    </>
  );
}
