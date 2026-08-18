import 'server-only';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { cache } from 'react';
import {
  NotFoundError,
  asSeason,
  fixtureSchema,
  gameweekSchema,
  playerGameweekSchema,
  playerSeasonSchema,
  historicPlayerGameweekSchema,
  careerTotals,
  internationalSeasonSchema,
  internationalTotals,
  groundSchema,
  groundImageSchema,
  managerSchema,
  matchSchema,
  matchDetailSchema,
  matchWeatherSchema,
  playerMatchSpatialSchema,
  playerSchema,
  teamSchema,
  type Fixture,
  type Gameweek,
  type Player,
  type PlayerGameweek,
  type PlayerSeason,
  type HistoricPlayerGameweek,
  type CareerTotals,
  type InternationalSeason,
  type InternationalTotals,
  type Ground,
  type GroundImage,
  type Manager,
  type Match,
  type MatchDetail,
  type MatchWeather,
  type PlayerMatchSpatial,
  type Season,
  type Team,
} from '@fpl/core';
import { seasonForDate } from '@fpl/config';
import { DATASETS } from '@fpl/ingest';
import { FileStore } from '@fpl/store';

/**
 * The site is built from committed snapshots rather than from a database or a
 * live API: Vercel's filesystem is read only, so reading the lake at build
 * time is both the cheapest and the only durable option. Everything here is
 * server side and memoised per request with React's cache.
 */

function findLakeRoot(): string {
  const tried: string[] = [];

  // A configured path wins, but only if it exists. Relative values are the
  // trap: FPL_DATA_DIR=data resolves against the app directory on Vercel, not
  // the repository root, and trusting it blindly turns a good deployment into
  // one that reports an empty lake at a path nobody meant.
  const configured = process.env.FPL_DATA_DIR;
  if (configured !== undefined && configured !== '') {
    const resolved = path.resolve(configured);
    if (existsSync(resolved)) return resolved;
    tried.push(`${resolved} (from FPL_DATA_DIR=${configured})`);
  }

  // Next runs with cwd at the app directory locally and at the repo root on
  // Vercel, so the root is found by walking up rather than by assuming either.
  let directory = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path.join(directory, 'data');
    if (existsSync(candidate)) return candidate;
    tried.push(candidate);
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  // Falling back to a path that does not exist would deploy a site that looks
  // healthy and renders nothing. On Vercel this means the project root
  // directory excludes the repository root, where data/ lives.
  throw new Error(
    [
      'no data directory found. Tried:',
      ...tried.map((candidate) => `  ${candidate}`),
      'Set FPL_DATA_DIR to an absolute path, or point the deployment at a root that contains data/.',
    ].join('\n'),
  );
}

export const lakeRoot = findLakeRoot();

// The build log is where this belongs: it is the first thing to check when a
// deployment renders differently from a local build.
console.info(`[lake] reading ${lakeRoot}`);

const store = new FileStore({ root: lakeRoot });

/** Season the site renders. Overridable so a build can pin an archived one. */
export const season: Season = ((): Season => {
  const configured = process.env.FPL_SEASON;
  return configured === undefined || configured === ''
    ? seasonForDate(new Date())
    : asSeason(configured);
})();

/**
 * Datasets the site cannot be built without. A missing one is a deployment
 * fault (wrong root directory, unseeded lake), and failing the build is the
 * only way that does not ship as a blank page nobody can explain.
 */
async function readRequired<T>(
  dataset: string,
  schema: Parameters<typeof store.read<T>>[1],
): Promise<T[]> {
  try {
    const rows = await store.read<T>({ season, dataset }, schema);
    if (rows.length > 0) return rows;
    throw new NotFoundError(`${dataset} snapshot for ${season}`);
  } catch (error) {
    if (error instanceof NotFoundError) {
      throw new Error(
        `the ${dataset} dataset is missing or empty for ${season} at ${lakeRoot}. Run a sync, or check that the deployment can see the repository root.`,
      );
    }
    throw error;
  }
}

/** An absent dataset is an empty page, not a crash: this is for optional ones. */
async function readOrEmpty<T>(
  dataset: string,
  schema: Parameters<typeof store.read<T>>[1],
  partition?: string,
): Promise<T[]> {
  try {
    return await store.read<T>(
      { season, dataset, ...(partition === undefined ? {} : { partition }) },
      schema,
    );
  } catch (error) {
    if (error instanceof NotFoundError) return [];
    throw error;
  }
}

export const getTeams = cache(async (): Promise<Team[]> =>
  readRequired<Team>(DATASETS.teams, teamSchema),
);

