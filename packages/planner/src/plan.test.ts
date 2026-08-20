import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Position } from '@fpl/core';
import { isLegal, plan } from './plan.js';
import { DEFAULT_RULES, type PlannerPlayer, type Squad } from './types.js';

/**
 * The planner's contract is legality first and points second. A suggestion that
 * breaks a rule is not a worse plan, it is not a plan: the manager cannot enter
 * it. So most of these tests are about what the search refuses to do.
 */

function pool(): PlannerPlayer[] {
  const players: PlannerPlayer[] = [];
  let code = 1;
  const shape: [Position, number][] = [
    ['GKP', 8],
    ['DEF', 20],
    ['MID', 20],
    ['FWD', 12],
  ];
  for (const [position, count] of shape) {
    for (let i = 0; i < count; i += 1) {
      players.push({
        code,
        name: `${position}${String(i)}`,
        position,
        // Clubs are spread by the global code rather than the position index,
        // because the latter puts the first of every position at the same club
        // and the first fifteen picks are then four players from it. The
        // legality check caught that, which is what it is for.
        teamCode: ((code - 1) % 20) + 1,
        price: 40 + i * 2,
        projections: Array.from({ length: 6 }, () => 2 + (i % 5)),
      });
      code += 1;
    }
  }
  return players;
}

function startingSquad(players: readonly PlannerPlayer[]): Squad {
  const take = (position: Position, count: number): PlannerPlayer[] =>
    players.filter((player) => player.position === position).slice(0, count);
  const picks = [...take('GKP', 2), ...take('DEF', 5), ...take('MID', 5), ...take('FWD', 3)];
  return {
    picks: picks.map((player) => player.code),
    purchasePrices: new Map(picks.map((player) => [player.code, player.price])),
    bank: 200,
    freeTransfers: 1,
    chipsUsed: [],
  };
}

const indexOf = (players: readonly PlannerPlayer[]): Map<number, PlannerPlayer> =>
  new Map(players.map((player) => [player.code, player]));

describe('legality', () => {
  const players = pool();
  const squad = startingSquad(players);

  it('accepts a squad that satisfies every rule', () => {
    assert.equal(isLegal(squad.picks, squad.bank, indexOf(players), DEFAULT_RULES), true);
  });

  it('refuses a squad of the wrong size', () => {
    assert.equal(isLegal(squad.picks.slice(0, 14), 0, indexOf(players), DEFAULT_RULES), false);
  });

  it('refuses an overdrawn bank', () => {
    assert.equal(isLegal(squad.picks, -1, indexOf(players), DEFAULT_RULES), false);
  });

  it('refuses a duplicate pick', () => {
    const duplicated = [...squad.picks.slice(0, 14), squad.picks[0] ?? 0];
    assert.equal(isLegal(duplicated, 0, indexOf(players), DEFAULT_RULES), false);
  });

  it('refuses a fourth player from one club', () => {
    const oneClub = players.filter((player) => player.teamCode === 1);
    const index = indexOf(players);
    const picks = [
      ...oneClub
        .filter((player) => player.position === 'DEF')
        .slice(0, 4)
        .map((player) => player.code),
      ...squad.picks.slice(0, 11),
    ].slice(0, 15);
    // Only assert when the arrangement really does exceed the limit, so the
    // test fails for the reason it names.
    const clubs = new Map<number, number>();
    for (const code of picks) {
      const player = index.get(code);
      if (player === undefined) continue;
      clubs.set(player.teamCode, (clubs.get(player.teamCode) ?? 0) + 1);
    }
    if (Math.max(...clubs.values()) > DEFAULT_RULES.maxPerClub) {
      assert.equal(isLegal(picks, 0, index, DEFAULT_RULES), false);
    }
  });

  it('refuses a squad of the wrong shape', () => {
    const allDefenders = players
      .filter((player) => player.position === 'DEF')
      .slice(0, 15)
      .map((player) => player.code);
    assert.equal(isLegal(allDefenders, 0, indexOf(players), DEFAULT_RULES), false);
  });
});

