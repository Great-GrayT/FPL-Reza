import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../app.js';
import { createTestDeps, seedCore, type TestDeps } from '../test-support.js';

describe('GET /health', () => {
  let testDeps: TestDeps;

  before(async () => {
    testDeps = await createTestDeps();
  });

  after(async () => {
    await testDeps.cleanup();
  });

  it('reports no data before anything is written', async () => {
    const app = buildServer(testDeps.deps);
    const response = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.season, '2026/27');
    assert.equal(body.hasData, false);
    await app.close();
  });

  it('reports data once a dataset has been written', async () => {
    await seedCore(testDeps.deps);
    const app = buildServer(testDeps.deps);
    const response = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.hasData, true);
    await app.close();
  });
});
