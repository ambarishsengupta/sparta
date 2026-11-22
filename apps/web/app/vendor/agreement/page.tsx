import { AgreementForm } from '../../../components/vendor/AgreementForm';
import { Markdown } from '../../../components/legal/Markdown';
import { isNoLoginDemo } from '../../../lib/demo-mode';
import { VENDOR_AGREEMENT_FILE, readVendorAgreement } from '../../../components/legal/files';

/** FR-94, LLD 9.1 step 6: the only vendor page open before the agreement is accepted. The file in legal/ is read when the page is served and drawn through the safe Markdown reader. */
export default function Page() {
  return (
    <>
      <article>
        <Markdown source={readVendorAgreement()} />
        <p className="muted">This page shows the file <code>legal/{VENDOR_AGREEMENT_FILE}</code> of the Sparta project repository.</p>
      </article>
      {isNoLoginDemo()
        ? <div className="form"><h2>Agreement accepted</h2><p>Accepted for Northline Apparel (demo vendor) on 2026-10-01. Demo only: nothing is recorded.</p></div>
        : <AgreementForm />}
    </>
  );
}
