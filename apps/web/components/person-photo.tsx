'use client';

import Image from 'next/image';
import { useState } from 'react';
import { managerPhotoUrl, playerPhotoUrl } from '@fpl/assets/urls';
import styles from './person-photo.module.css';

/**
 * One portrait component for every person the site names: a player, a manager,
 * a referee. Three kinds because the Premier League CDN keys them differently
 * (`p` for a player, `man` for a manager, and nothing at all for an official),
 * and one component because a name without a face reads as a database row
 * rather than a person, and that is true wherever the name appears.
 *
 * A missing photograph is the normal state, not an error: around a third of
 * players are unphotographed before a season opens, a newly appointed manager
 * takes weeks to appear, and no referee has a published portrait at all. So
 * the fallback is a designed monogram in the club's own ink, never a broken
 * image and never a generic silhouette.
 */

export type PersonKind = 'player' | 'manager' | 'official';

export const PERSON_SIZES = {
  xs: 24,
  sm: 36,
  md: 56,
  lg: 96,
  xl: 220,
} as const;

export type PersonSize = keyof typeof PERSON_SIZES;

function sourceFor(kind: PersonKind, code: number | null, pixels: number): string | null {
  if (code === null) return null;
  const size = pixels > 120 ? '250x250' : '110x140';
  if (kind === 'player') return playerPhotoUrl(code, size);
  if (kind === 'manager') return managerPhotoUrl(code, size);
  return null;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

export function PersonPhoto({
  kind = 'player',
  code = null,
  name,
  size = 'sm',
  className = '',
}: {
  kind?: PersonKind;
  /** The CDN key: a player code, a manager's Opta id, or null for an official. */
  code?: number | null;
  name: string;
  size?: PersonSize;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const pixels = PERSON_SIZES[size];
  const source = sourceFor(kind, code, pixels);

  if (source === null || failed) {
    return (
      <span
        className={`${styles.frame} ${styles.fallback} ${styles[size]} ${className}`}
        style={{ fontSize: `${String(Math.round(pixels * 0.36))}px` }}
        aria-hidden
      >
        {initialsOf(name)}
      </span>
    );
  }

  return (
    <Image
      className={`${styles.frame} ${styles.photo} ${styles[size]} ${className}`}
      src={source}
      alt=""
      aria-hidden
      width={pixels}
      height={pixels}
      onError={() => {
        setFailed(true);
      }}
    />
  );
}

/**
 * A portrait and a name as one unit, which is what most callers actually want.
 * The name carries the accessible text and the portrait stays decorative, so a
 * screen reader hears the person once rather than twice.
 */
export function PersonChip({
  kind = 'player',
  code = null,
  name,
  detail,
  size = 'sm',
  href,
}: {
  kind?: PersonKind;
  code?: number | null;
  name: string;
  detail?: string | undefined;
  size?: PersonSize;
  href?: string | undefined;
}) {
  const body = (
    <>
      <PersonPhoto kind={kind} code={code} name={name} size={size} />
      <span className={styles.chipText}>
        <span className={styles.chipName}>{name}</span>
        {detail !== undefined && detail !== '' && (
          <span className={styles.chipDetail}>{detail}</span>
        )}
      </span>
    </>
  );

  if (href === undefined) return <span className={styles.chip}>{body}</span>;
  return (
    <a className={`${styles.chip} ${styles.chipLink}`} href={href}>
      {body}
    </a>
  );
}
