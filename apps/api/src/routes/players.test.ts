import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../app.js';
import {
  createTestDeps,
  seedCore,
  seedSecondGameweekPartition,
  seedWithoutHistory,
  type TestDeps,
} from '../test-support.js';

interface PlayerListBody {
  total: number;
  players: { id: number; webName: string; position: string; price: number }[];
}

interface PlayerHistoryBody {
  history: { gameweek: number; totalPoints: number }[];
}

describe('players routes', () => {
  let testDeps: TestDeps;

  before(async () => {
    testDeps = await createTestDeps();
    await seedCore(testDeps.deps);
  });

  after(async () => {
    await testDeps.cleanup();
  });

  it('lists players filtered by position and sorted by price', async () => {
    const app = buildServer(testDeps.deps);
    const response = await app.inject({
      method: 'GET',
      url: '/players?position=MID&sort=price&order=desc',
    });
    assert.equal(response.statusCode, 200);
    const body = response.json<PlayerListBody>();
    assert.equal(body.total, 2);
    assert.deepEqual(
      body.players.map((player) => player.webName),
      ['Saka', 'Rice'],
    );
    await app.close();
  });

  it('filters by team and maxPrice', async () => {
    const app = buildServer(testDeps.deps);
    const response = await app.inject({ method: 'GET', url: '/players?team=1&maxPrice=120' });
    assert.equal(response.statusCode, 200);
    const body = response.json<PlayerListBody>();
    assert.deepEqual(
      body.players.map((player) => player.webName),
      ['Saka'],
    );
    await app.close();
  });

  it('returns a single player by id', async () => {
    const app = buildServer(testDeps.deps);
    const response = await app.inject({ method: 'GET', url: '/players/1' });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.webName, 'Haaland');
    await app.close();
  });

  it('404s for an unknown player id', async () => {
    const app = buildServer(testDeps.deps);
    const response = await app.inject({ method: 'GET', url: '/players/999' });
    assert.equal(response.statusCode, 404);
    const body = response.json();
    assert.equal(body.error.code, 'NOT_FOUND');
    await app.close();
  });

  it('400s on an invalid query value', async () => {
    const app = buildServer(testDeps.deps);
    const response = await app.inject({ method: 'GET', url: '/players?position=GOALKEEPER' });
    assert.equal(response.statusCode, 400);
    const body = response.json();
    assert.equal(body.error.code, 'VALIDATION');
    assert.ok(body.error.issues !== undefined && body.error.issues.length > 0);
    await app.close();
  });

  it('400s on an invalid player id', async () => {
    const app = buildServer(testDeps.deps);
    const response = await app.inject({ method: 'GET', url: '/players/not-a-number' });
    assert.equal(response.statusCode, 400);
    await app.close();
  });

  it('returns player history from the seeded gameweek partition', async () => {
    const app = buildServer(testDeps.deps);
    const response = await app.inject({ method: 'GET', url: '/players/1/history' });
    assert.equal(response.statusCode, 200);
    const body = response.json<PlayerHistoryBody>();
    assert.equal(body.history.length, 1);
    assert.equal(body.history[0]?.gameweek, 1);
    assert.equal(body.history[0]?.totalPoints, 12);
    await app.close();
  });

  it('404s for history of an unknown player', async () => {
    const app = buildServer(testDeps.deps);
    const response = await app.inject({ method: 'GET', url: '/players/999/history' });
    assert.equal(response.statusCode, 404);
    await app.close();
  });
});

describe('player history across partitions', () => {
  it('assembles history from more than one gameweek partition', async () => {
    const testDeps = await createTestDeps();
    await seedCore(testDeps.deps);
    await seedSecondGameweekPartition(testDeps.deps);

    const app = buildServer(testDeps.deps);
    const response = await app.inject({ method: 'GET', url: '/players/1/history' });
    assert.equal(response.statusCode, 200);
    const body = response.json<PlayerHistoryBody>();
    assert.deepEqual(
      body.history.map((entry) => entry.gameweek),
      [1, 2],
    );
    assert.equal(body.history[1]?.totalPoints, 6);

    await app.close();
    await testDeps.cleanup();
  });

  it('returns an empty history when the player-gameweeks dataset was never written', async () => {
    const testDeps = await createTestDeps();
    await seedWithoutHistory(testDeps.deps);

    const app = buildServer(testDeps.deps);
    const response = await app.inject({ method: 'GET', url: '/players/1/history' });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.playerId, 1);
    assert.deepEqual(body.history, []);

    await app.close();
    await testDeps.cleanup();
  });
});
