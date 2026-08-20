'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { InstallApp } from './install-app';
import styles from './site-nav.module.css';

/**
 * Navigation, designed for the phone first.
 *
 * Twelve destinations wrapped into three rows of a sticky header, and on a
 * 390 by 844 screen that was 219 pixels, a quarter of the display, gone before
 * a page had said anything. Worse, every one of them sat at the top, which is
 * the part of a phone a thumb cannot reach.
 *
 * So on a phone the header keeps only the wordmark and the sections move to a
 * bar along the bottom: the four a manager opens every week, plus everything
 * else behind a sheet. That is the platform convention on both phones people
 * actually hold, it is thumb reachable, and it costs 56 pixels instead of 219.
 * On a wide screen the twelve used to sit in one row, and that row was most of
 * the header's width: mono capitals with generous tracking, twelve of them,
 * wrapping to two lines on anything short of a desktop and pushing every page's
 * own controls down with it. Twelve destinations is a site map, not navigation.
 * So the row now carries the seven a manager moves between and the rest sits
 * behind one "More" menu, at a smaller step with tighter tracking. The sheet on
 * a phone and the menu on a desktop hold the same list, so there is one answer
 * to "where is everything else" rather than two.
 */

const PRIMARY = [
  { href: '/', label: 'Season' },
  { href: '/players', label: 'Players' },
  { href: '/teams', label: 'Clubs' },
  { href: '/matches', label: 'Matches' },
  { href: '/builder', label: 'Build' },
  { href: '/planner', label: 'Plan' },
  { href: '/stats', label: 'Lab' },
];

const SECONDARY = [
  { href: '/scout', label: 'Scout' },
  { href: '/managers', label: 'Managers' },
  { href: '/referees', label: 'Referees' },
  { href: '/grounds', label: 'Grounds' },
  { href: '/glossary', label: 'Glossary' },
  { href: '/how-it-works', label: 'How it works' },
];

/** The four a manager opens every week. Everything else is one press away. */
const BAR = [
  { href: '/', label: 'Season' },
  { href: '/players', label: 'Players' },
  { href: '/builder', label: 'Build' },
  { href: '/planner', label: 'Plan' },
];

const isCurrent = (pathname: string, href: string): boolean =>
  href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

export function SiteNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);

  // A sheet that survives navigation is a sheet covering the page you just
  // asked for, so it closes on every route change.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <nav aria-label="Sections" className={styles.wide}>
        <ul className={styles.row}>
          {PRIMARY.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isCurrent(pathname, item.href) ? 'page' : undefined}
              >
                {item.label}
              </Link>
            </li>
          ))}
          <li className={styles.moreWrap}>
            <button
              type="button"
              className={styles.more}
              aria-expanded={open}
              aria-controls="more-sections"
              data-current={
                SECONDARY.some((item) => isCurrent(pathname, item.href)) ? 'true' : undefined
              }
              onClick={() => {
                setOpen((current) => !current);
              }}
            >
              More
            </button>
            {open && (
              <ul className={styles.menu}>
                {SECONDARY.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={isCurrent(pathname, item.href) ? 'page' : undefined}
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </li>
          <li className={styles.install}>
            <InstallApp />
          </li>
        </ul>
      </nav>

      {/* The sheet is rendered before the bar so the bar sits over it, which is
          what makes the bar's own button stay pressable while it is open. */}
      {open && (
        <div
          className={styles.scrim}
          role="presentation"
          onClick={() => {
            setOpen(false);
          }}
        />
      )}
      <div
        ref={sheet}
        id="more-sections"
        className={styles.sheet}
        data-open={open ? 'true' : undefined}
        hidden={!open}
      >
        <InstallApp compact />
        <p className={styles.sheetHead}>Everything else</p>
        <ul className={styles.sheetList}>
          {[
            ...PRIMARY.filter((item) => !BAR.some((tab) => tab.href === item.href)),
            ...SECONDARY,
          ].map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isCurrent(pathname, item.href) ? 'page' : undefined}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <nav aria-label="Main sections" className={styles.bar}>
        <ul>
          {BAR.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isCurrent(pathname, item.href) ? 'page' : undefined}
              >
                {item.label}
              </Link>
            </li>
          ))}
          <li>
            <button
              type="button"
              aria-expanded={open}
              aria-controls="more-sections"
              onClick={() => {
                setOpen((current) => !current);
              }}
            >
              {open ? 'Close' : 'More'}
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}
