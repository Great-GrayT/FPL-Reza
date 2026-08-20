import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Position } from '@fpl/core';
import { bestSwaps } from './suggest.js';
import type { PlannerPlayer, Squad } from './types.js';

function pool(): PlannerPlayer[] {
  const players: PlannerPlayer[] = [];
  let code = 1;
  const shape: [Position, number][] = [
    ['GKP', 6],
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
        teamCode: ((code - 1) % 20) + 1,
        price: 40,
        projections: Array.from({ length: 6 }, () => 2),
      });
      code += 1;
    }
  }
  return players;
}

function squadOf(players: readonly PlannerPlayer[]): Squad {
  const take = (position: Position, count: number): PlannerPlayer[] =>
    players.filter((player) => player.position === position).slice(0, count);
  const picks = [...take('GKP', 2), ...take('DEF', 5), ...take('MID', 5), ...take('FWD', 3)];
  return {
    picks: picks.map((player) => player.code),
    purchasePrices: new Map(picks.map((player) => [player.code, player.price])),
    bank: 0,
    freeTransfers: 1,
    chipsUsed: [],
  };
}

describe('the best move available, ignoring what the plan can afford to do', () => {
  it('finds nothing when the squad already holds the best of everyone', () => {
    const players = pool();
    const squad = squadOf(players);
    assert.deepEqual(bestSwaps(players, squad, 0, { horizon: 3 }), []);
  });

  it('names the swap and what it gains over the rest of the horizon', () => {
    const players = pool();
    const squad = squadOf(players);
    const target = players.find(
      (player) => player.position === 'MID' && !squad.picks.includes(player.code),
    );
    assert.ok(target !== undefined);
    // Two points a week better, over three weeks left, is six.
    const better = players.map((player) =>
      player.code === target.code
        ? { ...player, projections: player.projections.map(() => 4) }
        : player,
    );

    const [best] = bestSwaps(better, squad, 0, { horizon: 3 });
    assert.ok(best !== undefined);
    assert.equal(best.in, target.code);
    assert.equal(Math.round(best.gain), 6);
  });

  it('measures over the horizon, not over the week', () => {
    const players = pool();
    const squad = squadOf(players);
    const free = players.filter(
      (player) => player.position === 'MID' && !squad.picks.includes(player.code),
    );
    const spike = free[0];
    const steady = free[1];
    assert.ok(spike !== undefined && steady !== undefined);

    const shaped = players.map((player) => {
      // One huge week and nothing after (20 over any horizon), against a
      // smaller edge every week (24 over four). The one week reader should take
      // the spike and the four week reader should not.
      if (player.code === spike.code) return { ...player, projections: [20, 0, 0, 0, 0, 0] };
      if (player.code === steady.code) return { ...player, projections: [6, 6, 6, 6, 6, 6] };
      return player;
    });

    const overOneWeek = bestSwaps(shaped, squad, 0, { horizon: 1 })[0];
    const overFour = bestSwaps(shaped, squad, 0, { horizon: 4 })[0];
    assert.equal(overOneWeek?.in, spike.code, 'one week should chase the fixture');
    assert.equal(overFour?.in, steady.code, 'four weeks should not');
  });

  it('never suggests a move the money cannot cover', () => {
    const players = pool();
    const squad = squadOf(players);
    const dear = players.map((player) =>
      squad.picks.includes(player.code)
        ? player
        : { ...player, price: 120, projections: player.projections.map(() => 9) },
    );
    // Bank is nothing and every replacement costs three times a held player.
    assert.deepEqual(bestSwaps(dear, squad, 0, { horizon: 3 }), []);
  });

  it('never suggests a fourth player from one club', () => {
    const players = pool();
    const squad = squadOf(players);
    const heldClubs = squad.picks.map(
      (code) => players.find((player) => player.code === code)?.teamCode ?? 0,
    );
    const crowded = heldClubs.find(
      (club) => heldClubs.filter((entry) => entry === club).length >= 3,
    );
    if (crowded === undefined) return;

    const tempting = players.map((player) =>
      player.teamCode === crowded && !squad.picks.includes(player.code)
        ? { ...player, projections: player.projections.map(() => 50) }
        : player,
    );
    for (const swap of bestSwaps(tempting, squad, 0, { horizon: 3, limit: 10 })) {
      const club = players.find((player) => player.code === swap.in)?.teamCode;
      const after = heldClubs.filter(
        (entry, index) => entry === club && squad.picks[index] !== swap.out,
      ).length;
      assert.ok(after < 3, 'suggested a fourth player from one club');
    }
  });

  it('offers one idea per player leaving, not five versions of the same one', () => {
    const players = pool();
    const squad = squadOf(players);
    const better = players.map((player) =>
      squad.picks.includes(player.code)
        ? player
        : { ...player, projections: player.projections.map(() => 9) },
    );
    const swaps = bestSwaps(better, squad, 0, { horizon: 3, limit: 3 });
    assert.equal(swaps.length, 3);
    assert.equal(new Set(swaps.map((swap) => swap.out)).size, 3);
  });
});
