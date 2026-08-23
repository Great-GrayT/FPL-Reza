import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { asSeason } from './ids.js';
import {
  asMatchId,
  describeWeatherCode,
  headToHead,
  matchSchema,
  recentForm,
  refereeRecord,
  teamRecord,
  type Match,
  type MatchDetail,
  congestionBetween,
  statSeries,
  statAverage,
  type ClubFixture,
  type MatchTeamStats,
} from './matches.js';

const ARSENAL = 3;
const CHELSEA = 8;
const SPURS = 6;

/**
 * Overrides are spread over the defaults rather than merged field by field
 * with `??`, because an explicit null (an unplayed match has a null score) is
 * a value the tests need to set and `??` would silently replace it.
 */
function match(overrides: Omit<Partial<Match>, 'matchId'> & { matchId: number }): Match {
  return matchSchema.parse({
    season: asSeason('2025/26'),
    round: 1,
    kickoff: new Date('2026-01-01T15:00:00Z'),
    homeTeamCode: ARSENAL,
    awayTeamCode: CHELSEA,
    homeTeamName: 'Arsenal',
    awayTeamName: 'Chelsea',
    homeScore: 2,
    awayScore: 1,
    halfTimeHomeScore: null,
    halfTimeAwayScore: null,
    status: 'completed',
    outcome: 'home',
    attendance: null,
    groundId: null,
    groundName: null,
    neutralGround: false,
    refereeId: null,
    refereeName: null,
    ...overrides,
    matchId: asMatchId(overrides.matchId),
  });
}

describe('headToHead', () => {
  it('reads the record from the named club, whichever ground it was played at', () => {
    const matches = [
      match({
        matchId: 1,
        homeTeamCode: ARSENAL,
        awayTeamCode: CHELSEA,
        homeScore: 2,
        awayScore: 1,
      }),
      match({
        matchId: 2,
        homeTeamCode: CHELSEA,
        awayTeamCode: ARSENAL,
        homeScore: 3,
        awayScore: 0,
      }),
      match({
        matchId: 3,
        homeTeamCode: CHELSEA,
        awayTeamCode: ARSENAL,
        homeScore: 1,
        awayScore: 1,
      }),
    ];

    const record = headToHead(matches, ARSENAL, CHELSEA);
    assert.equal(record.played, 3);
    assert.equal(record.homeWins, 1, 'wins are Arsenal wins, not home wins');
    assert.equal(record.awayWins, 1);
    assert.equal(record.draws, 1);
    assert.equal(record.homeGoals, 3, 'goals Arsenal scored across both venues');
    assert.equal(record.awayGoals, 5);
  });

  it('ignores a meeting that has not been played', () => {
    const matches = [
      match({ matchId: 1, homeScore: 1, awayScore: 0 }),
      match({ matchId: 2, homeScore: null, awayScore: null, status: 'upcoming', outcome: null }),
    ];
    assert.equal(headToHead(matches, ARSENAL, CHELSEA).played, 1);
  });

  it('ignores matches involving neither club', () => {
    const matches = [match({ matchId: 1, homeTeamCode: SPURS, awayTeamCode: CHELSEA })];
    assert.equal(headToHead(matches, ARSENAL, CHELSEA).played, 0);
  });

  it('orders meetings newest first', () => {
    const matches = [
      match({ matchId: 1, kickoff: new Date('2020-01-01T15:00:00Z') }),
      match({ matchId: 2, kickoff: new Date('2024-01-01T15:00:00Z') }),
    ];
    assert.deepEqual(
      headToHead(matches, ARSENAL, CHELSEA).matches.map((entry) => entry.matchId as number),
      [2, 1],
    );
  });
});

describe('teamRecord', () => {
  it('counts three for a win and one for a draw, from either venue', () => {
    const matches = [
      match({ matchId: 1, homeTeamCode: ARSENAL, homeScore: 2, awayScore: 1 }),
      match({
        matchId: 2,
        homeTeamCode: CHELSEA,
        awayTeamCode: ARSENAL,
        homeScore: 0,
        awayScore: 0,
      }),
      match({
        matchId: 3,
        homeTeamCode: CHELSEA,
        awayTeamCode: ARSENAL,
        homeScore: 4,
        awayScore: 1,
      }),
    ];

    const record = teamRecord(matches, ARSENAL);
    assert.deepEqual(
      {
        played: record.played,
        won: record.won,
        drawn: record.drawn,
        lost: record.lost,
        points: record.points,
      },
      { played: 3, won: 1, drawn: 1, lost: 1, points: 4 },
    );
    assert.equal(record.goalsFor, 3);
    assert.equal(record.goalsAgainst, 5);
  });

  it('is empty for a club with nothing on record, rather than throwing', () => {
    assert.equal(teamRecord([], ARSENAL).played, 0);
  });
});

