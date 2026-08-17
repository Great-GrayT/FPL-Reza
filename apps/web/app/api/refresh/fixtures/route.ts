import { revalidatePath } from 'next/cache';
import { refreshFixtures, summariseFixtureChange } from '@fpl/ingest';
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
 * Refetches the fixture list, reports every kickoff, gameweek, and score that
 * moved, and rebuilds the pages that render them. Fixtures are the most
 * volatile dataset in the lake, so this is the endpoint worth calling often.
 */
export async function POST(request: Request): Promise<Response> {
  const gate = authorise(request);
  if (!gate.ok) return gate.response;

  const writable = await lakeIsWritable();

  try {
    const result = await refreshFixtures({
      http,
      store,
      season,
      logger,
      dryRun: !writable,
    });

    // Rebuild whatever renders a fixture. Player pages carry each player's
    // fixture run in the ribbon, so they move with the fixture list.
    if (result.diff.changed) {
      revalidatePath('/matches');
      revalidatePath('/');
      revalidatePath('/players/[id]', 'page');
    }

    return Response.json({
      dataset: 'fixtures',
      changed: result.diff.changed,
      added: result.diff.added,
      removed: result.diff.removed,
      updated: result.diff.updated,
      total: result.fixtures.length,
      persisted: result.written !== null,
      // States plainly why nothing was stored, so a scheduler is never left
      // guessing whether a run silently did nothing.
      storage: writable ? 'writable' : 'read only, diff reported but not stored',
      unprotected: !isProtected(),
      changes: result.diff.changes.map((change) => ({
        ...change,
        summary: summariseFixtureChange(change),
      })),
      written: result.written,
    });
  } catch (error) {
    return failed(error, 'fixtures');
  }
}

/** Convenience for a scheduler that can only issue GET requests. */
export const GET = POST;
