import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  asFixtureId,
  asPlayerId,
  asSeason,
  asTeamId,
  fixtureSchema,
  matchEventSchema,
  playerMatchSpatialSchema,
  playerSchema,
  silentLogger,
  teamSchema,
  type Fixture,
  type Player,
  type Team,
} from '@fpl/core';
import { FileStore } from '@fpl/store';
import { DATASETS, type SourceBatch } from '../../source.js';
import { HttpClient } from '../../http.js';
import { SofascoreClient } from './client.js';
import { sofascoreSpatialSource } from './source.js';
import {
  SOFASCORE_AVERAGE_POSITIONS,
  SOFASCORE_HEATMAP,
  SOFASCORE_LINEUPS,
  SOFASCORE_SHOTMAP,
} from './fixture.test-data.js';

const season = asSeason('2025/26');
const capturedAt = new Date('2026-08-17T00:00:00Z');

/** The one event the saved lineups and shotmap belong to. */
const EVENT_ID = 14023963;
const KICKOFF = '2026-05-24T15:00:00Z';

const team = (id: number, name: string, shortName: string): Record<string, unknown> => ({
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

const player = (
  id: number,
  firstName: string,
  secondName: string,
  webName: string,
  teamId: number,
): Record<string, unknown> => ({
  id,
  code: id * 10,
  firstName,
  secondName,
  webName,
  teamId,
  position: 'MID',
  price: 50,
  startPrice: 50,
  totalPoints: 0,
  minutes: 0,
  goals: 0,
  assists: 0,
  cleanSheets: 0,
  goalsConceded: 0,
  yellowCards: 0,
  redCards: 0,
  saves: 0,
  bonus: 0,
  bps: 0,
  form: 0,
  pointsPerGame: 0,
  selectedByPercent: 0,
  expectedGoals: 0,
  expectedAssists: 0,
  expectedGoalInvolvements: 0,
  expectedGoalsConceded: 0,
  availability: 'available',
  chanceOfPlayingNextRound: null,
  news: '',
});

/**
 * Serves the saved payloads for the one event under test, and a listing page
 * rewritten to point at it. No test in this file touches the network.
 */
function clientServing(seen: string[]): SofascoreClient {
  const listing = {
    events: [
      {
        id: EVENT_ID,
        slug: 'crystal-palace-arsenal',
        startTimestamp: Math.floor(new Date(KICKOFF).getTime() / 1000),
        status: { code: 100, type: 'finished', description: 'Ended' },
        roundInfo: { round: 38 },
        homeTeam: { id: 7, name: 'Crystal Palace', shortName: 'Crystal Palace', nameCode: 'CRY' },
        awayTeam: { id: 42, name: 'Arsenal', shortName: 'Arsenal', nameCode: 'ARS' },
        hasEventPlayerHeatMap: true,
      },
      // A second, unfinished event, which must be skipped.
      {
        id: 999,
        startTimestamp: Math.floor(Date.now() / 1000),
        status: { code: 0, type: 'notstarted' },
        homeTeam: { id: 7, name: 'Crystal Palace' },
        awayTeam: { id: 42, name: 'Arsenal' },
      },
    ],
    hasNextPage: false,
  };

  const routes: [string, unknown][] = [
    ['/heatmap', SOFASCORE_HEATMAP],
    ['/lineups', SOFASCORE_LINEUPS],
    ['/shotmap', SOFASCORE_SHOTMAP],
    ['/average-positions', SOFASCORE_AVERAGE_POSITIONS],
    ['/events/last/', listing],
  ];

  const http = new HttpClient({
    baseUrl: 'https://example.test/api/v1',
    timeoutMs: 1000,
    retries: 0,
    minRequestIntervalMs: 0,
    userAgent: 'test',
    sleep: (): Promise<void> => Promise.resolve(),
    fetchImpl: (input: Parameters<typeof fetch>[0]): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      seen.push(url);
      const match = routes.find(([suffix]) => url.includes(suffix));
      if (match === undefined) {
        return Promise.resolve(new Response('{}', { status: 404 }));
      }
      return Promise.resolve(new Response(JSON.stringify(match[1]), { status: 200 }));
    },
  });

  return new SofascoreClient(http);
}

async function seed(root: string): Promise<FileStore> {
  const store = new FileStore({ root });
  await store.write({ season, dataset: DATASETS.teams }, [
    team(7, 'Crystal Palace', 'CRY'),
    team(1, 'Arsenal', 'ARS'),
  ]);
  await store.write({ season, dataset: DATASETS.players }, [
    player(11, 'Dean', 'Henderson', 'Henderson', 7),
    player(12, 'Will', 'Hughes', 'Hughes', 7),
    player(13, 'Martín', 'Zubimendi Ibáñez', 'Zubimendi', 1),
    player(14, 'Noni', 'Madueke', 'Madueke', 1),
    player(15, 'Jean-Philippe', 'Mateta', 'Mateta', 7),
  ]);
  await store.write({ season, dataset: DATASETS.fixtures }, [
    {
      id: 380,
      gameweek: 38,
      kickoff: KICKOFF,
      homeTeam: 7,
      awayTeam: 1,
      homeScore: 1,
      awayScore: 2,
      finished: true,
      started: true,
      homeDifficulty: 3,
      awayDifficulty: 3,
    },
  ]);
  return store;
}

async function collect(store: FileStore, seen: string[]): Promise<SourceBatch[]> {
  const source = sofascoreSpatialSource(clientServing(seen), { seasonId: 76986, maxEvents: 1 });
  const batches: SourceBatch[] = [];
  for await (const batch of source.run({ season, store, logger: silentLogger, capturedAt })) {
    batches.push(batch);
  }
  return batches;
}

describe('sofascoreSpatialSource', () => {
  let root: string;

  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'fpl-sofascore-'));
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('declares what it writes and what it needs first', () => {
    const source = sofascoreSpatialSource(clientServing([]));
    assert.equal(source.name, 'spatial-sofascore');
    assert.deepEqual(source.datasets, [DATASETS.playerMatchSpatial, DATASETS.matchEvents]);
    assert.deepEqual(source.requires, [DATASETS.teams, DATASETS.players, DATASETS.fixtures]);
  });

  it('writes both datasets into the fixture gameweek partition', async () => {
    const store = await seed(path.join(root, 'batches'));
    const batches = await collect(store, []);

    const spatial = batches.filter((batch) => batch.dataset === DATASETS.playerMatchSpatial);
    const events = batches.filter((batch) => batch.dataset === DATASETS.matchEvents);
    assert.equal(spatial.length, 1);
    assert.equal(events.length, 1);
    assert.equal(spatial[0]?.partition, 'gw38');
    assert.equal(events[0]?.partition, 'gw38');
  });

  it('keeps only the players it could resolve, and joins them onto the domain', async () => {
    const store = await seed(path.join(root, 'players'));
    const batches = await collect(store, []);
    const rows = (
      batches.find((batch) => batch.dataset === DATASETS.playerMatchSpatial)?.rows ?? []
    ).map((row) => playerMatchSpatialSchema.parse(row));

    // Henderson, Hughes, Zubimendi and Madueke played; the unused substitutes
    // and the players the domain does not carry are dropped.
    assert.equal(rows.length, 4);
    const henderson = rows.find((row) => row.playerId === asPlayerId(11));
    assert.equal(henderson?.fixtureId, asFixtureId(380));
    assert.equal(henderson?.teamId, asTeamId(7));
    assert.equal(henderson?.minutes, 90);
    assert.equal(henderson?.provider, 'sofascore');
    // The heatmap endpoint answered, so the grid and its zone counts are filled.
    assert.ok(henderson?.heatmap);
    assert.ok(henderson.touchesByZone);

    const madueke = rows.find((row) => row.playerId === asPlayerId(14));
    assert.equal(madueke?.teamId, asTeamId(1));
  });

  it('writes a shot for every row in the shotmap, resolved or not', async () => {
    const store = await seed(path.join(root, 'shots'));
    const batches = await collect(store, []);
    const rows = (batches.find((batch) => batch.dataset === DATASETS.matchEvents)?.rows ?? []).map(
      (row) => matchEventSchema.parse(row),
    );

    assert.equal(rows.length, 5);
    const goal = rows.find((row) => row.providerEventId === '7376236');
    assert.equal(goal?.playerId, asPlayerId(14));
    assert.equal(goal?.type, 'shot_goal');
    // Eze is not in the seeded player list, so his shot is kept without a player.
    assert.ok(rows.some((row) => row.playerId === null));
  });

  it('fetches one heatmap per resolved player and nothing more', async () => {
    const store = await seed(path.join(root, 'requests'));
    const seen: string[] = [];
    await collect(store, seen);

    const heatmaps = seen.filter((url) => url.endsWith('/heatmap'));
    assert.equal(heatmaps.length, 4);
    // One listing page, one lineups, one average-positions, one shotmap.
    assert.equal(seen.filter((url) => url.includes('/events/last/')).length, 1);
    assert.equal(seen.filter((url) => url.endsWith('/lineups')).length, 1);
  });

  it('yields nothing when the season is unknown to the provider', async () => {
    const store = await seed(path.join(root, 'unknown-season'));
    const source = sofascoreSpatialSource(clientServing([]), {});
    const batches: SourceBatch[] = [];
    for await (const batch of source.run({
      season: asSeason('2099/00'),
      store,
      logger: silentLogger,
      capturedAt,
    })) {
      batches.push(batch);
    }
    assert.equal(batches.length, 0);
  });

  it('skips a gameweek it was told to start after', async () => {
    const store = await seed(path.join(root, 'since'));
    const source = sofascoreSpatialSource(clientServing([]), {
      seasonId: 76986,
      sinceGameweek: 39,
    });
    const batches: SourceBatch[] = [];
    for await (const batch of source.run({ season, store, logger: silentLogger, capturedAt })) {
      batches.push(batch);
    }
    assert.equal(batches.length, 0);
  });
});

/** The seeded rows have to survive a schema checked read, or the source cannot run. */
describe('seeded store', () => {
  it('round trips teams, players and fixtures', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'fpl-sofascore-seed-'));
    try {
      const store = await seed(root);
      const teams = await store.read<Team>({ season, dataset: DATASETS.teams }, teamSchema);
      const players = await store.read<Player>({ season, dataset: DATASETS.players }, playerSchema);
      const fixtures = await store.read<Fixture>(
        { season, dataset: DATASETS.fixtures },
        fixtureSchema,
      );
      assert.equal(teams.length, 2);
      assert.equal(players.length, 5);
      assert.equal(fixtures[0]?.gameweek, 38);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
