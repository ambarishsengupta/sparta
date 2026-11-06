'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SignOutForm } from './account/SignOutForm';

const LINKS = [['/', 'Wardrobe'], ['/outfits', 'Outfits']] as const;
const ACCOUNT_LINKS = [['/settings', 'Settings']] as const;

/** `signedIn` is set by the page shell when the app runs against Supabase; Sign out is a plain form post, so it works without scripts. */
export function Nav({ signedIn = false }: { signedIn?: boolean }) {
  const path = usePathname();
  return (
    <header className="bar">
      <Link href="/" className="brand">Sparta</Link>
      <nav aria-label="Main">
        {[...LINKS, ...(signedIn ? ACCOUNT_LINKS : [])].map(([href, label]) => <Link key={href} href={href} aria-current={path === href ? 'page' : undefined}>{label}</Link>)}
      </nav>
      {signedIn && <SignOutForm buttonClassName="linklike" />}
    </header>
  );
}
