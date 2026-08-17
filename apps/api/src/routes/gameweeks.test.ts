import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../app.js';
import { createTestDeps, seedCore, type TestDeps } from '../test-support.js';

describe('gameweeks routes', () => {
  describe('with seeded data', () => {
    let testDeps: TestDeps;

    before(async () => {
      testDeps = await createTestDeps();
      await seedCore(testDeps.deps);
    });

    after(async () => {
      await testDeps.cleanup();
    });

    it('lists every gameweek', async () => {
      const app = buildServer(testDeps.deps);
      const response = await app.inject({ method: 'GET', url: '/gameweeks' });
      assert.equal(response.statusCode, 200);
      const body = response.json();
      assert.equal(body.total, 3);
      await app.close();
    });

    it('finds the current gameweek', async () => {
      const app = buildServer(testDeps.deps);
      const response = await app.inject({ method: 'GET', url: '/gameweeks/current' });
      assert.equal(response.statusCode, 200);
      const body = response.json();
      assert.equal(body.id, 2);
      assert.equal(body.isCurrent, true);
      await app.close();
    });

    it('finds the next gameweek', async () => {
      const app = buildServer(testDeps.deps);
      const response = await app.inject({ method: 'GET', url: '/gameweeks/next' });
      assert.equal(response.statusCode, 200);
      const body = response.json();
      assert.equal(body.id, 3);
      assert.equal(body.isNext, true);
      await app.close();
    });
  });

  describe('without any data', () => {
    let testDeps: TestDeps;

    before(async () => {
      testDeps = await createTestDeps();
    });

    after(async () => {
      await testDeps.cleanup();
    });

    it('404s the gameweeks dataset when it was never written', async () => {
      const app = buildServer(testDeps.deps);
      const response = await app.inject({ method: 'GET', url: '/gameweeks' });
      assert.equal(response.statusCode, 404);
      const body = response.json();
      assert.equal(body.error.code, 'NOT_FOUND');
      await app.close();
    });
  });
});
