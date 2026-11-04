'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [['/', 'Wardrobe'], ['/outfits', 'Outfits']] as const;

export function Nav() {
  const path = usePathname();
  return (
    <header className="bar">
      <Link href="/" className="brand">Sparta</Link>
      <nav aria-label="Main">
        {LINKS.map(([href, label]) => <Link key={href} href={href} aria-current={path === href ? 'page' : undefined}>{label}</Link>)}
      </nav>
    </header>
  );
}
