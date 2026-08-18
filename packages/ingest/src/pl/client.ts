import { ValidationError } from '@fpl/core';
import { HttpClient, type HttpClientOptions } from '../http.js';
import {
  plCompSeasonsSchema,
  plFixtureDetailSchema,
  plFixturesPageSchema,
  plStaffSchema,
  plTeamsPageSchema,
  type PlCompSeason,
  type PlFixture,
  type PlFixtureDetail,
  type PlStaff,
  type PlTeam,
} from './schemas.js';

export const PL_BASE_URL = 'https://footballapi.pulselive.com/football';

/** The Premier League's own competition id. Everything here is scoped to it. */
export const PREMIER_LEAGUE_COMPETITION = 1;

/**
 * The provider serves this API to its own website and checks nothing but the
 * calling origin: no key, no account, no rate limit published. It answers a
 * request without these two headers with 401, which is the entire barrier.
 */
export function plHttp(options?: Partial<HttpClientOptions>): HttpClient {
  return new HttpClient({
    baseUrl: PL_BASE_URL,
    timeoutMs: 20_000,
    retries: 3,
    minRequestIntervalMs: 250,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    name: 'pl-official',
    ...options,
    headers: {
      Origin: 'https://www.premierleague.com',
      Referer: 'https://www.premierleague.com/',
      ...options?.headers,
    },
  });
}

function parse<T>(
  schema: {
    safeParse: (value: unknown) => {
      success: boolean;
      data?: T;
      error?: { issues: { path: (string | number)[]; message: string }[] };
    };
  },
  value: unknown,
  what: string,
): T {
  const result = schema.safeParse(value);
  if (result.success && result.data !== undefined) return result.data;
  const issues = (result.error?.issues ?? [])
    .slice(0, 10)
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');
  throw new ValidationError(`Premier League ${what} did not match its schema: ${issues}`);
}

export class PremierLeagueClient {
  private readonly http: HttpClient;

  constructor(http: HttpClient) {
    this.http = http;
  }

  /** Every season the competition has, newest first. */
  async compSeasons(): Promise<PlCompSeason[]> {
    const payload = await this.http.getJson(
      `/competitions/${String(PREMIER_LEAGUE_COMPETITION)}/compseasons?pageSize=100&page=0`,
    );
    return parse(plCompSeasonsSchema, payload, 'season list').content;
  }

  async teams(compSeasonId: number): Promise<PlTeam[]> {
    const payload = await this.http.getJson(
      `/teams?pageSize=100&page=0&comps=${String(PREMIER_LEAGUE_COMPETITION)}&compSeasons=${String(compSeasonId)}&altIds=true`,
    );
    return parse(plTeamsPageSchema, payload, 'team list').content;
  }

  /**
   * One page of fixtures. The listing carries the result but not the
   * teamsheets, which is why a detail pass exists: 380 results a season cost
   * four listing requests, and 380 teamsheets cost 380.
   */
  async fixturesPage(
    compSeasonId: number,
    page: number,
    pageSize = 100,
  ): Promise<{ fixtures: PlFixture[]; numPages: number }> {
    const payload = await this.http.getJson(
      `/fixtures?comps=${String(PREMIER_LEAGUE_COMPETITION)}&compSeasons=${String(compSeasonId)}` +
        `&pageSize=${String(pageSize)}&page=${String(page)}&sort=asc&altIds=true`,
    );
    const parsed = parse(plFixturesPageSchema, payload, 'fixture page');
    return { fixtures: parsed.content, numPages: parsed.pageInfo.numPages };
  }

  /** Every fixture of a season, in kickoff order. */
  async allFixtures(compSeasonId: number): Promise<PlFixture[]> {
    const first = await this.fixturesPage(compSeasonId, 0);
    const fixtures = [...first.fixtures];
    for (let page = 1; page < first.numPages; page += 1) {
      const next = await this.fixturesPage(compSeasonId, page);
      fixtures.push(...next.fixtures);
    }
    return fixtures;
  }

  async fixtureDetail(fixtureId: number): Promise<PlFixtureDetail> {
    const payload = await this.http.getJson(`/fixtures/${String(fixtureId)}?altIds=true`);
    return parse(plFixtureDetailSchema, payload, 'fixture detail');
  }

  /** Players and, in `officials`, the manager and their staff for a season. */
  async staff(teamId: number, compSeasonId: number): Promise<PlStaff> {
    const payload = await this.http.getJson(
      `/teams/${String(teamId)}/compseasons/${String(compSeasonId)}/staff?altIds=true`,
    );
    return parse(plStaffSchema, payload, 'team staff');
  }
}
