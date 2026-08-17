import type { Metadata } from 'next';
import { GAMEWEEKS_PER_SEASON } from '@fpl/core';
import { Crest } from '@/components/crest';
import { getFixtures, getGameweeks, getTeamsById } from '@/lib/lake';
import { kickoff, matchDay } from '@/lib/display';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Matches | FPL Lake',
  description: 'Premier League fixtures and results, gameweek by gameweek',
};

export default async function MatchesPage({
  searchParams,
}: {
  searchParams: Promise<{ gw?: string }>;
}) {
  const [{ gw }, fixtures, gameweeks, teams] = await Promise.all([
    searchParams,
    getFixtures(),
    getGameweeks(),
    getTeamsById(),
  ]);

  const current = gameweeks.find((week) => week.isCurrent) ?? gameweeks.find((week) => week.isNext);
  const requested = gw === undefined ? undefined : Number(gw);
  const selected =
    requested !== undefined && Number.isInteger(requested) ? requested : (current?.id ?? 1);

  const week = gameweeks.find((entry) => entry.id === selected);
  const matches = fixtures
    .filter((fixture) => fixture.gameweek === selected)
    .sort((a, b) => (a.kickoff?.getTime() ?? 0) - (b.kickoff?.getTime() ?? 0));

  // Grouped by calendar day, because that is how a matchweek is actually read.
  const days = new Map<string, typeof matches>();
  for (const match of matches) {
    const key = matchDay(match.kickoff);
    days.set(key, [...(days.get(key) ?? []), match]);
  }

  const unscheduled = fixtures.filter((fixture) => fixture.gameweek === null);

  return (
    <div className="shell">
      <header className={styles.head}>
        <p className="eyebrow">
          {week === undefined ? 'Gameweek' : week.name}
          {week?.deadline !== undefined && ` · deadline ${kickoff(week.deadline)}`}
        </p>
        <h1 className={styles.title}>Matches</h1>
      </header>

      <nav className={styles.weeks} aria-label="Gameweek">
        <ul>
          {Array.from({ length: GAMEWEEKS_PER_SEASON }, (_, index) => index + 1).map((number) => (
            <li key={number}>
              <a
                href={`?gw=${String(number)}`}
                aria-current={number === selected ? 'page' : undefined}
                className={
                  number === selected
                    ? styles.weekOn
                    : number === current?.id
                      ? styles.weekNow
                      : styles.week
                }
              >
                {number}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {matches.length === 0 ? (
        <p className={styles.empty}>
          No fixtures stored for gameweek {selected}. Pick another week, or refresh the fixture
          list.
        </p>
      ) : (
        [...days.entries()].map(([day, dayMatches]) => (
          <section key={day} className={styles.day}>
            <h2 className={styles.dayHeading}>{day}</h2>
            <ul className={styles.matches}>
              {dayMatches.map((match) => {
                const home = teams.get(match.homeTeam);
                const away = teams.get(match.awayTeam);
                const played = match.finished && match.homeScore !== null;
                return (
                  <li key={match.id} className={styles.match}>
                    <div className={`${styles.side} ${styles.homeSide}`}>
                      <span className={styles.club}>{home?.name ?? 'Unknown'}</span>
                      {home !== undefined && <Crest code={home.code} name={home.name} />}
                    </div>

                    <div className={styles.result}>
                      {played ? (
                        <span className={`num ${styles.score}`}>
                          {match.homeScore}&ndash;{match.awayScore}
                        </span>
                      ) : (
                        <span className={`num ${styles.time}`}>{kickoff(match.kickoff)}</span>
                      )}
                      <span className={styles.fdr}>
                        <i
                          style={{ background: `var(--fdr-${String(match.homeDifficulty)})` }}
                          title={`Home difficulty ${String(match.homeDifficulty)}`}
                        />
                        <i
                          style={{ background: `var(--fdr-${String(match.awayDifficulty)})` }}
                          title={`Away difficulty ${String(match.awayDifficulty)}`}
                        />
                      </span>
                    </div>

                    <div className={styles.side}>
                      {away !== undefined && <Crest code={away.code} name={away.name} />}
                      <span className={styles.club}>{away?.name ?? 'Unknown'}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      {unscheduled.length > 0 && (
        <section className={styles.day}>
          <h2 className={styles.dayHeading}>Awaiting a round</h2>
          <p className={styles.empty}>
            {unscheduled.length} postponed{' '}
            {unscheduled.length === 1 ? 'fixture has' : 'fixtures have'} no gameweek yet.
          </p>
        </section>
      )}
    </div>
  );
}
