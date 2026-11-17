'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SignOutForm } from './account/SignOutForm';

const LINKS = [['/', 'Wardrobe'], ['/outfits', 'Outfits'], ['/wishlist', 'Wishlist'], ['/purchases', 'Purchases']] as const;
const ACCOUNT_LINKS = [['/settings', 'Settings']] as const;
/** WO-0103: the vendor portal has its own links (a vendor has no wardrobe); the agreement page, which is all a vendor can open before accepting, has none. */
const VENDOR_LINKS = [['/vendor', 'Dashboard'], ['/vendor/gaps', 'Gaps'], ['/vendor/reports', 'Reports'], ['/vendor/account', 'Account']] as const;

/** `signedIn` is set by the page shell when the app runs against Supabase; Sign out is a plain form post, so it works without scripts. */
export function Nav({ signedIn = false }: { signedIn?: boolean }) {
  const path = usePathname();
  const vendor = path === '/vendor' || path?.startsWith('/vendor/');
  const links = vendor ? (path === '/vendor/agreement' ? [] : VENDOR_LINKS) : [...LINKS, ...(signedIn ? ACCOUNT_LINKS : [])];
  const here = (href: string) => path === href || (vendor && href !== '/vendor' && path?.startsWith(`${href}/`));
  return (
    <header className="bar">
      <Link href={vendor ? '/vendor' : '/'} className="brand">Sparta</Link>
      <span className="demo-tag">Demo</span>
      {links.length > 0 && <nav aria-label="Main">
        {links.map(([href, label]) => <Link key={href} href={href} aria-current={here(href) ? 'page' : undefined}>{label}</Link>)}
      </nav>}
      {signedIn && <SignOutForm buttonClassName="linklike" />}
    </header>
  );
}
