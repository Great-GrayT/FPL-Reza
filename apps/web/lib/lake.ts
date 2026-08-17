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
  playerSchema,
  teamSchema,
  type Fixture,
  type Gameweek,
  type Player,
  type PlayerGameweek,
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
  const configured = process.env.FPL_DATA_DIR;
  if (configured !== undefined && configured !== '') return path.resolve(configured);

  // Next runs with cwd at the app directory locally and at the repo root on
  // Vercel, so the root is found by walking up rather than by assuming either.
  let directory = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path.join(directory, 'data');
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return path.join(process.cwd(), 'data');
}

export const lakeRoot = findLakeRoot();

const store = new FileStore({ root: lakeRoot });

/** Season the site renders. Overridable so a build can pin an archived one. */
export const season: Season = ((): Season => {
  const configured = process.env.FPL_SEASON;
  return configured === undefined || configured === ''
    ? seasonForDate(new Date())
    : asSeason(configured);
})();

/** An absent dataset is an empty page, not a crash: the lake may be unseeded. */
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
  readOrEmpty<Team>(DATASETS.teams, teamSchema),
);

export const getPlayers = cache(async (): Promise<Player[]> =>
  readOrEmpty<Player>(DATASETS.players, playerSchema),
);

export const getGameweeks = cache(async (): Promise<Gameweek[]> =>
  readOrEmpty<Gameweek>(DATASETS.gameweeks, gameweekSchema),
);

export const getFixtures = cache(async (): Promise<Fixture[]> =>
  readOrEmpty<Fixture>(DATASETS.fixtures, fixtureSchema),
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

export const getTeamsById = cache(async (): Promise<Map<number, Team>> => {
  const teams = await getTeams();
  return new Map(teams.map((team) => [team.id, team]));
});

export const getPlayersById = cache(async (): Promise<Map<number, Player>> => {
  const players = await getPlayers();
  return new Map(players.map((player) => [player.id, player]));
});

/** True when the lake has never been seeded, which the UI states plainly. */
export const isLakeEmpty = cache(async (): Promise<boolean> => {
  const teams = await getTeams();
  return teams.length === 0;
});
