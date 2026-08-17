import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  asFixtureId,
  asGameweekId,
  asPlayerId,
  asTeamId,
  fixtureSchema,
  playerSchema,
  teamSchema,
  type Fixture,
  type Player,
  type Team,
} from '@fpl/core';
import {
  buildFixtureResolver,
  buildPlayerResolver,
  buildProviderTeamResolver,
  normaliseName,
} from './identity.js';

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
  team(1, 'Arsenal', 'ARS'),
  team(2, 'Crystal Palace', 'CRY'),
  team(3, 'Tottenham Hotspur', 'TOT'),
  team(4, 'Wolverhampton Wanderers', 'WOL'),
];

const fixture = (
  id: number,
  home: number,
  away: number,
  kickoff: string | null,
  gameweek: number | null = 38,
): Fixture =>
  fixtureSchema.parse({
    id,
    gameweek,
    kickoff,
    homeTeam: home,
    awayTeam: away,
    homeScore: null,
    awayScore: null,
    finished: true,
    started: true,
    homeDifficulty: 3,
    awayDifficulty: 3,
  });

const player = (
  id: number,
  firstName: string,
  secondName: string,
  webName: string,
  teamId: number,
): Player =>
  playerSchema.parse({
    id,
    code: id * 10,
    firstName,
    secondName,
    webName,
    teamId,
    position: 'MID',
    price: 50,
    startPrice: 50,
    totalPoints: 0,
    minutes: 0,
    goals: 0,
    assists: 0,
    cleanSheets: 0,
    goalsConceded: 0,
    yellowCards: 0,
    redCards: 0,
    saves: 0,
    bonus: 0,
    bps: 0,
    form: 0,
    pointsPerGame: 0,
    selectedByPercent: 0,
    expectedGoals: 0,
    expectedAssists: 0,
    expectedGoalInvolvements: 0,
    expectedGoalsConceded: 0,
    availability: 'available',
    chanceOfPlayingNextRound: null,
    news: '',
  });

describe('normaliseName', () => {
  it('folds case, diacritics, and punctuation', () => {
    assert.equal(normaliseName('Daniel Muñoz'), 'danielmunoz');
    assert.equal(normaliseName("N'Golo Kanté"), 'ngolokante');
    assert.equal(normaliseName('Gabriel Magalhães'), 'gabrielmagalhaes');
  });
});

describe('buildProviderTeamResolver', () => {
  // The names FPL actually publishes, which are shorter than the provider's.
  const fplTeams = [
    team(1, 'Arsenal', 'ARS'),
    team(2, 'Newcastle', 'NEW'),
    team(3, 'Man City', 'MCI'),
    team(4, 'Man Utd', 'MUN'),
    team(5, 'Spurs', 'TOT'),
    team(6, 'Brighton', 'BHA'),
    team(7, 'Liverpool', 'LIV'),
  ];
  const resolve = buildProviderTeamResolver(fplTeams);

  it('matches a name both sides spell the same way', () => {
    assert.equal(resolve('Arsenal'), asTeamId(1));
  });

  it('matches the domain short name against the provider full name', () => {
    assert.equal(resolve('Newcastle United'), asTeamId(2));
    assert.equal(resolve('Brighton & Hove Albion'), asTeamId(6));
    assert.equal(resolve('Liverpool FC'), asTeamId(7));
  });

  it('bridges the names no prefix rule can reach', () => {
    assert.equal(resolve('Manchester City'), asTeamId(3));
    assert.equal(resolve('Manchester United'), asTeamId(4));
    assert.equal(resolve('Tottenham Hotspur'), asTeamId(5));
  });

  it('returns undefined for a club the season does not contain', () => {
    assert.equal(resolve('Wolverhampton Wanderers'), undefined);
  });
});

