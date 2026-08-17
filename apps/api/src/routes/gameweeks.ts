import type { FastifyInstance } from 'fastify';
import {
  NotFoundError,
  currentGameweek,
  gameweekSchema,
  nextGameweek,
  type Gameweek,
} from '@fpl/core';
import { DATASETS } from '@fpl/ingest';
import type { Deps } from '../deps.js';

export interface GameweeksRouteOptions {
  deps: Deps;
}

export async function gameweeksRoutes(
  app: FastifyInstance,
  opts: GameweeksRouteOptions,
): Promise<void> {
  const { deps } = opts;

  const readGameweeks = (): Promise<Gameweek[]> =>
    deps.store.read<Gameweek>(
      { season: deps.config.season, dataset: DATASETS.gameweeks },
      gameweekSchema,
    );

  app.get('/gameweeks', async () => {
    const gameweeks = await readGameweeks();
    return { total: gameweeks.length, gameweeks };
  });

  app.get('/gameweeks/current', async () => {
    const gameweeks = await readGameweeks();
    const gameweek = currentGameweek(gameweeks);
    if (gameweek === undefined) throw new NotFoundError('current gameweek');
    return gameweek;
  });

  app.get('/gameweeks/next', async () => {
    const gameweeks = await readGameweeks();
    const gameweek = nextGameweek(gameweeks);
    if (gameweek === undefined) throw new NotFoundError('next gameweek');
    return gameweek;
  });
}
