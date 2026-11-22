'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isNoLoginDemo } from '../lib/demo-mode';
import { SignOutForm } from './account/SignOutForm';

const LINKS = [['/', 'Wardrobe'], ['/outfits', 'Outfits'], ['/catalogue', 'Catalogue'], ['/wishlist', 'Wishlist'], ['/purchases', 'Purchases']] as const;
const ACCOUNT_LINKS = [['/settings', 'Settings']] as const;
/** WO-0103: the vendor portal has its own links (a vendor has no wardrobe); the agreement page, which is all a vendor can open before accepting, has none. */
const VENDOR_LINKS = [['/vendor', 'Dashboard'], ['/vendor/gaps', 'Gaps'], ['/vendor/reports', 'Reports'], ['/vendor/account', 'Account']] as const;
/** UI wave 3b: the no-login demo adds the two location pages after Gaps (they do not exist outside the demo). */
const DEMO_VENDOR_LINKS = [VENDOR_LINKS[0], VENDOR_LINKS[1], ['/vendor/locations', 'Locations'], ['/vendor/planning', 'Planning'], VENDOR_LINKS[2], VENDOR_LINKS[3]] as const;

/** WO-0173: the admin pages. Only the admin state can be on one (the proxy sends everyone else away from /admin/*), so these links show on those two pages only (the exact paths: an unrouted /admin/x shows the ordinary links), in place of the wardrobe links the admin cannot open. */
const ADMIN_LINKS = [['/admin/catalog', 'Catalogue'], ['/admin/pilot', 'End of pilot']] as const;

/** The no-login demo only: the "View as" switch and the admin links of the demo (the admin pages are not behind a sign-in there, so any path under /admin shows them). */
const VIEW_AS = [['SHOPPER', '/'], ['VENDOR', '/vendor'], ['ADMIN', '/admin/catalog']] as const;
const DEMO_ADMIN_LINKS = [['/admin/catalog', 'Catalogue review'], ['/admin/pilot', 'Pilot']] as const;

/** `signedIn` is set by the page shell when the app runs against Supabase; Sign out is a plain form post, so it works without scripts. */
export function Nav({ signedIn = false }: { signedIn?: boolean }) {
  const path = usePathname();
  const vendor = path === '/vendor' || path?.startsWith('/vendor/');
  const demo = isNoLoginDemo();
  const demoAdmin = demo && (path === '/admin' || path?.startsWith('/admin/') === true);
  const admin = demoAdmin || ADMIN_LINKS.some(([href]) => href === path);
  const links = demoAdmin ? DEMO_ADMIN_LINKS : admin ? ADMIN_LINKS : demo && vendor ? DEMO_VENDOR_LINKS : vendor ? (path === '/vendor/agreement' ? [] : VENDOR_LINKS) : [...LINKS, ...(signedIn ? ACCOUNT_LINKS : [])];
  const view = demoAdmin ? 'ADMIN' : vendor ? 'VENDOR' : 'SHOPPER';
  const here = (href: string) => path === href || (vendor && href !== '/vendor' && path?.startsWith(`${href}/`));
  return (
    <header className="bar">
      <Link href={vendor ? '/vendor' : '/'} className="brand">Sparta</Link>
      <span className="demo-tag">Demo</span>
      {demo && <nav aria-label="View as" className="view-as">
        <span>View as</span>
        {VIEW_AS.map(([label, href]) => <Link key={label} href={href} aria-current={label === view ? 'true' : undefined}>{label}</Link>)}
      </nav>}
      {links.length > 0 && <nav aria-label="Main">
        {links.map(([href, label]) => <Link key={href} href={href} aria-current={here(href) ? 'page' : undefined}>{label}</Link>)}
      </nav>}
      {signedIn && <SignOutForm buttonClassName="linklike" />}
    </header>
  );
}
