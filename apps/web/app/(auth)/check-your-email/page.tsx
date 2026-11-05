import Link from 'next/link';

export default function Page() {
  return (
    <>
      <h1>Check your email</h1>
      <p>We sent you a link to confirm your address. Open it in this browser, then sign in. It can take a minute to arrive; look in your spam folder too.</p>
      <p><Link href="/sign-in">Back to sign in</Link></p>
    </>
  );
}
