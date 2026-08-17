import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { NotFoundError, ValidationError } from '@fpl/core';
import { assetKindSchema } from '@fpl/assets';
import type { Deps } from '../deps.js';

export interface AssetsRouteOptions {
  deps: Deps;
}

const listQuerySchema = z.object({ kind: assetKindSchema.optional() });

const assetParamsSchema = z.object({
  kind: assetKindSchema,
  /** The stored key, with any extension the caller appended already stripped. */
  key: z.string().min(1),
});

/**
 * Badges and photos are immutable for a given code: a new photo is published
 * under a new code rather than replacing the file. That makes a year long
 * immutable cache correct, and it keeps a squad page from refetching fifteen
 * images on every navigation.
 */
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

export async function assetsRoutes(app: FastifyInstance, opts: AssetsRouteOptions): Promise<void> {
  const { deps } = opts;

  app.get('/assets', async (request) => {
    const query = parseOrReject(listQuerySchema, request.query, 'invalid asset query');
    const records = await deps.assets.list(query.kind);
    return { total: records.length, assets: records };
  });

  app.get('/assets/:kind/:key', async (request, reply) => {
    const params = parseOrReject(assetParamsSchema, request.params, 'invalid asset path');
    // A browser will happily ask for `223094.png`; the manifest keys on the
    // bare code, so the extension is decoration and is dropped here.
    const key = params.key.replace(/\.[A-Za-z0-9]+$/, '');

    const record = await deps.assets.get(params.kind, key);
    const bytes = record === undefined ? undefined : await deps.assets.read(params.kind, key);
    if (record === undefined || bytes === undefined) {
      throw new NotFoundError(`asset ${params.kind}/${key}`);
    }

    return reply
      .header('content-type', record.contentType)
      .header('cache-control', CACHE_CONTROL)
      .header('etag', `"${record.sha256}"`)
      .send(Buffer.from(bytes));
  });
}

/** Turns a schema miss into the domain error the handler maps to 400. */
function parseOrReject<T>(schema: z.ZodType<T>, raw: unknown, message: string): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError(
      message,
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  return result.data;
}
