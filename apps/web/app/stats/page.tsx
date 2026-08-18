import type { Metadata } from 'next';
import Link from 'next/link';
import { refereeRecord, teamRecord, type Match } from '@fpl/core';
import { estimateStrength } from '@fpl/analytics';
import { Crest } from '@/components/crest';
import { SeasonTrend } from '@/components/season-trend';
import {
  getAllMatchDetailsById,
  getAllMatches,
  getGroundsById,
  getMatchSeasons,
  getTeamsByCode,
} from '@/lib/lake';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Analysis | FPL Lake',
  description:
    'What thirty five seasons of Premier League results say about goals, home advantage, and who is actually strong',
};

interface SeasonSummary {
  season: string;
  matches: number;
  goals: number;
  goalsPerMatch: number;
  homeWinShare: number;
  drawShare: number;
  awayWinShare: number;
  homeGoalShare: number;
}

function summarise(matches: readonly Match[]): SeasonSummary | null {
  const played = matches.filter((match) => match.homeScore !== null && match.awayScore !== null);
  if (played.length === 0) return null;

  let goals = 0;
  let homeGoals = 0;
  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;

  for (const match of played) {
    const home = match.homeScore ?? 0;
    const away = match.awayScore ?? 0;
    goals += home + away;
    homeGoals += home;
    if (home > away) homeWins += 1;
    else if (home === away) draws += 1;
    else awayWins += 1;
  }

  return {
    season: played[0]?.season ?? '',
    matches: played.length,
    goals,
    goalsPerMatch: goals / played.length,
    homeWinShare: homeWins / played.length,
    drawShare: draws / played.length,
    awayWinShare: awayWins / played.length,
    homeGoalShare: goals === 0 ? 0 : homeGoals / goals,
  };
}

