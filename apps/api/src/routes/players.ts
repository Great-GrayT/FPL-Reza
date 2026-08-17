import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  NotFoundError,
  ValidationError,
  asPlayerId,
  asTeamId,
  playerGameweekSchema,
  playerSchema,
  positionSchema,
  type Player,
  type PlayerGameweek,
  type PlayerId,
} from '@fpl/core';
import { DATASETS } from '@fpl/ingest';
import type { Deps } from '../deps.js';

const SORT_FIELDS = ['totalPoints', 'form', 'price', 'pointsPerGame', 'selectedByPercent'] as const;
type SortField = (typeof SORT_FIELDS)[number];

const listQuerySchema = z.object({
  position: positionSchema.optional(),
  team: z.coerce.number().int().positive().optional(),
  maxPrice: z.coerce.number().int().positive().optional(),
  minMinutes: z.coerce.number().int().nonnegative().optional(),
  sort: z.enum(SORT_FIELDS).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });

export interface PlayersRouteOptions {
  deps: Deps;
}

export async function playersRoutes(
  app: FastifyInstance,
  opts: PlayersRouteOptions,
): Promise<void> {
  const { deps } = opts;

  app.get('/players', async (request: FastifyRequest) => {
    const query = parseListQuery(request.query);
    const players = await readPlayers(deps);
    const teamId = query.team === undefined ? undefined : asTeamId(query.team);

    const filtered = players.filter((player) => {
      if (query.position !== undefined && player.position !== query.position) return false;
      if (teamId !== undefined && player.teamId !== teamId) return false;
      if (query.maxPrice !== undefined && player.price > query.maxPrice) return false;
      if (query.minMinutes !== undefined && player.minutes < query.minMinutes) return false;
      return true;
    });

    const sorted =
      query.sort === undefined ? filtered : sortPlayers(filtered, query.sort, query.order);

    const offset = query.offset ?? 0;
    const limit = query.limit ?? sorted.length;
    const page = sorted.slice(offset, offset + limit);

    return { total: sorted.length, players: page };
  });

  app.get('/players/:id', async (request: FastifyRequest) => {
    const id = parsePlayerId(request.params);
    const player = await findPlayer(deps, id);
    return player;
  });

  app.get('/players/:id/history', async (request: FastifyRequest) => {
    const id = parsePlayerId(request.params);
    await findPlayer(deps, id); // 404s before spending time walking every partition
    const history = await readPlayerHistory(deps, id);
    return { playerId: id, history };
  });
}

function parseListQuery(raw: unknown): z.infer<typeof listQuerySchema> {
  const result = listQuerySchema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError(
      'invalid query',
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  return result.data;
}

function parsePlayerId(raw: unknown): PlayerId {
  const result = idParamsSchema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError('invalid player id', ['id must be a positive integer']);
  }
  return asPlayerId(result.data.id);
}

function sortPlayers(
  players: readonly Player[],
  field: SortField,
  order: 'asc' | 'desc' | undefined,
): Player[] {
  const direction = order === 'desc' ? -1 : 1;
  return [...players].sort((a, b) => (a[field] - b[field]) * direction);
}

async function findPlayer(deps: Deps, id: PlayerId): Promise<Player> {
  const players = await readPlayers(deps);
  const player = players.find((candidate) => candidate.id === id);
  if (player === undefined) throw new NotFoundError(`player ${id}`);
  return player;
}

async function readPlayers(deps: Deps): Promise<Player[]> {
  return deps.store.read<Player>(
    { season: deps.config.season, dataset: DATASETS.players },
    playerSchema,
  );
}

/**
 * Player gameweeks are partitioned per gameweek. `partitions` reads the actual
 * manifest, so every partition that was ever written is found, including one
 * named outside the gw<n> convention. A lake with no player-gameweeks dataset
 * yet still owes callers an empty history rather than a 500.
 */
async function readPlayerHistory(deps: Deps, playerId: PlayerId): Promise<PlayerGameweek[]> {
  const entries: PlayerGameweek[] = [];
  const dataset = DATASETS.playerGameweeks;

  let partitionNames: string[];
  try {
    partitionNames = await deps.store.partitions({ season: deps.config.season, dataset });
  } catch (error) {
    if (error instanceof NotFoundError) return entries;
    throw error;
  }

  for (const partition of partitionNames) {
    const rows = await deps.store.read<PlayerGameweek>(
      { season: deps.config.season, dataset, partition },
      playerGameweekSchema,
    );
    for (const row of rows) {
      if (row.playerId === playerId) entries.push(row);
    }
  }

  return entries.sort((a, b) => a.gameweek - b.gameweek);
}
