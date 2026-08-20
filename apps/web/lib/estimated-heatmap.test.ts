import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildNamedShapes, estimatePrior, slotOf, type NamedShape } from './estimated-heatmap';
import type { Match, MatchDetail } from '@fpl/core';

/**
 * `[[GK], [RB, CB, CB, LB], [CM, CM], [RW, AM, LW], [ST]]`, keeper first, and
 * holding **person ids**, which is what the provider puts in these rows. The
 * player codes below are deliberately a different range: conflating the two is
 * the bug these tests exist to keep out, and a fixture that used one number for
 * both would pass while the site drew every player in the middle of the pitch.
 */
const ROWS_442: readonly (readonly number[])[] = [
  [7001],
  [7002, 7003, 7004, 7005],
  [7006, 7007],
  [7008, 7009, 7010],
  [7011],
];

/** Player code 100 + n is person id 7000 + n, the way a lineup pairs them. */
const codeFor = (personId: number): number => personId - 6900;

const shape = (over: Partial<NamedShape> = {}): NamedShape => ({
  formationRows: ROWS_442,
  formation: '4-4-2',
  season: '2025/26',
  gameweek: 12,
  opponent: 'Everton',
  personId: 7009,
  role: null,
  roleStarts: 0,
  roleOf: 0,
  ...over,
});

describe('slotOf', () => {
  it('places the two full backs on opposite touchlines', () => {
    const right = slotOf(ROWS_442, 7002);
    const left = slotOf(ROWS_442, 7005);
    assert.ok(right !== null && left !== null);
    // Flipped: the provider writes a row right to left, and the domain runs 0
    // at the left touchline. Measured over every stored sheet, its "Left"
    // labels average 0.736 raw and its "Right" labels 0.240.
    assert.equal(right.lateral, 0.875);
    assert.equal(left.lateral, 0.125);
    // Both are the back line, so both sit at the bottom of the advancement scale.
    assert.equal(right.advancement, 0);
    assert.equal(left.advancement, 0);
  });

  it('returns null for a person the sheet does not name', () => {
    assert.equal(slotOf(ROWS_442, 9999), null);
  });

  it('does not match a player code against rows that hold person ids', () => {
    // The regression itself: 8,360 of 8,360 real lineup entries matched by
    // person id and none by player code, so this lookup must find nothing.
    assert.equal(slotOf(ROWS_442, codeFor(7002)), null);
  });
});

