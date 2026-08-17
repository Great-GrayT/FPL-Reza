import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { asTeamId, fixtureOutlook, teamSchema, type Team } from '@fpl/core';
import { parseCsv, parseCsvObjects } from '../csv.js';
import { footballDataSeasonCode, footballDataUrl, parseFootballDataCsv } from './football-data.js';
import { buildTeamResolver } from './team-names.js';

const CSV = [
  'Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,FTR,B365H,B365D,B365A,B365>2.5,B365<2.5,AvgH,AvgD,AvgA',
  'E0,21/08/2026,20:00,Man City,Burnley,3,0,H,1.20,7.50,15.00,1.40,2.90,1.22,7.20,14.00',
  "E0,22/08/2026,15:00,Nott'm Forest,Arsenal,1,1,D,4.50,3.60,1.80,2.10,1.75,4.40,3.55,1.82",
  'E0,23/08/2026,15:00,Everton,Chelsea,,,,,,,,,,,',
].join('\n');

const team = (id: number, name: string, shortName: string): Team =>
  teamSchema.parse({
    id,
    code: id,
    name,
    shortName,
    strength: 3,
    strengthOverallHome: 1200,
    strengthOverallAway: 1200,
    strengthAttackHome: 1200,
    strengthAttackAway: 1200,
    strengthDefenceHome: 1200,
    strengthDefenceAway: 1200,
  });

const teams = [
  team(1, 'Man City', 'MCI'),
  team(2, 'Burnley', 'BUR'),
  team(3, "Nott'm Forest", 'NFO'),
  team(4, 'Arsenal', 'ARS'),
  team(5, 'Manchester United', 'MUN'),
];

describe('parseCsv', () => {
  it('splits rows and fields', () => {
    assert.deepEqual(parseCsv('a,b\n1,2\n'), [
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps commas inside quoted fields', () => {
    assert.deepEqual(parseCsv('a,b\n"one, two",3'), [
      ['a', 'b'],
      ['one, two', '3'],
    ]);
  });

  it('unescapes a doubled quote', () => {
    assert.deepEqual(parseCsv('a\n"say ""hi"""'), [['a'], ['say "hi"']]);
  });

  it('keys rows by header', () => {
    const rows = parseCsvObjects('a,b\n1,2');
    assert.equal(rows[0]?.['b'], '2');
  });
});

describe('football-data urls', () => {
  it('maps a season label to the provider path', () => {
    assert.equal(footballDataSeasonCode('2026/27'), '2627');
    assert.ok(footballDataUrl('2026/27').endsWith('/2627/E0.csv'));
  });
});

describe('parseFootballDataCsv', () => {
  const quotes = parseFootballDataCsv(CSV, { resolveTeam: buildTeamResolver(teams) });

  it('skips a row with no priced market', () => {
    assert.equal(
      quotes.some((quote) => quote.kickoff?.getUTCDate() === 23),
      false,
    );
  });

  it('reads the 1X2 market for each bookmaker column present', () => {
    const bookmakers = new Set(
      quotes.filter((quote) => quote.market === 'match_odds').map((quote) => quote.bookmaker),
    );
    assert.deepEqual([...bookmakers].sort(), ['Bet365', 'Market average']);
  });

  it('reads the over under market only where the columns exist', () => {
    const overUnder = quotes.filter((quote) => quote.market === 'over_under');
    assert.ok(overUnder.every((quote) => quote.bookmaker === 'Bet365'));
    assert.ok(overUnder.every((quote) => quote.line === 2.5));
  });

  it('converts a UK local kickoff to an instant', () => {
    const first = quotes[0];
    // 21 Aug 2026 20:00 in British Summer Time is 19:00 UTC.
    assert.equal(first?.kickoff?.toISOString(), '2026-08-21T19:00:00.000Z');
  });

  it('resolves provider club names to domain ids', () => {
    const first = quotes[0];
    assert.equal(first?.homeTeam, asTeamId(1));
    assert.equal(first?.awayTeam, asTeamId(2));
  });

  it('feeds the derived fixture outlook', () => {
    const forOneMatch = quotes.filter(
      (quote) => quote.bookmaker === 'Bet365' && quote.kickoff?.getUTCDate() === 21,
    );
    const outlook = fixtureOutlook(forOneMatch);
    assert.ok(outlook !== null);
    // A heavy home favourite should be expected to score more and to concede less.
    assert.ok(outlook.goals.home > outlook.goals.away);
    assert.ok(outlook.homeCleanSheet > outlook.awayCleanSheet);
  });
});

describe('buildTeamResolver', () => {
  const resolve = buildTeamResolver(teams);

  it('matches on the exact name', () => {
    assert.equal(resolve('Arsenal'), asTeamId(4));
  });

  it('ignores punctuation and case', () => {
    assert.equal(resolve('nottm forest'), asTeamId(3));
  });

  it('bridges a known alias', () => {
    assert.equal(resolve('Man United'), asTeamId(5));
  });

  it('matches a prefix of the full club name', () => {
    assert.equal(resolve('Manchester Utd'), undefined);
    assert.equal(resolve('Manchester'), asTeamId(5));
  });

  it('returns undefined for a club outside the division', () => {
    assert.equal(resolve('Real Madrid'), undefined);
  });
});
