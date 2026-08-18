import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import { refereeRecord } from '@fpl/core';
import { PersonPhoto } from '@/components/person-photo';
import { getAllMatchDetailsById, getAllMatches, getTeamsByCode } from '@/lib/lake';
import { matchDay } from '@/lib/display';
import styles from './page.module.css';

export async function generateStaticParams(): Promise<{ id: string }[]> {
  const [allMatches, allDetails] = await Promise.all([getAllMatches(), getAllMatchDetailsById()]);
  return refereeRecord(allMatches, allDetails).map((entry) => ({ id: String(entry.refereeId) }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const [allMatches, allDetails] = await Promise.all([getAllMatches(), getAllMatchDetailsById()]);
  const record = refereeRecord(allMatches, allDetails).find(
    (entry) => entry.refereeId === Number(id),
  );
  return { title: record === undefined ? 'Referee' : `${record.name} | FPL Lake` };
}

export default async function RefereePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const refereeId = Number(id);

  const [allMatches, allDetails, teamsByCode] = await Promise.all([
    getAllMatches(),
    getAllMatchDetailsById(),
    getTeamsByCode(),
  ]);

  const record = refereeRecord(allMatches, allDetails).find(
    (entry) => entry.refereeId === refereeId,
  );
  if (record === undefined) notFound();

  const appointments = allMatches
    .filter((match) => match.refereeId === refereeId)
    .sort((a, b) => (b.kickoff?.getTime() ?? 0) - (a.kickoff?.getTime() ?? 0));

  // Which clubs this official has seen most, which is the question a manager
  // actually asks when an appointment is announced.
  const byClub = new Map<number, { matches: number; yellows: number; measured: number }>();
  for (const match of appointments) {
    const detail = allDetails.get(match.matchId);
    for (const teamCode of [match.homeTeamCode, match.awayTeamCode]) {
      const entry = byClub.get(teamCode) ?? { matches: 0, yellows: 0, measured: 0 };
      entry.matches += 1;
      if (detail !== undefined) {
        entry.measured += 1;
        entry.yellows += detail.events.filter(
          (event) => event.type === 'yellow_card' && event.teamCode === teamCode,
        ).length;
      }
      byClub.set(teamCode, entry);
    }
  }

  const clubs = [...byClub.entries()]
    .map(([teamCode, entry]) => ({ team: teamsByCode.get(teamCode), teamCode, ...entry }))
    .filter((entry) => entry.team !== undefined)
    .sort((a, b) => b.matches - a.matches)
    .slice(0, 12);

  return (
    <div className="shell">
      <nav className={styles.crumb} aria-label="Breadcrumb">
        <Link href="/referees">All referees</Link>
      </nav>

      <header className={styles.masthead}>
        <PersonPhoto kind="official" name={record.name} size="lg" />
        <div>
          <p className="eyebrow">Referee</p>
          <h1 className={styles.title}>{record.name}</h1>
          <p className={styles.meta}>
            {record.matches} matches on record across {record.seasons.join(', ')}
          </p>
        </div>
      </header>

      <section className={styles.block} aria-labelledby="rates">
        <h2 id="rates" className={styles.h2}>
          Rates
        </h2>
        <dl className={styles.totals}>
          <div>
            <dt>Matches</dt>
            <dd className="num">{record.matches}</dd>
          </div>
          <div>
            <dt>Home wins</dt>
            <dd className="num">
              {((record.homeWins / Math.max(1, record.matches)) * 100).toFixed(0)}%
            </dd>
          </div>
          <div>
            <dt>Goals per match</dt>
            <dd className="num">{record.goalsPerMatch.toFixed(2)}</dd>
          </div>
          <div>
            <dt>Yellows per match</dt>
            <dd className="num">
              {record.yellowsPerMatch === null ? '-' : record.yellowsPerMatch.toFixed(2)}
            </dd>
          </div>
          <div>
            <dt>Reds per match</dt>
            <dd className="num">
              {record.redsPerMatch === null ? '-' : record.redsPerMatch.toFixed(2)}
            </dd>
          </div>
          <div>
            <dt>Penalties per match</dt>
            <dd className="num">
              {record.penaltiesPerMatch === null ? '-' : record.penaltiesPerMatch.toFixed(2)}
            </dd>
          </div>
        </dl>
        <p className={styles.note}>
          A card rate is measured only over the seasons whose full timelines are stored, which is
          fewer than the seasons of results, so it is blank rather than zero where nothing was
          measured. Treat it as weak evidence in any case: referees are appointed to matches by an
          assessor, so the fixtures are not randomly assigned and a high rate partly reflects who
          they are given.
        </p>
      </section>

      {clubs.length > 0 && (
        <section className={styles.block} aria-labelledby="clubs">
          <h2 id="clubs" className={styles.h2}>
            Clubs seen most
          </h2>
          <ul className={styles.clubs}>
            {clubs.map((entry) => (
              <li key={entry.teamCode}>
                <Link className={styles.clubLink} href={`/teams/${String(entry.teamCode)}`}>
                  {entry.team?.name ?? entry.teamCode}
                </Link>
                <span className={`num ${styles.clubCount}`}>
                  {entry.matches} {entry.matches === 1 ? 'match' : 'matches'}
                  {entry.measured > 0 &&
                    ` · ${(entry.yellows / entry.measured).toFixed(1)} yellows each`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={styles.block} aria-labelledby="appointments">
        <h2 id="appointments" className={styles.h2}>
          Appointments
        </h2>
        <ul className={styles.results}>
          {appointments.slice(0, 30).map((match) => (
            <li key={match.matchId as number}>
              <span className={styles.resultDate}>{matchDay(match.kickoff)}</span>
              <span className={styles.resultTeams}>
                {match.homeTeamName} <span className="num">{match.homeScore}</span>&ndash;
                <span className="num">{match.awayScore}</span> {match.awayTeamName}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
