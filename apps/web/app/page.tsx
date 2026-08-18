import Link from 'next/link';
import { estimateStrength, forecastMatch } from '@fpl/analytics';
import { Crest } from '@/components/crest';
import { PersonPhoto } from '@/components/person-photo';
import { getAllMatches, getFixtures, getGameweeks, getPlayers, getTeamsById } from '@/lib/lake';
import { kickoff, price } from '@/lib/display';
import styles from './page.module.css';

export default async function HomePage() {
  const [players, gameweeks, fixtures, teams, allMatches] = await Promise.all([
    getPlayers(),
    getGameweeks(),
    getFixtures(),
    getTeamsById(),
    getAllMatches(),
  ]);

  // One model for the page: estimating the division's strengths once and
  // reading five fixtures off it, rather than once per fixture.
  const model = estimateStrength(allMatches);

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
          <Link href="/stats">Read the analysis</Link>
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
                const forecast =
                  home === undefined || away === undefined
                    ? null
                    : forecastMatch(model, home.code, away.code);
                return (
                  <li key={match.id} className={styles.fixture}>
                    <Link className={styles.fixtureLink} href={`/matches/${String(match.id)}`}>
                      <span className={styles.fixtureTeams}>
                        {home !== undefined && (
                          <Crest code={home.code} name={home.name} size={22} />
                        )}
                        <span>{home?.shortName ?? '???'}</span>
                        <span className={styles.dim}>v</span>
                        <span>{away?.shortName ?? '???'}</span>
                        {away !== undefined && (
                          <Crest code={away.code} name={away.name} size={22} />
                        )}
                      </span>
                      <span className={`num ${styles.dim}`}>{kickoff(match.kickoff)}</span>
                      {forecast !== null && (
                        <span className={`num ${styles.chance}`}>
                          {(forecast.homeWin * 100).toFixed(0)}
                          <span className={styles.dim}>/</span>
                          {(forecast.draw * 100).toFixed(0)}
                          <span className={styles.dim}>/</span>
                          {(forecast.awayWin * 100).toFixed(0)}
                        </span>
                      )}
                    </Link>
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
                <Link className={styles.person} href={`/players/${String(player.id)}`}>
                  <PersonPhoto kind="player" code={player.code} name={player.webName} size="xs" />
                  <span>{player.webName}</span>
                </Link>
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
                <Link className={styles.person} href={`/players/${String(player.id)}`}>
                  <PersonPhoto kind="player" code={player.code} name={player.webName} size="xs" />
                  <span>{player.webName}</span>
                </Link>
                <span className={`num ${styles.dim}`}>{price(player.price)}</span>
                <span className={`num ${styles.strong}`}>{player.form.toFixed(1)}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <section className={styles.explore} aria-labelledby="explore-heading">
        <h2 id="explore-heading" className={styles.h2}>
          Everything else on record
        </h2>
        <ul className={styles.exploreList}>
          <li>
            <Link href="/teams">
              <span className={styles.exploreTitle}>Clubs</span>
              <span className={styles.exploreNote}>
                Squad, staff, strength, and a record for every season the club has played.
              </span>
            </Link>
          </li>
          <li>
            <Link href="/managers">
              <span className={styles.exploreTitle}>Managers</span>
              <span className={styles.exploreNote}>
                Who is in charge, where, and what their side has done under them.
              </span>
            </Link>
          </li>
          <li>
            <Link href="/referees">
              <span className={styles.exploreTitle}>Referees</span>
              <span className={styles.exploreNote}>
                Appointments, and how freely each one books, with the caveat attached.
              </span>
            </Link>
          </li>
          <li>
            <Link href="/grounds">
              <span className={styles.exploreTitle}>Grounds</span>
              <span className={styles.exploreNote}>
                Where the season is played, photographed and credited.
              </span>
            </Link>
          </li>
          <li>
            <Link href="/stats">
              <span className={styles.exploreTitle}>Analysis</span>
              <span className={styles.exploreNote}>
                What {allMatches.length.toLocaleString('en-GB')} matches say about home advantage
                and goals.
              </span>
            </Link>
          </li>
          <li>
            <Link href="/glossary">
              <span className={styles.exploreTitle}>Glossary</span>
              <span className={styles.exploreNote}>
                Every metric this site shows, defined by its exact operation.
              </span>
            </Link>
          </li>
        </ul>
      </section>
    </div>
  );
}
