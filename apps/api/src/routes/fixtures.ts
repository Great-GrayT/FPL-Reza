import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ValidationError, asGameweekId, asTeamId, fixtureSchema, type Fixture } from '@fpl/core';
import { DATASETS, refreshFixtures, summariseFixtureChange } from '@fpl/ingest';
import type { Deps } from '../deps.js';

const listQuerySchema = z.object({
  gameweek: z.coerce.number().int().min(1).max(38).optional(),
  team: z.coerce.number().int().positive().optional(),
});

export interface FixturesRouteOptions {
  deps: Deps;
}

export async function fixturesRoutes(
  app: FastifyInstance,
  opts: FixturesRouteOptions,
): Promise<void> {
  const { deps } = opts;

  app.get('/fixtures', async (request: FastifyRequest) => {
    const result = listQuerySchema.safeParse(request.query);
    if (!result.success) {
      throw new ValidationError(
        'invalid query',
        result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      );
    }
    const query = result.data;

    const fixtures = await deps.store.read<Fixture>(
      { season: deps.config.season, dataset: DATASETS.fixtures },
      fixtureSchema,
    );

    const gameweek = query.gameweek === undefined ? undefined : asGameweekId(query.gameweek);
    const teamId = query.team === undefined ? undefined : asTeamId(query.team);

    const filtered = fixtures.filter((fixture) => {
      if (gameweek !== undefined && fixture.gameweek !== gameweek) return false;
      if (teamId !== undefined && fixture.homeTeam !== teamId && fixture.awayTeam !== teamId)
        return false;
      return true;
    });

    return { total: filtered.length, fixtures: filtered };
  });

  /**
   * Refetches the fixture list on demand. Fixtures move for broadcast, get
   * postponed, and take live scores, so a frontend cannot rely on the last
   * batch sync. Writes only when something actually moved, so this is safe to
   * call on a short poll, and the change list is shaped to render directly.
   */
  app.post('/fixtures/refresh', async () => {
    const result = await refreshFixtures({
      http: deps.http,
      store: deps.store,
      season: deps.config.season,
      logger: deps.logger,
    });

    return {
      changed: result.diff.changed,
      added: result.diff.added,
      removed: result.diff.removed,
      updated: result.diff.updated,
      total: result.fixtures.length,
      changes: result.diff.changes.map((change) => ({
        ...change,
        summary: summariseFixtureChange(change),
      })),
      written: result.written,
    };
  });
}
