'use client';

import { useMemo, useState } from 'react';
import { HeatGrid, PitchMarkings, PitchMarker } from './pitch';
import styles from './player-heatmap.module.css';

/**
 * Where a player actually was, rather than what their position is called.
 *
 * One match's heatmap is a 12 by 8 grid of touch counts in the domain's own
 * coordinates, always attacking towards the right. Several matches add cell by
 * cell, which is what makes a season aggregate mean anything: a striker who
 * dropped deep in April and led the line in August reads as two shapes, and
 * the gameweek filter is what separates them.
 *
 * The reader controls two things and nothing else: which season, and which
 * gameweek or all of them. Both are stated on the figure, because a heatmap
 * with no period attached is the most confidently wrong chart on a site.
 */

export interface HeatmapMatch {
  season: string;
  gameweek: number | null;
  fixtureId: number;
  opponent: string | null;
  home: boolean | null;
  minutes: number;
  touches: number | null;
  cols: number;
  rows: number;
  counts: number[];
  averageX: number | null;
  averageY: number | null;
}

const seasonLabel = (partition: string): string => partition.replace('-', '/');

export function PlayerHeatmap({
  matches,
  selectedGameweek,
  onSelectGameweek,
}: {
  matches: readonly HeatmapMatch[];
  /** Driven from the gameweek ribbon, so one click narrows the whole page. */
  selectedGameweek?: number | null;
  onSelectGameweek?: (gameweek: number | null) => void;
}) {
  const seasons = useMemo(
    () => [...new Set(matches.map((match) => match.season))].sort((a, b) => b.localeCompare(a)),
    [matches],
  );
  const [season, setSeason] = useState<string | null>(null);
  const activeSeason = season ?? seasons[0] ?? null;

  const inSeason = useMemo(
    () => matches.filter((match) => match.season === activeSeason),
    [matches, activeSeason],
  );

  // The ribbon's selection only applies inside the season it belongs to, so
  // picking gameweek 34 and then an older season shows that season whole
  // rather than an empty pitch.
  const narrowed = useMemo(() => {
    if (selectedGameweek === null || selectedGameweek === undefined) return inSeason;
    const matching = inSeason.filter((match) => match.gameweek === selectedGameweek);
    return matching.length === 0 ? inSeason : matching;
  }, [inSeason, selectedGameweek]);

  const aggregate = useMemo(() => {
    const first = narrowed[0];
    if (first === undefined) return null;
    const cols = first.cols;
    const rows = first.rows;
    const counts = new Array<number>(cols * rows).fill(0);
    let minutes = 0;
    let touches = 0;
    let touchesKnown = false;
    let sumX = 0;
    let sumY = 0;
    let positions = 0;

    for (const match of narrowed) {
      if (match.cols !== cols || match.rows !== rows) continue;
      match.counts.forEach((value, index) => {
        counts[index] = (counts[index] ?? 0) + value;
      });
      minutes += match.minutes;
      if (match.touches !== null) {
        touches += match.touches;
        touchesKnown = true;
      }
      if (match.averageX !== null && match.averageY !== null) {
        sumX += match.averageX;
        sumY += match.averageY;
        positions += 1;
      }
    }

    return {
      cols,
      rows,
      counts,
      minutes,
      touches: touchesKnown ? touches : null,
      matches: narrowed.length,
      averageX: positions === 0 ? null : sumX / positions,
      averageY: positions === 0 ? null : sumY / positions,
    };
  }, [narrowed]);

  if (matches.length === 0) {
    return (
      <section className={styles.section} aria-labelledby="heatmap-heading">
        <h2 id="heatmap-heading" className={styles.heading}>
          On the pitch
        </h2>
        <p className={styles.empty}>
          No tracked match is stored for this player yet. This fills in once a match they played in
          has been ingested from the movement provider, one heatmap per player per match.
        </p>
      </section>
    );
  }

  const gameweeks = [...new Set(inSeason.map((match) => match.gameweek))]
    .filter((week): week is number => week !== null)
    .sort((a, b) => a - b);

  const narrowedToOne = narrowed.length < inSeason.length;

  return (
    <section className={styles.section} aria-labelledby="heatmap-heading">
      <div className={styles.head}>
        <h2 id="heatmap-heading" className={styles.heading}>
          On the pitch
        </h2>
        {seasons.length > 1 && (
          <label className={styles.seasonPicker}>
            <span className="visually-hidden">Season</span>
            <select
              value={activeSeason ?? ''}
              onChange={(event) => {
                setSeason(event.target.value);
                onSelectGameweek?.(null);
              }}
            >
              {seasons.map((entry) => (
                <option key={entry} value={entry}>
                  {seasonLabel(entry)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <p className={styles.caption}>
        {activeSeason === null ? '' : seasonLabel(activeSeason)}
        {narrowedToOne && selectedGameweek !== null && selectedGameweek !== undefined
          ? `, gameweek ${String(selectedGameweek)}`
          : `, ${String(aggregate?.matches ?? 0)} tracked ${aggregate?.matches === 1 ? 'match' : 'matches'}`}
        . Every touch, added cell by cell. The player attacks towards the right.
      </p>

      {gameweeks.length > 0 && (
        <div className={styles.weeks} role="group" aria-label="Filter by gameweek">
          <button
            type="button"
            className={narrowedToOne ? styles.week : styles.weekOn}
            onClick={() => {
              onSelectGameweek?.(null);
            }}
          >
            All
          </button>
          {gameweeks.map((week) => (
            <button
              key={week}
              type="button"
              className={selectedGameweek === week ? styles.weekOn : styles.week}
              aria-pressed={selectedGameweek === week}
              onClick={() => {
                onSelectGameweek?.(selectedGameweek === week ? null : week);
              }}
            >
              {week}
            </button>
          ))}
        </div>
      )}

      {aggregate === null ? (
        <p className={styles.empty}>Nothing tracked in this selection.</p>
      ) : (
        <>
          <figure className={styles.figure}>
            <PitchMarkings>
              <HeatGrid cols={aggregate.cols} rows={aggregate.rows} counts={aggregate.counts} />
              {aggregate.averageX !== null && aggregate.averageY !== null && (
                <PitchMarker
                  x={aggregate.averageX}
                  y={aggregate.averageY}
                  tone="ink"
                  radius={2.4}
                />
              )}
            </PitchMarkings>
            <figcaption className={styles.legend}>
              <span className={styles.legendScale} aria-hidden />
              <span>Fewer touches</span>
              <span className={styles.legendSpacer} />
              <span>More</span>
              {aggregate.averageX !== null && (
                <span className={styles.legendDot}>Average position</span>
              )}
            </figcaption>
          </figure>

          <dl className={styles.stats}>
            <div>
              <dt>Matches</dt>
              <dd className="num">{aggregate.matches}</dd>
            </div>
            <div>
              <dt>Minutes</dt>
              <dd className="num">{aggregate.minutes}</dd>
            </div>
            <div>
              <dt>Touches</dt>
              <dd className="num">{aggregate.touches ?? 'not carried'}</dd>
            </div>
          </dl>
        </>
      )}
    </section>
  );
}