export const getPlayers = cache(async (): Promise<Player[]> =>
  readRequired<Player>(DATASETS.players, playerSchema),
);

export const getGameweeks = cache(async (): Promise<Gameweek[]> =>
  readRequired<Gameweek>(DATASETS.gameweeks, gameweekSchema),
);

export const getFixtures = cache(async (): Promise<Fixture[]> =>
  readRequired<Fixture>(DATASETS.fixtures, fixtureSchema),
);

/**
 * Every stored gameweek partition, flattened. Partitions come from the
 * manifest rather than from a guessed gw1 to gw38 range, so a partition named
 * outside that convention is still read.
 */
export const getAllPlayerGameweeks = cache(async (): Promise<PlayerGameweek[]> => {
  const partitions = await store.partitions({ season, dataset: DATASETS.playerGameweeks });
  const perPartition = await Promise.all(
    partitions.map((partition) =>
      readOrEmpty<PlayerGameweek>(DATASETS.playerGameweeks, playerGameweekSchema, partition),
    ),
  );
  return perPartition.flat();
});

export const getPlayerHistory = cache(async (playerId: number): Promise<PlayerGameweek[]> => {
  const rows = await getAllPlayerGameweeks();
  return rows.filter((row) => row.playerId === playerId).sort((a, b) => a.gameweek - b.gameweek);
});

/**
 * Completed seasons, keyed by the permanent player code. Optional: a lake that
 * has never had a history backfill still builds, it just has no career to show.
 */
export const getPlayerSeasons = cache(async (): Promise<PlayerSeason[]> =>
  readOrEmpty<PlayerSeason>('player-seasons', playerSeasonSchema),
);

export const getSeasonsByCode = cache(async (): Promise<Map<number, PlayerSeason[]>> => {
  const rows = await getPlayerSeasons();
  const byCode = new Map<number, PlayerSeason[]>();
  for (const row of rows) {
    const existing = byCode.get(row.playerCode);
    if (existing === undefined) byCode.set(row.playerCode, [row]);
    else existing.push(row);
  }
  // Newest first: a career reads backwards from what a manager last saw.
  for (const seasons of byCode.values()) seasons.sort((a, b) => b.season.localeCompare(a.season));
  return byCode;
});

export interface Career {
  seasons: PlayerSeason[];
  totals: CareerTotals;
}

export const getCareer = cache(async (playerCode: number): Promise<Career> => {
  const seasons = (await getSeasonsByCode()).get(playerCode) ?? [];
  return { seasons, totals: careerTotals(seasons) };
});

/**
 * One archived season at the gameweek grain. Read per season rather than all at
 * once: a season is about 27,000 rows, and a page that charts one season should
 * not pay for ten.
 */
export const getArchivedSeason = cache(
  async (archiveLabel: string): Promise<HistoricPlayerGameweek[]> =>
    readOrEmpty<HistoricPlayerGameweek>(
      'player-gameweeks-history',
      historicPlayerGameweekSchema,
      archiveLabel,
    ),
);

export const getArchivedSeasonForPlayer = cache(
  async (archiveLabel: string, playerCode: number): Promise<HistoricPlayerGameweek[]> => {
    const rows = await getArchivedSeason(archiveLabel);
    return rows
      .filter((row) => row.playerCode === playerCode)
      .sort((a, b) => a.gameweek - b.gameweek);
  },
);

/** Archived seasons present in the lake, newest first, as "2024-25" labels. */
export const getArchivedSeasonLabels = cache(async (): Promise<string[]> => {
  const partitions = await store.partitions({ season, dataset: 'player-gameweeks-history' });
  return [...partitions].sort((a, b) => b.localeCompare(a));
});

/**
 * National team records, keyed by player code. Optional like the rest of the
 * history: no backfill means no international block, not a broken page.
 */
export const getInternationals = cache(async (): Promise<InternationalSeason[]> =>
  readOrEmpty<InternationalSeason>('internationals', internationalSeasonSchema),
);

export interface InternationalCareer {
  seasons: InternationalSeason[];
  totals: InternationalTotals;
}

export const getInternationalCareer = cache(
  async (playerCode: number): Promise<InternationalCareer> => {
    const rows = (await getInternationals()).filter((row) => row.playerCode === playerCode);
    // Newest first. A youth tournament reads as what it is, because the provider
    // names the team that way: France U20 rather than France.
    rows.sort((a, b) => b.season.localeCompare(a.season));
    return { seasons: rows, totals: internationalTotals(rows) };
  },
);

