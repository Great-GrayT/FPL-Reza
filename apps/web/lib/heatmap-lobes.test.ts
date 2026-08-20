import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { impliedShotDistance, impliedShotQuality } from '@fpl/model';
import {
  composeHeatmap,
  priorFor,
  selectWindow,
  shotDistanceMetres,
  shotQuality,
  type EvidenceRow,
  type HeatmapPrior,
} from './heatmap-lobes';

const row = (over: Partial<EvidenceRow> = {}): EvidenceRow => ({
  season: '2025/26',
  gameweek: 1,
  minutes: 90,
  threat: null,
  creativity: null,
  expectedGoals: null,
  expectedAssists: null,
  defensiveContribution: null,
  ...over,
});

/** `count` identical matches, numbered from gameweek 1 upwards. */
const season = (count: number, over: Partial<EvidenceRow> = {}): EvidenceRow[] =>
  Array.from({ length: count }, (_, index) => row({ ...over, gameweek: index + 1 }));

const centreOfMass = (grid: { cols: number; rows: number; counts: readonly number[] }) => {
  let mass = 0;
  let x = 0;
  let y = 0;
  grid.counts.forEach((value, index) => {
    mass += value;
    x += value * ((index % grid.cols) + 0.5);
    y += value * (Math.floor(index / grid.cols) + 0.5);
  });
  return { x: x / mass / grid.cols, y: y / mass / grid.rows };
};

describe('shot transforms', () => {
  it('match the ones the model fits on', () => {
    // Copied rather than imported, because this module is loaded in the
    // browser and @fpl/model's barrel pulls the store, and therefore node:fs,
    // in behind it. Copied means they can drift, so this is what stops them.
    for (const ratio of [0.004, 0.0093, 0.02, 0.1]) {
      assert.equal(shotQuality(ratio), impliedShotQuality(ratio));
      assert.equal(shotDistanceMetres(shotQuality(ratio)), impliedShotDistance(shotQuality(ratio)));
    }
  });

  it('put the median shooter around eighteen metres', () => {
    // The median of the 2025/26 archive is 0.0093 expected goals per unit of
    // threat, which is the number the reference rates below were read from.
    const distance = shotDistanceMetres(shotQuality(0.0093));
    assert.ok(distance > 17 && distance < 19, `median shooter at ${String(distance)} m`);
  });
});

describe('the window', () => {
  it('takes the newest matches when nothing is selected', () => {
    const chosen = selectWindow(season(20), null, 12);
    assert.equal(chosen.rows.length, 12);
    assert.equal(chosen.rows[0]?.gameweek, 9);
    assert.equal(chosen.fellBack, false);
  });

  it('ends the window at the selected gameweek', () => {
    const chosen = selectWindow(season(20), { season: '2025/26', gameweek: 10 }, 12);
    assert.equal(chosen.rows.at(-1)?.gameweek, 10);
  });

  it('skips a gameweek he did not play', () => {
    const rows = [row({ gameweek: 1 }), row({ gameweek: 2, minutes: 0 }), row({ gameweek: 3 })];
    assert.deepEqual(
      selectWindow(rows, null, 12).rows.map((entry) => entry.gameweek),
      [1, 3],
    );
  });

  it('falls back to the newest matches, and says so, when the selection is before any of them', () => {
    const chosen = selectWindow(season(20), { season: '2026/27', gameweek: 1 }, 12);
    assert.equal(chosen.fellBack, false, 'a later season is after them, not before');

    const early = selectWindow(
      season(20, { season: '2025/26' }),
      { season: '2024/25', gameweek: 3 },
      12,
    );
    assert.equal(early.fellBack, true);
    assert.equal(early.rows.length, 12);
  });
});

