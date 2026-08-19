import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  candidateFrom,
  diversification,
  efficientFrontier,
  optimisePortfolio,
  portfolioVariance,
  riskContributions,
  type Candidate,
  type Constraints,
} from './optimise.js';

const constraints: Constraints = {
  budget: 1000,
  quota: { GKP: 1, DEF: 2, MID: 2, FWD: 1 },
  maxPerClub: 2,
};

function pool(): Candidate[] {
  const clubs = ['A', 'B', 'C', 'D', 'E'];
  const groups: { group: string; count: number }[] = [
    { group: 'GKP', count: 6 },
    { group: 'DEF', count: 12 },
    { group: 'MID', count: 12 },
    { group: 'FWD', count: 8 },
  ];
  const candidates: Candidate[] = [];
  let id = 1;
  for (const { group, count } of groups) {
    for (let i = 0; i < count; i += 1) {
      candidates.push({
        id,
        name: `${group}${i}`,
        group,
        club: clubs[i % clubs.length] ?? 'A',
        cost: 40 + i * 10,
        expected: 2 + i * 0.4,
        risk: 1 + i * 0.25,
      });
      id += 1;
    }
  }
  return candidates;
}

describe('portfolio variance', () => {
  it('adds independently across clubs and correlates within one', () => {
    const spread: Candidate[] = [
      { id: 1, name: 'a', group: 'MID', club: 'A', cost: 50, expected: 4, risk: 2 },
      { id: 2, name: 'b', group: 'MID', club: 'B', cost: 50, expected: 4, risk: 2 },
    ];
    const together: Candidate[] = spread.map((player) => ({ ...player, club: 'A' }));
    assert.equal(portfolioVariance(spread, 0.35), 8);
    assert.equal(portfolioVariance(together, 0.35), 8 + 2 * 0.35 * 4);
    assert.ok(portfolioVariance(together, 0.35) > portfolioVariance(spread, 0.35));
  });
});

describe('optimiser', () => {
  it('returns a squad that satisfies every constraint', () => {
    const portfolio = optimisePortfolio(pool(), constraints, 0);
    assert.ok(portfolio !== null);
    assert.equal(portfolio.players.length, 6);
    assert.ok(portfolio.cost <= constraints.budget);
    const counts = new Map<string, number>();
    const clubs = new Map<string, number>();
    for (const player of portfolio.players) {
      counts.set(player.group, (counts.get(player.group) ?? 0) + 1);
      clubs.set(player.club, (clubs.get(player.club) ?? 0) + 1);
    }
    assert.equal(counts.get('DEF'), 2);
    assert.equal(counts.get('MID'), 2);
    assert.equal(counts.get('FWD'), 1);
    assert.equal(counts.get('GKP'), 1);
    for (const count of clubs.values()) assert.ok(count <= constraints.maxPerClub);
  });

  it('gives up expected points as risk aversion rises', () => {
    const bold = optimisePortfolio(pool(), constraints, 0);
    const cautious = optimisePortfolio(pool(), constraints, 2);
    assert.ok(bold !== null && cautious !== null);
    assert.ok(cautious.expected <= bold.expected);
    assert.ok(cautious.risk <= bold.risk);
  });

  it('refuses when the budget cannot buy a legal shape', () => {
    assert.equal(optimisePortfolio(pool(), { ...constraints, budget: 10 }, 0), null);
  });

  it('refuses when a group has too few candidates', () => {
    const thin = pool().filter((player) => player.group !== 'GKP');
    assert.equal(optimisePortfolio(thin, constraints, 0), null);
  });
});

describe('frontier', () => {
  it('is ordered by risk and carries no dominated point', () => {
    const frontier = efficientFrontier(pool(), constraints);
    assert.ok(frontier.length >= 2);
    for (let i = 1; i < frontier.length; i += 1) {
      const previous = frontier[i - 1];
      const current = frontier[i];
      assert.ok(previous !== undefined && current !== undefined);
      assert.ok(current.risk >= previous.risk);
      // More risk has to buy more expected return, or the point would be dominated.
      assert.ok(current.expected > previous.expected);
    }
  });
});

describe('attribution', () => {
  it('attributes more variance to the riskier player', () => {
    const players: Candidate[] = [
      { id: 1, name: 'steady', group: 'DEF', club: 'A', cost: 50, expected: 4, risk: 1 },
      { id: 2, name: 'volatile', group: 'FWD', club: 'B', cost: 90, expected: 6, risk: 4 },
    ];
    const contributions = riskContributions(players);
    assert.equal(contributions[0]?.name, 'volatile');
    assert.ok((contributions[0]?.share ?? 0) > (contributions[1]?.share ?? 1));
  });

  it('reports concentration when a squad leans on one club', () => {
    const spread: Candidate[] = ['A', 'B', 'C', 'D'].map((club, i) => ({
      id: i,
      name: club,
      group: 'MID',
      club,
      cost: 50,
      expected: 4,
      risk: 2,
    }));
    const stacked: Candidate[] = spread.map((player) => ({ ...player, club: 'A' }));
    assert.ok(diversification(stacked).concentration > diversification(spread).concentration);
    assert.ok(diversification(stacked).ratio > diversification(spread).ratio);
  });
});

describe('candidates from returns', () => {
  it('reads the mean and spread off a return series', () => {
    const candidate = candidateFrom(1, 'test', 'MID', 'A', 70, [2, 6, 2, 10]);
    assert.equal(candidate.expected, 5);
    assert.ok(candidate.risk > 3.7 && candidate.risk < 3.9);
  });
});
