import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_HEATMAP_COLS,
  DEFAULT_HEATMAP_ROWS,
  ZONE_KEYS,
  addToHeatmap,
  buildHeatmap,
  channelOf,
  defensiveActionCount,
  emptyHeatmap,
  heatmapSchema,
  thirdOf,
  zoneOf,
} from './spatial.js';

describe('pitch zones', () => {
  it('splits the attacking axis into thirds', () => {
    assert.equal(thirdOf(0), 'defensive');
    assert.equal(thirdOf(50), 'middle');
    assert.equal(thirdOf(99), 'attacking');
  });

  it('assigns the far edge to the last channel rather than overflowing', () => {
    assert.equal(channelOf(100), 'right');
    assert.equal(channelOf(0), 'left');
    assert.equal(channelOf(50), 'centre');
  });

  it('enumerates every third and channel combination', () => {
    assert.equal(ZONE_KEYS.length, 15);
    assert.ok(ZONE_KEYS.includes('attacking:centre'));
  });

  it('keys a point by third and channel', () => {
    assert.equal(zoneOf({ x: 90, y: 10 }), 'attacking:left');
  });
});

describe('heatmap', () => {
  it('starts empty at the declared size', () => {
    const grid = emptyHeatmap();
    assert.equal(grid.counts.length, DEFAULT_HEATMAP_COLS * DEFAULT_HEATMAP_ROWS);
    assert.equal(
      grid.counts.reduce((a, b) => a + b, 0),
      0,
    );
  });

  it('counts every point exactly once', () => {
    const grid = buildHeatmap([
      { x: 10, y: 10 },
      { x: 10, y: 10 },
      { x: 90, y: 90 },
    ]);
    assert.equal(
      grid.counts.reduce((a, b) => a + b, 0),
      3,
    );
  });

  it('clamps a point on the far edge into the last cell', () => {
    const grid = buildHeatmap([{ x: 100, y: 100 }], 4, 4);
    assert.equal(grid.counts.at(-1), 1);
  });

  it('adds without mutating the original grid', () => {
    const grid = emptyHeatmap(4, 4);
    const next = addToHeatmap(grid, { x: 50, y: 50 });
    assert.equal(
      grid.counts.reduce((a, b) => a + b, 0),
      0,
    );
    assert.equal(
      next.counts.reduce((a, b) => a + b, 0),
      1,
    );
  });

  it('rejects a grid whose counts do not match its dimensions', () => {
    assert.equal(heatmapSchema.safeParse({ cols: 2, rows: 2, counts: [1, 2, 3] }).success, false);
  });
});

describe('defensiveActionCount', () => {
  const actions = { clearances: 4, blocks: 1, interceptions: 3, tackles: 2, recoveries: 5 };

  it('excludes recoveries for defenders', () => {
    assert.equal(defensiveActionCount(actions, false), 10);
  });

  it('includes recoveries for midfielders and forwards', () => {
    assert.equal(defensiveActionCount(actions, true), 15);
  });

  it('treats a missing count as zero', () => {
    assert.equal(
      defensiveActionCount(
        { clearances: null, blocks: null, interceptions: 2, tackles: null, recoveries: null },
        true,
      ),
      2,
    );
  });
});
