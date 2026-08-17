import type { FastifyInstance } from 'fastify';
import type { Deps } from '../deps.js';

export interface HealthRouteOptions {
  deps: Deps;
}

export async function healthRoutes(app: FastifyInstance, opts: HealthRouteOptions): Promise<void> {
  const { deps } = opts;

  app.get('/health', async () => {
    const datasets = await deps.store.datasets(deps.config.season);
    return {
      status: 'ok',
      season: deps.config.season,
      hasData: datasets.length > 0,
    };
  });
}
