'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { isNoLoginDemo } from '../lib/demo-mode';
import { SignOutForm } from './account/SignOutForm';
import { useThresholdsVersion } from './vendor/actions/hooks';

const LINKS = [['/', 'Wardrobe'], ['/outfits', 'Outfits'], ['/catalogue', 'Catalogue'], ['/wishlist', 'Wishlist'], ['/purchases', 'Purchases']] as const;
const ACCOUNT_LINKS = [['/settings', 'Settings']] as const;
/** WO-0103: the vendor portal has its own links (a vendor has no wardrobe); the agreement page, which is all a vendor can open before accepting, has none. */
const VENDOR_LINKS = [['/vendor', 'Dashboard'], ['/vendor/gaps', 'Gaps'], ['/vendor/reports', 'Reports'], ['/vendor/account', 'Account']] as const;
/** Vendor plan, section 5: the no-login demo has the retail screens as well. On a phone these twelve links collapse into a "Menu" disclosure; the Alerts link shows the open alert count. */
const DEMO_VENDOR_LINKS = [['/vendor', 'Dashboard'], ['/vendor/products', 'Products'], ['/vendor/stores', 'Stores'], ['/vendor/restock', 'Restock'], ['/vendor/orders', 'Orders'], ['/vendor/transfers', 'Transfers'], ['/vendor/alerts', 'Alerts'], ['/vendor/locations', 'Locations'], ['/vendor/planning', 'Planning'], VENDOR_LINKS[1], VENDOR_LINKS[2], VENDOR_LINKS[3]] as const;

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
  const demoVendor = demo && vendor && !demoAdmin && !admin;
  const [menuOpen, setMenuOpen] = useState(false);
  const [alerts, setAlerts] = useState(0);
  const thresholds = useThresholdsVersion();   // the alert count follows the thresholds set on the alerts page
  useEffect(() => { setMenuOpen(false); }, [path]);
  useEffect(() => {
    if (!demoVendor) return;
    let live = true;
    import('./vendor/actions/alerts').then((m) => { if (live) setAlerts(m.alertCount()); }, () => { if (live) setAlerts(0); });   // loaded here, so the retail data is not part of every other page
    return () => { live = false; };
  }, [demoVendor, thresholds]);
  const here = (href: string) => path === href || (vendor && href !== '/vendor' && path?.startsWith(`${href}/`));
  return (
    <header className="bar">
      <Link href={vendor ? '/vendor' : '/'} className="brand">Sparta</Link>
      <span className="demo-tag">Demo</span>
      {demo && <nav aria-label="View as" className="view-as">
        <span>View as</span>
        {VIEW_AS.map(([label, href]) => <Link key={label} href={href} aria-current={label === view ? 'true' : undefined}>{label}</Link>)}
      </nav>}
      {demoVendor && <button type="button" className="menu-toggle" aria-expanded={menuOpen} aria-controls="vendor-menu" onClick={() => setMenuOpen((o) => !o)}>Menu{alerts > 0 ? ` (${alerts})` : ''}</button>}
      {links.length > 0 && <nav aria-label="Main" id={demoVendor ? 'vendor-menu' : undefined} className={demoVendor ? 'vendor-menu' : undefined} data-open={demoVendor ? String(menuOpen) : undefined}>
        {links.map(([href, label]) => <Link key={href} href={href} aria-current={here(href) ? 'page' : undefined}>{label}{demoVendor && href === '/vendor/alerts' && alerts > 0 ? <span className="nav-count" aria-label={`, ${alerts} open ${alerts === 1 ? 'alert' : 'alerts'}`}>{alerts}</span> : null}</Link>)}
      </nav>}
      {signedIn && <SignOutForm buttonClassName="linklike" />}
    </header>
  );
}
