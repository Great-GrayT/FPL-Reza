import { oddsQuoteSchema, type OddsQuote, type TeamId } from '@fpl/core';
import { parseCsvObjects } from '../csv.js';
import { londonToUtc } from '../rules/london-time.js';

/**
 * football-data.co.uk season CSVs. Free, no key, and the only public source of
 * historical closing odds, which is what a model has to be trained against.
 * It publishes after matchdays, so it backfills history and never prices an
 * upcoming fixture.
 */

export const FOOTBALL_DATA_BASE = 'https://www.football-data.co.uk/mmz4281';

/** Season "2026/27" maps to the path segment "2627". */
export const footballDataSeasonCode = (season: string): string =>
  `${season.slice(2, 4)}${season.slice(5, 7)}`;

export const footballDataUrl = (season: string, division = 'E0'): string =>
  `${FOOTBALL_DATA_BASE}/${footballDataSeasonCode(season)}/${division}.csv`;

/** Column prefixes for the bookmakers the file carries, plus the market averages. */
const BOOKMAKER_COLUMNS: Readonly<Record<string, string>> = {
  B365: 'Bet365',
  BW: 'Betway',
  IW: 'Interwetten',
  PS: 'Pinnacle',
  WH: 'William Hill',
  VC: 'VC Bet',
  Max: 'Market best',
  Avg: 'Market average',
};

export interface FootballDataOptions {
  provider?: string;
  /** Resolves a football-data team name to a domain team id. */
  resolveTeam?: (name: string) => TeamId | undefined;
}

/**
 * Parses one season CSV into quotes. Rows missing a usable date or the 1X2
 * market are skipped rather than failing the file: an in progress season file
 * always has partly filled rows near the end.
 */
export function parseFootballDataCsv(text: string, options: FootballDataOptions = {}): OddsQuote[] {
  const provider = options.provider ?? 'football-data-uk';
  const resolve = options.resolveTeam ?? ((): undefined => undefined);
  const quotes: OddsQuote[] = [];

  for (const row of parseCsvObjects(text)) {
    const kickoff = parseKickoff(row['Date'] ?? '', row['Time'] ?? '');
    const homeName = row['HomeTeam'] ?? '';
    const awayName = row['AwayTeam'] ?? '';
    if (kickoff === null || homeName === '' || awayName === '') continue;

    const base = {
      provider,
      fixtureId: null,
      homeTeam: resolve(homeName) ?? null,
      awayTeam: resolve(awayName) ?? null,
      homeName,
      awayName,
      kickoff,
      // The file is published after the match, so the row's own date is the
      // best capture time available.
      capturedAt: kickoff,
    };

    for (const [prefix, bookmaker] of Object.entries(BOOKMAKER_COLUMNS)) {
      const home = decimal(row[`${prefix}H`]);
      const draw = decimal(row[`${prefix}D`]);
      const away = decimal(row[`${prefix}A`]);
      if (home === null || draw === null || away === null) continue;

      for (const [selection, value] of [
        ['home', home],
        ['draw', draw],
        ['away', away],
      ] as const) {
        quotes.push(
          oddsQuoteSchema.parse({
            ...base,
            bookmaker,
            market: 'match_odds',
            selection,
            decimal: value,
            line: null,
          }),
        );
      }

      const over = decimal(row[`${prefix}>2.5`]);
      const under = decimal(row[`${prefix}<2.5`]);
      if (over === null || under === null) continue;

      for (const [selection, value] of [
        ['over', over],
        ['under', under],
      ] as const) {
        quotes.push(
          oddsQuoteSchema.parse({
            ...base,
            bookmaker,
            market: 'over_under',
            selection,
            decimal: value,
            line: 2.5,
          }),
        );
      }
    }
  }

  return quotes;
}

/** Odds of 1.0 or below mean the column is empty or the market was pulled. */
function decimal(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 1 ? value : null;
}

/** Dates are day first UK local, with a two or four digit year. */
function parseKickoff(date: string, time: string): Date | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/.exec(date.trim());
  if (match === null) return null;

  const [, day, month, yearText] = match;
  const yearNumber = Number(yearText);
  const year = yearText?.length === 2 ? 2000 + yearNumber : yearNumber;

  const clock = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  const hour = clock === null ? 15 : Number(clock[1]);
  const minute = clock === null ? 0 : Number(clock[2]);

  return londonToUtc(year, Number(month) - 1, Number(day), hour, minute);
}