describe('estimatePrior', () => {
  it('reports the basis it actually used', () => {
    assert.equal(estimatePrior({ position: 'MID', shape: shape() }).basis, 'slot');
    assert.equal(
      estimatePrior({ position: 'MID', shape: shape({ personId: 9999 }) }).basis,
      'position',
    );
    assert.equal(
      estimatePrior({ position: 'MID', shape: shape({ role: 'Right Winger' }) }).basis,
      'role',
    );
    assert.equal(estimatePrior({ position: 'MID' }).basis, 'position');
  });

  it('prefers the named role over the slot it was named in', () => {
    // Named in the middle of a midfield three, but the provider calls him a
    // right winger: the words win, because a formation row is a rough grid and
    // the label is the provider's own reading of where he played.
    const both = estimatePrior({ position: 'MID', shape: shape({ role: 'Right Winger' }) });
    const slotOnly = estimatePrior({ position: 'MID', shape: shape() });
    assert.ok(both.lateral > 0.6, `expected a right sided cloud, got ${both.lateral}`);
    assert.ok(both.centreX > slotOnly.centreX, 'a winger plays ahead of a central midfielder');
  });

  it('separates a right back from a centre back, which the position alone cannot', () => {
    const right = estimatePrior({ position: 'DEF', shape: shape({ role: 'Right Full Back' }) });
    const centre = estimatePrior({
      position: 'DEF',
      shape: shape({ role: 'Centre Central Defender' }),
    });
    assert.ok(right.centreY > centre.centreY + 0.15, 'a right back is not drawn in the middle');
    assert.ok(right.centreX > centre.centreX, 'a full back pushes on past his centre backs');
  });

  it('puts a forward ahead of a midfielder, and a midfielder ahead of a defender', () => {
    const defender = estimatePrior({ position: 'DEF' }).centreX;
    const midfielder = estimatePrior({ position: 'MID' }).centreX;
    const forward = estimatePrior({ position: 'FWD' }).centreX;
    assert.ok(defender < midfielder);
    assert.ok(midfielder < forward);
  });

  it('keeps a keeper on his own mark whatever row the teamsheet lists him in', () => {
    const keeper = estimatePrior({ position: 'GKP', shape: shape({ personId: 7001 }) });
    assert.ok(keeper.centreX > 0 && keeper.centreX < estimatePrior({ position: 'DEF' }).centreX);
    assert.equal(keeper.centreY, 0.5);
  });

  it('leans a wide player inward without crossing the middle', () => {
    // First in the row is the provider's right, which is the domain's right
    // once the flip above is applied, so 7002 is the right back.
    const right = estimatePrior({ position: 'DEF', shape: shape({ personId: 7002 }) });
    const left = estimatePrior({ position: 'DEF', shape: shape({ personId: 7005 }) });
    assert.ok(right.centreY < 0.875 && right.centreY > 0.5);
    assert.ok(left.centreY > 0.125 && left.centreY < 0.5);
    // Mirrored slots produce mirrored clouds, since nothing here is handed.
    assert.ok(Math.abs(right.centreY + left.centreY - 1) < 1e-12);
    assert.ok(
      right.spreadY > estimatePrior({ position: 'DEF', shape: shape({ personId: 7003 }) }).spreadY,
    );
  });

  it('carries the match its shape was read from, and nothing where there is none', () => {
    const placed = estimatePrior({ position: 'MID', shape: shape() });
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

/** A sheet whose rows hold person ids and whose lineup pairs them to codes. */
const detail = (
  matchId: number,
  rows: readonly (readonly number[])[],
  roles: Record<number, string> = {},
): MatchDetail =>
  ({
    matchId,
    sheets: [
      {
        teamCode: 1,
        formation: '4-4-2',
        formationRows: rows,
        lineup: rows.flat().map((personId) => ({
          playerCode: codeFor(personId),
          personId,
          name: `Player ${String(personId)}`,
          shirt: null,
          captain: false,
          positionInfo: roles[personId] ?? null,
          position: null,
          nationality: null,
          country: null,
        })),
        substitutes: [],
      },
    ],
  }) as unknown as MatchDetail;

describe('buildNamedShapes', () => {
  const matches = [
    match(1, '2026-04-01T14:00:00Z', '2025/26'),
    match(2, '2025-08-10T14:00:00Z', '2025/26'),
  ];

  it('places a player by his person id, from his player code', () => {
    const shapes = buildNamedShapes(matches, new Map([[1, detail(1, ROWS_442)]]));
    const found = shapes.forPlayer(codeFor(7002), 1);
    assert.ok(found !== null);
    assert.equal(found.personId, 7002);
    // And that id resolves to the right back's slot, which is the whole point.
    assert.deepEqual(slotOf(found.formationRows, found.personId ?? 0), {
      lateral: 0.875,
      advancement: 0,
    });
  });

  it('takes the newest sheet that named the player', () => {
    const older: readonly (readonly number[])[] = [[7001], [7020, 7021, 7022], [7023, 7024]];
    const shapes = buildNamedShapes(
      matches,
      new Map([
        [1, detail(1, ROWS_442)],
        [2, detail(2, older)],
      ]),
    );
    const found = shapes.forPlayer(codeFor(7023), 1);
    assert.ok(found !== null);
    assert.equal(found.season, '2025/26');
    assert.equal(found.gameweek, 5);
    assert.deepEqual(found.formationRows, older);
  });

  it('takes the role he started in most often, not the one he started in last', () => {
    const shapes = buildNamedShapes(
      matches,
      new Map([
        [1, detail(1, ROWS_442, { 7002: 'Centre Central Defender' })],
        [2, detail(2, ROWS_442, { 7002: 'Right Full Back' })],
      ]),
    );
    // Two matches, one label each: the tie resolves to the most recent.
    assert.equal(shapes.forPlayer(codeFor(7002), 1)?.role, 'Centre Central Defender');

    const third = match(3, '2025-09-10T14:00:00Z', '2025/26');
    const withMajority = buildNamedShapes(
      [...matches, third],
      new Map([
        [1, detail(1, ROWS_442, { 7002: 'Centre Central Defender' })],
        [2, detail(2, ROWS_442, { 7002: 'Right Full Back' })],
        [3, detail(3, ROWS_442, { 7002: 'Right Full Back' })],
      ]),
    );
    const found = withMajority.forPlayer(codeFor(7002), 1);
    assert.equal(found?.role, 'Right Full Back');
    assert.equal(found?.roleStarts, 2);
    assert.equal(found?.roleOf, 3);
  });

  it('falls back to the club last shape for a player no sheet names', () => {
    const shapes = buildNamedShapes(matches, new Map([[1, detail(1, ROWS_442)]]));
    const found = shapes.forPlayer(999999, 1);
    assert.ok(found !== null);
    assert.deepEqual(found.formationRows, ROWS_442);
    // The club's shape places nobody in particular, so there is no person id
    // and no role: the estimate falls to his position, and says so.
    assert.equal(found.personId, null);
    assert.equal(found.role, null);
  });

  it('has nothing for a club with no stored teamsheet', () => {
    assert.equal(
      buildNamedShapes(matches, new Map([[1, detail(1, ROWS_442)]])).forPlayer(1, 77),
      null,
    );
  });
});
