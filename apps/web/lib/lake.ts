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
  playerSchema,
  teamSchema,
  type Fixture,
  type Gameweek,
  type Player,
  type PlayerGameweek,
  type PlayerSeason,
  type HistoricPlayerGameweek,
  type CareerTotals,
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
