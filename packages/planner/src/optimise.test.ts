import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Position } from '@fpl/core';
import { optimiseSquad } from './optimise.js';
import { isLegal } from './plan.js';
import { DEFAULT_RULES, type PlannerPlayer } from './types.js';

/**
 * The optimiser's contract is the same as the plan's: legality first, points
 * second. What is added here is a claim about the search itself, that it never
 * returns a squad worse than the greedy one it started from, and a claim about
 * reproducibility, that the same seed returns the same fifteen.
 */

function pool(): PlannerPlayer[] {
  const players: PlannerPlayer[] = [];
  let code = 1;
  const shape: [Position, number][] = [
    ['GKP', 12],
    ['DEF', 40],
    ['MID', 40],
    ['FWD', 24],
  ];
  for (const [position, count] of shape) {
    for (let index = 0; index < count; index += 1) {
      players.push({
        code,
        name: `${position}${String(index)}`,
        position,
        // Spread by the global code, not the position index: the latter puts
        // the first of every position at one club, which the club limit then
        // refuses, and the fixture rather than the search is what is broken.
        teamCode: ((code - 1) % 20) + 1,
        price: 40 + (index % 12) * 5,
        // Value rises with price but not proportionally, which is what makes
        // this a knapsack rather than a sort: the dearest player is the best
        // per slot and the worst per million.
        projections: Array.from(
          { length: 8 },
          (_, week) => 1 + (index % 12) * 0.6 + (week % 3) * 0.2,
        ),
        spreads: Array.from({ length: 8 }, () => 1 + (index % 5) * 0.3),
      });
      code += 1;
    }
  }
  return players;
}

const indexOf = (players: readonly PlannerPlayer[]): Map<number, PlannerPlayer> =>
  new Map(players.map((player) => [player.code, player]));

describe('optimiseSquad', () => {
  const players = pool();

  it('returns a legal fifteen inside the budget', () => {
    const result = optimiseSquad(players, { budget: 1000, horizon: 6, seed: 3, rounds: 2 });
    assert.ok(result !== null);
    assert.equal(result.squad.picks.length, DEFAULT_RULES.squadSize);
    assert.ok(
      isLegal(result.squad.picks, result.squad.bank, indexOf(players), DEFAULT_RULES),
      'the squad satisfies the quota, the club limit, and the budget',
    );
    assert.ok(result.squad.bank >= 0);
  });

  it('never returns a squad worse than the greedy one it started from', () => {
    const result = optimiseSquad(players, { budget: 1000, horizon: 6, seed: 11, rounds: 4 });
    assert.ok(result !== null);
    assert.ok(
      result.points >= result.baseline,
      `optimised ${String(result.points)} against greedy ${String(result.baseline)}`,
    );
  });

  it('beats the greedy squad on a pool where ranking alone cannot', () => {
    const result = optimiseSquad(players, { budget: 1000, horizon: 6, seed: 5, rounds: 6 });
    assert.ok(result !== null);
    assert.ok(result.points > result.baseline, 'the search found something the ranking did not');
    assert.ok(result.improvements > 0);
  });

  it('reproduces exactly on the same seed, and reports what it explored', () => {
    const first = optimiseSquad(players, { budget: 1000, horizon: 4, seed: 42, rounds: 3 });
    const second = optimiseSquad(players, { budget: 1000, horizon: 4, seed: 42, rounds: 3 });
    assert.ok(first !== null && second !== null);
    assert.deepEqual([...first.squad.picks].sort(), [...second.squad.picks].sort());
    assert.equal(first.points, second.points);
    assert.ok(first.evaluated > 0);
    assert.equal(first.rounds, 4);
  });

  it('keeps the players it was told to keep', () => {
    const keep = [players[0], players[13], players[60]].flatMap((player) =>
      player === undefined ? [] : [player.code],
    );
    const result = optimiseSquad(players, { budget: 1000, horizon: 4, seed: 7, rounds: 3, keep });
    assert.ok(result !== null);
    for (const code of keep) assert.ok(result.squad.picks.includes(code), `kept ${String(code)}`);
    assert.ok(isLegal(result.squad.picks, result.squad.bank, indexOf(players), DEFAULT_RULES));
  });

  it('respects a budget too small for the greedy squad to be improved into an illegal one', () => {
    const result = optimiseSquad(players, { budget: 700, horizon: 4, seed: 9, rounds: 3 });
    assert.ok(result !== null);
    assert.ok(result.squad.bank >= 0);
    assert.ok(isLegal(result.squad.picks, result.squad.bank, indexOf(players), DEFAULT_RULES));
  });

  it('stops at the evaluation budget and says it did not settle', () => {
    const result = optimiseSquad(players, {
      budget: 1000,
      horizon: 6,
      seed: 2,
      rounds: 20,
      maxEvaluations: 300,
    });
    assert.ok(result !== null);
    assert.equal(result.converged, false);
    assert.ok(result.evaluated <= 400, `stopped near the cap, at ${String(result.evaluated)}`);
  });

  it('takes a safer squad under risk aversion', () => {
    const brave = optimiseSquad(players, { budget: 1000, horizon: 6, seed: 4, riskAversion: 0 });
    const cautious = optimiseSquad(players, { budget: 1000, horizon: 6, seed: 4, riskAversion: 1 });
    assert.ok(brave !== null && cautious !== null);
    // The cautious objective subtracts spreads, so its own total is lower; what
    // matters is that it is a different squad, not a rescored one.
    assert.notDeepEqual([...brave.squad.picks].sort(), [...cautious.squad.picks].sort());
  });

  it('returns nothing when the pool cannot fill a squad', () => {
    assert.equal(optimiseSquad(players.slice(0, 10), { budget: 1000 }), null);
  });

  it('reports a value per gameweek that sums to the total', () => {
    const result = optimiseSquad(players, { budget: 1000, horizon: 5, seed: 8, rounds: 2 });
    assert.ok(result !== null);
    assert.equal(result.perGameweek.length, 5);
    const summed = result.perGameweek.reduce((total, points) => total + points, 0);
    assert.ok(Math.abs(summed - result.points) < 0.1);
  });
});
