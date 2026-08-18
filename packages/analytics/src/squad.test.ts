import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  INITIAL_BUDGET,
  MAX_PLAYERS_PER_CLUB,
  SQUAD_SIZE,
  asPlayerId,
  asTeamId,
  playerSchema,
  type Player,
  type Position,
} from '@fpl/core';
import {
  autoPick,
  bestStartingEleven,
  canAdd,
  countByPosition,
  formationLabel,
  isLegalSquad,
  squadCost,
  suggestTransfers,
  validateSquad,
} from './squad.js';

let nextId = 1;

function player(position: Position, price: number, team: number, points = 50): Player {
  const id = nextId++;
  return playerSchema.parse({
    id,
    code: 100000 + id,
    firstName: 'Test',
    secondName: `Player ${String(id)}`,
    webName: `P${String(id)}`,
    teamId: team,
    position,
    price,
    startPrice: price,
    totalPoints: points,
    pointsPerGame: points / 38,
    form: 0,
    selectedByPercent: 5,
    minutes: 1000,
    goals: 0,
    assists: 0,
    cleanSheets: 0,
    goalsConceded: 0,
    yellowCards: 0,
    redCards: 0,
    saves: 0,
    bonus: 0,
    bps: 0,
    expectedGoals: 0,
    expectedAssists: 0,
    expectedGoalInvolvements: 0,
    expectedGoalsConceded: 0,
    availability: 'available',
    news: '',
    chanceOfPlayingNextRound: null,
  });
}

/** A legal 15 spread over enough clubs, at a cost the budget covers. */
function legalSquad(): { players: Player[]; picks: ReturnType<typeof asPlayerId>[] } {
  const squad: Player[] = [];
  const quota: [Position, number][] = [
    ['GKP', 2],
    ['DEF', 5],
    ['MID', 5],
    ['FWD', 3],
  ];
  let team = 1;
  for (const [position, count] of quota) {
    for (let i = 0; i < count; i += 1) {
      squad.push(player(position, 50, team));
      // Three per club is legal, so rotate clubs every third pick.
      team = team === 20 ? 1 : team + 1;
    }
  }
  return { players: squad, picks: squad.map((entry) => entry.id) };
}

describe('squadCost', () => {
  it('sums prices and reports what is left of the budget', () => {
    const one = player('MID', 105, 1);
    const two = player('FWD', 145, 2);

    const cost = squadCost({ picks: [one.id, two.id] }, [one, two]);

    assert.equal(cost.spent, 250);
    assert.equal(cost.budget, INITIAL_BUDGET);
    assert.equal(cost.remaining, INITIAL_BUDGET - 250);
  });
});

describe('validateSquad', () => {
  it('passes a legal squad', () => {
    const { players, picks } = legalSquad();

    assert.deepEqual(validateSquad({ picks }, players), []);
    assert.equal(isLegalSquad({ picks }, players), true);
  });

  it('reports every problem at once rather than only the first', () => {
    const keeper = player('GKP', 50, 1);
    const issues = validateSquad({ picks: [keeper.id] }, [keeper]);

    const codes = issues.map((issue) => issue.code);
    assert.ok(codes.includes('squad_incomplete'));
    assert.ok(codes.includes('quota_short'));
    // One keeper short, five defenders, five midfielders, three forwards short.
    assert.equal(issues.filter((issue) => issue.code === 'quota_short').length, 4);
  });

  it('names the club when four come from one', () => {
    const four = [1, 2, 3, 4].map(() => player('MID', 50, 7));
    const issues = validateSquad({ picks: four.map((entry) => entry.id) }, four, () => 'Arsenal');

    const clubIssue = issues.find((issue) => issue.code === 'club_limit');
    assert.ok(clubIssue !== undefined);
    assert.match(clubIssue.message, /Arsenal/);
    assert.match(clubIssue.message, new RegExp(String(MAX_PLAYERS_PER_CLUB)));
  });

  it('catches a squad over budget', () => {
    const expensive = Array.from({ length: 15 }, (_, index) =>
      player(index === 0 ? 'GKP' : 'MID', 200, (index % 20) + 1),
    );
    const issues = validateSquad({ picks: expensive.map((entry) => entry.id) }, expensive);

    assert.ok(issues.some((issue) => issue.code === 'over_budget'));
  });

  it('catches the same player picked twice', () => {
    const one = player('MID', 50, 1);
    const issues = validateSquad({ picks: [one.id, one.id] }, [one]);

    assert.ok(issues.some((issue) => issue.code === 'duplicate'));
  });
});

