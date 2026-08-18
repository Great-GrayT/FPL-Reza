import type { Metadata } from 'next';
import Link from 'next/link';
import { refereeRecord } from '@fpl/core';
import { PersonPhoto } from '@/components/person-photo';
import { getAllMatchDetailsById, getAllMatches } from '@/lib/lake';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Referees | FPL Lake',
  description: 'Premier League referees, their matches, and how freely they book',
};

export default async function RefereesPage() {
  const [allMatches, allDetails] = await Promise.all([getAllMatches(), getAllMatchDetailsById()]);
  const records = refereeRecord(allMatches, allDetails).filter((entry) => entry.matches >= 3);

  if (records.length === 0) {
    return (
      <div className="shell">
        <header className={styles.head}>
          <h1 className={styles.title}>Referees</h1>
        </header>
        <p className={styles.empty}>
          No referee appointments stored. Run <code>fpl official matches</code> with a detail season
          to read them.
        </p>
      </div>
    );
  }

  const measured = records.filter((entry) => entry.yellowsPerMatch !== null);

  return (
    <div className="shell">
      <header className={styles.head}>
        <p className="eyebrow">{records.length} officials</p>
        <h1 className={styles.title}>Referees</h1>
        <p className={styles.lede}>
          Who takes charge, and how freely they book. Cards come from the seasons whose full
          timelines are stored, which is fewer than the seasons of results, so a rate is blank
          rather than zero where nothing was measured. No referee has a published portrait, so each
          carries a monogram.
        </p>
      </header>

      <div className={styles.scroll}>
        <table className={styles.table}>
          <caption className="visually-hidden">Referees, most matches first</caption>
          <thead>
            <tr>
              <th scope="col">Referee</th>
              <th scope="col">Matches</th>
              <th scope="col">Home wins</th>
              <th scope="col">Draws</th>
              <th scope="col">Away wins</th>
              <th scope="col">Goals per match</th>
              <th scope="col">Yellows per match</th>
              <th scope="col">Reds per match</th>
            </tr>
          </thead>
          <tbody>
            {records.map((entry) => (
              <tr key={entry.refereeId}>
                <th scope="row" className={styles.nameCell}>
                  <Link className={styles.nameLink} href={`/referees/${String(entry.refereeId)}`}>
                    <PersonPhoto kind="official" name={entry.name} size="xs" />
                    <span>{entry.name}</span>
                  </Link>
                </th>
                <td className="num">{entry.matches}</td>
                <td className="num">{entry.homeWins}</td>
                <td className="num">{entry.draws}</td>
                <td className="num">{entry.awayWins}</td>
                <td className="num">{entry.goalsPerMatch.toFixed(2)}</td>
                <td className="num">
                  {entry.yellowsPerMatch === null ? (
                    <span className={styles.dim}>not measured</span>
                  ) : (
                    entry.yellowsPerMatch.toFixed(2)
                  )}
                </td>
                <td className="num">
                  {entry.redsPerMatch === null ? (
                    <span className={styles.dim}>-</span>
                  ) : (
                    entry.redsPerMatch.toFixed(2)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {measured.length > 0 && (
        <p className={styles.footnote}>
          Card rates measured across {String(measured.length)} referees. A high yellow rate is a
          weak signal on its own: a referee is appointed to the matches an assessor thinks they can
          handle, so the fixtures are not randomly assigned and the rate partly measures who they
          are given rather than how they officiate.
        </p>
      )}
    </div>
  );
}