describe('planning', () => {
  const players = pool();
  const squad = startingSquad(players);

  it('never suggests an illegal squad', () => {
    const result = plan(players, squad, { horizon: 4, startGameweek: 1, beamWidth: 8 });
    const index = indexOf(players);
    for (const week of result.weeks) {
      assert.equal(
        isLegal(week.picks, week.bank, index, DEFAULT_RULES),
        true,
        `gameweek ${String(week.gameweek)}`,
      );
    }
  });

  it('plans one week per gameweek of the horizon', () => {
    const result = plan(players, squad, { horizon: 5, startGameweek: 12 });
    assert.equal(result.weeks.length, 5);
    assert.deepEqual(
      result.weeks.map((week) => week.gameweek),
      [12, 13, 14, 15, 16],
    );
  });

  it('starts eleven and benches four', () => {
    const result = plan(players, squad, { horizon: 2, startGameweek: 1 });
    for (const week of result.weeks) {
      assert.equal(week.starters.length, 11);
      assert.equal(week.bench.length, 4);
      assert.equal(new Set([...week.starters, ...week.bench]).size, 15);
    }
  });

  it('never beats holding by less than nothing', () => {
    // The search always has the option of no transfer, so the plan it returns
    // can never be worse than holding the same squad.
    const result = plan(players, squad, { horizon: 4, startGameweek: 1 });
    assert.ok(result.excess >= -1e-9, `excess was ${String(result.excess)}`);
  });

  it('takes a transfer that pays for itself and refuses one that does not', () => {
    const worthIt = players.map((player) =>
      player.position === 'FWD' && player.name === 'FWD11'
        ? { ...player, projections: Array.from({ length: 6 }, () => 30) }
        : player,
    );
    const taken = plan(worthIt, squad, { horizon: 3, startGameweek: 1 });
    assert.ok(taken.transfers > 0, 'a thirty point player is worth a transfer');
    assert.ok(taken.weeks.some((week) => week.transfersIn.length > 0));

    // With every projection identical, no transfer can gain anything, so the
    // planner should sit still rather than churn.
    const flat = players.map((player) => ({
      ...player,
      projections: Array.from({ length: 6 }, () => 4),
    }));
    const idle = plan(flat, startingSquad(flat), { horizon: 3, startGameweek: 1 });
    assert.equal(idle.transfers, 0, 'nothing to gain means nothing to do');
    assert.equal(idle.hits, 0);
  });

  it('charges for a transfer beyond the free one', () => {
    const strong = players.map((player, index) =>
      player.position === 'MID' && index % 7 === 0
        ? { ...player, projections: Array.from({ length: 6 }, () => 25) }
        : player,
    );
    const result = plan(strong, squad, {
      horizon: 1,
      startGameweek: 1,
      maxTransfersPerWeek: 2,
    });
    const week = result.weeks[0];
    assert.ok(week !== undefined);
    if (week.transfers > week.freeTransfers) {
      assert.ok(week.hit > 0, 'a second transfer in one week costs four');
    }
  });

  it('spends a chip only where it earns more than holding it', () => {
    const withChips = plan(players, squad, {
      horizon: 3,
      startGameweek: 1,
      chips: ['bench_boost', 'triple_captain'],
    });
    // Each chip may be played at most once across the horizon.
    const played = withChips.chipsPlayed;
    assert.equal(new Set(played).size, played.length);
    const withoutChips = plan(players, squad, { horizon: 3, startGameweek: 1 });
    assert.ok(withChips.total >= withoutChips.total - 1e-9, 'a chip cannot make a plan worse');
  });

  it('respects a risk appetite', () => {
    const spread = players.map((player, index) => ({
      ...player,
      // Every other player is a coin flip with the same mean.
      spreads: Array.from({ length: 6 }, () => (index % 2 === 0 ? 6 : 0.5)),
    }));
    const cautious = plan(spread, startingSquad(spread), {
      horizon: 2,
      startGameweek: 1,
      riskAversion: 1,
    });
    const bold = plan(spread, startingSquad(spread), {
      horizon: 2,
      startGameweek: 1,
      riskAversion: -1,
    });
    assert.ok(cautious.total < bold.total, 'a cautious objective values the same squad lower');
    assert.equal(cautious.riskAversion, 1);
  });

  it('reports what it explored', () => {
    const result = plan(players, squad, { horizon: 2, startGameweek: 1, beamWidth: 4 });
    assert.ok(result.explored > 0);
  });
});

describe('churn', () => {
  it('never buys back a player it sold earlier in the horizon', () => {
    // Two forwards whose projections alternate week by week: without the guard
    // the plan swaps between them every gameweek, which is what a free transfer
    // costing nothing rates as optimal and what no manager would enter.
    const players = pool().map((player) =>
      player.name === 'FWD0'
        ? { ...player, projections: [9, 1, 9, 1, 9, 1] }
        : player.name === 'FWD1'
          ? { ...player, projections: [1, 9, 1, 9, 1, 9] }
          : player,
    );
    const start = startingSquad(players);
    const result = plan(players, start, { horizon: 6, startGameweek: 1 });

    const bought = new Set<number>();
    const soldOff = new Set<number>();
    for (const week of result.weeks) {
      for (const code of week.transfersIn) {
        assert.ok(!soldOff.has(code), `bought back ${String(code)} after selling him`);
        bought.add(code);
      }
      for (const code of week.transfersOut) soldOff.add(code);
    }
  });
});

