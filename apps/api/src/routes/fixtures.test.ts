import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../app.js';
import { createTestDeps, seedCore, type TestDeps } from '../test-support.js';

describe('GET /fixtures', () => {
  let testDeps: TestDeps;

  before(async () => {
    testDeps = await createTestDeps();
    await seedCore(testDeps.deps);
  });

  after(async () => {
    await testDeps.cleanup();
  });

  it('lists every fixture with no filter', async () => {
    const app = buildServer(testDeps.deps);
    const response = await app.inject({ method: 'GET', url: '/fixtures' });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.total, 2);
    await app.close();
  });

  it('filters by gameweek', async () => {
    const app = buildServer(testDeps.deps);
    const response = await app.inject({ method: 'GET', url: '/fixtures?gameweek=1' });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.total, 1);
    assert.equal(body.fixtures[0]?.id, 1);
    await app.close();
  });

  it('filters by team, matching either home or away', async () => {
    const app = buildServer(testDeps.deps);
    const response = await app.inject({ method: 'GET', url: '/fixtures?team=2' });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.total, 2);
    await app.close();
  });

  it('400s on an out of range gameweek', async () => {
    const app = buildServer(testDeps.deps);
    const response = await app.inject({ method: 'GET', url: '/fixtures?gameweek=99' });
    assert.equal(response.statusCode, 400);
    const body = response.json();
    assert.equal(body.error.code, 'VALIDATION');
    await app.close();
  });
});
