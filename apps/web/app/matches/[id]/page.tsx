import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  describeWeatherCode,
  headToHead,
  recentForm,
  refereeRecord,
  teamRecord,
  type Match,
  type MatchDetail,
  type Player,
} from '@fpl/core';
import { estimateStrength, explainForecast, forecastMatch, projectPoints } from '@fpl/analytics';
import { Crest } from '@/components/crest';
import { PersonChip } from '@/components/person-photo';
import { ForecastBar, Likelihood } from '@/components/forecast-bar';
import { MarketOdds } from '@/components/market-odds';
import { marketFor } from '@/lib/market';
import { TeamSheetList, TeamSheetPitch } from '@/components/team-sheet';
import { GroundPhoto } from '@/components/ground-photo';
import { MetricTip } from '@/components/metric-tip';
import {
  getAllMatchDetailsById,
  getAllMatches,
  getCurrentManager,
  getFixtures,
  getGameweeks,
  getGroundsById,
  getGroundImages,
  getOdds,
  getOfficialByFixture,
  getPlayers,
  getPlayersByCode,
  getTeamsById,
  getWeatherByMatch,
  season,
} from '@/lib/lake';
import { confirmedSheet, likelyEleven } from '@/lib/lineups';
import { kickoff, matchDay, price } from '@/lib/display';
import styles from './page.module.css';

