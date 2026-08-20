import {
  historicPlayerGameweekSchema,
  managerSpellSchema,
  matchDetailSchema,
  matchSchema,
  teamSeasonSchema,
  type HistoricPlayerGameweek,
  type ManagerSpell,
  type Match,
  type MatchDetail,
  playerGameweekSchema,
  playerSchema,
  teamSchema,
  type Player,
  type PlayerGameweek,
  type Season,
  type Team,
  type TeamSeason,
} from '@fpl/core';
import type { Store } from '@fpl/store';

/**
 * Everything a feature builder needs, loaded once and indexed.
 *
 * The panel is 254,000 rows and the joins around it are all by a key the rows
 * do not carry: a stored gameweek names its opponent by that season's FPL team
 * id, which FPL renumbers every summer, and it names nothing at all about who
 * managed the club or what shape it played. This assembles those indexes once,
 * so a builder is a lookup rather than a scan.
 */

export interface PanelSources {
  /** Season the lake is filed under, not the season of a row. */
  season: Season;
  /** Archive seasons to load, newest last. */
  seasons: readonly string[];
  /**
   * Also load the live season from the FPL datasets, mapped into the archive's
   * shape. Without it a model fitted on closed seasons has nothing to project
   * today's squad from: the archive stops where the current season starts.
   */
  includeLive?: boolean;
}

export interface Panel {
  rows: HistoricPlayerGameweek[];
  /** The permanent club code for a season's FPL team id. */
  teamCodeOf: (season: string, teamId: number) => number | null;
  /** The club a row belongs to, resolved from its team name that season. */
  ownTeamCodeOf: (row: HistoricPlayerGameweek) => number | null;
  spells: ManagerSpell[];
  /** Matches by season, kickoff ordered, for form and rest days. */
  matches: Match[];
  /** Teamsheets by match id, for formations and duels. */
  detailOf: (matchId: number) => MatchDetail | null;
  /** Which archive seasons carry teamsheets, since only some do. */
  detailSeasons: Set<string>;
}

/** Season labels differ between the archive and the domain: 2024-25 and 2024/25. */
const toDomainSeason = (label: string): string => label.replace('-', '/');
const toArchiveSeason = (label: string): string => label.replace('/', '-');

async function readOrEmpty<T>(
  store: Store,
  season: Season,
  dataset: string,
  schema: Parameters<typeof store.read<T>>[1],
  partition?: string,
): Promise<T[]> {
  try {
    return await store.read<T>(
      { season, dataset, ...(partition === undefined ? {} : { partition }) },
      schema,
    );
  } catch {
    return [];
  }
}

export async function loadPanel(store: Store, sources: PanelSources): Promise<Panel> {
  const rows: HistoricPlayerGameweek[] = [];
  for (const season of sources.seasons) {
    rows.push(
      ...(await readOrEmpty<HistoricPlayerGameweek>(
        store,
        sources.season,
        'player-gameweeks-history',
        historicPlayerGameweekSchema,
        toArchiveSeason(season),
      )),
    );
  }

  const live = sources.includeLive === true ? await loadLiveRows(store, sources.season) : null;
  if (live !== null) rows.push(...live.rows);

  const teamSeasons = await readOrEmpty<TeamSeason>(
    store,
    sources.season,
    'team-seasons',
    teamSeasonSchema,
  );
  const codeBySeasonId = new Map<string, number>();
  const codeBySeasonName = new Map<string, number>();
  if (live !== null) {
    for (const team of live.teams) {
      codeBySeasonId.set(`${sources.season}:${String(team.id)}`, team.code);
      codeBySeasonName.set(`${sources.season}:${normalise(team.name)}`, team.code);
      codeBySeasonName.set(`${sources.season}:${normalise(team.shortName)}`, team.code);
    }
  }
  for (const entry of teamSeasons) {
    codeBySeasonId.set(`${entry.season}:${String(entry.teamId)}`, entry.teamCode);
    codeBySeasonName.set(`${entry.season}:${normalise(entry.name)}`, entry.teamCode);
    codeBySeasonName.set(`${entry.season}:${normalise(entry.shortName)}`, entry.teamCode);
  }

  const spells = await readOrEmpty<ManagerSpell>(
    store,
    sources.season,
    'manager-spells',
    managerSpellSchema,
  );

  const matchPartitions = await store
    .partitions({ season: sources.season, dataset: 'matches' })
    .catch(() => [] as string[]);
  const wanted = new Set(sources.seasons.map(toArchiveSeason));
  if (sources.includeLive === true) wanted.add(toArchiveSeason(sources.season));
  const matches: Match[] = [];
  for (const partition of matchPartitions) {
    if (!wanted.has(partition)) continue;
    matches.push(
      ...(await readOrEmpty<Match>(store, sources.season, 'matches', matchSchema, partition)),
    );
  }

  const detailPartitions = await store
    .partitions({ season: sources.season, dataset: 'match-details' })
    .catch(() => [] as string[]);
  const details = new Map<number, MatchDetail>();
  const detailSeasons = new Set<string>();
  for (const partition of detailPartitions) {
    if (!wanted.has(partition)) continue;
    const rowsForSeason = await readOrEmpty<MatchDetail>(
      store,
      sources.season,
      'match-details',
      matchDetailSchema,
      partition,
    );
    if (rowsForSeason.length > 0) detailSeasons.add(toDomainSeason(partition));
    for (const detail of rowsForSeason) details.set(detail.matchId, detail);
  }

  return {
    rows,
    teamCodeOf: (season, teamId) => codeBySeasonId.get(`${season}:${String(teamId)}`) ?? null,
    ownTeamCodeOf: (row) => {
      if (row.team === null) return null;
      return codeBySeasonName.get(`${row.season}:${normalise(row.team)}`) ?? null;
    },
    spells,
    matches,
    detailOf: (matchId) => details.get(matchId) ?? null,
    detailSeasons,
  };
}