describe('recentForm', () => {
  it('returns the newest results first', () => {
    const matches = [
      match({ matchId: 1, kickoff: new Date('2026-01-01T15:00:00Z'), homeScore: 3, awayScore: 0 }),
      match({ matchId: 2, kickoff: new Date('2026-02-01T15:00:00Z'), homeScore: 0, awayScore: 2 }),
      match({ matchId: 3, kickoff: new Date('2026-03-01T15:00:00Z'), homeScore: 1, awayScore: 1 }),
    ];
    assert.deepEqual(recentForm(matches, ARSENAL), ['D', 'L', 'W']);
  });

  it('caps at the requested count', () => {
    const matches = Array.from({ length: 8 }, (_, index) =>
      match({ matchId: index + 1, kickoff: new Date(2026, 0, index + 1) }),
    );
    assert.equal(recentForm(matches, ARSENAL, 3).length, 3);
  });
});

describe('refereeRecord', () => {
  const detail = (matchId: number, yellows: number, reds: number): MatchDetail => ({
    matchId: asMatchId(matchId),
    season: asSeason('2025/26'),
    officials: [],
    sheets: [],
    events: [
      ...Array.from({ length: yellows }, () => ({
        type: 'yellow_card' as const,
        minute: 30,
        teamCode: ARSENAL,
        personId: 1,
        playerCode: null,
        name: null,
        relatedPersonId: null,
        relatedPlayerCode: null,
        relatedName: null,
        homeScore: null,
        awayScore: null,
      })),
      ...Array.from({ length: reds }, () => ({
        type: 'red_card' as const,
        minute: 60,
        teamCode: ARSENAL,
        personId: 2,
        playerCode: null,
        name: null,
        relatedPersonId: null,
        relatedPlayerCode: null,
        relatedName: null,
        homeScore: null,
        awayScore: null,
      })),
    ],
  });

  it('averages cards only over the matches whose detail is stored', () => {
    const matches = [
      match({ matchId: 1, refereeId: 99, refereeName: 'A Referee' }),
      match({ matchId: 2, refereeId: 99, refereeName: 'A Referee' }),
      match({ matchId: 3, refereeId: 99, refereeName: 'A Referee' }),
    ];
    // Only one of the three has a timeline, so the rate is over one match.
    const details = new Map([[1, detail(1, 4, 1)]]);

    const [record] = refereeRecord(matches, details);
    assert.ok(record !== undefined);
    assert.equal(record.matches, 3, 'appointments count every match');
    assert.equal(record.yellowsPerMatch, 4, 'cards average over the measured match only');
    assert.equal(record.redsPerMatch, 1);
  });

  it('reports a null card rate rather than zero when nothing was measured', () => {
    const matches = [match({ matchId: 1, refereeId: 99, refereeName: 'A Referee' })];
    const [record] = refereeRecord(matches, new Map());
    assert.ok(record !== undefined);
    assert.equal(record.yellowsPerMatch, null);
    assert.equal(record.redsPerMatch, null);
    assert.equal(record.penaltiesPerMatch, null);
  });

  it('ignores a match with no referee on it', () => {
    assert.deepEqual(refereeRecord([match({ matchId: 1 })], new Map()), []);
  });

  it('ranks by matches taken charge of', () => {
    const matches = [
      match({ matchId: 1, refereeId: 1, refereeName: 'One' }),
      match({ matchId: 2, refereeId: 2, refereeName: 'Two' }),
      match({ matchId: 3, refereeId: 2, refereeName: 'Two' }),
    ];
    assert.deepEqual(
      refereeRecord(matches, new Map()).map((entry) => entry.name),
      ['Two', 'One'],
    );
  });
});

describe('describeWeatherCode', () => {
  it('names the conditions a reader would recognise', () => {
    assert.equal(describeWeatherCode(0), 'Clear');
    assert.equal(describeWeatherCode(3), 'Overcast');
    assert.equal(describeWeatherCode(63), 'Rain');
    assert.equal(describeWeatherCode(95), 'Thunderstorm');
  });

  it('is null for an absent reading rather than inventing clear skies', () => {
    assert.equal(describeWeatherCode(null), null);
  });
});

