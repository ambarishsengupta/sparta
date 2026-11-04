import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Nav } from '../components/Nav';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sparta',
  description: 'Your wardrobe, and what to wear from it. Everything stays in this browser.',
  manifest: '/manifest.webmanifest',
};
export const viewport: Viewport = { themeColor: '#2f4f4f', colorScheme: 'light dark' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip" href="#main">Skip to content</a>
        <Nav />
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
