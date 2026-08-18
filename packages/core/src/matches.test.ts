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
