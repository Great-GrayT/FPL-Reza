import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PlannerPlayer } from '@fpl/planner';
import { chipValue, strategySpace } from './space';

/** A pool with real spread between players, so a frontier has somewhere to go. */
function pool(): PlannerPlayer[] {
  const players: PlannerPlayer[] = [];
  let code = 1;
  const shape: [PlannerPlayer['position'], number][] = [
    ['GKP', 20],
    ['DEF', 60],
    ['MID', 60],
    ['FWD', 40],
  ];
  for (const [position, count] of shape) {
    for (let i = 0; i < count; i += 1) {
      const rate = 1 + (i % 10) * 0.7;
      players.push({
        code,
        name: `${position}${String(i)}`,
        position,
        teamCode: ((code - 1) % 20) + 1,
        price: 38 + (i % 12) * 6,
        projections: Array.from({ length: 4 }, () => rate),
        spreads: Array.from({ length: 4 }, () => 0.4 + (i % 5) * 0.3),
      });
      code += 1;
    }
  }
  return players;
}

const options = { budget: 1000, horizon: 4, keep: [], ban: [], chips: [], seed: 7 };

describe('the strategy space', () => {
  it('returns a cloud rather than a handful of points', () => {
    const space = strategySpace(pool(), options);
    assert.ok(space.dots.length > 40, `expected a cloud, got ${String(space.dots.length)} dots`);
    assert.ok(space.generated >= space.dots.length);
  });

  it('is the same cloud on the same seed, and a different one on another', () => {
    const first = strategySpace(pool(), options);
    const same = strategySpace(pool(), options);
    const other = strategySpace(pool(), { ...options, seed: 8 });
    assert.deepEqual(
      first.dots.map((dot) => dot.picks),
      same.dots.map((dot) => dot.picks),
    );
    assert.notDeepEqual(
      first.dots.map((dot) => dot.picks),
      other.dots.map((dot) => dot.picks),
    );
  });

  it('never draws a squad that breaks a rule', () => {
    const players = pool();
    const byCode = new Map(players.map((player) => [player.code, player]));
    for (const dot of strategySpace(players, options).dots) {
      assert.equal(dot.picks.length, 15);
      const held = dot.picks.map((code) => byCode.get(code));
      const counts = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
      const clubs = new Map<number, number>();
      let cost = 0;
      for (const player of held) {
        assert.ok(player !== undefined);
        counts[player.position] += 1;
        clubs.set(player.teamCode, (clubs.get(player.teamCode) ?? 0) + 1);
        cost += player.price;
      }
      assert.deepEqual(counts, { GKP: 2, DEF: 5, MID: 5, FWD: 3 });
      assert.ok(
        [...clubs.values()].every((count) => count <= 3),
        'four from one club',
      );
      assert.ok(cost <= options.budget, `spent ${String(cost)}`);
    }
  });

  it('holds every locked player in every strategy', () => {
    const players = pool();
    const keep = [players[0]?.code ?? 0, players[30]?.code ?? 0];
    const space = strategySpace(players, { ...options, keep });
    assert.ok(space.dots.length > 0);
    for (const dot of space.dots) for (const code of keep) assert.ok(dot.picks.includes(code));
  });

  it('draws no strategy holding a banned player', () => {
    const players = pool();
    // Ban the best forwards, who would otherwise be in most squads.
    const ban = players
      .filter((player) => player.position === 'FWD')
      .slice(0, 8)
      .map((player) => player.code);
    for (const dot of strategySpace(players, { ...options, ban }).dots) {
      for (const code of ban) assert.ok(!dot.picks.includes(code), 'a banned player was drawn');
    }
  });

  it('measures Sharpe from the steadiest squad, and finds the tangency', () => {
    const space = strategySpace(pool(), options);
    assert.ok(space.tangency !== null);
    const best = Math.max(...space.dots.map((dot) => dot.sharpe));
    assert.equal(space.tangency.sharpe, best);
    // Every dot's Sharpe is its excess over the risk free squad, per unit risk.
    for (const dot of space.dots) {
      if (dot.risk <= 0) continue;
      const expected = (dot.expected - space.riskFree.expected) / dot.risk;
      assert.ok(Math.abs(expected - dot.sharpe) < 0.01);
    }
  });

  it('prices the chips it can price, and only those', () => {
    const players = pool();
    const withChips = strategySpace(players, {
      ...options,
      chips: ['bench_boost', 'triple_captain'],
    });
    const without = strategySpace(players, options);
    assert.ok(
      Math.max(...withChips.dots.map((dot) => dot.expected)) >
        Math.max(...without.dots.map((dot) => dot.expected)),
      'chips should raise what the best squad is worth',
    );
    // A wildcard is a rebuild, not a valuation, so it prices nothing here.
    const wildcardOnly = strategySpace(players, { ...options, chips: ['wildcard'] });
    assert.ok(wildcardOnly.dots.every((dot) => dot.chipGain === 0));
  });
});

describe('what a chip is worth to a squad', () => {
  const squad: PlannerPlayer[] = Array.from({ length: 15 }, (_, index) => ({
    code: index + 1,
    name: `P${String(index)}`,
    position: 'MID',
    teamCode: index + 1,
    price: 50,
    // One big week for everyone, so the chips have an obvious week to land in.
    projections: [1, 1, index === 0 ? 20 : 6, 1],
  }));

  it('plays the triple captain on the best starter in his best week', () => {
    const { chipGain, chipWeeks } = chipValue(squad, 4, ['triple_captain'], 1);
    assert.equal(chipGain, 20);
    assert.deepEqual(chipWeeks, [{ chip: 'triple_captain', gameweek: 3, gain: 20 }]);
  });

  it('values a bench boost as the four who would not otherwise have scored', () => {
    const { chipGain } = chipValue(squad, 4, ['bench_boost'], 1);
    // Week three: one 20 and fourteen 6s, so the last four are 6 each.
    assert.equal(chipGain, 24);
  });

  it('prices nothing for a chip that rebuilds rather than revalues', () => {
    assert.equal(chipValue(squad, 4, ['wildcard', 'free_hit'], 1).chipGain, 0);
  });
});
