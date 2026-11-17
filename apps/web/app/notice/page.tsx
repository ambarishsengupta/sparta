import Link from 'next/link';
import { NoticeText } from '../../components/consent/NoticeText';

/** The pilot notice (Privacy Policy section 13) as a public page, so it can be read before or after joining. */
export default function Page() {
  return (
    <>
      <NoticeText />
      <p><Link href="/about">About the pilot</Link></p>
    </>
  );
}
