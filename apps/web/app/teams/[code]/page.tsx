import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import { asGameweekId, headToHead, playerFullName, recentForm, teamRecord } from '@fpl/core';
import { estimateStrength, fixtureDifficulty, projectPoints } from '@fpl/analytics';
import { Crest } from '@/components/crest';
import { PersonChip } from '@/components/person-photo';
import { MetricTip } from '@/components/metric-tip';
import { GroundPhoto } from '@/components/ground-photo';
import {
  getAllMatches,
  getFixtures,
  getGameweeks,
  getGroundsById,
  getGroundImages,
  getManagersByTeamCode,
  getCurrentManager,
  getMatchSeasons,
  getPlayers,
  getTeams,
  getTeamsByCode,
  season,
} from '@/lib/lake';
import { kickoff, price } from '@/lib/display';
import styles from './page.module.css';

export async function generateStaticParams(): Promise<{ code: string }[]> {
  const teams = await getTeams();
  return teams.map((team) => ({ code: String(team.code) }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  const team = (await getTeamsByCode()).get(Number(code));
  return { title: team === undefined ? 'Club' : `${team.name} | FPL Lake` };
}

export default async function TeamPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const teamCode = Number(code);

  const [
    teamsByCode,
    allMatches,
    managersByTeam,
    players,
    fixtures,
    gameweeks,
    grounds,
    groundImages,
    seasons,
  ] = await Promise.all([
    getTeamsByCode(),
    getAllMatches(),
    getManagersByTeamCode(),
    getPlayers(),
    getFixtures(),
    getGameweeks(),
    getGroundsById(),
    getGroundImages(),
    getMatchSeasons(),
  ]);

  const team = teamsByCode.get(teamCode);
  if (team === undefined) notFound();

  const model = estimateStrength(allMatches);
  const strength = model.teams.get(teamCode);
  const thisSeason = allMatches.filter((match) => match.season === season);
  const record = teamRecord(thisSeason, teamCode);
  const form = recentForm(allMatches, teamCode);

  const managers = managersByTeam.get(teamCode) ?? [];
  // A departed manager stays listed in the staff feed with no date to retire him,
  // so a club mid handover carries two rows reading "Manager". Only the one the
  // dated spells name is in charge; the head coach leads the list.
  const head = await getCurrentManager(teamCode);
  const staff = managers
    .filter((entry) => entry.season === managers[0]?.season)
    .filter(
      (entry) => entry.role.toLowerCase() !== 'manager' || entry.managerId === head?.managerId,
    )
    .sort(
      (a, b) => Number(b.managerId === head?.managerId) - Number(a.managerId === head?.managerId),
    );

  const ground = [...grounds.values()].find((entry) => entry.teamCode === teamCode);

  // A club's record season by season, which is what a club page is for: one
  // line each, so a rise or a relegation reads as a shape rather than prose.
  const bySeason = seasons
    .map((label) => {
      const seasonLabel = label.replace('-', '/');
      const matches = allMatches.filter((match) => match.season === seasonLabel);
      return { season: seasonLabel, record: teamRecord(matches, teamCode) };
    })
    .filter((entry) => entry.record.played > 0);

  const peak = Math.max(...bySeason.map((entry) => entry.record.points), 1);

  const squad = players.filter((player) => (player.teamId as number) === (team.id as number));
  const current = gameweeks.find((week) => week.isCurrent) ?? gameweeks.find((week) => week.isNext);
  const fromGameweek = (current?.id as number | undefined) ?? 1;

  const outlook = fixtureDifficulty(fixtures, team.id, asGameweekId(fromGameweek), 6);
  const ranked = squad
    .map((player) => ({
      player,
      projection: projectPoints(player, { fixtures, fromGameweek, horizon: 6 }),
    }))
    .sort((a, b) => b.projection.points - a.projection.points);

  const upcoming = fixtures
    .filter(
      (fixture) =>
        ((fixture.homeTeam as number) === (team.id as number) ||
          (fixture.awayTeam as number) === (team.id as number)) &&
        !fixture.finished,
    )
    .sort((a, b) => (a.kickoff?.getTime() ?? 0) - (b.kickoff?.getTime() ?? 0))
    .slice(0, 6);

  // The clubs this one has struggled against, over everything on record.
  const rivals = [...teamsByCode.values()]
    .filter((other) => other.code !== teamCode)
    .map((other) => ({ other, record: headToHead(allMatches, teamCode, other.code) }))
    .filter((entry) => entry.record.played >= 6)
    .sort((a, b) => a.record.homeWins / a.record.played - b.record.homeWins / b.record.played)
    .slice(0, 5);

  return (
    <div className="shell">
      <nav className={styles.crumb} aria-label="Breadcrumb">
        <Link href="/teams">All clubs</Link>
      </nav>

      <header className={styles.masthead}>
        <Crest code={team.code} name={team.name} size={88} />
        <div>
          <p className="eyebrow">
            {ground === undefined ? 'Premier League' : `${ground.name}, ${ground.city ?? ''}`}
          </p>
          <h1 className={styles.title}>{team.name}</h1>
          <p className={styles.form}>
            {form.map((result, index) => (
              <span key={index} className={styles[`form${result}`]}>
                {result}
              </span>
            ))}
            {form.length === 0 && <span className={styles.dim}>no results on record</span>}
          </p>
        </div>
      </header>

      {ground !== undefined && (
        <section className={styles.block} aria-labelledby="ground">
          <h2 id="ground" className="visually-hidden">
            Home ground
          </h2>
          <GroundPhoto ground={ground} image={groundImages.get(ground.groundId)} priority />
        </section>
      )}

      <div className={styles.columns}>
        <section aria-labelledby="staff">
          <h2 id="staff" className={styles.h2}>
            Staff
          </h2>
          {staff.length === 0 ? (
            <p className={styles.note}>No staff recorded for this club.</p>
          ) : (
            <ul className={styles.people}>
              {staff.map((manager) => (
                <li key={manager.managerId}>
                  <PersonChip
                    kind="manager"
                    code={manager.photoCode}
                    name={manager.name}
                    detail={`${manager.role}${manager.country === null ? '' : ` · ${manager.country}`}`}
                    size="md"
                    href={`/managers/${String(manager.managerId)}`}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="strength">
          <h2 id="strength" className={styles.h2}>
            Strength
          </h2>
          <dl className={styles.stats}>
            <div>
              <dt>Attack</dt>
              <dd className="num">{strength === undefined ? '-' : strength.attack.toFixed(2)}</dd>
            </div>
            <div>
              <dt>Defence</dt>
              <dd className="num">{strength === undefined ? '-' : strength.defence.toFixed(2)}</dd>
            </div>
            <div>
              <dt>Played</dt>
              <dd className="num">{record.played}</dd>
            </div>
            <div>
              <dt>Points</dt>
              <dd className="num">{record.points}</dd>
            </div>
          </dl>
          <p className={styles.note}>
            Both are ratios to the division average of {model.baseline.toFixed(2)} goals per team
            per match. Above 1 in attack means more goals than average; above 1 in defence means
            more conceded.
            {strength?.shrunk === true &&
              ' This club has fewer than ten matches on record, so its ratios are blended towards the average.'}
          </p>
        </section>

        <section aria-labelledby="run">
          <h2 id="run" className={styles.h2}>
            Next six
          </h2>
          <p className={styles.note}>
            Average <MetricTip id="fixture-difficulty">difficulty</MetricTip>{' '}
            <span className="num">
              {outlook.averageDifficulty === null ? '-' : outlook.averageDifficulty.toFixed(2)}
            </span>
            {outlook.blankGameweeks.length > 0 && `, blank in ${outlook.blankGameweeks.join(', ')}`}
            {outlook.doubleGameweeks.length > 0 &&
              `, double in ${outlook.doubleGameweeks.join(', ')}`}
            .
          </p>
          <ul className={styles.fixtures}>
            {upcoming.map((fixture) => {
              const home = (fixture.homeTeam as number) === (team.id as number);
              const otherId = home ? (fixture.awayTeam as number) : (fixture.homeTeam as number);
              const other = [...teamsByCode.values()].find(
                (entry) => (entry.id as number) === otherId,
              );
              const difficulty = home ? fixture.homeDifficulty : fixture.awayDifficulty;
              return (
                <li key={fixture.id}>
                  <Link className={styles.fixtureLink} href={`/matches/${String(fixture.id)}`}>
                    <span
                      className={styles.fdr}
                      style={{ background: `var(--fdr-${String(difficulty)})` }}
                      aria-hidden
                    />
                    <span className={styles.fixtureOpponent}>
                      {home ? 'v' : 'at'} {other?.shortName ?? '???'}
                    </span>
                    <span className={`num ${styles.fixtureTime}`}>{kickoff(fixture.kickoff)}</span>
                  </Link>
                </li>
              );
            })}
            {upcoming.length === 0 && <li className={styles.note}>No fixtures scheduled.</li>}
          </ul>
        </section>
      </div>

      <section className={styles.block} aria-labelledby="squad">
        <h2 id="squad" className={styles.h2}>
          Squad
        </h2>
        <p className={styles.note}>
          Ranked by <MetricTip id="projected-points">projected points</MetricTip> over the next six
          gameweeks, which folds in this run of fixtures.
        </p>
        <ul className={styles.squad}>
          {ranked.map(({ player, projection }) => (
            <li key={player.id as number}>
              <PersonChip
                kind="player"
                code={player.code}
                name={player.webName}
                detail={`${player.position} · ${price(player.price)}`}
                size="md"
                href={`/players/${String(player.id as number)}`}
              />
              <span className={`num ${styles.projected}`} title={playerFullName(player)}>
                {projection.points.toFixed(1)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.block} aria-labelledby="history">
        <h2 id="history" className={styles.h2}>
          Season by season
        </h2>
        {bySeason.length === 0 ? (
          <p className={styles.note}>No completed season on record for this club.</p>
        ) : (
          <div className={styles.scroll}>
            <table className={styles.table}>
              <caption className="visually-hidden">
                Premier League record by season, newest first
              </caption>
              <thead>
                <tr>
                  <th scope="col">Season</th>
                  <th scope="col">P</th>
                  <th scope="col">W</th>
                  <th scope="col">D</th>
                  <th scope="col">L</th>
                  <th scope="col">GF</th>
                  <th scope="col">GA</th>
                  <th scope="col">Pts</th>
                  <th scope="col" className={styles.barColumn}>
                    Share of best
                  </th>
                </tr>
              </thead>
              <tbody>
                {bySeason.map((entry) => (
                  <tr key={entry.season}>
                    <th scope="row" className="num">
                      {entry.season}
                    </th>
                    <td className="num">{entry.record.played}</td>
                    <td className="num">{entry.record.won}</td>
                    <td className="num">{entry.record.drawn}</td>
                    <td className="num">{entry.record.lost}</td>
                    <td className="num">{entry.record.goalsFor}</td>
                    <td className="num">{entry.record.goalsAgainst}</td>
                    <td className={`num ${styles.strong}`}>{entry.record.points}</td>
                    <td className={styles.barCell}>
                      <span
                        className={styles.bar}
                        style={{ width: `${String((entry.record.points / peak) * 100)}%` }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {rivals.length > 0 && (
        <section className={styles.block} aria-labelledby="rivals">
          <h2 id="rivals" className={styles.h2}>
            Hardest opponents
          </h2>
          <p className={styles.note}>
            Clubs met at least six times, by the share of those meetings {team.shortName} won.
          </p>
          <ul className={styles.rivals}>
            {rivals.map(({ other, record: h2h }) => (
              <li key={other.code}>
                <Link className={styles.rivalLink} href={`/teams/${String(other.code)}`}>
                  <Crest code={other.code} name={other.name} size={28} />
                  <span className={styles.rivalName}>{other.name}</span>
                </Link>
                <span className={`num ${styles.rivalRecord}`}>
                  {h2h.homeWins}W {h2h.draws}D {h2h.awayWins}L
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