describe('buildFixtureResolver', () => {
  const fixtures = [
    fixture(1001, 2, 1, '2026-05-24T15:00:00Z'),
    fixture(1002, 1, 2, '2026-01-04T14:00:00Z', 20),
    fixture(1003, 3, 4, null, 21),
  ];
  const resolve = buildFixtureResolver(fixtures, teams);

  it('matches a provider event on its team pair and kickoff', () => {
    assert.equal(
      resolve({
        homeTeamName: 'Crystal Palace',
        awayTeamName: 'Arsenal',
        kickoff: new Date('2026-05-24T15:00:00Z'),
      }),
      asFixtureId(1001),
    );
  });

  it('tolerates a kickoff the two sides disagree about by minutes', () => {
    assert.equal(
      resolve({
        homeTeamName: 'Crystal Palace',
        awayTeamName: 'Arsenal',
        kickoff: new Date('2026-05-24T15:30:00Z'),
      }),
      asFixtureId(1001),
    );
  });

  it('keeps the fixture direction: a reversed pair is a different match', () => {
    assert.equal(
      resolve({
        homeTeamName: 'Arsenal',
        awayTeamName: 'Crystal Palace',
        kickoff: new Date('2026-01-04T14:00:00Z'),
      }),
      asFixtureId(1002),
    );
  });

  it('refuses a kickoff outside the tolerance window', () => {
    assert.equal(
      resolve({
        homeTeamName: 'Crystal Palace',
        awayTeamName: 'Arsenal',
        kickoff: new Date('2026-05-26T15:00:00Z'),
      }),
      undefined,
    );
  });

  it('resolves the provider club names through the shared alias table', () => {
    const withKickoff = buildFixtureResolver(
      [fixture(1004, 3, 4, '2026-02-01T15:00:00Z', 25)],
      teams,
    );
    // "Spurs" needs the alias table; "Wolverhampton" needs the prefix fallback.
    assert.equal(
      withKickoff({
        homeTeamName: 'Spurs',
        awayTeamName: 'Wolverhampton',
        kickoff: new Date('2026-02-01T15:00:00Z'),
      }),
      asFixtureId(1004),
    );
  });

  it('cannot place an event against a fixture with no kickoff', () => {
    assert.equal(
      resolve({
        homeTeamName: 'Spurs',
        awayTeamName: 'Wolverhampton',
        kickoff: new Date('2026-02-01T15:00:00Z'),
      }),
      undefined,
    );
  });

  it('returns undefined for a club outside the domain', () => {
    assert.equal(
      resolve({
        homeTeamName: 'Real Madrid',
        awayTeamName: 'Arsenal',
        kickoff: new Date('2026-05-24T15:00:00Z'),
      }),
      undefined,
    );
  });
});

describe('buildPlayerResolver', () => {
  const players = [
    player(1, 'Daniel', 'Muñoz Mejía', 'Muñoz', 2),
    player(2, 'Jean-Philippe', 'Mateta', 'Mateta', 2),
    player(3, 'Gabriel', 'Magalhães', 'Gabriel', 1),
    player(4, 'Gabriel', 'Martinelli Silva', 'Martinelli', 1),
    player(5, 'Gabriel', 'Fernando de Jesus', 'G.Jesus', 1),
    // Two Palace players sharing a surname: nothing may resolve on it alone.
    player(6, 'Marc', 'Guehi', 'Guehi', 2),
    player(7, 'Tom', 'Guehi', 'T.Guehi', 2),
  ];
  const resolve = buildPlayerResolver(players, teams);

  it('matches a full name across a spelling difference', () => {
    assert.equal(resolve('Daniel Munoz', asTeamId(2)), asPlayerId(1));
  });

  it('matches when FPL carries a second family name the provider drops', () => {
    assert.equal(resolve('Gabriel Martinelli', asTeamId(1)), asPlayerId(4));
  });

  it('falls back to the surname within the club', () => {
    assert.equal(resolve('J. Mateta', asTeamId(2)), asPlayerId(2));
    assert.equal(resolve('Mateta', asTeamId(2)), asPlayerId(2));
  });

  it('matches on the FPL display name', () => {
    assert.equal(resolve('Gabriel', asTeamId(1)), asPlayerId(3));
  });

  it('returns undefined rather than guessing between two namesakes at one club', () => {
    assert.equal(resolve('Guehi', asTeamId(2)), undefined);
    // The full name still separates them.
    assert.equal(resolve('Marc Guehi', asTeamId(2)), asPlayerId(6));
  });

  it('does not resolve a player at the wrong club by surname', () => {
    assert.equal(resolve('Mateta', asTeamId(1)), undefined);
  });

  it('still finds a player whose club changed after the match', () => {
    // Filed under Arsenal in the current FPL data, seen here in a Palace shirt.
    assert.equal(resolve('Gabriel Martinelli', asTeamId(2)), asPlayerId(4));
  });

  it('returns undefined for somebody the domain does not carry', () => {
    assert.equal(resolve('Rio Cardines', asTeamId(2)), undefined);
  });
});

describe('buildPlayerResolver ambiguity across clubs', () => {
  it('refuses a global fallback when the name is shared by two clubs', () => {
    const players = [player(1, 'Danny', 'Ings', 'Ings', 1), player(2, 'Danny', 'Ings', 'Ings', 2)];
    const resolve = buildPlayerResolver(players, teams);
    assert.equal(resolve('Danny Ings', asTeamId(3)), undefined);
    // Scoped to the right club it is still unambiguous.
    assert.equal(resolve('Danny Ings', asTeamId(1)), asPlayerId(1));
  });
});

describe('gameweek partition inputs', () => {
  it('keeps a domain gameweek branded', () => {
    assert.equal(fixture(1, 1, 2, '2026-05-24T15:00:00Z', 12).gameweek, asGameweekId(12));
  });
});
