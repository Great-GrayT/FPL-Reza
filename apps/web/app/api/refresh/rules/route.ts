import { revalidatePath } from 'next/cache';
import { refreshRules, summariseChange } from '@fpl/ingest';
import {
  authorise,
  failed,
  http,
  isProtected,
  lakeIsWritable,
  logger,
  season,
  store,
} from '@/lib/refresh';

export const dynamic = 'force-dynamic';

/**
 * Rescrapes the published rules page and reports what changed. Deadlines and
 * scoring values live here, so this is what keeps a deadline component honest
 * when the Premier League edits the page mid season.
 */
export async function POST(request: Request): Promise<Response> {
  const gate = authorise(request);
  if (!gate.ok) return gate.response;

  const writable = await lakeIsWritable();

  try {
    const result = await refreshRules({ http, store, season, logger, dryRun: !writable });

    if (result.usable && result.diff.changed) {
      revalidatePath('/');
      revalidatePath('/matches');
    }

    return Response.json({
      dataset: 'rules',
      // False when the published page served nothing parsable, which is its
      // current state: client rendered, with no tables and no embedded payload.
      usable: result.usable,
      changed: result.diff.changed,
      checksum: result.diff.checksumAfter,
      deadlines: result.document.deadlines.length,
      persisted: result.written !== null,
      storage: writable ? 'writable' : 'read only, diff reported but not stored',
      unprotected: !isProtected(),
      changes: result.diff.changes.map((change) => ({
        ...change,
        summary: summariseChange(change),
      })),
      written: result.written,
    });
  } catch (error) {
    return failed(error, 'rules');
  }
}

export const GET = POST;
