import type { Metadata } from 'next';
import { IBM_Plex_Sans_Arabic, Readex_Pro } from 'next/font/google';
import './globals.css';

const body = IBM_Plex_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['400', '500', '700'],
  variable: '--font-body',
});
const heading = Readex_Pro({
  subsets: ['arabic'],
  weight: ['500', '700'],
  variable: '--font-heading',
});

export const metadata: Metadata = { title: 'وَصْل' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={`${body.variable} ${heading.variable}`}>
      <body>{children}</body>
    </html>
  );
}
