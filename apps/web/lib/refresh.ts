import 'server-only';
import { access, constants } from 'node:fs/promises';
import { createLogger } from '@fpl/core';
import { loadConfig } from '@fpl/config';
import { FileStore } from '@fpl/store';
import { HttpClient } from '@fpl/ingest';
import { lakeRoot, season } from './lake';

/**
 * Shared plumbing for the refresh endpoints an external scheduler calls.
 *
 * A serverless host mounts the deployment read only, so a refresh there can
 * fetch upstream and report exactly what moved, but it cannot persist. Rather
 * than failing or pretending, the endpoint probes for write access once and
 * says in its response whether the change was stored. Run the same endpoint
 * against a writable store and it persists as normal.
 */

export const config = loadConfig();

export const logger = createLogger({ level: config.logLevel });

export const store = new FileStore({ root: lakeRoot });

export const http = new HttpClient({
  baseUrl: config.fpl.baseUrl,
  timeoutMs: config.fpl.timeoutMs,
  retries: config.fpl.retries,
  minRequestIntervalMs: config.fpl.minRequestIntervalMs,
  userAgent: config.fpl.userAgent,
  logger,
});

export { season };

export async function lakeIsWritable(): Promise<boolean> {
  try {
    await access(lakeRoot, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * These endpoints spend an upstream request budget and are meant for one
 * scheduler, so they are shared secret gated. With REFRESH_TOKEN unset the
 * gate is open, which is the right default for local development and the
 * wrong one in production, hence the explicit unprotected flag in responses.
 */
export function authorise(request: Request): { ok: true } | { ok: false; response: Response } {
  const expected = process.env.REFRESH_TOKEN;
  if (expected === undefined || expected === '') return { ok: true };

  const supplied =
    request.headers.get('x-refresh-token') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    '';

  if (supplied === expected) return { ok: true };

  return {
    ok: false,
    response: Response.json(
      { error: 'unauthorised', message: 'Send the shared secret in x-refresh-token.' },
      { status: 401 },
    ),
  };
}

export const isProtected = (): boolean => {
  const expected = process.env.REFRESH_TOKEN;
  return expected !== undefined && expected !== '';
};

export function failed(error: unknown, source: string): Response {
  const message = error instanceof Error ? error.message : String(error);
  logger.error('refresh failed', { source, message });
  // An upstream that refused is not this service being broken, so it reads as
  // a bad gateway rather than an internal error.
  return Response.json({ error: 'upstream_failed', source, message }, { status: 502 });
}