export const getTeamsById = cache(async (): Promise<Map<number, Team>> => {
  const teams = await getTeams();
  return new Map(teams.map((team) => [team.id, team]));
});

export const getPlayersById = cache(async (): Promise<Map<number, Player>> => {
  const players = await getPlayers();
  return new Map(players.map((player) => [player.id, player]));
});

/**
 * Kept for callers that want to ask, but a build now fails before this could
 * report true: the core datasets throw rather than resolve empty.
 */
export const isLakeEmpty = cache(async (): Promise<boolean> => {
  const teams = await getTeams();
  return teams.length === 0;
});

/**
 * The Premier League's own record, which FPL does not carry. Every one of
 * these is optional: a clone that has never run `fpl official matches` still
 * builds, and the pages that need them say so rather than rendering a blank.
 *
 * Everything here joins on `teamCode` and `playerCode`, which are the Opta ids
 * the provider publishes beside its own, so no name is ever matched.
 */

const seasonPartition = (label: string): string => label.replace('/', '-');

/** Every season of results the lake holds, newest first, as "2025-26" labels. */
export const getMatchSeasons = cache(async (): Promise<string[]> => {
  const partitions = await store.partitions({ season, dataset: 'matches' });
  return [...partitions].sort((a, b) => b.localeCompare(a));
});

/** One season of results. Read per season: 35 of them is 13,500 rows. */
export const getMatchesForSeason = cache(async (label: string): Promise<Match[]> =>
  readOrEmpty<Match>('matches', matchSchema, label),
);

/**
 * Every result the lake holds, across every season. Used by the strength model
 * and by a head to head record, both of which are meaningless on one season.
 */
export const getAllMatches = cache(async (): Promise<Match[]> => {
  const labels = await getMatchSeasons();
  const perSeason = await Promise.all(labels.map((label) => getMatchesForSeason(label)));
  return perSeason.flat();
});

/** This season's results and fixtures from the official record. */
export const getSeasonMatches = cache(async (): Promise<Match[]> =>
  getMatchesForSeason(seasonPartition(season)),
);

export const getMatchDetails = cache(async (label: string): Promise<MatchDetail[]> =>
  readOrEmpty<MatchDetail>('match-details', matchDetailSchema, label),
);

export const getMatchDetailsById = cache(
  async (label: string): Promise<Map<number, MatchDetail>> => {
    const rows = await getMatchDetails(label);
    return new Map(rows.map((row) => [row.matchId as number, row]));
  },
);

/** Every detail row the lake holds, keyed by match. Card rates need all of it. */
export const getAllMatchDetailsById = cache(async (): Promise<Map<number, MatchDetail>> => {
  const labels = await getMatchSeasons();
  const perSeason = await Promise.all(labels.map((label) => getMatchDetails(label)));
  return new Map(perSeason.flat().map((row) => [row.matchId as number, row]));
});

export const getManagers = cache(async (): Promise<Manager[]> =>
  readOrEmpty<Manager>('managers', managerSchema),
);

export const getGrounds = cache(async (): Promise<Ground[]> =>
  readOrEmpty<Ground>('grounds', groundSchema),
);

export const getGroundsById = cache(async (): Promise<Map<number, Ground>> => {
  const grounds = await getGrounds();
  return new Map(grounds.map((ground) => [ground.groundId, ground]));
});

export const getWeatherByMatch = cache(async (): Promise<Map<number, MatchWeather>> => {
  const rows = await readOrEmpty<MatchWeather>(
    'match-weather',
    matchWeatherSchema,
    seasonPartition(season),
  );
  return new Map(rows.map((row) => [row.matchId as number, row]));
});

/** FPL teams keyed by the code that joins them to the official record. */
export const getTeamsByCode = cache(async (): Promise<Map<number, Team>> => {
  const teams = await getTeams();
  return new Map(teams.map((team) => [team.code, team]));
});

export const getPlayersByCode = cache(async (): Promise<Map<number, Player>> => {
  const players = await getPlayers();
  return new Map(players.map((player) => [player.code, player]));
});

/**
 * Where a player actually moved, per match. Optional and, before a season has
 * been played, empty: the provider publishes a heatmap once a match has been
 * tracked, so a pre season page has nothing to draw and says exactly that.
 */
export interface SpatialRow {
  spatial: PlayerMatchSpatial;
  /** From the partition name, since the row itself is keyed by fixture. */
  season: string;
  gameweek: number | null;
}

/**
 * Partitions are named `{season}-gw{n}`, so the season and the gameweek a row
 * belongs to are read back off the partition rather than stored on every row.
 */
