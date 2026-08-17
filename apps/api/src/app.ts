import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { Deps } from './deps.js';
import { registerErrorHandler } from './errors.js';
import { healthRoutes } from './routes/health.js';
import { playersRoutes } from './routes/players.js';
import { fixturesRoutes } from './routes/fixtures.js';
import { gameweeksRoutes } from './routes/gameweeks.js';
import { rulesRoutes } from './routes/rules.js';
import { assetsRoutes } from './routes/assets.js';

/** Assembles the Fastify instance from injected deps; nothing here touches process env. */
export function buildServer(deps: Deps): FastifyInstance {
  const app = Fastify({ logger: false });

  app.register(cors);
  registerErrorHandler(app);

  app.register(healthRoutes, { deps });
  app.register(playersRoutes, { deps });
  app.register(fixturesRoutes, { deps });
  app.register(gameweeksRoutes, { deps });
  app.register(rulesRoutes, { deps });
  app.register(assetsRoutes, { deps });

  return app;
}
