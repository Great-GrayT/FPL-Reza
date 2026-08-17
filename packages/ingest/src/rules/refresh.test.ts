import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { asSeason } from '@fpl/core';
import { FileStore } from '@fpl/store';
import { HttpClient } from '../http.js';
import { readLatestRules, refreshRules } from './refresh.js';
import { RULES_HTML_CHANGED, RULES_HTML_SAMPLE } from './fixture.test-data.js';

const season = asSeason('2026/27');

/** Serves whatever HTML the test currently points at, with no network. */
function httpServing(get: () => string): HttpClient {
  return new HttpClient({
    baseUrl: 'https://example.test/api',
    timeoutMs: 1000,
    retries: 0,
    minRequestIntervalMs: 0,
    userAgent: 'test',
    sleep: (): Promise<void> => Promise.resolve(),
    fetchImpl: (): Promise<Response> =>
      Promise.resolve(
        new Response(get(), { status: 200, headers: { 'content-type': 'text/html' } }),
      ),
  });
}

describe('refreshRules', () => {
  let root: string;

  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'fpl-rules-'));
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes on the first scrape and reports it as a change', async () => {
    const store = new FileStore({ root: path.join(root, 'first') });
    const result = await refreshRules({
      http: httpServing(() => RULES_HTML_SAMPLE),
      store,
      season,
      capturedAt: new Date('2026-08-16T00:00:00Z'),
    });

    assert.equal(result.diff.changed, true);
    assert.equal(result.diff.checksumBefore, null);
    assert.notEqual(result.written, null);
    assert.equal(result.written?.rows, 1);
    // Nested documents only survive a schema checked read in JSONL.
    assert.equal(result.written?.format, 'jsonl');
    assert.equal(result.document.deadlines.length, 3);
  });

  it('does not rewrite an unchanged page', async () => {
    const store = new FileStore({ root: path.join(root, 'unchanged') });
    const http = httpServing(() => RULES_HTML_SAMPLE);

    await refreshRules({ http, store, season, capturedAt: new Date('2026-08-16T00:00:00Z') });
    const second = await refreshRules({
      http,
      store,
      season,
      capturedAt: new Date('2026-08-17T00:00:00Z'),
    });

    assert.equal(second.diff.changed, false);
    assert.equal(second.written, null);
    assert.equal((await store.history({ season, dataset: 'rules' })).length, 1);
  });

  it('writes a new snapshot and names what moved when the page changes', async () => {
    const store = new FileStore({ root: path.join(root, 'changed') });
    let html = RULES_HTML_SAMPLE;
    const http = httpServing(() => html);

    await refreshRules({ http, store, season, capturedAt: new Date('2026-08-16T00:00:00Z') });
    html = RULES_HTML_CHANGED;
    const second = await refreshRules({
      http,
      store,
      season,
      capturedAt: new Date('2026-08-17T00:00:00Z'),
    });

    assert.equal(second.diff.changed, true);
    assert.notEqual(second.written, null);
    assert.ok(second.diff.changes.some((change) => change.path === 'deadlines.gw1'));
    assert.equal((await store.history({ season, dataset: 'rules' })).length, 2);
  });

  it('round trips the stored document through the schema', async () => {
    const store = new FileStore({ root: path.join(root, 'roundtrip') });
    await refreshRules({
      http: httpServing(() => RULES_HTML_SAMPLE),
      store,
      season,
      capturedAt: new Date('2026-08-16T00:00:00Z'),
    });

    const stored = await readLatestRules(store, season);
    assert.equal(stored?.deadlines.length, 3);
    assert.equal(stored?.deadlines[0]?.deadline?.toISOString(), '2026-08-21T17:30:00.000Z');
    assert.equal(stored?.squad.budgetTenths, 1000);
  });

  it('returns undefined when the rules were never scraped', async () => {
    const store = new FileStore({ root: path.join(root, 'empty') });
    assert.equal(await readLatestRules(store, season), undefined);
  });
});
