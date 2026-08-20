'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Position } from '@fpl/core';
import styles from './mini-pitch.module.css';

/**
 * The eleven, kept on screen after the pitch has scrolled away.
 *
 * Both team pages put the squad on a pitch at the top and the reasoning
 * underneath, and the reasoning is long: the ledger, the calendar, the
 * verdict, the caveats. Read any of it and the thing it is about is off the
 * screen, so every comparison becomes a scroll and a memory test.
 *
 * This is the squad reduced to what survives at thumbnail size: position on
 * the pitch, and a shirt colour per club. No names, because at this size a
 * name is three pixels of grey; the panel is an index, not a second copy of
 * the team sheet. Pressing it scrolls the real pitch back into view.
 */

export interface MiniPlayer {
  code: number;
  position: Position;
  /** Club code, which is what colours the dot. */
  teamCode: number;
  name: string;
  starter: boolean;
  captain: boolean;
}

const ROWS: Position[] = ['GKP', 'DEF', 'MID', 'FWD'];

export function MiniPitch({
  players,
  watch,
  label,
  alwaysShown = false,
}: {
  players: readonly MiniPlayer[];
  /** The real pitch. The panel appears exactly when this leaves the screen. */
  watch: RefObject<HTMLElement | null>;
  label: string;
  /**
   * Drawn in place rather than pinned to the corner. The same drawing serves as
   * a preview of a squad being assembled, where there is no pitch to watch.
   */
  alwaysShown?: boolean;
}) {
  const [away, setAway] = useState(alwaysShown);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = watch.current;
    if (alwaysShown || target === null || typeof IntersectionObserver === 'undefined') return;

    // Any part of the pitch showing counts as visible: a panel that appeared
    // while a sliver of the real thing was still on screen would be two
    // pitches at once, which is worse than none.
    const observer = new IntersectionObserver(
      ([entry]) => {
        setAway(entry !== undefined && !entry.isIntersecting);
      },
      { threshold: 0 },
    );
    observer.observe(target);
    return () => {
      observer.disconnect();
    };
  }, [watch, alwaysShown]);

  const starters = players.filter((player) => player.starter);
  if (starters.length === 0) return null;

  return (
    <div
      ref={panel}
      className={styles.panel}
      data-shown={away ? 'true' : undefined}
      data-inline={alwaysShown ? 'true' : undefined}
      // Hidden from everything, not just from sight, while it is off screen:
      // a duplicate eleven in the tab order is a maze for a keyboard.
      aria-hidden={away ? undefined : 'true'}
      inert={!away}
    >
      <button
        type="button"
        className={styles.button}
        onClick={() => {
          watch.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}
      >
        <span className="visually-hidden">{label}. Press to scroll back to the pitch.</span>
        <span className={styles.pitch} aria-hidden="true">
          {ROWS.map((row) => (
            <span key={row} className={styles.row}>
              {starters
                .filter((player) => player.position === row)
                .map((player) => (
                  <span
                    key={player.code}
                    className={styles.dot}
                    data-captain={player.captain ? 'true' : undefined}
                    title={player.name}
                  />
                ))}
            </span>
          ))}
        </span>
      </button>
    </div>
  );
}
