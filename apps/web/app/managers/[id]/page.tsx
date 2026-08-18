import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import { teamRecord, type Match } from '@fpl/core';
import { Crest } from '@/components/crest';
import { PersonPhoto } from '@/components/person-photo';
import { getAllMatches, getManagers, getTeamsByCode } from '@/lib/lake';
import { matchDay } from '@/lib/display';
import styles from './page.module.css';

export async function generateStaticParams(): Promise<{ id: string }[]> {
  const managers = await getManagers();
  return [...new Set(managers.map((manager) => manager.managerId))].map((id) => ({
    id: String(id),
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const manager = (await getManagers()).find((entry) => entry.managerId === Number(id));
  return { title: manager === undefined ? 'Manager' : `${manager.name} | FPL Lake` };
}

const AGE_MS = 365.2425 * 24 * 60 * 60 * 1000;

export default async function ManagerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const managerId = Number(id);

  const [managers, teamsByCode, allMatches] = await Promise.all([
    getManagers(),
    getTeamsByCode(),
    getAllMatches(),
  ]);

  const spells = managers
    .filter((entry) => entry.managerId === managerId)
    .sort((a, b) => b.season.localeCompare(a.season));

  const manager = spells[0];
  if (manager === undefined) notFound();

  const club = teamsByCode.get(manager.teamCode);

  // The record is the club's over the seasons this person is recorded at it,
  // which is not the same as the record of every match they took charge of: a
  // mid season appointment inherits the games played before they arrived. The
  // page says so rather than quietly presenting one as the other.
  const seasonsHeld = new Set(spells.map((spell) => `${spell.season}|${String(spell.teamCode)}`));
  const relevant: Match[] = allMatches.filter((match) =>
    spells.some(
      (spell) =>
        match.season === spell.season &&
        (match.homeTeamCode === spell.teamCode || match.awayTeamCode === spell.teamCode),
    ),
  );

  const bySeason = spells.map((spell) => ({
    spell,
    record: teamRecord(
      allMatches.filter((match) => match.season === spell.season),
      spell.teamCode,
    ),
    club: teamsByCode.get(spell.teamCode),
  }));

  const total = bySeason.reduce(
    (sum, entry) => ({
      played: sum.played + entry.record.played,
      won: sum.won + entry.record.won,
      drawn: sum.drawn + entry.record.drawn,
      lost: sum.lost + entry.record.lost,
      points: sum.points + entry.record.points,
    }),
    { played: 0, won: 0, drawn: 0, lost: 0, points: 0 },
  );

  const age =
    manager.birthDate === null
      ? null
      : Math.floor((Date.now() - manager.birthDate.getTime()) / AGE_MS);

  const recent = relevant
    .filter((match) => match.status === 'completed')
    .sort((a, b) => (b.kickoff?.getTime() ?? 0) - (a.kickoff?.getTime() ?? 0))
    .slice(0, 8);

  return (
    <div className="shell">
      <nav className={styles.crumb} aria-label="Breadcrumb">
        <Link href="/managers">All managers</Link>
      </nav>

      <header className={styles.masthead}>
        <PersonPhoto kind="manager" code={manager.photoCode} name={manager.name} size="lg" />
        <div className={styles.identity}>
          <p className="eyebrow">
            {manager.role}
            {club === undefined ? '' : ` · ${club.name}`}
          </p>
          <h1 className={styles.title}>{manager.name}</h1>
          <p className={styles.meta}>
            {manager.country ?? 'Nationality not recorded'}
            {age !== null && ` · ${String(age)}`}
          </p>
        </div>
        {club !== undefined && (
          <Link className={styles.clubLink} href={`/teams/${String(club.code)}`}>
            <Crest code={club.code} name={club.name} size={44} />
            {/* The crest is decorative, so without this the link announces as
                nothing at all. */}
            <span className="visually-hidden">{club.name}</span>
          </Link>
        )}
      </header>

      <section className={styles.block} aria-labelledby="record">
        <h2 id="record" className={styles.h2}>
          Record
        </h2>
        <p className={styles.note}>
          The club&apos;s record across the {String(seasonsHeld.size)}{' '}
          {seasonsHeld.size === 1 ? 'season' : 'seasons'} this person is recorded in charge. The
          provider publishes a season, not a start date, so a mid season appointment inherits every
          match played before they arrived. Read it as the club&apos;s season, not as their tenure.
        </p>
        <dl className={styles.totals}>
          <div>
            <dt>Played</dt>
            <dd className="num">{total.played}</dd>
          </div>
          <div>
            <dt>Won</dt>
            <dd className="num">{total.won}</dd>
          </div>
          <div>
            <dt>Drawn</dt>
            <dd className="num">{total.drawn}</dd>
          </div>
          <div>
            <dt>Lost</dt>
            <dd className="num">{total.lost}</dd>
          </div>
          <div>
            <dt>Points per match</dt>
            <dd className="num">
              {total.played === 0 ? '-' : (total.points / total.played).toFixed(2)}
            </dd>
          </div>
        </dl>

        <div className={styles.scroll}>
          <table className={styles.table}>
            <caption className="visually-hidden">Season by season, newest first</caption>
            <thead>
              <tr>
                <th scope="col">Season</th>
                <th scope="col">Club</th>
                <th scope="col">Role</th>
                <th scope="col">P</th>
                <th scope="col">W</th>
                <th scope="col">D</th>
                <th scope="col">L</th>
                <th scope="col">Pts</th>
              </tr>
            </thead>
            <tbody>
              {bySeason.map((entry) => (
                <tr key={`${entry.spell.season}-${String(entry.spell.teamCode)}`}>
                  <th scope="row" className="num">
                    {entry.spell.season}
                  </th>
                  <td>{entry.club?.shortName ?? entry.spell.teamCode}</td>
                  <td>{entry.spell.role}</td>
                  <td className="num">{entry.record.played}</td>
                  <td className="num">{entry.record.won}</td>
                  <td className="num">{entry.record.drawn}</td>
                  <td className="num">{entry.record.lost}</td>
                  <td className="num">{entry.record.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {recent.length > 0 && (
        <section className={styles.block} aria-labelledby="recent">
          <h2 id="recent" className={styles.h2}>
            Latest results
          </h2>
          <ul className={styles.results}>
            {recent.map((match) => (
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
      )}
    </div>
  );
}
