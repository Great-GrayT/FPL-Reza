import type { Metadata } from 'next';
import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import Link from 'next/link';
import { SiteNav } from '@/components/site-nav';
import './globals.css';
import styles from './layout.module.css';

// Expanded display type inverts the condensed lettering every sports product
// reaches for, and Archivo's width axis is what makes that available.
const display = Archivo({
  subsets: ['latin'],
  axes: ['wdth'],
  variable: '--font-display',
  display: 'swap',
});

const body = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-body',
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'FPL Lake',
  description: 'Fantasy Premier League players, gameweek by gameweek, and the fixtures around them',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <a href="#main" className={styles.skip}>
          Skip to content
        </a>
        <header className={styles.header}>
          <div className={`shell ${styles.headerInner}`}>
            <Link href="/" className={styles.wordmark}>
              FPL<span className={styles.wordmarkTail}>Lake</span>
            </Link>
            <SiteNav />
          </div>
        </header>
        <main id="main">{children}</main>
        <footer className={styles.footer}>
          <div className="shell">
            <p className="eyebrow">
              Built from committed snapshots of the public Fantasy Premier League API. Not
              affiliated with the Premier League.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
