import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { backtest, compareRules, randomBaseline, type PanelRow, type Rule } from './backtest.js';

const rule: Rule = {
  squadSize: 2,
  freeTransfers: 1,
  transferCost: 4,
  captainMultiplier: 2,
};

/** Four players over three periods, with a score known before each period. */
function panel(): PanelRow[] {
  const rows: PanelRow[] = [];
  const players = [
    { id: 1, name: 'steady', club: 'A', scores: [9, 9, 9], actual: [6, 6, 6] },
    { id: 2, name: 'rising', club: 'B', scores: [1, 8, 10], actual: [2, 7, 12] },
    { id: 3, name: 'falling', club: 'C', scores: [8, 2, 1], actual: [7, 1, 0] },
    { id: 4, name: 'flat', club: 'D', scores: [5, 5, 5], actual: [4, 4, 4] },
  ];
  for (const player of players) {
    for (let period = 1; period <= 3; period += 1) {
      rows.push({
        id: player.id,
        name: player.name,
        period,
        group: 'MID',
        club: player.club,
        cost: 50,
        score: player.scores[period - 1] ?? 0,
        actual: player.actual[period - 1] ?? 0,
      });
    }
  }
  return rows;
}

describe('backtest', () => {
  it('holds the highest scoring players and doubles the captain', () => {
    const result = backtest(panel(), rule);
    const first = result.periods[0];
    assert.ok(first !== undefined);
    assert.deepEqual(first.holdings.sort(), ['falling', 'steady']);
    // 6 + 7, plus the captain's own return again: the captain is the highest
    // score, which is steady at 9, so 6 is doubled.
    assert.equal(first.gross, 19);
    assert.equal(first.captain, 'steady');
    assert.equal(first.transfers, 0, 'the opening squad is not a set of transfers');
  });

  it('charges for a transfer beyond the free allowance', () => {
    const result = backtest(panel(), { ...rule, freeTransfers: 0 });
    const second = result.periods[1];
    assert.ok(second !== undefined);
    assert.equal(second.transfers, 1);
    assert.equal(second.cost, 4);
    assert.equal(second.net, second.gross - 4);
  });

  it('does not charge inside the free allowance', () => {
    const result = backtest(panel(), rule);
    assert.equal(result.periods[1]?.cost, 0);
  });

  it('never picks a captain on a return it could not have known', () => {
    // In period three "rising" scores highest on both, but in period two
    // "steady" has the higher score while "rising" has the higher return.
    const result = backtest(panel(), rule);
    assert.equal(result.periods[1]?.captain, 'steady');
  });

  it('accumulates and reports a drawdown', () => {
    const result = backtest(panel(), rule);
    assert.equal(result.total, result.periods[2]?.cumulative);
    assert.ok(result.maxDrawdown <= 0);
    assert.ok(result.turnover >= 0 && result.turnover <= 1);
  });

  it('scores against a benchmark when one is supplied', () => {
    const benchmark = new Map([
      [1, 10],
      [2, 10],
      [3, 10],
    ]);
    const result = backtest(panel(), rule, { benchmarkByPeriod: benchmark });
    assert.ok(result.excess !== null);
    assert.ok(result.hitRate !== null && result.hitRate > 0);
    assert.ok(result.trackingError !== null);
  });

  it('respects a budget and a club limit', () => {
    const rows = panel().map((row) => ({ ...row, cost: row.id === 1 ? 200 : 50 }));
    const result = backtest(rows, { ...rule, budget: 120, maxPerClub: 1 });
    const holdings = result.periods[0]?.holdings ?? [];
    assert.ok(!holdings.includes('steady'), 'the expensive player does not fit the budget');
    assert.equal(holdings.length, 2);
  });

  it('fills a quota that the greedy pass left short', () => {
    const rows = panel().map((row) => ({ ...row, group: row.id % 2 === 0 ? 'DEF' : 'MID' }));
    const result = backtest(rows, { ...rule, quota: { MID: 1, DEF: 1 } });
    assert.equal(result.periods[0]?.holdings.length, 2);
  });
});

describe('comparison and baseline', () => {
  it('ranks rules by total points', () => {
    const table = compareRules(panel(), [
      { name: 'free transfers', rule },
      { name: 'expensive transfers', rule: { ...rule, freeTransfers: 0, transferCost: 20 } },
    ]);
    assert.equal(table[0]?.name, 'free transfers');
    assert.ok((table[0]?.total ?? 0) >= (table[1]?.total ?? 0));
  });

  it('produces a random baseline a real rule can be measured against', () => {
    const rows = panel();
    const strategy = backtest(rows, rule).total;
    const baseline = randomBaseline(rows, rule, { runs: 30, seed: 5 });
    assert.equal(baseline.runs, 30);
    assert.ok(baseline.p5 <= baseline.mean && baseline.mean <= baseline.p95);
    assert.ok(strategy > baseline.mean, 'a rule that ranks on a real signal should beat chance');
  });
});
