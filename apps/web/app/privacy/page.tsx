import { LegalPage } from '../../components/consent/LegalPage';
import { NoticeText } from '../../components/consent/NoticeText';

export default function Page() {
  return <LegalPage title="Privacy Policy" file="legal/PRIVACY-POLICY.md"><p className="muted">The short notice shown at first sign-in (section 13 of the Privacy Policy):</p><NoticeText heading="h2" /></LegalPage>;
}