describe('the posterior', () => {
  const forward = (): HeatmapPrior => priorFor({ position: 'FWD' });
  const defender = (): HeatmapPrior => priorFor({ position: 'DEF' });

  it('is the prior when nothing was recorded', () => {
    const bare = composeHeatmap(forward(), [], null);
    assert.deepEqual(bare.lobes, []);
    assert.equal(bare.window, null);
    const mass = centreOfMass(bare);
    assert.ok(Math.abs(mass.x - forward().centreX) < 0.05, `x ${String(mass.x)}`);
    assert.ok(Math.abs(mass.y - 0.5) < 0.02, `y ${String(mass.y)}`);
  });

  it('pulls a shooter towards the goal he attacks', () => {
    const bare = centreOfMass(composeHeatmap(forward(), [], null));
    const shooting = composeHeatmap(
      forward(),
      season(12, { threat: 60, expectedGoals: 0.9 }),
      null,
    );
    assert.ok(
      centreOfMass(shooting).x > bare.x,
      'a shooter is further forward than his role alone',
    );
    assert.ok(shooting.lobes.some((lobe) => lobe.kind === 'shot'));
  });

  it('places a poacher nearer the goal than a shooter from range', () => {
    // Same volume of threat, different quality per unit of it: the first takes
    // his chances in the six yard box, the second from the edge.
    const close = composeHeatmap(forward(), season(12, { threat: 60, expectedGoals: 1.2 }), null);
    const far = composeHeatmap(forward(), season(12, { threat: 60, expectedGoals: 0.25 }), null);
    assert.ok(centreOfMass(close).x > centreOfMass(far).x);
  });

  it('sends a creator out into his own channel', () => {
    const wide = priorFor({ position: 'MID', lateral: 0.08 });
    const bare = centreOfMass(composeHeatmap(wide, [], null));
    const creating = centreOfMass(
      composeHeatmap(wide, season(12, { creativity: 45, expectedAssists: 0.4 }), null),
    );
    assert.ok(creating.y < bare.y, 'a left sided creator works further left, not further right');
  });

  it('pulls a defensive worker back towards his own goal', () => {
    const bare = centreOfMass(composeHeatmap(defender(), [], null));
    const working = centreOfMass(
      composeHeatmap(defender(), season(12, { defensiveContribution: 16 }), null),
    );
    assert.ok(working.x < bare.x);
  });

  it('barely moves for a player with two appearances', () => {
    const evidence = { threat: 60, expectedGoals: 0.9 };
    const bare = centreOfMass(composeHeatmap(forward(), [], null)).x;
    const thin = centreOfMass(composeHeatmap(forward(), season(2, evidence), null)).x;
    const full = centreOfMass(composeHeatmap(forward(), season(12, evidence), null)).x;
    assert.ok(thin - bare < (full - bare) / 2, 'two matches is not a season');
  });

  it('never moves a player outside the ground his role covers', () => {
    // The whole point of multiplying rather than adding: evidence redistributes
    // mass inside the range a role reaches and can never invent a new range. A
    // centre back who scores every header at every corner is still a centre back.
    const absurd = season(38, {
      threat: 10_000,
      expectedGoals: 300,
      creativity: 10_000,
      expectedAssists: 300,
    });
    const mass = centreOfMass(composeHeatmap(defender(), absurd, null));
    assert.ok(mass.x < 0.55, `a defender fed absurd attacking evidence sat at x ${String(mass.x)}`);
  });

  it('leaves a keeper where he stands, whatever he recorded', () => {
    const keeper = priorFor({ position: 'GKP' });
    const bare = centreOfMass(composeHeatmap(keeper, [], null));
    const busy = composeHeatmap(keeper, season(12, { threat: 40, creativity: 40 }), null);
    assert.deepEqual(busy.lobes, []);
    assert.ok(Math.abs(centreOfMass(busy).x - bare.x) < 0.01);
  });

  it('reports the window it read', () => {
    const posterior = composeHeatmap(forward(), season(20, { threat: 40 }), null);
    assert.equal(posterior.window?.matches, 12);
    assert.equal(posterior.window?.minutes, 12 * 90);
    assert.equal(posterior.window?.from?.gameweek, 9);
    assert.equal(posterior.window?.to?.gameweek, 20);
  });

  it('draws a grid a chart can take', () => {
    const posterior = composeHeatmap(forward(), season(12, { threat: 60, creativity: 20 }), null);
    assert.equal(posterior.counts.length, posterior.cols * posterior.rows);
    assert.ok(posterior.counts.every((value) => Number.isFinite(value) && value >= 0));
    assert.ok(Math.max(...posterior.counts) > 0);
    assert.ok(posterior.centreX > 0 && posterior.centreX < 1);
    assert.ok(posterior.centreY > 0 && posterior.centreY < 1);
  });
});