export async function generateStaticParams(): Promise<{ id: string }[]> {
  const fixtures = await getFixtures();
  return fixtures.map((fixture) => ({ id: String(fixture.id) }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const fixtures = await getFixtures();
  const teams = await getTeamsById();
  const fixture = fixtures.find((entry) => (entry.id as number) === Number(id));
  if (fixture === undefined) return { title: 'Match | FPL Lake' };
  const home = teams.get(fixture.homeTeam)?.name ?? 'Home';
  const away = teams.get(fixture.awayTeam)?.name ?? 'Away';
  return {
    title: `${home} v ${away} | FPL Lake`,
    description: `Line ups, records, officials, and probabilities for ${home} against ${away}.`,
  };
}

const percent = (value: number): string => `${(value * 100).toFixed(0)}%`;

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const fixtureId = Number(id);

  const [fixtures, teams, gameweeks, officialByFixture, players, playersByCode, allMatches] =
    await Promise.all([
      getFixtures(),
      getTeamsById(),
      getGameweeks(),
      getOfficialByFixture(),
      getPlayers(),
      getPlayersByCode(),
      getAllMatches(),
    ]);

  const fixture = fixtures.find((entry) => (entry.id as number) === fixtureId);
  if (fixture === undefined) notFound();

  const home = teams.get(fixture.homeTeam);
  const away = teams.get(fixture.awayTeam);
  if (home === undefined || away === undefined) notFound();

  const official = officialByFixture.get(fixtureId) ?? null;
  const week = gameweeks.find((entry) => (entry.id as number) === fixture.gameweek);

  const [grounds, groundImages, weatherByMatch, allDetails, odds] = await Promise.all([
    getGroundsById(),
    getGroundImages(),
    getWeatherByMatch(),
    getAllMatchDetailsById(),
    getOdds(),
  ]);

  const detail = official === null ? undefined : (allDetails.get(official.matchId) ?? undefined);
  const ground = official?.groundId == null ? undefined : grounds.get(official.groundId);
  const weather = official === null ? undefined : weatherByMatch.get(official.matchId);

  // The forecast is built from the whole official record rather than this
  // season alone, which before a ball is kicked is the only record there is.
  const model = estimateStrength(allMatches);
  const forecast = forecastMatch(model, home.code, away.code);
  const explanation = explainForecast(model, forecast);

  // The market, where a price for this match was stored. Matched on the two
  // club names and the day rather than an id, because a club since relegated
  // has no FPL id on either side of the join.
  const market = marketFor(odds, {
    homeTeamName: home.name,
    awayTeamName: away.name,
    kickoff: fixture.kickoff,
  });

  const record = headToHead(allMatches, home.code, away.code);
  const lastMeetings = record.matches.slice(0, 6);

  const homeForm = recentForm(allMatches, home.code);
  const awayForm = recentForm(allMatches, away.code);
  const homeRecord = teamRecord(
    allMatches.filter((match) => match.season === season),
    home.code,
  );
  const awayRecord = teamRecord(
    allMatches.filter((match) => match.season === season),
    away.code,
  );

  const [homeManager, awayManager] = await Promise.all([
    getCurrentManager(home.code),
    getCurrentManager(away.code),
  ]);

  const referee = detail?.officials.find((entry) => entry.role === 'referee') ?? null;
  const refereeStats =
    referee === null
      ? null
      : (refereeRecord(allMatches, allDetails).find(
          (entry) => entry.refereeId === referee.officialId,
        ) ?? null);

  const played = official?.status === 'completed' || fixture.finished;

  // Before kickoff there is no teamsheet to print, so the page prints the last
  // one each club used and says exactly that.
  const lastFor = (teamCode: number): { detail: MatchDetail; match: Match } | null => {
    const candidates = allMatches
      .filter(
        (match) =>
          (match.homeTeamCode === teamCode || match.awayTeamCode === teamCode) &&
          match.status === 'completed' &&
          allDetails.has(match.matchId as number),
      )
      .sort((a, b) => (b.kickoff?.getTime() ?? 0) - (a.kickoff?.getTime() ?? 0));
    const newest = candidates[0];
    if (newest === undefined) return null;
    const found = allDetails.get(newest.matchId);
    return found === undefined ? null : { detail: found, match: newest };
  };

  const squadOf = (teamId: number): Player[] =>
    players.filter((player) => (player.teamId as number) === teamId);

  const homeSquad = squadOf(fixture.homeTeam);
  const awaySquad = squadOf(fixture.awayTeam);

  const homeSheet =
    played && detail !== undefined
      ? confirmedSheet(detail, home.code, home.name, playersByCode)
      : null;
  const awaySheet =
    played && detail !== undefined
      ? confirmedSheet(detail, away.code, away.name, playersByCode)
      : null;

  const homeLikely =
    homeSheet === null ? likelyEleven(home.code, home.name, homeSquad, lastFor(home.code)) : null;
  const awayLikely =
    awaySheet === null ? likelyEleven(away.code, away.name, awaySquad, lastFor(away.code)) : null;

  // Who is worth owning in this fixture, from the same projection the scout
  // page and the builder use, so three pages cannot disagree about a player.
  const watchList = [...homeSquad, ...awaySquad]
    .map((player) => ({
      player,
      projection: projectPoints(player, {
        fixtures,
        ...(fixture.gameweek === null ? {} : { fromGameweek: fixture.gameweek }),
        horizon: 1,
      }),
    }))
    .sort((a, b) => b.projection.points - a.projection.points)
    .slice(0, 8);

  const detailSeason = official === null ? null : official.season.replace('/', '-');
  const timeline = detail?.events.filter((event) => event.type !== 'other') ?? [];

  return (
    <div className="shell">
      <nav className={styles.crumb} aria-label="Breadcrumb">
        <Link href={`/matches?gw=${String(fixture.gameweek ?? 1)}`}>
          {week?.name ?? 'All matches'}
        </Link>
      </nav>

      <header className={styles.masthead}>
        {/* The heading is the match. It is visually hidden because the crests
            and the score already say it far better than a line of type would,
            but a page with no h1 is a page a screen reader cannot summarise. */}
        <h1 className="visually-hidden">
          {home.name} against {away.name}
          {week === undefined ? '' : `, ${week.name}`}
        </h1>

        <div className={styles.side}>
          <Crest code={home.code} name={home.name} size={64} />
          <Link className={styles.club} href={`/teams/${String(home.code)}`}>
            {home.name}
          </Link>
          <p className={styles.form}>
            {homeForm.map((result, index) => (
              <span key={index} className={styles[`form${result}`]}>
                {result}
              </span>
            ))}
          </p>
        </div>

        <div className={styles.centre}>
          {played && official !== null ? (
            <p className={`num ${styles.score}`}>
              {official.homeScore}&ndash;{official.awayScore}
            </p>
          ) : (
            <p className={`num ${styles.time}`}>{kickoff(fixture.kickoff)}</p>
          )}
          <p className="eyebrow">
            {matchDay(fixture.kickoff)}
            {official?.halfTimeHomeScore != null &&
              ` · half time ${String(official.halfTimeHomeScore)}-${String(official.halfTimeAwayScore)}`}
          </p>
          {ground !== undefined && (
            <p className={styles.venue}>
              {ground.name}
              {ground.city !== null && `, ${ground.city}`}
              {official?.attendance != null &&
                ` · ${official.attendance.toLocaleString('en-GB')} in`}
            </p>
          )}
        </div>

        <div className={`${styles.side} ${styles.sideRight}`}>
          <Crest code={away.code} name={away.name} size={64} />
          <Link className={styles.club} href={`/teams/${String(away.code)}`}>
            {away.name}
          </Link>
          <p className={styles.form}>
            {awayForm.map((result, index) => (
              <span key={index} className={styles[`form${result}`]}>
                {result}
              </span>
            ))}
          </p>
        </div>
      </header>

      <section className={styles.block} aria-labelledby="forecast">
        <h2 id="forecast" className={styles.h2}>
          What is likely
        </h2>
        <p className={styles.lede}>
          Where these numbers come from: a Poisson model fitted to nothing, stated in full below. It
          reads every completed match on record, gives each club an attack and a defence as a ratio
          to the division average, and turns the pair into two goal expectations and a scoreline
          grid. No parameter in it is tuned against an outcome it is later scored on. It is not a
          bookmaker&apos;s price, and it does not know about an injury, a suspension, or a manager
          resting a squad for a European tie.
        </p>

        <ForecastBar
          home={forecast.homeWin}
          draw={forecast.draw}
          away={forecast.awayWin}
          homeLabel={home.shortName}
          awayLabel={away.shortName}
        />

        <div className={styles.forecastGrid}>
          <div>
            <p className="eyebrow">Goals expected</p>
            <p className={`num ${styles.big}`}>
              {forecast.homeExpectedGoals.toFixed(2)}
              <span className={styles.dim}> v </span>
              {forecast.awayExpectedGoals.toFixed(2)}
            </p>
            <Likelihood label={`${home.shortName} clean sheet`} value={forecast.homeCleanSheet} />
            <Likelihood label={`${away.shortName} clean sheet`} value={forecast.awayCleanSheet} />
            <Likelihood label="Both to score" value={forecast.bothToScore} />
            <Likelihood label="Over 2.5 goals" value={forecast.overTwoPointFive} />
          </div>

          <div>
            <p className="eyebrow">Likeliest scores</p>
            <ol className={styles.scores}>
              {forecast.likelyScores.map((entry) => (
                <li key={`${String(entry.home)}-${String(entry.away)}`}>
                  <span className="num">
                    {entry.home}&ndash;{entry.away}
                  </span>
                  <span className={`num ${styles.dim}`}>{percent(entry.probability)}</span>
                </li>
              ))}
            </ol>
            <p className="eyebrow">FPL difficulty</p>
            <p className={styles.fdrRow}>
              <span
                className={styles.fdrChip}
                style={{ background: `var(--fdr-${String(fixture.homeDifficulty)})` }}
              >
                {home.shortName} {fixture.homeDifficulty}
              </span>
              <span
                className={styles.fdrChip}
                style={{ background: `var(--fdr-${String(fixture.awayDifficulty)})` }}
              >
                {away.shortName} {fixture.awayDifficulty}
              </span>
              <MetricTip id="fixture-difficulty">FPL&apos;s own rating</MetricTip>
            </p>
          </div>
        </div>

        <details className={styles.method}>
          <summary>How these numbers were produced</summary>
          <ul>
            {explanation.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </details>
      </section>

      {market === null ? (
        <section className={styles.block} aria-labelledby="market-none">
          <h2 id="market-none" className={styles.h2}>
            What the market thought
          </h2>
          <p className={styles.lede}>
            No bookmaker price is stored for this match. Closing odds come from football-data.co.uk,
            which publishes a season file only once that season is under way, and the backfill
            covers 2023/24 onward. Until a price exists, the model above is the only probability on
            this page.
          </p>
        </section>
      ) : (
        <MarketOdds
          market={market}
          homeLabel={home.shortName}
          awayLabel={away.shortName}
          model={{
            home: forecast.homeWin,
            draw: forecast.draw,
            away: forecast.awayWin,
            over: forecast.overTwoPointFive,
          }}
        />
      )}

      <section className={styles.block} aria-labelledby="lineups">
        <h2 id="lineups" className={styles.h2}>
          {played ? 'How they lined up' : 'How they are likely to line up'}
        </h2>
        {!played && (
          <p className={styles.lede}>
            No teamsheet exists before the referee receives it. This is the last eleven each club
            actually started, in the shape they started in, with anyone who has left or is
            unavailable replaced by the next player at that position by minutes played.
          </p>
        )}

        <div className={styles.sheets}>
          {[
            { sheet: homeSheet ?? homeLikely?.sheet ?? null, likely: homeLikely, mirrored: false },
            { sheet: awaySheet ?? awayLikely?.sheet ?? null, likely: awayLikely, mirrored: true },
          ].map((entry, index) =>
            entry.sheet === null ? null : (
              <article key={index} className={styles.sheet}>
                <header className={styles.sheetHead}>
                  <h3 className={styles.h3}>{entry.sheet.teamName}</h3>
                  <p className="eyebrow">{entry.sheet.formation ?? 'shape unknown'}</p>
                </header>
                <TeamSheetPitch sheet={entry.sheet} mirrored={entry.mirrored} />
                <TeamSheetList sheet={entry.sheet} />
                {entry.likely?.basis != null && (
                  <p className={styles.basis}>
                    Shape from {entry.likely.basis.homeTeamName}{' '}
                    {entry.likely.basis.homeScore ?? ''}
                    &ndash;{entry.likely.basis.awayScore ?? ''} {entry.likely.basis.awayTeamName},{' '}
                    {matchDay(entry.likely.basis.kickoff)}.
                  </p>
                )}
                {entry.likely !== null && entry.likely.replacements.length > 0 && (
                  <ul className={styles.replacements}>
                    {entry.likely.replacements.map((swap) => (
                      <li key={swap.out}>
                        <strong>{swap.in}</strong> for {swap.out}: {swap.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            ),
          )}
        </div>
      </section>

      {timeline.length > 0 && (
        <section className={styles.block} aria-labelledby="timeline">
          <h2 id="timeline" className={styles.h2}>
            What happened
          </h2>
          <ol className={styles.timeline}>
            {timeline.map((event, index) => {
              const player =
                event.playerCode === null ? undefined : playersByCode.get(event.playerCode);
              const homeSide = event.teamCode === home.code;
              return (
                <li
                  key={index}
                  className={`${styles.event} ${homeSide ? styles.eventHome : styles.eventAway}`}
                >
                  <span className={`num ${styles.minute}`}>
                    {event.minute === null ? '' : `${String(event.minute)}'`}
                  </span>
                  <span className={styles.eventBody}>
                    <PersonChip
                      kind="player"
                      code={event.playerCode}
                      name={event.name ?? 'Unknown'}
                      size="xs"
                      {...(player === undefined ? {} : { href: `/players/${String(player.id)}` })}
                    />
                    <span className={styles[`tag${event.type}`] ?? styles.tagother}>
                      {event.type.replace(/_/g, ' ')}
                    </span>
                    {event.relatedName !== null && (
                      <span className={styles.dim}>
                        {event.type === 'substitution' ? 'off: ' : 'assist: '}
                        {event.relatedName}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <div className={styles.columns}>
        <section aria-labelledby="people">
          <h2 id="people" className={styles.h2}>
            In charge
          </h2>
          <ul className={styles.people}>
            {[
              { manager: homeManager, club: home },
              { manager: awayManager, club: away },
            ].map(({ manager, club }) =>
              manager === undefined ? null : (
                <li key={club.code}>
                  <PersonChip
                    kind="manager"
                    code={manager.photoCode}
                    name={manager.name}
                    detail={`${club.shortName} manager`}
                    size="md"
                    href={`/managers/${String(manager.managerId)}`}
                  />
                </li>
              ),
            )}
            {referee !== null && (
              <li>
                <PersonChip
                  kind="official"
                  name={referee.name}
                  detail={
                    refereeStats === null
                      ? 'Referee'
                      : `Referee · ${String(refereeStats.matches)} matches stored`
                  }
                  size="md"
                  href={`/referees/${String(referee.officialId)}`}
                />
              </li>
            )}
          </ul>
          {referee === null && (
            <p className={styles.note}>
              The referee is published in the week of a match, so this fills in nearer kickoff.
            </p>
          )}
          {detail !== undefined && detail.officials.length > 1 && (
            <ul className={styles.officials}>
              {detail.officials
                .filter((entry) => entry.role !== 'referee')
                .map((entry) => (
                  <li key={entry.officialId}>
                    <span className={styles.officialRole}>{entry.role.replace(/_/g, ' ')}</span>
                    <span>{entry.name}</span>
                  </li>
                ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="h2h">
          <h2 id="h2h" className={styles.h2}>
            Between them
          </h2>
          {record.played === 0 ? (
            <p className={styles.note}>
              These two have not met in the Premier League in the seasons on record.
            </p>
          ) : (
            <>
              <p className={styles.h2hLine}>
                <span className="num">{record.played}</span> meetings since the division began:{' '}
                <span className="num">{record.homeWins}</span> to {home.shortName},{' '}
                <span className="num">{record.draws}</span> drawn,{' '}
                <span className="num">{record.awayWins}</span> to {away.shortName}.
              </p>
              <ul className={styles.meetings}>
                {lastMeetings.map((match) => (
                  <li key={match.matchId as number}>
                    <span className={styles.meetingSeason}>{match.season}</span>
                    <span className={styles.meetingTeams}>
                      {match.homeTeamName} <span className="num">{match.homeScore}</span>
                      &ndash;
                      <span className="num">{match.awayScore}</span> {match.awayTeamName}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <h3 className={styles.h3}>This season so far</h3>
          <div className={styles.miniScroll}>
            <table className={styles.mini}>
              <thead>
                <tr>
                  <th scope="col">Club</th>
                  <th scope="col">P</th>
                  <th scope="col">W</th>
                  <th scope="col">D</th>
                  <th scope="col">L</th>
                  <th scope="col">GF</th>
                  <th scope="col">GA</th>
                  <th scope="col">Pts</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { club: home, record: homeRecord },
                  { club: away, record: awayRecord },
                ].map(({ club, record: row }) => (
                  <tr key={club.code}>
                    <th scope="row">{club.shortName}</th>
                    <td className="num">{row.played}</td>
                    <td className="num">{row.won}</td>
                    <td className="num">{row.drawn}</td>
                    <td className="num">{row.lost}</td>
                    <td className="num">{row.goalsFor}</td>
                    <td className="num">{row.goalsAgainst}</td>
                    <td className="num">{row.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="conditions">
          <h2 id="conditions" className={styles.h2}>
            Conditions
          </h2>
          {weather === undefined ? (
            <p className={styles.note}>
              No forecast stored for this kickoff. Conditions are read for matches within three
              weeks of today.
            </p>
          ) : (
            <dl className={styles.conditions}>
              <div>
                <dt>Sky</dt>
                <dd>{describeWeatherCode(weather.weatherCode) ?? 'unknown'}</dd>
              </div>
              <div>
                <dt>Temperature</dt>
                <dd className="num">
                  {weather.temperatureC === null ? '-' : `${weather.temperatureC.toFixed(0)}°C`}
                </dd>
              </div>
              <div>
                <dt>Rain</dt>
                <dd className="num">
                  {weather.precipitationMm === null
                    ? '-'
                    : `${weather.precipitationMm.toFixed(1)}mm`}
                </dd>
              </div>
              <div>
                <dt>Wind</dt>
                <dd className="num">
                  {weather.windSpeedKmh === null ? '-' : `${weather.windSpeedKmh.toFixed(0)} km/h`}
                </dd>
              </div>
            </dl>
          )}
          {ground !== undefined && (
            <GroundPhoto ground={ground} image={groundImages.get(ground.groundId)} size="card" />
          )}
        </section>
      </div>

      <section className={styles.block} aria-labelledby="watch">
        <h2 id="watch" className={styles.h2}>
          Worth owning
        </h2>
        <p className={styles.lede}>
          Ranked by the same <MetricTip id="projected-points">projection</MetricTip> the scout and
          the builder use, for this fixture only.
        </p>
        <ul className={styles.watch}>
          {watchList.map(({ player, projection }) => {
            const club = teams.get(player.teamId);
            return (
              <li key={player.id}>
                <PersonChip
                  kind="player"
                  code={player.code}
                  name={player.webName}
                  detail={`${club?.shortName ?? ''} · ${price(player.price)}`}
                  size="md"
                  href={`/players/${String(player.id)}`}
                />
                <span className={`num ${styles.projected}`}>{projection.points.toFixed(1)}</span>
              </li>
            );
          })}
        </ul>
      </section>

      {detailSeason !== null && (
        <p className={styles.provenance}>
          Result, teamsheets, officials, and ground from the Premier League&apos;s own record.
          Prices, ownership and projections from the Fantasy Premier League API. Conditions from
          Open-Meteo. See <Link href="/how-it-works">how it works</Link>.
        </p>
      )}
    </div>
  );
}
