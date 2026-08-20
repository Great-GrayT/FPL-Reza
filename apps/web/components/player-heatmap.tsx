'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import {
  composeHeatmap,
  type EstimatedHeatmap,
  type EvidenceRow,
  type HeatmapPrior,
  type HeatmapWindow,
  type LobeKind,
} from '@/lib/heatmap-lobes';
import { usePlayerFocus } from './player-focus';
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

/** What each measure claims, in the words a manager would use for it. */
const REASON_LABEL: Record<LobeKind, string> = {
  shot: 'Shooting',
  create: 'Creating',
  defend: 'Defending',
};

/**
 * What the figure was drawn as, in the words it was drawn from.
 *
 * Three bases, three different claims, and they are worth different amounts:
 * the provider's own role label is the strongest, the slot he filled in a
 * named shape is next, and his position alone is an admission that nothing
 * placed him. Printing which one applies is what lets a reader argue with the
 * label rather than with the picture.
 */
function roleSentence(estimate: EstimatedHeatmap): string {
  const from =
    estimate.from === null
      ? ''
      : `, last named ${estimate.from.season}${
          estimate.from.gameweek === null ? '' : ` gameweek ${String(estimate.from.gameweek)}`
        }`;

  if (estimate.basis === 'role' && estimate.role !== null) {
    const starts =
      estimate.roleOf === 0
        ? ''
        : ` in ${String(estimate.roleStarts)} of his last ${String(estimate.roleOf)} starts`;
    return `${estimate.role}${starts}${from}`;
  }

  if (estimate.basis === 'slot') {
    return `his slot in the ${estimate.formation ?? 'last named'} shape${from}`;
  }

  return 'his position alone, since no teamsheet names him in a shape';
}

/** The matches the figure read, which is the date on a modelled picture. */
function windowSentence(window: HeatmapWindow): string {
  const span =
    window.from === null || window.to === null
      ? ''
      : window.from.season === window.to.season
        ? ` (${window.from.season}, gameweeks ${String(window.from.gameweek)} to ${String(window.to.gameweek)})`
        : ` (${window.from.season} gameweek ${String(window.from.gameweek)} to ${window.to.season} gameweek ${String(window.to.gameweek)})`;
  const read = `Read from his last ${String(window.matches)} ${
    window.matches === 1 ? 'match' : 'matches'
  }${span}.`;
  return window.fellBack
    ? `${read} He had played nothing at or before the gameweek selected, so these are his most recent instead.`
    : read;
}

