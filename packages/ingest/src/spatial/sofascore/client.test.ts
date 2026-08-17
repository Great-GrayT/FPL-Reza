import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ValidationError } from '@fpl/core';
import type { HttpClient } from '../../http.js';
import { SofascoreClient, sofascoreHttp, SOFASCORE_BASE_URL } from './client.js';
import {
  SOFASCORE_AVERAGE_POSITIONS,
  SOFASCORE_EVENTS_PAGE,
  SOFASCORE_EVENT_SUMMARY,
  SOFASCORE_HEATMAP,
  SOFASCORE_LINEUPS,
  SOFASCORE_SHOTMAP,
} from './fixture.test-data.js';

interface Call {
  url: string;
  headers: Record<string, string>;
}

/** Serves saved payloads by path. No test in this file touches the network. */
function stub(routes: Record<string, unknown>, status = 200): { http: HttpClient; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = ((
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const key = Object.keys(routes).find((route) => url.endsWith(route));
    if (key === undefined) {
      return Promise.resolve(new Response('{"error":{"code":404}}', { status: 404 }));
    }
    return Promise.resolve(new Response(JSON.stringify(routes[key]), { status }));
  }) as typeof fetch;

  return {
    http: sofascoreHttp({ minRequestIntervalMs: 0, retries: 0, fetchImpl }),
    calls,
  };
}

describe('sofascoreHttp', () => {
  it('sends the referer the provider requires, and no key', async () => {
    const { http, calls } = stub({ 'event/1': SOFASCORE_EVENT_SUMMARY });
    await new SofascoreClient(http).event(1);
    const headers = calls[0]?.headers;
    assert.equal(headers?.['referer'], 'https://www.sofascore.com/');
    assert.ok(headers?.['user-agent']?.startsWith('Mozilla/5.0'));
    assert.equal(calls[0]?.url, `${SOFASCORE_BASE_URL}/event/1`);
  });
});

describe('SofascoreClient', () => {
  it('reads a listing page', async () => {
    const { http, calls } = stub({ 'events/last/0': SOFASCORE_EVENTS_PAGE });
    const page = await new SofascoreClient(http).events(76986, 0);
    assert.equal(page.events.length, 2);
    assert.equal(page.hasNextPage, true);
    assert.equal(page.events[0]?.status?.type, 'finished');
    assert.ok(calls[0]?.url.includes('unique-tournament/17/season/76986/events/last/0'));
  });

  it('unwraps the event envelope', async () => {
    const { http } = stub({ 'event/14023963': SOFASCORE_EVENT_SUMMARY });
    const event = await new SofascoreClient(http).event(14023963);
    assert.equal(event.homeTeam.name, 'Crystal Palace');
    assert.equal(event.awayTeam.name, 'Arsenal');
    assert.equal(event.startTimestamp, 1779634800);
  });

  it('keeps the statistics it maps and strips the rest', async () => {
    const { http } = stub({ lineups: SOFASCORE_LINEUPS });
    const lineups = await new SofascoreClient(http).lineups(14023963);
    const keeper = lineups.home.players[0];
    assert.equal(keeper?.player.name, 'Dean Henderson');
    assert.equal(keeper?.statistics?.saves, 5);
    // A field nothing maps is dropped rather than carried through.
    assert.equal(Object.hasOwn(keeper?.statistics ?? {}, 'keeperSaveValue'), false);
  });

  it('reads the shotmap and the average positions', async () => {
    const { http } = stub({
      shotmap: SOFASCORE_SHOTMAP,
      'average-positions': SOFASCORE_AVERAGE_POSITIONS,
    });
    const client = new SofascoreClient(http);
    const shots = await client.shotmap(14023963);
    assert.equal(shots.length, 5);
    assert.equal(shots[0]?.playerCoordinates?.x, 13.2);

    const averages = await client.averagePositions(14023963);
    assert.equal(averages.home.length, 2);
    assert.equal(averages.away[0]?.player.name, 'Martín Zubimendi');
  });

  it('reads a player heatmap', async () => {
    const { http } = stub({ heatmap: SOFASCORE_HEATMAP });
    const points = await new SofascoreClient(http).heatmap(14023963, 788134);
    assert.equal(points.length, 15);
    assert.deepEqual(points[0], { x: 44, y: 55 });
  });

  it('reports an absent heatmap as null rather than failing the run', async () => {
    const { http } = stub({});
    assert.equal(await new SofascoreClient(http).tryHeatmap(14023963, 1), null);
  });

  it('raises a ValidationError when the payload shape moves', async () => {
    const { http } = stub({ lineups: { home: { players: [{ player: { id: 0, name: '' } }] } } });
    await assert.rejects(
      () => new SofascoreClient(http).lineups(1),
      (error: unknown) => error instanceof ValidationError,
    );
  });
});
