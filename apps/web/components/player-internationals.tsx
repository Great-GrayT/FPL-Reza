import type { InternationalSeason, InternationalTotals } from '@fpl/core';
import { classes } from '@/lib/classes';
import styles from './player-internationals.module.css';

/**
 * The half of a career FPL does not carry. Grouped by competition rather than
 * listed flat, because "four World Cups" is the fact a reader wants and eleven
 * tournament season rows is not.
 *
 * Caps here mean appearances in the national team competitions the provider
 * tracks, which is not an official cap count: friendlies and untracked
 * competitions are simply absent, so the total reads as a floor.
 */
export function PlayerInternationals({
  seasons,
  totals,
}: {
  seasons: readonly InternationalSeason[];
  totals: InternationalTotals;
}) {
  if (seasons.length === 0) return null;

  const byCompetition = new Map<string, InternationalSeason[]>();
  for (const season of seasons) {
    const existing = byCompetition.get(season.tournament);
    if (existing === undefined) byCompetition.set(season.tournament, [season]);
    else existing.push(season);
  }

  return (
    <section className={styles.internationals} aria-labelledby="internationals">
      <h2 id="internationals" className={styles.heading}>
        International
      </h2>

      <p className={styles.summary}>
        {totals.country !== null && <strong>{totals.country}</strong>}
        {totals.country !== null && ' · '}
        <span className="num">{totals.caps}</span> appearances,{' '}
        <span className="num">{totals.goals}</span> goals across{' '}
        <span className="num">{totals.tournaments}</span>{' '}
        {totals.tournaments === 1 ? 'competition' : 'competitions'}.
      </p>

      <ul className={styles.competitions}>
        {[...byCompetition.entries()].map(([tournament, rows]) => (
          <li key={tournament} className={styles.competition}>
            <h3 className={styles.competitionName}>{tournament}</h3>
            <ul className={styles.editions}>
              {rows.map((row) => (
                <li key={`${tournament}-${row.season}`} className={styles.edition}>
                  <span className={classes(styles.year, 'num')}>{row.season}</span>
                  <span className={styles.team}>{row.country}</span>
                  <span className={classes(styles.figures, 'num')}>
                    {row.appearances ?? 0} apps
                    {(row.goals ?? 0) > 0 && <> · {row.goals} goals</>}
                    {(row.assists ?? 0) > 0 && <> · {row.assists} assists</>}
                    {row.minutes !== null && <> · {row.minutes} min</>}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      <p className={styles.note}>
        Appearances in the national team competitions the provider tracks, which is a floor rather
        than an official cap count: friendlies and untracked competitions are absent. A youth side
        is named as one, so France U20 is not France.
      </p>
    </section>
  );
}
