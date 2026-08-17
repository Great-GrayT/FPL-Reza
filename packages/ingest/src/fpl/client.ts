import { ValidationError } from '@fpl/core';
import type { ZodType } from 'zod';
import type { HttpClient } from '../http.js';
import {
  bootstrapSchema,
  elementSummarySchema,
  fixturesSchema,
  type Bootstrap,
  type RawHistory,
} from './schemas.js';

/** Thin typed wrapper over the public FPL endpoints. */
export class FplClient {
  private readonly http: HttpClient;

  constructor(http: HttpClient) {
    this.http = http;
  }

  /** Teams, players, and gameweeks in one payload. Roughly 1 MB. */
  async bootstrap(): Promise<Bootstrap> {
    return this.parse(await this.http.getJson('bootstrap-static/'), bootstrapSchema, 'bootstrap');
  }

  async fixtures(): Promise<ReturnType<typeof fixturesSchema.parse>> {
    return this.parse(await this.http.getJson('fixtures/'), fixturesSchema, 'fixtures');
  }

  /** Per gameweek history for one player. One request per player. */
  async playerHistory(playerId: number): Promise<RawHistory[]> {
    const payload = await this.http.getJson(`element-summary/${playerId}/`);
    return this.parse(payload, elementSummarySchema, `element-summary/${playerId}`).history;
  }

  private parse<T>(payload: unknown, schema: ZodType<T>, what: string): T {
    const result = schema.safeParse(payload);
    if (!result.success) {
      throw new ValidationError(
        `${what} response did not match its schema`,
        result.error.issues
          .slice(0, 10)
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      );
    }
    return result.data;
  }
}
