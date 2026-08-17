import Link from 'next/link';
import { Crest } from '@/components/crest';
import { getFixtures, getGameweeks, getPlayers, getTeamsById } from '@/lib/lake';
import { kickoff, price } from '@/lib/display';
import styles from './page.module.css';

export default async function HomePage() {
  const [players, gameweeks, fixtures, teams] = await Promise.all([
    getPlayers(),
    getGameweeks(),
    getFixtures(),
    getTeamsById(),
  ]);

  if (players.length === 0) {
    return (
      <div className="shell">
        <section className={styles.hero}>
          <h1 className={styles.title}>Nothing landed yet</h1>
          <p className={styles.lede}>
            The lake holds no snapshots for this season. Run <code>pnpm sync</code> to pull teams,
            players, gameweeks, and fixtures, then reload.
          </p>
        </section>
      </div>
    );
  }

  const upcoming =
    gameweeks.find((week) => week.isNext) ?? gameweeks.find((week) => week.isCurrent);
  const nextGameweek = upcoming?.id;
  const nextMatches = fixtures
    .filter((fixture) => fixture.gameweek === nextGameweek)
    .sort((a, b) => (a.kickoff?.getTime() ?? 0) - (b.kickoff?.getTime() ?? 0))
    .slice(0, 5);

  const topScorers = [...players].sort((a, b) => b.totalPoints - a.totalPoints).slice(0, 8);
  const inForm = [...players]
    .filter((player) => player.minutes > 0)
    .sort((a, b) => b.form - a.form)
    .slice(0, 8);

  return (
    <div className="shell">
      <section className={styles.hero}>
        <p className="eyebrow">
          {upcoming === undefined
            ? 'Between seasons'
            : `${upcoming.name} · deadline ${kickoff(upcoming.deadline)}`}
        </p>
        <h1 className={styles.title}>
          Thirty eight
          <br />
          gameweeks
        </h1>
        <p className={styles.lede}>
          Fantasy Premier League time is not continuous. It is 38 discrete slabs, and every decision
          a manager makes is per gameweek. This is that season, one player and one match at a time.
        </p>
        <p className={styles.cta}>
          <Link href="/players">Browse players</Link>
          <Link href="/matches">See the fixtures</Link>
        </p>
      </section>

      <div className={styles.columns}>
        <section aria-labelledby="next-heading">
          <h2 id="next-heading" className={styles.h2}>
            Next up
          </h2>
          {nextMatches.length === 0 ? (
            <p className={styles.dim}>No fixtures scheduled for the next gameweek yet.</p>
          ) : (
            <ul className={styles.list}>
              {nextMatches.map((match) => {
                const home = teams.get(match.homeTeam);
                const away = teams.get(match.awayTeam);
                return (
                  <li key={match.id} className={styles.fixture}>
                    <span className={styles.fixtureTeams}>
                      {home !== undefined && <Crest code={home.code} name={home.name} size={22} />}
                      <span>{home?.shortName ?? '???'}</span>
                      <span className={styles.dim}>v</span>
                      <span>{away?.shortName ?? '???'}</span>
                      {away !== undefined && <Crest code={away.code} name={away.name} size={22} />}
                    </span>
                    <span className={`num ${styles.dim}`}>{kickoff(match.kickoff)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="points-heading">
          <h2 id="points-heading" className={styles.h2}>
            Most points
          </h2>
          <ol className={styles.list}>
            {topScorers.map((player) => (
              <li key={player.id} className={styles.rank}>
                <Link href={`/players/${String(player.id)}`}>{player.webName}</Link>
                <span className={`num ${styles.dim}`}>{price(player.price)}</span>
                <span className={`num ${styles.strong}`}>{player.totalPoints}</span>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="form-heading">
          <h2 id="form-heading" className={styles.h2}>
            In form
          </h2>
          <ol className={styles.list}>
            {inForm.map((player) => (
              <li key={player.id} className={styles.rank}>
                <Link href={`/players/${String(player.id)}`}>{player.webName}</Link>
                <span className={`num ${styles.dim}`}>{price(player.price)}</span>
                <span className={`num ${styles.strong}`}>{player.form.toFixed(1)}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