/**
 * The live season in the archive's shape.
 *
 * FPL files this season by element id and the archive files a closed one by
 * permanent player code, so every row is rekeyed through the player list, the
 * same way the archive backfill does. A player the list does not carry is
 * dropped rather than matched on name.
 */
async function loadLiveRows(
  store: Store,
  season: Season,
): Promise<{ rows: HistoricPlayerGameweek[]; teams: Team[] }> {
  const players = await readOrEmpty<Player>(store, season, 'players', playerSchema);
  const teams = await readOrEmpty<Team>(store, season, 'teams', teamSchema);
  if (players.length === 0) return { rows: [], teams };

  const byId = new Map(players.map((player) => [Number(player.id), player]));
  const teamName = new Map(teams.map((team) => [Number(team.id), team.name]));

  const partitions = await store
    .partitions({ season, dataset: 'player-gameweeks' })
    .catch(() => [] as string[]);

  const rows: HistoricPlayerGameweek[] = [];
  for (const partition of partitions) {
    const gameweeks = await readOrEmpty<PlayerGameweek>(
      store,
      season,
      'player-gameweeks',
      playerGameweekSchema,
      partition,
    );
    for (const row of gameweeks) {
      const player = byId.get(Number(row.playerId));
      if (player === undefined) continue;
      rows.push({
        playerCode: player.code,
        season,
        gameweek: Number(row.gameweek),
        name: player.webName,
        position: player.position,
        team: teamName.get(Number(player.teamId)) ?? null,
        opponentTeam: Number(row.opponentTeam),
        wasHome: row.wasHome,
        kickoff: row.kickoff,
        minutes: row.minutes,
        totalPoints: row.totalPoints,
        goals: row.goals,
        assists: row.assists,
        cleanSheets: row.cleanSheet ? 1 : 0,
        goalsConceded: row.goalsConceded,
        ownGoals: row.ownGoals,
        penaltiesSaved: row.penaltiesSaved,
        penaltiesMissed: row.penaltiesMissed,
        yellowCards: row.yellowCards,
        redCards: row.redCards,
        saves: row.saves,
        bonus: row.bonus,
        bps: row.bps,
        price: row.price,
        selectedBy: null,
        expectedGoals: row.expectedGoals,
        expectedAssists: row.expectedAssists,
        expectedGoalsConceded: row.expectedGoalsConceded,
        influence: row.influence,
        creativity: row.creativity,
        threat: row.threat,
        ictIndex: row.ictIndex,
        expectedPoints: null,
      } satisfies HistoricPlayerGameweek);
    }
  }
  rows.sort((a, b) => (a.kickoff?.getTime() ?? 0) - (b.kickoff?.getTime() ?? 0));
  return { rows, teams };
}

/** Club names arrive spelt several ways, so the key is stripped to letters. */
function normalise(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export { toArchiveSeason, toDomainSeason, normalise };
