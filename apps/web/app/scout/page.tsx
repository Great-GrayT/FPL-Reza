import type { Metadata } from 'next';
import Link from 'next/link';
import { currentGameweek, formatPrice, nextGameweek, type Player } from '@fpl/core';
import { differentials, fixtureSwings, projectPoints } from '@fpl/analytics';
import { MetricTip } from '@/components/metric-tip';
import { Crest } from '@/components/crest';
import { PersonPhoto } from '@/components/person-photo';
import { classes } from '@/lib/classes';
import { getFixtures, getGameweeks, getPlayerHistory, getPlayers, getTeams } from '@/lib/lake';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Scout | FPL Lake',
  description:
    'Three questions a manager actually asks: who is overlooked, whose fixtures turn, and who to captain.',
};

/**
 * Three answers, one page. Not a dashboard: a dashboard shows everything and
 * decides nothing. Each block here answers one question a manager asks in the
 * hour before a deadline, and says what it is assuming while it answers.
 */

/** Gameweeks the fixture blocks look ahead. Six is a chip planning window. */
const HORIZON = 6;
const CAPTAIN_SHORTLIST = 8;
const DIFFERENTIAL_LIMIT = 12;

export default async function ScoutPage() {
  const [players, teams, fixtures, gameweeks] = await Promise.all([
    getPlayers(),
    getTeams(),
    getFixtures(),
    getGameweeks(),
  ]);

  const week = currentGameweek(gameweeks) ?? nextGameweek(gameweeks) ?? gameweeks[0];
  const from = week?.id ?? 1;
  const teamById = new Map(teams.map((team) => [team.id, team]));

  // One projection per player, over one gameweek for captaincy and over the
  // horizon for the overlooked list: a captain plays once, a signing stays.
  const nextWeek = new Map<number, number>();
  const overHorizon = new Map<number, number>();
  const reasons = new Map<number, string[]>();

  await Promise.all(
    players.map(async (player: Player) => {
      const history = await getPlayerHistory(player.id);
      const one = projectPoints(player, { history, fixtures, fromGameweek: from, horizon: 1 });
      const many = projectPoints(player, {
        history,
        fixtures,
        fromGameweek: from,
        horizon: HORIZON,
      });
      nextWeek.set(player.id, one.points);
      overHorizon.set(player.id, many.points);
      reasons.set(player.id, many.explain);
    }),
  );

  const overlooked = differentials(players, (player) => overHorizon.get(player.id) ?? 0, {
    maxOwnership: 8,
    minProjected: 2.5,
    limit: DIFFERENTIAL_LIMIT,
  });

  const swings = fixtureSwings(
    fixtures,
    teams.map((team) => team.id),
    from,
    HORIZON,
  );

  const captains = [...players]
    .filter((player) => player.availability === 'available')
    .sort((a, b) => (nextWeek.get(b.id) ?? 0) - (nextWeek.get(a.id) ?? 0))
    .slice(0, CAPTAIN_SHORTLIST);

  return (
    <div className={`shell ${styles.page}`}>
      <header className={styles.masthead}>
        <p className={styles.eyebrow}>Gameweek {from} onward</p>
        <h1 className={styles.title}>Scout</h1>
        <p className={styles.standfirst}>
          Three questions, answered from the same numbers the rest of the site shows. Every block
          states what it assumes, because a recommendation whose reasoning is hidden is worth
          nothing at a deadline.
        </p>
      </header>

      <section className={styles.block} aria-labelledby="overlooked">
        <div className={styles.blockHead}>
          <h2 id="overlooked" className={styles.blockTitle}>
            Who is overlooked
          </h2>
          <p className={styles.blockNote}>
            Highest <MetricTip id="edge">edge</MetricTip>: projected points per percent of{' '}
            <MetricTip id="ownership">ownership</MetricTip>, under 8 percent owned. Rank is won
            against other managers, so a player everyone owns cannot win it for you.
          </p>
        </div>

        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Player</th>
                <th scope="col">Club</th>
                <th scope="col">Pos</th>
                <th scope="col">
                  <MetricTip id="price" short>
                    Price
                  </MetricTip>
                </th>
                <th scope="col">
                  <MetricTip id="ownership" short>
                    Owned
                  </MetricTip>
                </th>
                <th scope="col">
                  <MetricTip id="projection" short>
                    Proj
                  </MetricTip>
                </th>
                <th scope="col">
                  <MetricTip id="edge" short>
                    Edge
                  </MetricTip>
                </th>
              </tr>
            </thead>
            <tbody>
              {overlooked.map((row) => (
                <tr key={row.player.id}>
                  <th scope="row">
                    <Link className={styles.person} href={`/players/${String(row.player.id)}`}>
                      <PersonPhoto
                        kind="player"
                        code={row.player.code}
                        name={row.player.webName}
                        size="xs"
                      />
                      <span>{row.player.webName}</span>
                    </Link>
                  </th>
                  <td>
                    {((): React.ReactNode => {
                      const club = teamById.get(row.player.teamId);
                      if (club === undefined) return '???';
                      return (
                        <Link className={styles.person} href={`/teams/${String(club.code)}`}>
                          <Crest code={club.code} name={club.name} size={18} />
                          <span>{club.shortName}</span>
                        </Link>
                      );
                    })()}
                  </td>
                  <td>{row.player.position}</td>
                  <td className="num">{formatPrice(row.player.price)}</td>
                  <td className="num">{row.ownership.toFixed(1)}%</td>
                  <td className="num">{row.projected.toFixed(1)}</td>
                  <td className="num">{row.edge.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {overlooked.length === 0 && (
          <p className={styles.empty}>
            Nobody clears the bar yet. Before a ball is kicked the projection has only last season
            to work from, so it holds few strong opinions about cheap players.
          </p>
        )}
      </section>

      <section className={styles.block} aria-labelledby="swings">
        <div className={styles.blockHead}>
          <h2 id="swings" className={styles.blockTitle}>
            Whose fixtures turn
          </h2>
          <p className={styles.blockNote}>
            Average <MetricTip id="fdr">fixture difficulty</MetricTip> over the next {HORIZON}{' '}
            gameweeks, easiest run first. A <MetricTip id="blank">blank</MetricTip> or a{' '}
            <MetricTip id="double">double</MetricTip> is called out rather than averaged away,
            because an average cannot tell one easy match from two.
          </p>
        </div>

        <ol className={styles.swings}>
          {swings.slice(0, 12).map((swing, index) => {
            const club = teamById.get(swing.teamId);
            const average = swing.averageDifficulty;
            return (
              <li key={swing.teamId} className={styles.swing}>
                <span className={classes(styles.rank, 'num')}>{index + 1}</span>
                <span className={styles.club}>
                  {club === undefined ? (
                    `club ${String(swing.teamId)}`
                  ) : (
                    <Link className={styles.person} href={`/teams/${String(club.code)}`}>
                      <Crest code={club.code} name={club.name} size={20} />
                      <span>{club.name}</span>
                    </Link>
                  )}
                </span>
                <span className={classes(styles.difficulty, 'num')}>
                  {average === null ? 'no fixtures' : average.toFixed(2)}
                </span>
                <span className={styles.bars} aria-hidden="true">
                  {average !== null && (
                    <span
                      className={styles.bar}
                      // 1 is easiest and 5 hardest, so an easy run is a long bar.
                      style={{ inlineSize: `${String(((5 - average) / 4) * 100)}%` }}
                    />
                  )}
                </span>
                <span className={styles.flags}>
                  {swing.blanks.length > 0 && (
                    <span className={styles.blank}>blank gw {swing.blanks.join(', ')}</span>
                  )}
                  {swing.doubles.length > 0 && (
                    <span className={styles.double}>double gw {swing.doubles.join(', ')}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      <section className={styles.block} aria-labelledby="captains">
        <div className={styles.blockHead}>
          <h2 id="captains" className={styles.blockTitle}>
            Who to captain
          </h2>
          <p className={styles.blockNote}>
            Highest <MetricTip id="projection">projection</MetricTip> for gameweek {from} alone, and
            only players listed available. The armband doubles one match, so the horizon that
            matters here is one.
          </p>
        </div>

        <ol className={styles.captains}>
          {captains.map((player, index) => (
            <li key={player.id} className={styles.captain}>
              <span className={classes(styles.captainRank, 'num')}>{index + 1}</span>
              <div className={styles.captainBody}>
                <p className={styles.captainName}>
                  <Link className={styles.person} href={`/players/${String(player.id)}`}>
                    <PersonPhoto kind="player" code={player.code} name={player.webName} size="sm" />
                    <span>{player.webName}</span>
                  </Link>
                  <span className={styles.captainClub}>
                    {teamById.get(player.teamId)?.shortName ?? '???'} · {player.position} ·{' '}
                    {formatPrice(player.price)}
                  </span>
                </p>
                <p className={styles.captainWhy}>{(reasons.get(player.id) ?? []).join('; ')}</p>
              </div>
              <span className={classes(styles.captainPoints, 'num')}>
                {(nextWeek.get(player.id) ?? 0).toFixed(1)}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <p className={styles.footnote}>
        Every number here is defined in <Link href="/glossary">the glossary</Link>. The projection
        is a stated heuristic, not a model: form, then fixtures, then availability, each with a
        weight you can read.
      </p>
    </div>
  );
}
