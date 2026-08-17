import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../app.js';
import { createTestDeps, type TestDeps } from '../test-support.js';

/** Minimal page: no tables, no headings, so parseRules falls back to `parsedFrom: 'none'`. */
const STUB_RULES_HTML = '<html><body>Squad of 15 players. Rules v1.</body></html>';

const stubFetch: typeof fetch = (): Promise<Response> =>
  Promise.resolve(
    new Response(STUB_RULES_HTML, { status: 200, headers: { 'content-type': 'text/html' } }),
  );

describe('rules routes', () => {
  describe('before any scrape', () => {
    let testDeps: TestDeps;

    before(async () => {
      testDeps = await createTestDeps(stubFetch);
    });

    after(async () => {
      await testDeps.cleanup();
    });

    it('404s GET /rules when nothing has been scraped yet', async () => {
      const app = buildServer(testDeps.deps);
      const response = await app.inject({ method: 'GET', url: '/rules' });
      assert.equal(response.statusCode, 404);
      const body = response.json();
      assert.equal(body.error.code, 'NOT_FOUND');
      await app.close();
    });

    it('400s an invalid deadlines query', async () => {
      const app = buildServer(testDeps.deps);
      const response = await app.inject({ method: 'GET', url: '/rules/deadlines?next=maybe' });
      assert.equal(response.statusCode, 400);
      const body = response.json();
      assert.equal(body.error.code, 'VALIDATION');
      await app.close();
    });
  });

  describe('after a refresh', () => {
    let testDeps: TestDeps;

    before(async () => {
      testDeps = await createTestDeps(stubFetch);
    });

    after(async () => {
      await testDeps.cleanup();
    });

    it('scrapes and writes the first snapshot, with a human readable summary', async () => {
      const app = buildServer(testDeps.deps);
      const response = await app.inject({ method: 'POST', url: '/rules/refresh' });
      assert.equal(response.statusCode, 200);
      const body = response.json();
      assert.equal(body.changed, true);
      assert.ok(body.written !== null);
      assert.equal(body.changes.length, 1);
      assert.match(body.changes[0]?.summary ?? '', /rules added/);
      await app.close();
    });

    it('serves the scraped document from GET /rules', async () => {
      const app = buildServer(testDeps.deps);
      const response = await app.inject({ method: 'GET', url: '/rules' });
      assert.equal(response.statusCode, 200);
      const body = response.json();
      assert.equal(body.parsedFrom, 'none');
      assert.equal(body.squad.size, 15);
      await app.close();
    });
  });
});