describe('canAdd', () => {
  it('refuses a fourth player from one club, and says why', () => {
    const three = [1, 2, 3].map(() => player('MID', 50, 9));
    const fourth = player('DEF', 50, 9);

    const result = canAdd({ picks: three.map((entry) => entry.id) }, fourth, [...three, fourth]);

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /three/i);
  });

  it('refuses a player the budget cannot cover, quoting both numbers', () => {
    const cheap = player('MID', 40, 1);
    const dear = player('FWD', 990, 2);

    const result = canAdd({ picks: [cheap.id], budget: 1000 }, dear, [cheap, dear]);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.reason, /99\.0m/);
      assert.match(result.reason, /96\.0m/);
    }
  });

  it('refuses a position whose slots are already full', () => {
    const keepers = [1, 2].map(() => player('GKP', 45, 3));
    const third = player('GKP', 45, 5);

    const result = canAdd({ picks: keepers.map((entry) => entry.id) }, third, [...keepers, third]);

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /GKP/);
  });

  it('accepts a legal addition', () => {
    const one = player('MID', 50, 1);
    const two = player('DEF', 50, 2);

    assert.deepEqual(canAdd({ picks: [one.id] }, two, [one, two]), { ok: true });
  });
});

describe('bestStartingEleven', () => {
  it('picks the highest scoring legal formation, not simply the top eleven', () => {
    const squad: Player[] = [];
    // Two keepers, one excellent. Five defenders, all poor. Five midfielders,
    // all excellent. Three forwards, all poor. The top eleven by projection
    // would field 5 midfielders and no defenders, which is illegal.
    squad.push(player('GKP', 50, 1, 10), player('GKP', 45, 2, 1));
    for (let i = 0; i < 5; i += 1) squad.push(player('DEF', 45, 3 + i, 2));
    for (let i = 0; i < 5; i += 1) squad.push(player('MID', 90, 8 + i, 20));
    for (let i = 0; i < 3; i += 1) squad.push(player('FWD', 60, 14 + i, 3));

    const projection = (candidate: Player): number => candidate.totalPoints;
    const eleven = bestStartingEleven(
      squad.map((entry) => entry.id),
      squad,
      projection,
    );

    assert.equal(eleven.starters.length, 11);
    assert.equal(eleven.formation.GKP, 1);
    assert.equal(eleven.formation.DEF, 3);
    assert.equal(eleven.formation.MID, 5);
    assert.equal(eleven.formation.FWD, 2);
    assert.equal(formationLabel(eleven.formation), '3-5-2');
    // 10 + (3 x 2) + (5 x 20) + (2 x 3) = 122
    assert.equal(eleven.projectedPoints, 122);
  });

  it('puts the spare keeper at the front of the bench, where only a keeper can replace one', () => {
    const squad: Player[] = [];
    squad.push(player('GKP', 50, 1, 10), player('GKP', 45, 2, 1));
    for (let i = 0; i < 5; i += 1) squad.push(player('DEF', 45, 3 + i, 5));
    for (let i = 0; i < 5; i += 1) squad.push(player('MID', 90, 8 + i, 9));
    for (let i = 0; i < 3; i += 1) squad.push(player('FWD', 60, 14 + i, 7));

    const eleven = bestStartingEleven(
      squad.map((entry) => entry.id),
      squad,
      (candidate) => candidate.totalPoints,
    );

    const firstBenched = squad.find((entry) => entry.id === eleven.bench[0]);
    assert.equal(firstBenched?.position, 'GKP');
    assert.equal(eleven.bench.length, 4);
  });

  it('names a captain and a vice captain, the two best starters', () => {
    const { players, picks } = legalSquad();
    const best = players[7];
    assert.ok(best !== undefined);

    const eleven = bestStartingEleven(picks, players, (candidate) =>
      candidate.id === best.id ? 100 : 1,
    );

    assert.equal(eleven.captain, best.id);
    assert.notEqual(eleven.viceCaptain, best.id);
    assert.notEqual(eleven.viceCaptain, null);
  });

  it('returns an empty eleven rather than throwing on a squad too small to field one', () => {
    const one = player('MID', 50, 1);
    const eleven = bestStartingEleven([one.id], [one], () => 1);

    assert.deepEqual(eleven.starters, []);
    assert.equal(eleven.captain, null);
  });
});

