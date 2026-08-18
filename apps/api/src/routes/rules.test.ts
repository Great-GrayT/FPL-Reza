import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../app.js';
import { createTestDeps, type TestDeps } from '../test-support.js';

/**
 * Enough of the published page's structure to parse: a deadlines table and a
 * scoring table. It has to carry at least one of those, because a scrape that
 * finds none is treated as a broken page and is never stored.
 */
const STUB_RULES_HTML = `<html><body>
  <p>Squad of 15 players. Rules v1.</p>
  <h2>Deadlines</h2>
  <table>
    <tr><th>Gameweek</th><th>Deadline</th></tr>
    <tr><td>Gameweek 1</td><td>Fri 21 Aug 18:30</td></tr>
  </table>
  <h2>Scoring</h2>
  <table>
    <tr><th>Action</th><th>Points</th></tr>
    <tr><td>For playing 60 minutes or more (excluding stoppage time)</td><td>2</td></tr>
  </table>
</body></html>`;

/** What the live page serves today: a shell, with the rules rendered client side. */
const UNPARSABLE_RULES_HTML = '<html><body><div id="app"></div></body></html>';

const servingHtml =
  (html: string): typeof fetch =>
  (): Promise<Response> =>
    Promise.resolve(new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }));

const stubFetch = servingHtml(STUB_RULES_HTML);

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
      assert.equal(body.parsedFrom, 'html');
      assert.equal(body.squad.size, 15);
      assert.equal(body.deadlines.length, 1);
      await app.close();
    });
  });

  // The live page went client side in August 2026, so this is the current
  // behaviour, not a hypothetical: the refresh has to report it rather than
  // storing an empty document that reads back as "this season has no rules".
  describe('when the page serves nothing parsable', () => {
    let testDeps: TestDeps;

    before(async () => {
      testDeps = await createTestDeps(servingHtml(UNPARSABLE_RULES_HTML));
    });

    after(async () => {
      await testDeps.cleanup();
    });

    it('refreshes without storing anything, and says so', async () => {
      const app = buildServer(testDeps.deps);

      const refresh = await app.inject({ method: 'POST', url: '/rules/refresh' });
      assert.equal(refresh.statusCode, 200);
      assert.equal(refresh.json().usable, false);
      assert.equal(refresh.json().written, null);

      const read = await app.inject({ method: 'GET', url: '/rules' });
      assert.equal(read.statusCode, 404);

      await app.close();
    });
  });
});
