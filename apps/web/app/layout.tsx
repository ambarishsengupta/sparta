import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Nav } from '../components/Nav';
import { dataBackend } from '../lib/supabase/config';
import { isSignedIn } from '../lib/supabase/server';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sparta',
  description: 'Your wardrobe, and what to wear from it.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg' },
};
export const viewport: Viewport = { themeColor: '#2f4f4f', colorScheme: 'light dark' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const signedIn = dataBackend() === 'supabase' && (await isSignedIn());
  return (
    <html lang="en">
      <body>
        <a className="skip" href="#main">Skip to content</a>
        <Nav signedIn={signedIn} />
        <main id="main">{children}</main>
        <footer className="foot">
          <nav aria-label="About and legal">
            <Link href="/about" prefetch={false}>About the pilot</Link>
            <Link href="/privacy" prefetch={false}>Privacy Policy</Link>
            <Link href="/terms" prefetch={false}>Terms of Use</Link>
          </nav>
        </footer>
      </body>
    </html>
  );
}
