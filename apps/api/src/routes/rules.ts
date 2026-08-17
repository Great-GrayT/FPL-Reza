import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { NotFoundError, ValidationError } from '@fpl/core';
import { readLatestRules, refreshRules, summariseChange, type RulesDocument } from '@fpl/ingest';
import type { Deps } from '../deps.js';

const deadlinesQuerySchema = z.object({
  next: z.enum(['true', 'false', '1', '0']).optional(),
});

const TRUTHY = new Set(['true', '1']);

export interface RulesRouteOptions {
  deps: Deps;
}

export async function rulesRoutes(app: FastifyInstance, opts: RulesRouteOptions): Promise<void> {
  const { deps } = opts;

  app.get('/rules', async () => {
    return readDocument(deps);
  });

  app.get('/rules/deadlines', async (request: FastifyRequest) => {
    const result = deadlinesQuerySchema.safeParse(request.query);
    if (!result.success) {
      throw new ValidationError(
        'invalid query',
        result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      );
    }
    const wantNext = result.data.next !== undefined && TRUTHY.has(result.data.next);

    const document = await readDocument(deps);
    const now = Date.now();
    const deadlines = wantNext
      ? document.deadlines.filter(
          (entry) => entry.deadline !== null && entry.deadline.getTime() > now,
        )
      : document.deadlines;

    return { total: deadlines.length, deadlines };
  });

  // Backs a frontend "update rules" button: the response must be directly
  // renderable, so every change carries a ready made summary string.
  app.post('/rules/refresh', async () => {
    const result = await refreshRules({
      http: deps.http,
      store: deps.store,
      season: deps.config.season,
      logger: deps.logger,
    });

    return {
      changed: result.diff.changed,
      checksum: result.diff.checksumAfter,
      changes: result.diff.changes.map((change) => ({
        ...change,
        summary: summariseChange(change),
      })),
      written: result.written,
    };
  });
}

async function readDocument(deps: Deps): Promise<RulesDocument> {
  const document = await readLatestRules(deps.store, deps.config.season);
  if (document === undefined) throw new NotFoundError('rules document');
  return document;
}