export default async function StatsPage() {
  const [seasons, allMatches, teamsByCode, allDetails, grounds] = await Promise.all([
    getMatchSeasons(),
    getAllMatches(),
    getTeamsByCode(),
    getAllMatchDetailsById(),
    getGroundsById(),
  ]);

  if (allMatches.length === 0) {
    return (
      <div className="shell">
        <header className={styles.head}>
          <h1 className={styles.title}>Analysis</h1>
        </header>
        <p className={styles.empty}>
          No results stored. Run <code>fpl official matches</code> to read the Premier League&apos;s
          own record.
        </p>
      </div>
    );
  }

  const bySeason = seasons
    .map((label) =>
      summarise(allMatches.filter((match) => match.season === label.replace('-', '/'))),
    )
    .filter((entry): entry is SeasonSummary => entry !== null)
    .sort((a, b) => a.season.localeCompare(b.season));

  const model = estimateStrength(allMatches);
  const strengths = [...model.teams.values()]
    .map((strength) => ({ strength, team: teamsByCode.get(strength.teamCode) }))
    .filter((entry) => entry.team !== undefined)
    .sort((a, b) => b.strength.attack - a.strength.attack);

  const bestDefences = [...strengths].sort((a, b) => a.strength.defence - b.strength.defence);

  const firstSeason = bySeason[0];
  const lastSeason = bySeason[bySeason.length - 1];

  // Home advantage over time is the single clearest thing this archive shows,
  // and it is not a constant: it fell sharply through the 2010s and collapsed
  // in the season played without crowds, which the chart makes obvious.
  const homeTrend = bySeason.map((entry) => ({
    season: entry.season,
    value: entry.homeWinShare * 100,
  }));
  const goalTrend = bySeason.map((entry) => ({
    season: entry.season,
    value: entry.goalsPerMatch,
  }));

  const referees = refereeRecord(allMatches, allDetails)
    .filter((entry) => entry.yellowsPerMatch !== null && entry.matches >= 10)
    .sort((a, b) => (b.yellowsPerMatch ?? 0) - (a.yellowsPerMatch ?? 0));

  const biggestGrounds = [...grounds.values()]
    .filter((ground) => ground.capacity !== null)
    .sort((a, b) => (b.capacity ?? 0) - (a.capacity ?? 0))
    .slice(0, 8);

  const allTime = [...teamsByCode.values()]
    .map((team) => ({ team, record: teamRecord(allMatches, team.code) }))
    .filter((entry) => entry.record.played > 0)
    .sort((a, b) => b.record.points - a.record.points);

  return (
    <div className="shell">
      <header className={styles.head}>
        <p className="eyebrow">
          {allMatches.length.toLocaleString('en-GB')} matches · {bySeason.length} seasons
        </p>
        <h1 className={styles.title}>Analysis</h1>
        <p className={styles.lede}>
          Everything below is computed from the Premier League&apos;s own record of every match it
          has played, from {firstSeason?.season ?? ''} to {lastSeason?.season ?? ''}. No estimate,
          no third party model, and no number without the matches behind it.
        </p>
      </header>

      <section className={styles.block} aria-labelledby="home">
        <h2 id="home" className={styles.h2}>
          Home advantage is not a constant
        </h2>
        <p className={styles.note}>
          The share of matches won by the home side, season by season. It is the assumption every
          fixture model is built on, and it has moved: a division that once gave the home side
          nearly half its matches now gives it noticeably fewer, and the season played in empty
          grounds shows as a trough rather than a blip.
        </p>
        <SeasonTrend data={homeTrend} label="Home wins" unit="percent" tone="pitch" />
        <p className={styles.readout}>
          Across the whole record the home side scores{' '}
          <span className="num">{model.homeAdvantage.toFixed(2)}</span> goals for every one the away
          side scores.
        </p>
      </section>

      <section className={styles.block} aria-labelledby="goals">
        <h2 id="goals" className={styles.h2}>
          Goals per match
        </h2>
        <p className={styles.note}>
          Total goals divided by matches played. This is the baseline every expected goals figure on
          this site is scaled against, so a season that scores freely raises every forecast with it.
        </p>
        <SeasonTrend data={goalTrend} label="Goals per match" unit="decimal" tone="flare" />
        <p className={styles.readout}>
          The weighted division average, which recent seasons dominate, is{' '}
          <span className="num">{(model.baseline * 2).toFixed(2)}</span> goals per match.
        </p>
      </section>

      <div className={styles.columns}>
        <section aria-labelledby="attack">
          <h2 id="attack" className={styles.h2}>
            Strongest attacks
          </h2>
          <ol className={styles.rank}>
            {strengths.slice(0, 10).map(({ team, strength }) => (
              <li key={strength.teamCode}>
                <Link className={styles.rankLink} href={`/teams/${String(strength.teamCode)}`}>
                  {team !== undefined && <Crest code={team.code} name={team.name} size={22} />}
                  <span className={styles.rankName}>{team?.name ?? strength.teamCode}</span>
                </Link>
                <span className="num">{strength.attack.toFixed(2)}</span>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="defence">
          <h2 id="defence" className={styles.h2}>
            Meanest defences
          </h2>
          <ol className={styles.rank}>
            {bestDefences.slice(0, 10).map(({ team, strength }) => (
              <li key={strength.teamCode}>
                <Link className={styles.rankLink} href={`/teams/${String(strength.teamCode)}`}>
                  {team !== undefined && <Crest code={team.code} name={team.name} size={22} />}
                  <span className={styles.rankName}>{team?.name ?? strength.teamCode}</span>
                </Link>
                <span className="num">{strength.defence.toFixed(2)}</span>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="alltime">
          <h2 id="alltime" className={styles.h2}>
            Points on record
          </h2>
          <p className={styles.note}>
            Current clubs only, over every season stored. A promoted club has fewer seasons to
            gather them in, so this ranks longevity as much as quality.
          </p>
          <ol className={styles.rank}>
            {allTime.slice(0, 10).map(({ team, record }) => (
              <li key={team.code}>
                <Link className={styles.rankLink} href={`/teams/${String(team.code)}`}>
                  <Crest code={team.code} name={team.name} size={22} />
                  <span className={styles.rankName}>{team.name}</span>
                </Link>
                <span className="num">{record.points.toLocaleString('en-GB')}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {referees.length > 0 && (
        <section className={styles.block} aria-labelledby="cards">
          <h2 id="cards" className={styles.h2}>
            Who books the most
          </h2>
          <p className={styles.note}>
            Yellow cards per match, over the seasons whose full timelines are stored and referees
            with at least ten of them. Read it as weak evidence:{' '}
            <Link href="/referees">appointments are not random</Link>.
          </p>
          <ol className={styles.rank}>
            {referees.slice(0, 10).map((entry) => (
              <li key={entry.refereeId}>
                <Link className={styles.rankLink} href={`/referees/${String(entry.refereeId)}`}>
                  <span className={styles.rankName}>{entry.name}</span>
                </Link>
                <span className="num">{(entry.yellowsPerMatch ?? 0).toFixed(2)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className={styles.block} aria-labelledby="grounds">
        <h2 id="grounds" className={styles.h2}>
          Biggest grounds
        </h2>
        <ol className={styles.rank}>
          {biggestGrounds.map((ground) => (
            <li key={ground.groundId}>
              <span className={styles.rankLink}>
                {ground.teamCode !== null && teamsByCode.has(ground.teamCode) && (
                  <Crest
                    code={ground.teamCode}
                    name={teamsByCode.get(ground.teamCode)?.name ?? ''}
                    size={22}
                  />
                )}
                <span className={styles.rankName}>
                  {ground.name}
                  {ground.city !== null && <span className={styles.dim}>, {ground.city}</span>}
                </span>
              </span>
              <span className="num">{(ground.capacity ?? 0).toLocaleString('en-GB')}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.block} aria-labelledby="table">
        <h2 id="table" className={styles.h2}>
          Season by season
        </h2>
        <div className={styles.scroll}>
          <table className={styles.table}>
            <caption className="visually-hidden">
              Goals and result shares by season, oldest first
            </caption>
            <thead>
              <tr>
                <th scope="col">Season</th>
                <th scope="col">Matches</th>
                <th scope="col">Goals</th>
                <th scope="col">Per match</th>
                <th scope="col">Home</th>
                <th scope="col">Draw</th>
                <th scope="col">Away</th>
                <th scope="col">Home goal share</th>
              </tr>
            </thead>
            <tbody>
              {[...bySeason].reverse().map((entry) => (
                <tr key={entry.season}>
                  <th scope="row" className="num">
                    {entry.season}
                  </th>
                  <td className="num">{entry.matches}</td>
                  <td className="num">{entry.goals}</td>
                  <td className="num">{entry.goalsPerMatch.toFixed(2)}</td>
                  <td className="num">{(entry.homeWinShare * 100).toFixed(0)}%</td>
                  <td className="num">{(entry.drawShare * 100).toFixed(0)}%</td>
                  <td className="num">{(entry.awayWinShare * 100).toFixed(0)}%</td>
                  <td className="num">{(entry.homeGoalShare * 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
