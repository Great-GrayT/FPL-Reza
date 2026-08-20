import type { Metadata } from 'next';
import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import Link from 'next/link';
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

/*
 * Twelve destinations do not fit one row on a phone, and a horizontally
 * scrolling strip of twelve hides most of them behind a gesture nobody
 * discovers. So the nav is grouped: the six a manager uses every week stay
 * visible, and the reference sections sit behind a disclosure that is a real
 * <details> element, which means it opens from the keyboard and works with
 * JavaScript disabled. Above the wide breakpoint both groups render as one row.
 */
const PRIMARY = [
  { href: '/', label: 'Season' },
  { href: '/players', label: 'Players' },
  { href: '/teams', label: 'Clubs' },
  { href: '/matches', label: 'Matches' },
  { href: '/builder', label: 'Build' },
  { href: '/planner', label: 'Plan' },
  { href: '/scout', label: 'Scout' },
];

const SECONDARY = [
  { href: '/managers', label: 'Managers' },
  { href: '/referees', label: 'Referees' },
  { href: '/grounds', label: 'Grounds' },
  { href: '/stats', label: 'Analysis' },
  { href: '/glossary', label: 'Glossary' },
  { href: '/how-it-works', label: 'How it works' },
];

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

            <nav aria-label="Sections" className={styles.navWrap}>
              <ul className={styles.nav}>
                {PRIMARY.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href}>{item.label}</Link>
                  </li>
                ))}
              </ul>

              <details className={styles.more}>
                <summary className={styles.moreSummary}>More</summary>
                <ul className={`${styles.nav} ${styles.moreList}`}>
                  {SECONDARY.map((item) => (
                    <li key={item.href}>
                      <Link href={item.href}>{item.label}</Link>
                    </li>
                  ))}
                </ul>
              </details>
            </nav>
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