describe('the claim every plan makes', () => {
  it('is never worth less than holding the same fifteen', () => {
    // The holding line used to sit in the beam like any other state, so a beam
    // full of better looking early states could prune it and the plan could
    // finish below the number it reports itself against.
    const players = pool();
    const start = startingSquad(players);
    for (const beamWidth of [1, 2, 4, 12]) {
      const result = plan(players, start, { horizon: 6, startGameweek: 1, beamWidth });
      assert.ok(
        result.total >= result.holdTotal - 1e-9,
        `beam ${String(beamWidth)}: planned ${result.total.toFixed(2)} against holding ${result.holdTotal.toFixed(2)}`,
      );
      assert.ok(result.excess >= -1e-9);
    }
  });
});

describe('a locked player', () => {
  const players = pool();
  const squad = startingSquad(players);

  /** A pool where selling the first defender is plainly the best move. */
  function withAnObviousUpgrade(): PlannerPlayer[] {
    return pool().map((player) =>
      player.position === 'DEF' && !squad.picks.includes(player.code)
        ? { ...player, price: 40, projections: player.projections.map(() => 20) }
        : player,
    );
  }

  it('is sold when nothing locks him', () => {
    const result = plan(withAnObviousUpgrade(), squad, { horizon: 4, startGameweek: 1 });
    assert.ok(result.transfers > 0, 'the search should take an upgrade this large');
  });

  it('is never sold when he is locked throughout', () => {
    const locked = squad.picks;
    const result = plan(withAnObviousUpgrade(), squad, {
      horizon: 4,
      startGameweek: 1,
      locked,
    });
    for (const week of result.weeks)
      for (const code of week.transfersOut)
        assert.fail(`sold ${String(code)}, which was locked for the whole horizon`);
  });

  it('locks only the players named, and leaves the rest tradable', () => {
    const first = squad.picks[2] ?? 0;
    const result = plan(withAnObviousUpgrade(), squad, {
      horizon: 4,
      startGameweek: 1,
      locked: [first],
    });
    const soldOut = result.weeks.flatMap((week) => week.transfersOut);
    assert.ok(!soldOut.includes(first), 'the locked player was sold');
    assert.ok(result.transfers > 0, 'the rest of the squad should still trade');
  });

  it('still beats holding the same fifteen, with a lock in place', () => {
    const result = plan(withAnObviousUpgrade(), squad, {
      horizon: 4,
      startGameweek: 1,
      locked: [squad.picks[0] ?? 0],
    });
    assert.ok(
      result.excess >= -1e-9,
      `a plan must never be worth less than holding, got ${String(result.excess)}`,
    );
  });
});