function parseSpatialPartition(partition: string): { season: string; gameweek: number | null } {
  const match = /^(\d{4}-\d{2})-gw(\d{1,2})$/.exec(partition);
  if (match?.[1] !== undefined && match[2] !== undefined) {
    return { season: match[1], gameweek: Number(match[2]) };
  }
  // The original convention, written before seasons were kept apart: a bare
  // `gwN` belongs to whichever season the lake is filed under.
  const legacy = /^gw(\d{1,2})$/.exec(partition);
  if (legacy?.[1] !== undefined) {
    return { season: seasonPartition(season), gameweek: Number(legacy[1]) };
  }
  return { season: partition, gameweek: null };
}

export const getAllPlayerSpatial = cache(async (): Promise<SpatialRow[]> => {
  const partitions = await store.partitions({ season, dataset: DATASETS.playerMatchSpatial });
  const perPartition = await Promise.all(
    partitions.map(async (partition) => {
      const rows = await readOrEmpty<PlayerMatchSpatial>(
        DATASETS.playerMatchSpatial,
        playerMatchSpatialSchema,
        partition,
      );
      const meta = parseSpatialPartition(partition);
      return rows.map((spatial) => ({ spatial, ...meta }));
    }),
  );
  return perPartition.flat();
});

export const getPlayerSpatial = cache(async (playerId: number): Promise<SpatialRow[]> => {
  const rows = await getAllPlayerSpatial();
  return rows
    .filter((row) => (row.spatial.playerId as number) === playerId)
    .sort((a, b) => (a.gameweek ?? 0) - (b.gameweek ?? 0));
});

/** Spatial rows for one match, both sides, so a match page can draw a pitch. */
export const getSpatialForFixture = cache(async (fixtureId: number): Promise<SpatialRow[]> => {
  const rows = await getAllPlayerSpatial();
  return rows.filter((row) => (row.spatial.fixtureId as number) === fixtureId);
});

/**
 * The official record for one FPL fixture. The two providers number matches
 * differently, so they are joined on the club pair plus the round, both of
 * which either agree or the fixture is not the same fixture. Nothing is
 * matched on kickoff, because a rescheduled match moves by days and the pair
 * plus the round already identifies it uniquely inside one season.
 */
export const getOfficialByFixture = cache(async (): Promise<Map<number, Match>> => {
  const [fixtures, matches, teams] = await Promise.all([
    getFixtures(),
    getSeasonMatches(),
    getTeamsById(),
  ]);

  const key = (home: number, away: number, round: number | null): string =>
    `${String(home)}|${String(away)}|${String(round ?? 0)}`;

  const officialByKey = new Map<string, Match>();
  for (const match of matches) {
    officialByKey.set(key(match.homeTeamCode, match.awayTeamCode, match.round), match);
  }

  const joined = new Map<number, Match>();
  for (const fixture of fixtures) {
    const home = teams.get(fixture.homeTeam)?.code;
    const away = teams.get(fixture.awayTeam)?.code;
    if (home === undefined || away === undefined) continue;
    const match = officialByKey.get(key(home, away, fixture.gameweek));
    if (match !== undefined) joined.set(fixture.id, match);
  }
  return joined;
});

/** Managers of one club, newest season first. */
export const getManagersByTeamCode = cache(async (): Promise<Map<number, Manager[]>> => {
  const managers = await getManagers();
  const byTeam = new Map<number, Manager[]>();
  for (const manager of managers) {
    const existing = byTeam.get(manager.teamCode);
    if (existing === undefined) byTeam.set(manager.teamCode, [manager]);
    else existing.push(manager);
  }
  for (const list of byTeam.values()) {
    list.sort((a, b) => b.season.localeCompare(a.season) || a.role.localeCompare(b.role));
  }
  return byTeam;
});

/** The club's current manager, which is the newest season's head coach. */
export const getCurrentManager = cache(async (teamCode: number): Promise<Manager | undefined> =>
  (await getManagersByTeamCode())
    .get(teamCode)
    ?.find((manager) => manager.role.toLowerCase() === 'manager'),
);

/**
 * A licensed photograph per ground, keyed by ground id. Every one carries its
 * credit and licence, and the component that renders it prints both, because
 * almost all of these are Creative Commons with an attribution condition.
 */
export const getGroundImages = cache(async (): Promise<Map<number, GroundImage>> => {
  const rows = await readOrEmpty<GroundImage>('ground-images', groundImageSchema);
  return new Map(rows.map((row) => [row.groundId, row]));
});