describe('congestion across every competition', () => {
  const fixture = (over: Partial<ClubFixture>): ClubFixture => ({
    fixtureId: 1,
    competitionId: 1,
    competition: 'Premier League',
    season: asSeason('2026/27'),
    kickoff: new Date('2026-09-12T14:00:00Z'),
    homeTeamCode: 3,
    awayTeamCode: 8,
    homeTeamName: 'Arsenal',
    awayTeamName: 'Chelsea',
    round: null,
    finished: false,
    ...over,
  });

  const window = { from: new Date('2026-09-10T00:00:00Z'), to: new Date('2026-09-24T00:00:00Z') };

  it('counts every competition, and names the ones outside the league', () => {
    const fixtures = [
      fixture({ fixtureId: 1, kickoff: new Date('2026-09-12T14:00:00Z') }),
      fixture({
        fixtureId: 2,
        competitionId: 2,
        competition: 'UEFA Champions League',
        kickoff: new Date('2026-09-16T19:00:00Z'),
        awayTeamCode: 999,
        awayTeamName: 'Bayern',
      }),
      fixture({ fixtureId: 3, kickoff: new Date('2026-09-20T14:00:00Z') }),
    ];
    const congestion = congestionBetween(fixtures, 3, window.from, window.to);
    assert.equal(congestion.matches, 3);
    assert.equal(congestion.extra, 1, 'the European tie is the one FPL cannot see');
    assert.deepEqual(congestion.competitions, ['Premier League', 'UEFA Champions League']);
  });

  it('reports the shortest turnaround, which is what fatigue actually is', () => {
    const fixtures = [
      fixture({ fixtureId: 1, kickoff: new Date('2026-09-12T14:00:00Z') }),
      fixture({
        fixtureId: 2,
        competitionId: 5,
        competition: 'EFL Cup',
        kickoff: new Date('2026-09-15T19:00:00Z'),
      }),
      fixture({ fixtureId: 3, kickoff: new Date('2026-09-20T14:00:00Z') }),
    ];
    const congestion = congestionBetween(fixtures, 3, window.from, window.to);
    assert.equal(congestion.shortestGap, 3.2);
  });

  it('measures the rest a club arrived with', () => {
    const fixtures = [
      fixture({ fixtureId: 0, kickoff: new Date('2026-09-08T19:00:00Z') }),
      fixture({ fixtureId: 1, kickoff: new Date('2026-09-12T14:00:00Z') }),
    ];
    assert.equal(congestionBetween(fixtures, 3, window.from, window.to).restBefore, 3.8);
  });

  it('ignores a club that is not in the fixture', () => {
    const congestion = congestionBetween([fixture({})], 11, window.from, window.to);
    assert.equal(congestion.matches, 0);
    assert.equal(congestion.restBefore, null);
    assert.equal(congestion.shortestGap, null);
  });

  it('counts a fixture with no kickoff nowhere, since nobody knows the rest yet', () => {
    const congestion = congestionBetween([fixture({ kickoff: null })], 3, window.from, window.to);
    assert.equal(congestion.matches, 0);
  });
});

describe('match statistics', () => {
  const row = (over: Partial<MatchTeamStats>): MatchTeamStats => ({
    fixtureId: 1,
    competitionId: 1,
    competition: 'Premier League',
    season: asSeason('2026/27'),
    kickoff: new Date('2026-09-12T14:00:00Z'),
    teamId: 38,
    teamCode: 39,
    teamName: 'Wolves',
    opponentCode: 50,
    opponentName: 'Port Vale',
    home: true,
    stats: { ppda: 9.7, possession_percentage: 68.6 },
    ...over,
  });

  it('reads one measure across a club, newest first', () => {
    const rows = [
      row({ fixtureId: 1, kickoff: new Date('2026-09-12T14:00:00Z'), stats: { ppda: 9.7 } }),
      row({ fixtureId: 2, kickoff: new Date('2026-09-19T14:00:00Z'), stats: { ppda: 12.1 } }),
    ];
    assert.deepEqual(
      statSeries(rows, 39, 'ppda').map((entry) => entry.value),
      [12.1, 9.7],
    );
  });

  it('skips a match that did not produce the measure, rather than reading it as zero', () => {
    const rows = [
      row({ fixtureId: 1, stats: { penalty_save: 1 } }),
      row({ fixtureId: 2, stats: { ppda: 8 } }),
    ];
    // A match with no penalty has no penalty save: it is absent, not zero, and
    // averaging a zero in would report a keeper who faced none as having failed.
    assert.equal(statSeries(rows, 39, 'penalty_save').length, 1);
    assert.equal(statAverage(rows, 39, 'penalty_save'), 1);
  });

  it('averages over the most recent matches only', () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
      row({
        fixtureId: index + 1,
        kickoff: new Date(2026, 8, index + 1),
        stats: { ppda: index + 1 },
      }),
    );
    // Newest six are 10 down to 5, which average 7.5.
    assert.equal(statAverage(rows, 39, 'ppda', 6), 7.5);
  });

  it('has no average for a club with nothing stored', () => {
    assert.equal(statAverage([row({})], 99, 'ppda'), null);
  });
});
