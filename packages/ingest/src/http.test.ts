import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SourceError } from '@fpl/core';
import { HttpClient } from './http.js';

interface Call {
  url: string;
}

/** A fetch input may be a string, a URL, or a Request. */
const urlOf = (input: Parameters<typeof fetch>[0]): string => {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
};

function stubFetch(responses: (() => Response)[]): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  let index = 0;
  const fetchImpl = ((input: Parameters<typeof fetch>[0]): Promise<Response> => {
    calls.push({ url: urlOf(input) });
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (next === undefined) throw new Error('no stubbed response');
    return Promise.resolve(next());
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers });

function client(
  responses: (() => Response)[],
  overrides: Partial<ConstructorParameters<typeof HttpClient>[0]> = {},
): { http: HttpClient; calls: Call[]; waits: number[] } {
  const { fetch: fetchImpl, calls } = stubFetch(responses);
  const waits: number[] = [];
  const http = new HttpClient({
    baseUrl: 'https://example.test/api',
    timeoutMs: 1000,
    retries: 3,
    minRequestIntervalMs: 0,
    userAgent: 'test',
    fetchImpl,
    sleep: (ms): Promise<void> => {
      waits.push(ms);
      return Promise.resolve();
    },
    ...overrides,
  });
  return { http, calls, waits };
}

describe('HttpClient', () => {
  it('returns parsed JSON on success', async () => {
    const { http, calls } = client([() => json({ ok: true })]);
    assert.deepEqual(await http.getJson('bootstrap-static/'), { ok: true });
    assert.equal(calls[0]?.url, 'https://example.test/api/bootstrap-static/');
  });

  it('joins base and path without doubling the slash', async () => {
    const { http, calls } = client([() => json({})], { baseUrl: 'https://example.test/api/' });
    await http.getJson('/fixtures/');
    assert.equal(calls[0]?.url, 'https://example.test/api/fixtures/');
  });

  it('retries a 503 then succeeds', async () => {
    let call = 0;
    const { http, calls } = client([
      (): Response => {
        call += 1;
        return call === 1 ? json({}, 503) : json({ ok: true });
      },
    ]);
    assert.deepEqual(await http.getJson('x'), { ok: true });
    assert.equal(calls.length, 2);
  });

  it('honours retry-after over its own backoff', async () => {
    let call = 0;
    const { http, waits } = client([
      (): Response => {
        call += 1;
        return call === 1 ? json({}, 429, { 'retry-after': '2' }) : json({ ok: true });
      },
    ]);
    await http.getJson('x');
    assert.deepEqual(waits, [2000]);
  });

  it('backs off exponentially without a retry-after header', async () => {
    let call = 0;
    const { http, waits } = client([
      (): Response => {
        call += 1;
        return call <= 2 ? json({}, 500) : json({ ok: true });
      },
    ]);
    await http.getJson('x');
    assert.deepEqual(waits, [250, 500]);
  });

  it('does not retry a 404', async () => {
    const { http, calls } = client([() => json({}, 404)]);
    await assert.rejects(() => http.getJson('missing'), SourceError);
    assert.equal(calls.length, 1);
  });

  it('gives up after the retry budget', async () => {
    const { http, calls } = client([() => json({}, 500)], { retries: 2 });
    await assert.rejects(() => http.getJson('x'), SourceError);
    assert.equal(calls.length, 3);
  });

  it('retries a network fault', async () => {
    let call = 0;
    const calls: Call[] = [];
    const http = new HttpClient({
      baseUrl: 'https://example.test/api',
      timeoutMs: 1000,
      retries: 2,
      minRequestIntervalMs: 0,
      userAgent: 'test',
      sleep: (): Promise<void> => Promise.resolve(),
      fetchImpl: (input: Parameters<typeof fetch>[0]): Promise<Response> => {
        calls.push({ url: urlOf(input) });
        call += 1;
        if (call === 1) return Promise.reject(new TypeError('socket hang up'));
        return Promise.resolve(json({ ok: true }));
      },
    });
    assert.deepEqual(await http.getJson('x'), { ok: true });
    assert.equal(calls.length, 2);
  });

  it('waits out the minimum request interval between calls', async () => {
    let now = 0;
    const waits: number[] = [];
    const { http } = client([() => json({})], {
      minRequestIntervalMs: 300,
      clock: (): number => now,
      // Advances the fake clock as well as recording, so the second call sees
      // the interval as already elapsed.
      sleep: (ms): Promise<void> => {
        waits.push(ms);
        now += ms;
        return Promise.resolve();
      },
    });
    await http.getJson('a');
    await http.getJson('b');
    // First call is free; the second waits the full interval.
    assert.deepEqual(waits, [300]);
  });
});
