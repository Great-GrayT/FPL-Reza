import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { asSeason, silentLogger, teamSchema } from '@fpl/core';
import { FileStore } from '@fpl/store';
import { HttpClient } from '../http.js';
import { DATASETS, type SourceBatch, type SourceContext } from '../source.js';
import { footballDataOddsSource } from './source.js';

const season = asSeason('2026/27');

const team = (id: number, name: string, shortName: string) =>
  teamSchema.parse({
    id,
    code: id,
    name,
    shortName,
    strength: 3,
    strengthOverallHome: 1200,
    strengthOverallAway: 1200,
    strengthAttackHome: 1200,
    strengthAttackAway: 1200,
    strengthDefenceHome: 1200,
    strengthDefenceAway: 1200,
  });

/** Answers every request with one status and body, with no network. */
function httpAnswering(status: number, body: string): HttpClient {
  return new HttpClient({
    baseUrl: 'https://provider.test',
    timeoutMs: 1000,
    retries: 0,
    minRequestIntervalMs: 0,
    userAgent: 'test',
    sleep: (): Promise<void> => Promise.resolve(),
    fetchImpl: (): Promise<Response> => Promise.resolve(new Response(body, { status })),
  });
}

async function runSource(
  http: HttpClient,
): Promise<{ batches: SourceBatch[]; warnings: string[] }> {
  const root = await mkdtemp(path.join(tmpdir(), 'fpl-odds-'));
  try {
    const store = new FileStore({ root });
    await store.write({ season, dataset: DATASETS.teams }, [
      team(1, 'Arsenal', 'ARS'),
      team(2, 'Crystal Palace', 'CRY'),
    ]);

    const warnings: string[] = [];
    const logger = {
      ...silentLogger,
      warn: (message: string): void => {
        warnings.push(message);
      },
    };

    const context = {
      season,
      store,
      logger,
      capturedAt: new Date('2026-08-18T00:00:00Z'),
    } as unknown as SourceContext;

    const batches: SourceBatch[] = [];
    for await (const batch of footballDataOddsSource(http).run(context)) batches.push(batch);
    return { batches, warnings };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('footballDataOddsSource', () => {
  // The provider publishes a season file only once that season is under way, and
  // answers a path it does not hold with 300 Multiple Choices through Apache
  // content negotiation. A scheduled sync must not fail over a file that does
  // not exist yet: this happened on the first real run, on 2026-08-18.
  it('yields nothing when the season file is not published yet', async () => {
    const { batches, warnings } = await runSource(httpAnswering(300, 'Multiple Choices'));

    assert.equal(batches.length, 0);
    assert.deepEqual(warnings, ['odds file not published for this season yet']);
  });

  it('yields nothing for the other absent statuses too', async () => {
    for (const status of [403, 404, 410]) {
      const { batches } = await runSource(httpAnswering(status, ''));
      assert.equal(batches.length, 0, `status ${String(status)} should be treated as absent`);
    }
  });

  it('still fails on a status that means the provider is broken, not absent', async () => {
    await assert.rejects(() => runSource(httpAnswering(418, '')), /418/);
  });

  it('yields the parsed quotes when the file exists', async () => {
    const csv = [
      'Div,Date,Time,HomeTeam,AwayTeam,B365H,B365D,B365A',
      'E0,22/08/2026,15:00,Arsenal,Crystal Palace,1.40,4.75,7.50',
    ].join('\n');

    const { batches } = await runSource(httpAnswering(200, csv));

    assert.equal(batches.length, 1);
    assert.equal(batches[0]?.dataset, DATASETS.odds);
    assert.equal(batches[0]?.partition, 'football-data-2026-27');
    // One bookmaker, three selections in the match odds market.
    assert.equal(batches[0]?.rows.length, 3);
  });
});
