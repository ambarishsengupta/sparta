'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [['/', 'Wardrobe'], ['/outfits', 'Outfits']] as const;

/** `signedIn` is set by the page shell when the app runs against Supabase; Sign out is a plain form post, so it works without scripts. */
export function Nav({ signedIn = false }: { signedIn?: boolean }) {
  const path = usePathname();
  return (
    <header className="bar">
      <Link href="/" className="brand">Sparta</Link>
      <nav aria-label="Main">
        {LINKS.map(([href, label]) => <Link key={href} href={href} aria-current={path === href ? 'page' : undefined}>{label}</Link>)}
      </nav>
      {signedIn && <form action="/auth/sign-out" method="post"><button type="submit" className="linklike">Sign out</button></form>}
    </header>
  );
}
