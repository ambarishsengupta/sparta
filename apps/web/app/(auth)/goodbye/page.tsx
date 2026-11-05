import Link from 'next/link';

/** Shown after Leave the pilot. Public (the person is signed out and the account is gone) and it holds no data about them. */
export default function Page() {
  return (
    <>
      <h1>You have left the pilot</h1>
      <p>Your account and your data have been deleted, and you have been signed out. Deletion is complete within 7 days at the latest, and copies in our encrypted backups are gone within 30 days; they are never restored.</p>
      <p>Thank you for taking part. If you would like to join again later, ask the team for a new invitation.</p>
      <p><Link href="/privacy">Privacy Policy</Link> · <Link href="/about">About the pilot</Link></p>
    </>
  );
}
