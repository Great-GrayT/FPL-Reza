'use client';

import Image from 'next/image';
import { useState } from 'react';
import { playerPhotoUrl } from '@fpl/assets/urls';
import styles from './player-photo.module.css';

/**
 * Around a third of players have no published photo before a season opens,
 * concentrated in the promoted clubs and summer signings. That is a normal
 * state, not an error, so the fallback is a designed initial rather than a
 * broken image or a generic silhouette.
 */
export function PlayerPhoto({
  code,
  name,
  size = 'large',
}: {
  code: number;
  name: string;
  size?: 'small' | 'large';
}) {
  const [failed, setFailed] = useState(false);
  const pixels = size === 'large' ? 250 : 44;
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('');

  if (failed) {
    return (
      <span
        className={`${styles.fallback} ${size === 'large' ? styles.large : styles.small}`}
        aria-hidden
      >
        {initials}
      </span>
    );
  }

  return (
    <Image
      className={`${styles.photo} ${size === 'large' ? styles.large : styles.small}`}
      src={playerPhotoUrl(code, size === 'large' ? '250x250' : '110x140')}
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
