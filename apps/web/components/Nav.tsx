import Link from 'next/link';

export function Nav() {
  return (
    <header className="bar">
      <Link href="/" className="brand">Sparta</Link>
      <nav aria-label="Main">
        <Link href="/">Wardrobe</Link>
        <Link href="/outfits">Outfits</Link>
      </nav>
    </header>
  );
}
