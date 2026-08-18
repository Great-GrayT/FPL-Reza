import type { CareerTotals, PlayerSeason } from '@fpl/core';
import { formatPrice } from '@fpl/core';
import styles from './player-career.module.css';

/**
 * A career at season scale, built from the same idea as the gameweek ribbon: the
 * bar is the measure and the row is the navigation unit. Where the ribbon reads
 * one season across 38 slabs, this reads a whole career across its seasons, so a
 * manager can see a rise, a decline, or one outlier year without reading numbers.
 */

const signed = (value: number): string => (value > 0 ? `+${value.toFixed(1)}` : value.toFixed(1));

function priceDrift(season: PlayerSeason): number {
  return (season.endPrice - season.startPrice) / 10;
}

export function PlayerCareer({
  seasons,
  totals,
}: {
  seasons: readonly PlayerSeason[];
  totals: CareerTotals;
}) {
  if (seasons.length === 0) {
    return (
      <section className={styles.career} aria-labelledby="career">
        <h2 id="career" className={styles.heading}>
          Career
        </h2>
        <p className={styles.empty}>
          No completed Premier League seasons on record for this player. A first season starts
          appearing here once it finishes.
        </p>
      </section>
    );
  }

  const peak = Math.max(...seasons.map((season) => season.totalPoints), 1);

  return (
    <section className={styles.career} aria-labelledby="career">
      <h2 id="career" className={styles.heading}>
        Career
      </h2>

      <dl className={styles.totals}>
        <div>
          <dt>Seasons</dt>
          <dd className="num">{totals.seasons}</dd>
        </div>
        <div>
          <dt>Points</dt>
          <dd className="num">{totals.totalPoints}</dd>
        </div>
        <div>
          <dt>Minutes</dt>
          <dd className="num">{totals.minutes.toLocaleString('en-GB')}</dd>
        </div>
        <div>
          <dt>Goals</dt>
          <dd className="num">{totals.goals}</dd>
        </div>
        <div>
          <dt>Assists</dt>
          <dd className="num">{totals.assists}</dd>
        </div>
        <div>
          <dt>Best</dt>
          <dd className="num">
            {totals.bestSeason ?? '-'}
            {totals.bestSeasonPoints !== null && (
              <span className={styles.bestPoints}> {totals.bestSeasonPoints} pts</span>
            )}
          </dd>
        </div>
      </dl>

      <div className={styles.scroll}>
        <table className={styles.table}>
          <caption className="visually-hidden">Season by season totals, most recent first</caption>
          <thead>
            <tr>
              <th scope="col">Season</th>
              <th scope="col">Points</th>
              <th scope="col" className={styles.barColumn}>
                Share of best season
              </th>
              <th scope="col">Min</th>
              <th scope="col">G</th>
              <th scope="col">A</th>
              <th scope="col">CS</th>
              <th scope="col">Bonus</th>
              <th scope="col">Price</th>
            </tr>
          </thead>
          <tbody>
            {seasons.map((season) => {
              const drift = priceDrift(season);
              const isBest = season.totalPoints === peak;

              return (
                <tr key={season.season} data-best={isBest ? 'true' : undefined}>
                  <th scope="row" className="num">
                    {season.season}
                  </th>
                  <td className="num">{season.totalPoints}</td>
                  <td className={styles.barCell}>
                    <span
                      className={styles.bar}
                      style={{ inlineSize: `${String((100 * season.totalPoints) / peak)}%` }}
                    />
                  </td>
                  <td className="num">{season.minutes.toLocaleString('en-GB')}</td>
                  <td className="num">{season.goals}</td>
                  <td className="num">{season.assists}</td>
                  <td className="num">{season.cleanSheets}</td>
                  <td className="num">{season.bonus}</td>
                  <td className="num">
                    {formatPrice(season.startPrice)}
                    {drift !== 0 && (
                      <span className={drift > 0 ? styles.up : styles.down}> {signed(drift)}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className={styles.note}>
        Totals as Fantasy Premier League recorded them. Expected goals begin in 2022/23 and
        defensive contribution in 2025/26, so a season before those is blank rather than zero.
      </p>
    </section>
  );
}
