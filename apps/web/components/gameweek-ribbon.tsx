'use client';

import { useId, useState } from 'react';
import styles from './gameweek-ribbon.module.css';

export interface RibbonCell {
  gameweek: number;
  /** Null where the player has no row for that gameweek: unplayed, not zero. */
  points: number | null;
  minutes: number | null;
  /** 1 easiest to 5 hardest, or null where no fixture is scheduled. */
  difficulty: number | null;
  opponent: string | null;
  home: boolean | null;
  isCurrent: boolean;
}

/**
 * The signature element. Fantasy Premier League time is not continuous, it is
 * 38 discrete slabs, and every judgement a manager makes is per gameweek. So
 * the season is drawn as 38 cells that are simultaneously the sparkline, the
 * fixture ticker, and the control that scrubs the rest of the page. Bar height
 * is points, cell ground is fixture difficulty.
 */
export function GameweekRibbon({
  cells,
  onSelect,
  selected,
  label = 'Season by gameweek',
}: {
  cells: readonly RibbonCell[];
  onSelect?: (gameweek: number | null) => void;
  selected?: number | null;
  label?: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const describedBy = useId();

  const best = cells.reduce((max, cell) => Math.max(max, cell.points ?? 0), 1);
  const active = hovered ?? selected ?? null;
  const activeCell = cells.find((cell) => cell.gameweek === active) ?? null;

  return (
    <figure className={styles.wrap}>
      <figcaption className="visually-hidden">{label}</figcaption>
      <ol
        className={styles.ribbon}
        onMouseLeave={() => {
          setHovered(null);
        }}
        aria-describedby={describedBy}
      >
        {cells.map((cell, index) => {
          const height = cell.points === null ? 0 : Math.max(2, (cell.points / best) * 100);
          return (
            <li key={cell.gameweek} className={styles.cell}>
              <button
                type="button"
                className={[
                  styles.button,
                  cell.isCurrent ? styles.current : '',
                  active === cell.gameweek ? styles.active : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{
                  // Staggered fill reads as a season playing out. Suppressed
                  // wholesale by the reduced motion rule in globals.css.
                  animationDelay: `${String(index * 24)}ms`,
                  background:
                    cell.difficulty === null
                      ? 'var(--paper-3)'
                      : `var(--fdr-${String(cell.difficulty)})`,
                }}
                onMouseEnter={() => {
                  setHovered(cell.gameweek);
                }}
                onFocus={() => {
                  setHovered(cell.gameweek);
                }}
                onBlur={() => {
                  setHovered(null);
                }}
                onClick={() => {
                  onSelect?.(selected === cell.gameweek ? null : cell.gameweek);
                }}
                aria-pressed={selected === cell.gameweek}
              >
                <span className={styles.bar} style={{ height: `${String(height)}%` }} />
                <span className="visually-hidden">
                  Gameweek {cell.gameweek}
                  {cell.opponent === null
                    ? ', no fixture'
                    : `, ${cell.home === true ? 'home to' : 'away at'} ${cell.opponent}`}
                  {cell.points === null ? ', not played' : `, ${String(cell.points)} points`}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className={styles.axis} aria-hidden>
        <span className="num">1</span>
        <span className="num">19</span>
        <span className="num">38</span>
      </div>

      <p id={describedBy} className={styles.readout} role="status">
        {activeCell === null ? (
          <span className={styles.readoutIdle}>
            Hover or focus a gameweek. Bar height is points, cell colour is fixture difficulty.
          </span>
        ) : (
          <>
            <span className={`num ${styles.readoutGw}`}>GW{activeCell.gameweek}</span>
            <span className={styles.readoutOpp}>
              {activeCell.opponent === null
                ? 'No fixture'
                : `${activeCell.home === true ? 'v' : 'at'} ${activeCell.opponent}`}
            </span>
            <span className={`num ${styles.readoutPts}`}>
              {activeCell.points === null ? 'not played' : `${String(activeCell.points)} pts`}
            </span>
            {activeCell.minutes !== null && (
              <span className={`num ${styles.readoutMin}`}>{activeCell.minutes}&apos;</span>
            )}
          </>
        )}
      </p>
    </figure>
  );
}