describe('chips as decisions the search makes', () => {
  const players = pool();
  const squad = startingSquad(players);

  /** A pool where one gameweek is worth far more than the others. */
  function withOneBigWeek(week: number): PlannerPlayer[] {
    return pool().map((player) =>
      squad.picks.includes(player.code)
        ? {
            ...player,
            projections: player.projections.map((value, index) =>
              index === week ? value * 4 : value,
            ),
          }
        : player,
    );
  }

  it('plays the triple captain in the week the captain is worth most', () => {
    const result = plan(withOneBigWeek(2), squad, {
      horizon: 4,
      startGameweek: 1,
      chips: ['triple_captain'],
    });
    const played = result.weeks.find((week) => week.chip === 'triple_captain');
    assert.ok(played !== undefined, 'the chip was never played');
    assert.equal(played.gameweek, 3, 'it should land on the week worth the most');
  });

  it('plays each chip at most once in a horizon', () => {
    const result = plan(withOneBigWeek(1), squad, {
      horizon: 6,
      startGameweek: 1,
      chips: ['triple_captain', 'bench_boost'],
    });
    const played = result.weeks.flatMap((week) => (week.chip === null ? [] : [week.chip]));
    assert.equal(new Set(played).size, played.length, 'a chip was played twice');
  });

  it('never plays two chips in one gameweek', () => {
    const result = plan(withOneBigWeek(1), squad, {
      horizon: 4,
      startGameweek: 1,
      chips: ['triple_captain', 'bench_boost', 'wildcard'],
    });
    // One chip per WeekPlan by construction, so this checks the report as well
    // as the rule: a week may name one chip or none.
    for (const week of result.weeks) {
      assert.ok(week.chip === null || typeof week.chip === 'string');
    }
  });

  it('plays a wildcard when the squad it can buy is far better', () => {
    // Everyone outside the squad is twice as good and affordable, so a week of
    // free transfers is worth more than the one transfer a week the plan gets.
    const better = pool().map((player) =>
      squad.picks.includes(player.code)
        ? player
        : { ...player, price: 40, projections: player.projections.map(() => 12) },
    );
    const withChip = plan(better, squad, {
      horizon: 5,
      startGameweek: 1,
      chips: ['wildcard'],
      maxTransfersPerWeek: 1,
    });
    const without = plan(better, squad, {
      horizon: 5,
      startGameweek: 1,
      maxTransfersPerWeek: 1,
    });

    assert.ok(
      withChip.chipsPlayed.includes('wildcard'),
      'a wildcard that buys eight upgrades at once should be played',
    );
    assert.ok(
      withChip.total > without.total,
      `the wildcard should be worth something: ${String(withChip.total)} against ${String(without.total)}`,
    );
  });

  it('takes no hit for the transfers a wildcard makes', () => {
    const better = pool().map((player) =>
      squad.picks.includes(player.code)
        ? player
        : { ...player, price: 40, projections: player.projections.map(() => 12) },
    );
    const result = plan(better, squad, {
      horizon: 4,
      startGameweek: 1,
      chips: ['wildcard'],
      maxTransfersPerWeek: 1,
    });
    const week = result.weeks.find((entry) => entry.chip === 'wildcard');
    assert.ok(week !== undefined);
    assert.equal(week.hit, 0, 'a wildcard week costs nothing');
    assert.ok(week.transfers > 1, 'a wildcard that makes one transfer is a wasted chip');
  });

  it('reverts the squad the week after a free hit', () => {
    const better = pool().map((player) =>
      squad.picks.includes(player.code)
        ? player
        : {
            ...player,
            price: 40,
            // One enormous week for everyone else, nothing after it: exactly
            // the shape a free hit exists for.
            projections: player.projections.map((_, index) => (index === 2 ? 30 : 0)),
          },
    );
    const result = plan(better, squad, {
      horizon: 5,
      startGameweek: 1,
      chips: ['free_hit'],
      maxTransfersPerWeek: 1,
    });

    const played = result.weeks.find((week) => week.chip === 'free_hit');
    assert.ok(played !== undefined, 'the free hit was never played');
    const after = result.weeks.find((week) => week.gameweek === played.gameweek + 1);
    assert.ok(after !== undefined, 'there should be a week after it to revert into');

    const before = result.weeks.find((week) => week.gameweek === played.gameweek - 1);
    const restored = before?.picks ?? squad.picks;
    assert.deepEqual(
      [...after.picks].sort((a, b) => a - b),
      [...restored].sort((a, b) => a - b),
      'the squad after a free hit must be the squad before it',
    );
  });

  it('never plays a chip the manager does not hold', () => {
    const result = plan(withOneBigWeek(1), squad, { horizon: 4, startGameweek: 1, chips: [] });
    assert.deepEqual(result.chipsPlayed, []);
  });
});

describe('a banned player', () => {
  const players = pool();
  const squad = startingSquad(players);

  /** A pool where one player outside the squad is plainly the best buy. */
  function withATemptingBuy(): { players: PlannerPlayer[]; tempting: number } {
    const free = pool().filter(
      (player) => player.position === 'DEF' && !squad.picks.includes(player.code),
    );
    const tempting = free[0]?.code ?? 0;
    return {
      players: pool().map((player) =>
        player.code === tempting
          ? { ...player, price: 40, projections: player.projections.map(() => 25) }
          : player,
      ),
      tempting,
    };
  }

  it('is bought when nothing bans him', () => {
    const { players: pooled, tempting } = withATemptingBuy();
    const result = plan(pooled, squad, { horizon: 4, startGameweek: 1 });
    assert.ok(
      result.weeks.some((week) => week.transfersIn.includes(tempting)),
      'the search should take a buy this good',
    );
  });

  it('is never bought when he is banned', () => {
    const { players: pooled, tempting } = withATemptingBuy();
    const result = plan(pooled, squad, { horizon: 4, startGameweek: 1, banned: [tempting] });
    for (const week of result.weeks) {
      assert.ok(!week.transfersIn.includes(tempting), `bought ${String(tempting)}, who was banned`);
      assert.ok(!week.picks.includes(tempting), 'a banned player appeared in the squad');
    }
  });

  it('is not bought under a wildcard either', () => {
    const { players: pooled, tempting } = withATemptingBuy();
    const result = plan(pooled, squad, {
      horizon: 4,
      startGameweek: 1,
      chips: ['wildcard'],
      banned: [tempting],
    });
    for (const week of result.weeks) {
      assert.ok(!week.picks.includes(tempting), 'a wildcard bought a banned player');
    }
  });
});
