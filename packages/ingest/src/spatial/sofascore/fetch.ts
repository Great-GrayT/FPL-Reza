import { request as httpsRequest } from 'node:https';
import { SourceError } from '@fpl/core';

/**
 * The provider's edge fingerprints the TLS handshake, not just the headers.
 * Node's built in fetch offers its own cipher list and is answered with 403 on
 * every path, including the site root, while the same request with a browser's
 * cipher order is answered normally. So this pipeline needs its own fetch: the
 * headers alone (browser user agent, Referer) are not enough, and no key or
 * account is involved either way.
 *
 * Everything else stays with HttpClient. This is a transport only, so retries,
 * backoff, and throttling are unaffected.
 */
const BROWSER_CIPHERS = [
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-CHACHA20-POLY1305',
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384',
].join(':');

/** Compression is not requested, so the body needs no decoding step. */
export const sofascoreFetch: typeof fetch = (input, init) => {
  const url = urlOf(input);
  return new Promise<Response>((resolve, reject) => {
    const request = httpsRequest(
      {
        protocol: url.protocol,
        host: url.hostname,
        port: url.port === '' ? undefined : Number(url.port),
        path: `${url.pathname}${url.search}`,
        method: init?.method ?? 'GET',
        headers: headersOf(init),
        ciphers: BROWSER_CIPHERS,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => {
          resolve(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode ?? 500,
              statusText: response.statusMessage ?? '',
              headers: flatten(response.headers),
            }),
          );
        });
      },
    );

    // HttpClient passes a timeout signal, which has to reach the socket or a
    // hung upstream would hold the whole sync open.
    const signal = init?.signal;
    if (signal !== null && signal !== undefined) {
      if (signal.aborted) request.destroy(new Error('request aborted'));
      signal.addEventListener('abort', () => request.destroy(new Error('request aborted')), {
        once: true,
      });
    }

    request.on('error', reject);
    request.end();
  });
};

function urlOf(input: Parameters<typeof fetch>[0]): URL {
  if (typeof input === 'string') return new URL(input);
  if (input instanceof URL) return input;
  throw new SourceError('sofascore', 'this transport takes a URL, not a Request');
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  const headers = init?.headers;
  if (headers === undefined) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) {
    const out: Record<string, string> = {};
    for (const pair of headers) {
      const [name, value] = pair;
      if (name === undefined || value === undefined) continue;
      out[name] = value;
    }
    return out;
  }
  return flatten(headers);
}

/** node's header bag allows an array per name; Response wants one string. */
function flatten(
  headers: Record<string, string | readonly string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    // Set-Cookie is the only header that legitimately repeats here, and nothing
    // in this pipeline reads it.
    out[name] = typeof value === 'string' ? value : value.join(', ');
  }
  return out;
}
