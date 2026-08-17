'use client';

import { useEffect, useState } from 'react';
import type { DocHeading } from '../lib/markdown.js';
import styles from './doc-contents.module.css';

/**
 * The contents list doubles as a position marker: the same idea as the gameweek
 * ribbon, where one object is both the reading of the data and the control that
 * moves through it. A long pipeline document is only navigable if you can see
 * where in the pipeline you are.
 */
export function DocContents({ headings }: { headings: readonly DocHeading[] }) {
  const [activeId, setActiveId] = useState<string>(headings[0]?.id ?? '');

  useEffect(() => {
    const targets = headings
      .map((heading) => document.getElementById(heading.id))
      .filter((element): element is HTMLElement => element !== null);
    if (targets.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // The topmost heading currently on screen wins, so the marker tracks
        // reading position rather than whichever heading fired last.
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const first = visible[0]?.target.id;
        if (first !== undefined) setActiveId(first);
      },
      { rootMargin: '-96px 0px -70% 0px' },
    );

    for (const target of targets) observer.observe(target);
    return () => {
      observer.disconnect();
    };
  }, [headings]);

  return (
    <nav className={styles.contents} aria-label="Contents">
      <p className="eyebrow">Contents</p>
      <ol className={styles.list}>
        {headings.map((heading) => (
          <li
            key={heading.id}
            className={heading.level === 3 ? styles.sub : styles.top}
            data-active={heading.id === activeId ? 'true' : undefined}
          >
            <a href={`#${heading.id}`} aria-current={heading.id === activeId ? 'true' : undefined}>
              {heading.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