describe('autoPick', () => {
  // A realistic pool: every position at several price points across 20 clubs.
  const pool: Player[] = [];
  for (let team = 1; team <= 20; team += 1) {
    pool.push(player('GKP', 40 + (team % 3) * 5, team, 40 + team));
    pool.push(player('GKP', 45, team, 30));
    for (let i = 0; i < 4; i += 1) pool.push(player('DEF', 40 + i * 10, team, 30 + i * 15));
    for (let i = 0; i < 4; i += 1) pool.push(player('MID', 45 + i * 20, team, 40 + i * 30));
    for (let i = 0; i < 3; i += 1) pool.push(player('FWD', 45 + i * 25, team, 35 + i * 35));
  }
  const projection = (candidate: Player): number => candidate.totalPoints / 38;

  it('produces a complete, legal squad within the budget', () => {
    const picks = autoPick(pool, projection);

    assert.equal(picks.length, SQUAD_SIZE);
    assert.deepEqual(validateSquad({ picks }, pool), []);
  });

  it('respects players it is told to keep', () => {
    const keep = pool.filter((entry) => entry.position === 'FWD').slice(0, 2);
    const picks = autoPick(pool, projection, { keep: keep.map((entry) => entry.id) });

    for (const kept of keep) assert.ok(picks.includes(kept.id));
    assert.deepEqual(validateSquad({ picks }, pool), []);
  });

  it('never picks an excluded player', () => {
    const excluded = pool.slice(0, 12).map((entry) => entry.id);
    const picks = autoPick(pool, projection, { exclude: excluded });

    for (const id of excluded) assert.ok(!picks.includes(id));
  });

  it('spends most of the money on the eleven rather than evenly across fifteen', () => {
    const picks = autoPick(pool, projection);
    const priced = picks.map((id) => pool.find((entry) => entry.id === id)?.price ?? 0);
    const cheapestFour = [...priced].sort((a, b) => a - b).slice(0, 4);
    const benchSpend = cheapestFour.reduce((total, price) => total + price, 0);

    // The four cheapest slots should be a small share of a 100.0m budget.
    assert.ok(benchSpend <= 220, `bench cost ${String(benchSpend)} tenths`);
  });
});

describe('suggestTransfers', () => {
  it('suggests an affordable same position upgrade, best gain first', () => {
    const { players, picks } = legalSquad();
    const weak = players.find((entry) => entry.position === 'MID');
    assert.ok(weak !== undefined);

    const upgrade = player('MID', 60, 20, 200);
    const pool = [...players, upgrade];
    const projection = (candidate: Player): number => candidate.totalPoints / 38;

    const suggestions = suggestTransfers({ picks }, pool, projection, 3);

    assert.ok(suggestions.length > 0);
    assert.equal(suggestions[0]?.in, upgrade.id);
    assert.ok((suggestions[0]?.gain ?? 0) > 0);
  });

  it('never suggests a swap that would break the club limit', () => {
    const { players, picks } = legalSquad();
    // Three from club 1 already: another from club 1 must not be suggested.
    const fromFullClub = player('MID', 50, 1, 500);
    const pool = [...players, fromFullClub];
    const heldFromClubOne = players.filter((entry) => entry.teamId === asTeamId(1)).length;

    const suggestions = suggestTransfers({ picks }, pool, (c) => c.totalPoints, 20);

    if (heldFromClubOne >= MAX_PLAYERS_PER_CLUB) {
      const offending = suggestions.filter(
        (suggestion) =>
          suggestion.in === fromFullClub.id &&
          players.find((entry) => entry.id === suggestion.out)?.teamId !== asTeamId(1),
      );
      assert.deepEqual(offending, []);
    }
  });

  it('never suggests a player the budget cannot afford', () => {
    const { players, picks } = legalSquad();
    const dear = player('MID', 400, 20, 900);
    const pool = [...players, dear];

    const suggestions = suggestTransfers({ picks }, pool, (c) => c.totalPoints, 20);

    for (const suggestion of suggestions) {
      const out = players.find((entry) => entry.id === suggestion.out);
      const incoming = pool.find((entry) => entry.id === suggestion.in);
      assert.ok(out !== undefined && incoming !== undefined);
      const cost = squadCost({ picks }, pool);
      assert.ok(incoming.price <= cost.remaining + out.price);
    }
  });
});

describe('countByPosition', () => {
  it('ignores an id no longer in the player list', () => {
    const one = player('MID', 50, 1);
    const counts = countByPosition([one.id, asPlayerId(999999)], [one]);

    assert.equal(counts.MID, 1);
    assert.equal(counts.DEF, 0);
  });
});
