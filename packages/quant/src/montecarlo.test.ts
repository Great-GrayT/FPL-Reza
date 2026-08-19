import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  captaincyEv,
  simulateMatch,
  simulatePlayerPoints,
  simulateSeason,
  summariseDraws,
} from './montecarlo.js';
import { poisson } from './dist.js';

const close = (actual: number, expected: number, tolerance: number): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be near ${expected}`);
};

describe('match simulation', () => {
  it('matches the analytic Poisson probabilities', () => {
    const result = simulateMatch(1.6, 1.1, { draws: 40000, seed: 5 });
    // Clean sheet probability is exp(-lambda) for the other side's expectation.
    close(result.homeCleanSheet, Math.exp(-1.1), 0.01);
    close(result.awayCleanSheet, Math.exp(-1.6), 0.01);
    close(result.homeGoals.mean, 1.6, 0.03);
    close(result.awayGoals.mean, 1.1, 0.03);
    close(result.homeWin + result.draw + result.awayWin, 1, 1e-12);
    assert.ok(result.homeWin > result.awayWin);
  });

  it('reports the likeliest scoreline first', () => {
    const result = simulateMatch(1.5, 1.0, { draws: 20000, seed: 6 });
    const top = result.scorelines[0];
    assert.ok(top !== undefined);
    const analytic = poisson(1.5).pdf(top.home) * poisson(1.0).pdf(top.away);
    close(top.probability, analytic, 0.01);
  });

  it('repeats exactly on the same seed and differs on another', () => {
    const a = simulateMatch(1.4, 1.2, { draws: 2000, seed: 11 });
    const b = simulateMatch(1.4, 1.2, { draws: 2000, seed: 11 });
    const c = simulateMatch(1.4, 1.2, { draws: 2000, seed: 12 });
    assert.equal(a.homeWin, b.homeWin);
    assert.notEqual(a.homeWin, c.homeWin);
  });
});

describe('season simulation', () => {
  const teams = ['Arsenal', 'Brentford', 'Chelsea', 'Everton'];
  const fixtures = teams.flatMap((home) =>
    teams.filter((away) => away !== home).map((away) => ({ home, away })),
  );

  it('gives the strongest club the best expected position', () => {
    const strengths = new Map([
      ['Arsenal', { attack: 1.6, defence: 0.7 }],
      ['Brentford', { attack: 1.0, defence: 1.0 }],
      ['Chelsea', { attack: 1.0, defence: 1.0 }],
      ['Everton', { attack: 0.6, defence: 1.4 }],
    ]);
    const table = simulateSeason(fixtures, strengths, { draws: 400, seed: 3, relegationPlaces: 1 });
    assert.equal(table[0]?.team, 'Arsenal');
    assert.equal(table[3]?.team, 'Everton');
    assert.ok((table[0]?.title ?? 0) > (table[3]?.title ?? 1));
    // Every position share sums to one across the table.
    const firstPlace = table.reduce((total, entry) => total + entry.title, 0);
    close(firstPlace, 1, 1e-9);
  });

  it('keeps results that already happened', () => {
    const strengths = new Map(teams.map((team) => [team, { attack: 1, defence: 1 }]));
    const played = fixtures.map((fixture, index) =>
      index === 0 ? { ...fixture, homeScore: 5, awayScore: 0 } : fixture,
    );
    const table = simulateSeason(played, strengths, { draws: 200, seed: 4 });
    const arsenal = table.find((entry) => entry.team === 'Arsenal');
    assert.ok(arsenal !== undefined);
    // Arsenal opened with a five goal win in every simulation, so their goal
    // difference distribution must sit above the average club's.
    assert.ok(arsenal.goalDifference.mean > 0);
  });
});

describe('player simulation', () => {
  it('pays appearance points and a clean sheet the way the rules do', () => {
    const result = simulatePlayerPoints(
      {
        name: 'test defender',
        position: 'DEF',
        startProbability: 1,
        sixtyGivenStart: 1,
        expectedGoals: 0,
        expectedAssists: 0,
        cleanSheetProbability: 1,
        expectedConceded: 0,
      },
      { draws: 500, seed: 2 },
    );
    // Two for the appearance, four for the clean sheet, nothing else possible.
    close(result.fan.mean, 6, 1e-9);
  });

  it('turns a benched player into a zero rather than a small number', () => {
    const result = simulatePlayerPoints(
      {
        name: 'rotation risk',
        position: 'MID',
        startProbability: 0,
        expectedGoals: 1,
        expectedAssists: 1,
        cleanSheetProbability: 1,
      },
      { draws: 200, seed: 2 },
    );
    assert.equal(result.fan.mean, 0);
    assert.equal(result.blankRisk, 1);
  });

  it('spreads a striker wider than a defender at the same mean', () => {
    const striker = simulatePlayerPoints(
      {
        name: 'striker',
        position: 'FWD',
        startProbability: 0.95,
        expectedGoals: 0.6,
        expectedAssists: 0.2,
        cleanSheetProbability: 0,
      },
      { draws: 20000, seed: 8 },
    );
    const keeper = simulatePlayerPoints(
      {
        name: 'keeper',
        position: 'GKP',
        startProbability: 0.99,
        expectedGoals: 0,
        expectedAssists: 0,
        cleanSheetProbability: 0.35,
        expectedSaves: 3,
      },
      { draws: 20000, seed: 9 },
    );
    assert.ok(striker.fan.sd > keeper.fan.sd);
    assert.ok(striker.atLeast.some((entry) => entry.threshold === 10 && entry.probability > 0.05));
  });
});

describe('captaincy', () => {
  it('ranks the higher expectation first and shares the win probability', () => {
    const choices = captaincyEv(
      [
        {
          name: 'premium',
          position: 'FWD',
          startProbability: 0.98,
          expectedGoals: 0.8,
          expectedAssists: 0.3,
          cleanSheetProbability: 0,
        },
        {
          name: 'budget',
          position: 'MID',
          startProbability: 0.8,
          expectedGoals: 0.2,
          expectedAssists: 0.2,
          cleanSheetProbability: 0.3,
        },
      ],
      { draws: 4000, seed: 13 },
    );
    assert.equal(choices[0]?.name, 'premium');
    const total = choices.reduce((sum, choice) => sum + choice.winProbability, 0);
    close(total, 1, 1e-9);
    assert.ok((choices[0]?.regretRisk ?? 1) < 1);
  });
});

describe('fans', () => {
  it('orders its own quantiles', () => {
    const fan = summariseDraws([5, 1, 9, 3, 7]);
    assert.ok(
      fan.p5 <= fan.p25 && fan.p25 <= fan.median && fan.median <= fan.p75 && fan.p75 <= fan.p95,
    );
    assert.equal(fan.min, 1);
    assert.equal(fan.max, 9);
    assert.equal(fan.draws, 5);
  });
});
