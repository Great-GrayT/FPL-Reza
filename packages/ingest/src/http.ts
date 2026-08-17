import { SourceError, silentLogger, type Logger } from '@fpl/core';

export interface HttpClientOptions {
  baseUrl: string;
  timeoutMs: number;
  retries: number;
  /** Minimum gap between requests. FPL throttles clients that burst. */
  minRequestIntervalMs: number;
  userAgent: string;
  /** Names the upstream in any SourceError this client raises. */
  name?: string;
  /** Sent on every request. A second provider usually needs its own Referer. */
  headers?: Readonly<Record<string, string>>;
  logger?: Logger;
  /** Injected in tests. Defaults to the platform implementations. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  clock?: () => number;
}

export interface BinaryResponse {
  bytes: Uint8Array;
  contentType: string | null;
}

/**
 * Statuses that mean "this resource does not exist", not "this request failed".
 * 403 is in here because the Premier League image CDN is object storage without
 * public listing, so an absent file answers 403 rather than 404. The cost of
 * that reading is that a wholesale block would look like absence, which is why
 * the asset sync reports a missing count rather than swallowing it.
 */
const ABSENT = new Set([403, 404, 410]);

/** Statuses worth a retry: transient overload or an explicit throttle. */
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

const BACKOFF_BASE_MS = 250;

export class HttpClient {
  private readonly options: HttpClientOptions;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly clock: () => number;
  private readonly logger: Logger;
  private readonly name: string;
  private nextAllowedAt = 0;

  constructor(options: HttpClientOptions) {
    this.options = options;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.sleep = options.sleep ?? ((ms): Promise<void> => new Promise((r) => setTimeout(r, ms)));
    this.clock = options.clock ?? Date.now;
    this.logger = options.logger ?? silentLogger;
    this.name = options.name ?? 'fpl';
  }

  async getJson(pathname: string): Promise<unknown> {
    const response = await this.get(pathname, 'application/json');
    return response.json();
  }

  /** Used for the rules page, which is HTML rather than an API payload. */
  async getText(pathname: string): Promise<string> {
    const response = await this.get(pathname, 'text/html,application/xhtml+xml');
    return response.text();
  }

  /** Raw bytes, for images and any other non textual resource. */
  async getBytes(pathname: string, accept = '*/*'): Promise<BinaryResponse> {
    const response = await this.get(pathname, accept);
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get('content-type'),
    };
  }

  /**
   * Bytes, or null when the upstream says the resource does not exist. Asset
   * downloads probe many URLs that are legitimately absent (an unphotographed
   * player), and a missing file must not abort the run.
   */
  async tryGetBytes(pathname: string, accept = '*/*'): Promise<BinaryResponse | null> {
    try {
      return await this.getBytes(pathname, accept);
    } catch (error) {
      if (error instanceof SourceError && error.status !== undefined && ABSENT.has(error.status)) {
        return null;
      }
      throw error;
    }
  }

  private async get(pathname: string, accept: string): Promise<Response> {
    const url = this.resolve(pathname);
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.options.retries; attempt += 1) {
      await this.throttle();
      try {
        const response = await this.fetchImpl(url, {
          headers: {
            ...this.options.headers,
            accept,
            'user-agent': this.options.userAgent,
          },
          signal: AbortSignal.timeout(this.options.timeoutMs),
        });

        if (response.ok) return response;

        if (!RETRYABLE.has(response.status) || attempt === this.options.retries) {
          throw new SourceError(this.name, `GET ${url} failed with ${response.status}`, {
            status: response.status,
          });
        }

        const wait = retryAfterMs(response) ?? backoffMs(attempt);
        this.logger.warn('retrying request', { url, status: response.status, waitMs: wait });
        await this.sleep(wait);
        lastError = new SourceError(this.name, `GET ${url} failed with ${response.status}`, {
          status: response.status,
        });
      } catch (error) {
        // A thrown SourceError is already terminal; anything else is a network
        // or timeout fault, which is worth retrying while attempts remain.
        if (error instanceof SourceError) throw error;
        if (attempt === this.options.retries) {
          throw new SourceError(this.name, `GET ${url} failed: ${describeError(error)}`, {
            cause: error,
          });
        }
        const wait = backoffMs(attempt);
        this.logger.warn('retrying after network fault', { url, waitMs: wait });
        await this.sleep(wait);
        lastError = error;
      }
    }

    throw new SourceError(this.name, `GET ${url} exhausted retries`, { cause: lastError });
  }

  /** An absolute URL bypasses the base, so non API pages can reuse this client. */
  private resolve(pathname: string): string {
    if (/^https?:\/\//i.test(pathname)) return pathname;
    const base = this.options.baseUrl.replace(/\/+$/, '');
    const suffix = pathname.replace(/^\/+/, '');
    return `${base}/${suffix}`;
  }

  private async throttle(): Promise<void> {
    const wait = this.nextAllowedAt - this.clock();
    if (wait > 0) await this.sleep(wait);
    this.nextAllowedAt = this.clock() + this.options.minRequestIntervalMs;
  }
}

const backoffMs = (attempt: number): number => BACKOFF_BASE_MS * 2 ** attempt;

function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get('retry-after');
  if (header === null) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
