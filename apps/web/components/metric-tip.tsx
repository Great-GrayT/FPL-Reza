import Link from 'next/link';
import { glossaryEntry } from '@fpl/analytics';
import styles from './metric-tip.module.css';

/**
 * Every metric label on the site is a link into the dictionary that defines it.
 * A number whose definition is not one click away is a number a manager cannot
 * argue with, and an interface of unarguable numbers gets trusted once.
 *
 * Rendered as an anchor with a title rather than a hover card: a hover card is
 * unreachable on a touch screen, and the anchor works for a keyboard, a screen
 * reader, and a middle click into a new tab.
 */
export function MetricTip({
  id,
  children,
  short = false,
}: {
  id: string;
  children?: React.ReactNode;
  /** Abbreviated label, for a table header where space is tight. */
  short?: boolean;
}) {
  const entry = glossaryEntry(id);
  if (entry === undefined) return <>{children}</>;

  const label = children ?? (short ? entry.term.split(',')[0] : entry.term);

  return (
    <Link
      href={`/glossary#${entry.id}`}
      className={styles.tip}
      title={`${entry.term}: ${entry.short}`}
    >
      {label}
      <span className={styles.mark} aria-hidden="true">
        ?
      </span>
      <span className="visually-hidden"> (what this means)</span>
    </Link>
  );
}
