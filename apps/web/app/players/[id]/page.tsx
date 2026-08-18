import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import { GAMEWEEKS_PER_SEASON, playerFullName } from '@fpl/core';
import { Crest } from '@/components/crest';
import { PersonPhoto } from '@/components/person-photo';
import { PlayerSeason, type GameweekRow } from '@/components/player-season';
import type { HeatmapMatch } from '@/components/player-heatmap';
import { PlayerCareer } from '@/components/player-career';
import { PlayerInternationals } from '@/components/player-internationals';
import type { RibbonCell } from '@/components/gameweek-ribbon';
import type { SeriesPoint } from '@/components/player-time-series';
import {
  getCareer,
  getInternationalCareer,
  getFixtures,
  getGameweeks,
  getPlayerHistory,
  getPlayers,
  getPlayersById,
  getPlayerSpatial,
  getTeamsById,
  getTeamsByCode,
  getAllMatches,
} from '@/lib/lake';
import { POSITION_LABEL, opponentFor, price, signed } from '@/lib/display';
import styles from './page.module.css';

export async function generateStaticParams(): Promise<{ id: string }[]> {
  const players = await getPlayers();
  return players.map((player) => ({ id: String(player.id) }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const player = (await getPlayersById()).get(Number(id));
  return { title: player === undefined ? 'Player' : `${player.webName} | FPL Lake` };
}

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const playerId = Number(id);
  const player = (await getPlayersById()).get(playerId);
  if (player === undefined) notFound();

  // Keyed by code, not id: FPL reassigns ids every summer, so a career looked
  // up by id would be this season only.
  const career = await getCareer(player.code);
  const international = await getInternationalCareer(player.code);

  const teams = await getTeamsById();
  const team = teams.get(player.teamId);
  const [history, fixtures, gameweeks, spatial, teamsByCode, allMatches] = await Promise.all([
    getPlayerHistory(playerId),
    getFixtures(),
    getGameweeks(),
    getPlayerSpatial(playerId),
    getTeamsByCode(),
    getAllMatches(),
  ]);

  const currentGameweek = gameweeks.find((week) => week.isCurrent)?.id;
  // Keyed by plain number so a loop counter can look a gameweek up without
  // minting a branded id for a week that may hold nothing.
  const byGameweek = new Map<number, (typeof history)[number]>(
    history.map((row) => [row.gameweek, row]),
  );

  // The team's fixture for each gameweek, so a week with no row still shows
  // who they would have faced and how hard it was.
  const teamFixtures = new Map<number, ReturnType<typeof opponentFor>>();
  for (const fixture of fixtures) {
    if (fixture.gameweek === null) continue;
    if (fixture.homeTeam !== player.teamId && fixture.awayTeam !== player.teamId) {
      continue;
    }
    teamFixtures.set(fixture.gameweek, opponentFor(fixture, player.teamId, teams));
  }

  const cells: RibbonCell[] = Array.from({ length: GAMEWEEKS_PER_SEASON }, (_, index) => {
    const gameweek = index + 1;
    const row = byGameweek.get(gameweek);
    const opponent = teamFixtures.get(gameweek) ?? null;
    return {
      gameweek,
      points: row?.totalPoints ?? null,
      minutes: row?.minutes ?? null,
      difficulty: opponent?.difficulty ?? null,
      opponent: opponent?.short ?? null,
      home: opponent?.home ?? null,
      isCurrent: gameweek === currentGameweek,
    };
  });

  const series: SeriesPoint[] = history.map((row) => ({
    gameweek: row.gameweek,
    points: row.totalPoints,
    minutes: row.minutes,
    expectedInvolvement: row.expectedGoals + row.expectedAssists,
    bps: row.bps,
    price: row.price,
  }));

  const rows: GameweekRow[] = history.map((row) => {
    const opponent = teamFixtures.get(row.gameweek) ?? null;
    return {
      gameweek: row.gameweek,
      opponent: opponent?.short ?? null,
      home: opponent?.home ?? null,
      minutes: row.minutes,
      points: row.totalPoints,
      goals: row.goals,
      assists: row.assists,
      expectedGoals: row.expectedGoals,
      expectedAssists: row.expectedAssists,
      bonus: row.bonus,
      bps: row.bps,
      price: row.price,
    };
  });

  // A tracked match is keyed by the fixture it happened in, and for a
  // backfilled season that fixture is an official match id, so the opponent is
  // read off the official record rather than off this season's fixture list.
  const matchById = new Map(allMatches.map((match) => [match.matchId as number, match]));
  const heatmapMatches: HeatmapMatch[] = spatial
    .filter((row) => row.spatial.heatmap !== null)
    .map((row) => {
      const match = matchById.get(row.spatial.fixtureId);
      const teamCode = teams.get(row.spatial.teamId)?.code ?? null;
      const home =
        match === undefined || teamCode === null ? null : match.homeTeamCode === teamCode;
      const opponentCode =
        match === undefined ? null : home === true ? match.awayTeamCode : match.homeTeamCode;
      const opponent =
        opponentCode === null
          ? null
          : (teamsByCode.get(opponentCode)?.shortName ??
            (home === true ? (match?.awayTeamName ?? null) : (match?.homeTeamName ?? null)));

      return {
        season: row.season,
        gameweek: row.gameweek,
        fixtureId: row.spatial.fixtureId,
        opponent,
        home,
        minutes: row.spatial.minutes,
        touches: row.spatial.touches,
        cols: row.spatial.heatmap?.cols ?? 12,
        rows: row.spatial.heatmap?.rows ?? 8,
        counts: [...(row.spatial.heatmap?.counts ?? [])],
        averageX: row.spatial.averagePosition?.x ?? null,
        averageY: row.spatial.averagePosition?.y ?? null,
      };
    });

  const drift = player.price - player.startPrice;

  return (
    <div className="shell">
      <nav className={styles.crumb} aria-label="Breadcrumb">
        <Link href="/players">All players</Link>
      </nav>

      <header className={styles.masthead}>
        <div className={styles.identity}>
          <p className="eyebrow">
            {POSITION_LABEL[player.position] ?? player.position}
            {team === undefined ? '' : ` · ${team.name}`}
          </p>
          <h1 className={styles.name}>{player.webName}</h1>
          <p className={styles.fullName}>{playerFullName(player)}</p>
        </div>

        <dl className={styles.headline}>
          <div>
            <dt>Points</dt>
            <dd className="num">{player.totalPoints}</dd>
          </div>
          <div>
            <dt>Price</dt>
            <dd className="num">
              {price(player.price)}
              {drift !== 0 && (
                <span className={drift > 0 ? styles.up : styles.down}>{signed(drift / 10)}</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Owned</dt>
            <dd className="num">{player.selectedByPercent.toFixed(1)}%</dd>
          </div>
          <div>
            <dt>Form</dt>
            <dd className="num">{player.form.toFixed(1)}</dd>
          </div>
        </dl>
      </header>

      {player.news !== '' && (
        <p className={styles.news}>
          <span className={styles.newsTag}>News</span>
          {player.news}
          {player.chanceOfPlayingNextRound !== null &&
            ` (${String(player.chanceOfPlayingNextRound)}% chance of playing)`}
        </p>
      )}

      <div className={styles.body}>
        <aside className={styles.aside}>
          <PersonPhoto kind="player" code={player.code} name={playerFullName(player)} size="xl" />
          <dl className={styles.totals}>
            <Total label="Minutes" value={String(player.minutes)} />
            <Total label="Goals" value={String(player.goals)} />
            <Total label="Assists" value={String(player.assists)} />
            <Total label="Clean sheets" value={String(player.cleanSheets)} />
            <Total label="Bonus" value={String(player.bonus)} />
            <Total label="BPS" value={String(player.bps)} />
            <Total label="xG" value={player.expectedGoals.toFixed(2)} />
            <Total label="xA" value={player.expectedAssists.toFixed(2)} />
            <Total label="Points per game" value={player.pointsPerGame.toFixed(1)} />
            {team !== undefined && (
              <Link className={styles.club} href={`/teams/${String(team.code)}`}>
                <Crest code={team.code} name={team.name} size={20} />
                <span>{team.name}</span>
              </Link>
            )}
          </dl>
        </aside>

        <div className={styles.main}>
          <PlayerSeason cells={cells} series={series} rows={rows} heatmap={heatmapMatches} />
          <PlayerCareer seasons={career.seasons} totals={career.totals} />
          <PlayerInternationals seasons={international.seasons} totals={international.totals} />
        </div>
      </div>
    </div>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.total}>
      <dt>{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}
