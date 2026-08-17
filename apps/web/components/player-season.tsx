'use client';

import { useState } from 'react';
import { GameweekRibbon, type RibbonCell } from './gameweek-ribbon';
import { PlayerTimeSeries, type SeriesPoint } from './player-time-series';
import styles from './player-season.module.css';

export interface GameweekRow {
  gameweek: number;
  opponent: string | null;
  home: boolean | null;
  minutes: number;
  points: number;
  goals: number;
  assists: number;
  expectedGoals: number;
  expectedAssists: number;
  bonus: number;
  bps: number;
  price: number;
}

/**
 * Holds the one piece of state the ribbon, the chart, and the table all share:
 * which gameweek the reader is looking at. Selecting a cell narrows the table
 * to that week rather than opening a separate view, so the season stays on
 * screen while a single week is inspected.
 */
export function PlayerSeason({
  cells,
  series,
  rows,
}: {
  cells: readonly RibbonCell[];
  series: readonly SeriesPoint[];
  rows: readonly GameweekRow[];
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const shown = selected === null ? rows : rows.filter((row) => row.gameweek === selected);

  return (
    <>
      <section className={styles.ribbonSection} aria-labelledby="season-heading">
        <div className={styles.sectionHead}>
          <h2 id="season-heading" className={styles.h2}>
            The season
          </h2>
          {selected !== null && (
            <button
              type="button"
              className={styles.clear}
              onClick={() => {
                setSelected(null);
              }}
            >
              Show all 38
            </button>
          )}
        </div>
        <GameweekRibbon cells={cells} selected={selected} onSelect={setSelected} />
      </section>

      <section className={styles.chartSection} aria-labelledby="trend-heading">
        <h2 id="trend-heading" className={styles.h2}>
          Trend
        </h2>
        <PlayerTimeSeries data={series} />
      </section>

      <section aria-labelledby="rows-heading">
        <div className={styles.sectionHead}>
          <h2 id="rows-heading" className={styles.h2}>
            Gameweek by gameweek
          </h2>
          <p className="eyebrow">
            {selected === null
              ? `${String(rows.length)} played`
              : `Gameweek ${String(selected)} only`}
          </p>
        </div>

        {shown.length === 0 ? (
          <p className={styles.empty}>
            Nothing stored for this gameweek. Run a sync including player history to fill it in.
          </p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">GW</th>
                  <th scope="col">Opponent</th>
                  <th scope="col" className={styles.right}>
                    Min
                  </th>
                  <th scope="col" className={styles.right}>
                    Pts
                  </th>
                  <th scope="col" className={styles.right}>
                    G
                  </th>
                  <th scope="col" className={styles.right}>
                    A
                  </th>
                  <th scope="col" className={styles.right}>
                    xG
                  </th>
                  <th scope="col" className={styles.right}>
                    xA
                  </th>
                  <th scope="col" className={styles.right}>
                    Bonus
                  </th>
                  <th scope="col" className={styles.right}>
                    BPS
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.gameweek}>
                    <th scope="row" className="num">
                      {row.gameweek}
                    </th>
                    <td>
                      {row.opponent === null
                        ? 'No fixture'
                        : `${row.home === true ? 'v' : 'at'} ${row.opponent}`}
                    </td>
                    <td className={`num ${styles.right}`}>{row.minutes}</td>
                    <td className={`num ${styles.right} ${styles.strong}`}>{row.points}</td>
                    <td className={`num ${styles.right}`}>{row.goals}</td>
                    <td className={`num ${styles.right}`}>{row.assists}</td>
                    <td className={`num ${styles.right} ${styles.dim}`}>
                      {row.expectedGoals.toFixed(2)}
                    </td>
                    <td className={`num ${styles.right} ${styles.dim}`}>
                      {row.expectedAssists.toFixed(2)}
                    </td>
                    <td className={`num ${styles.right}`}>
                      {row.bonus > 0 ? <span className={styles.bonus}>{row.bonus}</span> : '0'}
                    </td>
                    <td className={`num ${styles.right} ${styles.dim}`}>{row.bps}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