export function PlayerHeatmap({
  matches,
  prior,
  form,
  liveSeason,
}: {
  matches: readonly HeatmapMatch[];
  /**
   * Where his role puts him, drawn only when no match was measured. Modelled,
   * and marked as modelled: it is a prior, not an observation.
   */
  prior?: HeatmapPrior | undefined;
  /** His own recent gameweeks, which is what narrows the role to him. */
  form?: readonly EvidenceRow[] | undefined;
  /** The season the ribbon's gameweek numbers belong to. */
  liveSeason?: string | undefined;
}) {
  // The ribbon lives in the other column, so the week comes from the page
  // rather than from a prop threaded through the season component.
  const { gameweek: selectedGameweek, select: onSelectGameweek } = usePlayerFocus();
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
    if (selectedGameweek === null) return inSeason;
    const matching = inSeason.filter((match) => match.gameweek === selectedGameweek);
    return matching.length === 0 ? inSeason : matching;
  }, [inSeason, selectedGameweek]);

  /**
   * The estimate reads the ribbon too, so a reader who narrows the page to a
   * gameweek sees the twelve matches ending there rather than the twelve most
   * recent. The window is stated on the figure either way, because a modelled
   * picture with no period attached is worse than the measured one it stands in
   * for, not better.
   */
  const estimate = useMemo(() => {
    if (prior === undefined) return null;
    const until =
      selectedGameweek === null || liveSeason === undefined
        ? null
        : { season: liveSeason, gameweek: selectedGameweek };
    return composeHeatmap(prior, form ?? [], until);
  }, [prior, form, liveSeason, selectedGameweek]);

  /** The largest uplift any measure claimed, which is what the bars scale to. */
  const strongest = useMemo(
    () => (estimate === null ? 0 : Math.max(0, ...estimate.lobes.map((lobe) => lobe.weight))),
    [estimate],
  );

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

        {estimate === null ? (
          <p className={styles.empty}>
            No tracked match is stored for this player, and there is not enough on record to
            estimate where he plays either. That needs a position at the least, and a teamsheet
            naming him to do it properly.
          </p>
        ) : (
          <>
            {/* Modelled, and marked as modelled everywhere it is drawn: the
                banner above it, the word on the figure, and the broken outline
                around the pitch, which is the same device a draft is printed
                with. Nothing about it should read as a measurement. */}
            <p className={styles.estimateNote}>
              <strong>Estimated, not measured.</strong> No tracking data is stored for him, so this
              is where his role puts him, narrowed by what he actually did. It says nothing about
              whether he drifts, tucks in, or spent March somewhere else.
            </p>

            {/* The role is the claim the whole figure rests on, so it is
                printed rather than implied: the provider's own words, how many
                of his recent starts carried them, and the match the shape was
                read from. A reader who disagrees with the label can see that
                it is the label they disagree with, not the arithmetic. */}
            <p className={styles.role}>
              <span className={styles.roleLabel}>Drawn as</span>
              <span className={styles.roleValue}>{roleSentence(estimate)}</span>
            </p>

            <figure className={styles.figure} data-estimated="true">
              <div className={styles.pitchWrap} data-orientation="vertical">
                <PitchMarkings orientation="vertical">
                  <HeatGrid
                    cols={estimate.cols}
                    rows={estimate.rows}
                    counts={estimate.counts}
                    floor={0.12}
                  />
                  <PitchMarker x={estimate.centreX * 100} y={estimate.centreY * 100} tone="bonus" />
                </PitchMarkings>
                <span className={styles.stamp}>Estimated</span>
              </div>
              <figcaption className={styles.caption}>
                Attacking upward. The mark is the middle of it, the shading is how far it reaches.
              </figcaption>
            </figure>

            {/* The reasons are the figure's legend, not decoration: each one is
                a measure that moved the shading, and the rule beside it is how
                hard. Marked up as a description list, so a screen reader gets
                the same pairing the eye does. */}
            {estimate.lobes.length > 0 && strongest > 0 && (
              <dl className={styles.reasons}>
                <dt className={styles.reasonsHead}>What moved it</dt>
                <dd className={styles.reasonsBody}>
                  <ul className={styles.reasonList}>
                    {estimate.lobes.map((lobe) => (
                      <li key={lobe.kind} className={styles.reason}>
                        <span className={styles.reasonKind}>{REASON_LABEL[lobe.kind]}</span>
                        <span className={styles.reasonNote}>{lobe.note}</span>
                        <span
                          className={styles.reasonWeight}
                          style={{ '--weight': lobe.weight / strongest } as CSSProperties}
                          aria-hidden
                        />
                      </li>
                    ))}
                  </ul>
                  {/* Normalised to this player's strongest measure, so the bars
                      rank what moved his own figure. That costs comparison
                      between two players, so the scale is printed rather than
                      left to be assumed. */}
                  <p className={styles.reasonScale}>
                    Full bar is his strongest, {strongest.toFixed(2)} times the role alone.
                  </p>
                </dd>
              </dl>
            )}

            <p className={styles.window}>
              {estimate.window === null
                ? 'Nothing on his record to narrow it with yet, so this is the role alone.'
                : windowSentence(estimate.window)}
            </p>
          </>
        )}
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
                onSelectGameweek(null);
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
        {narrowedToOne && selectedGameweek !== null
          ? `, gameweek ${String(selectedGameweek)}`
          : `, ${String(aggregate?.matches ?? 0)} tracked ${aggregate?.matches === 1 ? 'match' : 'matches'}`}
        . Every touch, added cell by cell. The player attacks upward.
      </p>

      {gameweeks.length > 0 && (
        <div className={styles.weeks} role="group" aria-label="Filter by gameweek">
          <button
            type="button"
            className={narrowedToOne ? styles.week : styles.weekOn}
            onClick={() => {
              onSelectGameweek(null);
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
                onSelectGameweek(selectedGameweek === week ? null : week);
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
            <PitchMarkings orientation="vertical">
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
