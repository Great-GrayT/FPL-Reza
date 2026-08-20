import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildNamedShapes, estimatePrior, slotOf, type NamedShape } from './estimated-heatmap';
import type { Match, MatchDetail } from '@fpl/core';

/** `[[GK], [RB, CB, CB, LB], [CM, CM], [RW, AM, LW], [ST]]`, keeper first. */
const ROWS_442: readonly (readonly number[])[] = [[1], [2, 3, 4, 5], [6, 7], [8, 9, 10], [11]];

const shape = (over: Partial<NamedShape> = {}): NamedShape => ({
  formationRows: ROWS_442,
  formation: '4-4-2',
  season: '2025/26',
  gameweek: 12,
  opponent: 'Everton',
  ...over,
});

describe('slotOf', () => {
  it('places the two full backs on opposite touchlines', () => {
    const right = slotOf(ROWS_442, 2);
    const left = slotOf(ROWS_442, 5);
    assert.ok(right !== null && left !== null);
    assert.equal(right.lateral, 0.125);
    assert.equal(left.lateral, 0.875);
    // Both are the back line, so both sit at the bottom of the advancement scale.
    assert.equal(right.advancement, 0);
    assert.equal(left.advancement, 0);
  });

  it('returns null for a player the sheet does not name', () => {
    assert.equal(slotOf(ROWS_442, 99), null);
  });
});

describe('estimatePrior', () => {
  it('reports the slot as its basis only when a teamsheet placed him', () => {
    assert.equal(estimatePrior({ position: 'MID', playerCode: 9, shape: shape() }).basis, 'slot');
    assert.equal(
      estimatePrior({ position: 'MID', playerCode: 99, shape: shape() }).basis,
      'position',
    );
    assert.equal(estimatePrior({ position: 'MID' }).basis, 'position');
  });

  it('puts a forward ahead of a midfielder, and a midfielder ahead of a defender', () => {
    const defender = estimatePrior({ position: 'DEF' }).centreX;
    const midfielder = estimatePrior({ position: 'MID' }).centreX;
    const forward = estimatePrior({ position: 'FWD' }).centreX;
    assert.ok(defender < midfielder);
    assert.ok(midfielder < forward);
  });

  it('keeps a keeper on his own mark whatever row the teamsheet lists him in', () => {
    const keeper = estimatePrior({ position: 'GKP', playerCode: 1, shape: shape() });
    // Behind the defensive line, on the pitch, and centred in the goal.
    assert.ok(keeper.centreX > 0 && keeper.centreX < estimatePrior({ position: 'DEF' }).centreX);
    assert.equal(keeper.centreY, 0.5);
  });

  it('leans a wide player inward without crossing the middle', () => {
    const right = estimatePrior({ position: 'DEF', playerCode: 2, shape: shape() });
    const left = estimatePrior({ position: 'DEF', playerCode: 5, shape: shape() });
    assert.ok(right.centreY > 0.125 && right.centreY < 0.5);
    assert.ok(left.centreY < 0.875 && left.centreY > 0.5);
    // Mirrored slots produce mirrored clouds, since nothing here is handed.
    assert.ok(Math.abs(right.centreY + left.centreY - 1) < 1e-12);
    // And a touchline player ranges wider across the pitch than a central one,
    // because the ground he covers is the same width squeezed against a wall.
    assert.ok(
      right.spreadY > estimatePrior({ position: 'DEF', playerCode: 3, shape: shape() }).spreadY,
    );
  });

  it('carries the match its shape was read from, and nothing where there is none', () => {
    const placed = estimatePrior({ position: 'MID', playerCode: 9, shape: shape() });
    assert.deepEqual(placed.from, { season: '2025/26', gameweek: 12, opponent: 'Everton' });
    assert.equal(placed.formation, '4-4-2');
    assert.equal(estimatePrior({ position: 'MID' }).from, null);
    assert.equal(estimatePrior({ position: 'MID' }).formation, null);
  });
});

const match = (matchId: number, kickoff: string, season: string): Match =>
  ({
    matchId,
    season,
    round: 5,
    kickoff: new Date(kickoff),
    homeTeamCode: 1,
    awayTeamCode: 2,
    homeTeamName: 'Arsenal',
    awayTeamName: 'Everton',
  }) as unknown as Match;

const detail = (matchId: number, rows: readonly (readonly number[])[]): MatchDetail =>
  ({
    matchId,
    sheets: [{ teamCode: 1, formation: '4-4-2', formationRows: rows, lineup: [], substitutes: [] }],
  }) as unknown as MatchDetail;

describe('buildNamedShapes', () => {
  const matches = [
    match(1, '2026-04-01T14:00:00Z', '2025/26'),
    match(2, '2025-08-10T14:00:00Z', '2025/26'),
  ];
  const details = new Map([
    [1, detail(1, [[1], [2, 3, 4, 5], [6, 7], [8, 9, 10], [11]])],
    [2, detail(2, [[1], [20, 21, 22], [23, 24, 25, 26], [27, 28, 29]])],
  ]);

  it('takes the newest sheet that named the player', () => {
    const shapes = buildNamedShapes(matches, details);
    const found = shapes.forPlayer(23, 1);
    assert.ok(found !== null);
    // Named only in the older match, so that is the shape he is placed in.
    assert.equal(found.season, '2025/26');
    assert.equal(found.gameweek, 5);
    assert.equal(found.opponent, 'Everton');
    assert.deepEqual(found.formationRows, [[1], [20, 21, 22], [23, 24, 25, 26], [27, 28, 29]]);
  });

  it('falls back to the club last shape for a player no sheet names', () => {
    const shapes = buildNamedShapes(matches, details);
    const found = shapes.forPlayer(999, 1);
    assert.ok(found !== null);
    // The newest sheet the club named, since nothing places this player.
    assert.deepEqual(found.formationRows, [[1], [2, 3, 4, 5], [6, 7], [8, 9, 10], [11]]);
  });

  it('has nothing for a club with no stored teamsheet', () => {
    assert.equal(buildNamedShapes(matches, details).forPlayer(999, 77), null);
  });
});
