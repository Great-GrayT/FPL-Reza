import { ValidationError, SourceError } from '@fpl/core';
import type { ZodType } from 'zod';
import { HttpClient, type HttpClientOptions } from '../../http.js';
import { sofascoreFetch } from './fetch.js';
import {
  sofascoreAveragePositionsSchema,
  sofascoreEventEnvelopeSchema,
  sofascoreEventsPageSchema,
  sofascoreHeatmapSchema,
  sofascoreLineupsSchema,
  sofascoreShotmapSchema,
  type SofascoreAveragePositions,
  type SofascoreEvent,
  type SofascoreEventsPage,
  type SofascoreHeatmapPoint,
  type SofascoreLineups,
  type SofascoreShot,
} from './schemas.js';

export const SOFASCORE_BASE_URL = 'https://api.sofascore.com/api/v1';

/** England's Premier League in the provider's tournament numbering. */
export const PREMIER_LEAGUE_UNIQUE_TOURNAMENT = 17;

/**
 * The provider serves its own site, so it answers a browser shaped request and
 * refuses a bare one. No key is involved: these two headers are the whole of it.
 */
export const SOFASCORE_HEADERS: Readonly<Record<string, string>> = {
  referer: 'https://www.sofascore.com/',
  origin: 'https://www.sofascore.com',
};

export const SOFASCORE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export type SofascoreHttpOptions = Partial<HttpClientOptions>;

/**
 * An HttpClient carrying the provider's required headers. Throttling stays with
 * HttpClient: one client, one request interval, no parallel fetch loop.
 */
export function sofascoreHttp(options: SofascoreHttpOptions = {}): HttpClient {
  return new HttpClient({
    baseUrl: SOFASCORE_BASE_URL,
    timeoutMs: 15000,
    retries: 3,
    minRequestIntervalMs: 500,
    userAgent: SOFASCORE_USER_AGENT,
    ...options,
    name: options.name ?? 'sofascore',
    headers: { ...SOFASCORE_HEADERS, ...options.headers },
    // Node's own fetch is refused by the provider's edge; see fetch.ts.
    fetchImpl: options.fetchImpl ?? sofascoreFetch,
  });
}

/** Statuses the provider uses for a resource it does not hold for a match. */
const ABSENT = new Set([403, 404]);

/** Thin typed wrapper over the Sofascore endpoints this pipeline reads. */
export class SofascoreClient {
  private readonly http: HttpClient;

  constructor(http: HttpClient) {
    this.http = http;
  }

  /** One page of finished events, newest page first at page 0. */
  async events(
    seasonId: number,
    page: number,
    tournamentId?: number,
  ): Promise<SofascoreEventsPage> {
    const unique = tournamentId ?? PREMIER_LEAGUE_UNIQUE_TOURNAMENT;
    const path = `unique-tournament/${unique}/season/${seasonId}/events/last/${page}`;
    return this.parse(await this.http.getJson(path), sofascoreEventsPageSchema, path);
  }

  async event(eventId: number): Promise<SofascoreEvent> {
    const path = `event/${eventId}`;
    return this.parse(await this.http.getJson(path), sofascoreEventEnvelopeSchema, path).event;
  }

  async lineups(eventId: number): Promise<SofascoreLineups> {
    const path = `event/${eventId}/lineups`;
    return this.parse(await this.http.getJson(path), sofascoreLineupsSchema, path);
  }

  async shotmap(eventId: number): Promise<SofascoreShot[]> {
    const path = `event/${eventId}/shotmap`;
    return this.parse(await this.http.getJson(path), sofascoreShotmapSchema, path).shotmap;
  }

  async averagePositions(eventId: number): Promise<SofascoreAveragePositions> {
    const path = `event/${eventId}/average-positions`;
    return this.parse(await this.http.getJson(path), sofascoreAveragePositionsSchema, path);
  }

  async heatmap(eventId: number, playerId: number): Promise<SofascoreHeatmapPoint[]> {
    const path = `event/${eventId}/player/${playerId}/heatmap`;
    return this.parse(await this.http.getJson(path), sofascoreHeatmapSchema, path).heatmap;
  }

  /**
   * Null where the provider holds no such resource. A match without tracking
   * has no heatmap for any of its players, and one missing optional endpoint
   * must not abort a whole sync run.
   */
  async tryHeatmap(eventId: number, playerId: number): Promise<SofascoreHeatmapPoint[] | null> {
    try {
      return await this.heatmap(eventId, playerId);
    } catch (error) {
      if (error instanceof SourceError && error.status !== undefined && ABSENT.has(error.status)) {
        return null;
      }
      throw error;
    }
  }

  private parse<T>(payload: unknown, schema: ZodType<T>, what: string): T {
    const result = schema.safeParse(payload);
    if (!result.success) {
      throw new ValidationError(
        `sofascore ${what} response did not match its schema`,
        result.error.issues
          .slice(0, 10)
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      );
    }
    return result.data;
  }
}
