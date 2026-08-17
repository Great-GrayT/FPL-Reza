import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fixtureSchema, type Fixture } from '@fpl/core';
import { diffFixtures, summariseFixtureChange } from './diff.js';

const base = {
  id: 1,
  gameweek: 1,
  kickoff: '2026-08-21T19:00:00.000Z',
  homeTeam: 1,
  awayTeam: 2,
  homeScore: null,
  awayScore: null,
  finished: false,
  started: false,
  homeDifficulty: 3,
  awayDifficulty: 3,
};

const fixture = (overrides: Partial<Record<string, unknown>> = {}): Fixture =>
  fixtureSchema.parse({ ...base, ...overrides });

describe('diffFixtures', () => {
  it('reports a first fetch as one addition rather than 380 of them', () => {
    const diff = diffFixtures(undefined, [fixture(), fixture({ id: 2 })]);
    assert.equal(diff.changed, true);
    assert.equal(diff.added, 2);
    assert.equal(diff.changes.length, 1);
  });

  it('sees no change in an identical list', () => {
    const before = [fixture(), fixture({ id: 2 })];
    const diff = diffFixtures(before, [fixture(), fixture({ id: 2 })]);
    assert.equal(diff.changed, false);
    assert.deepEqual(diff.changes, []);
  });

  it('names the fixture and the field when a kickoff moves', () => {
    const diff = diffFixtures([fixture()], [fixture({ kickoff: '2026-08-22T16:30:00.000Z' })]);

    assert.equal(diff.updated, 1);
    assert.equal(diff.changes.length, 1);
    const change = diff.changes[0];
    assert.ok(change !== undefined);
    assert.equal(change.field, 'kickoff');
    assert.equal(change.before, '2026-08-21T19:00:00.000Z');
    assert.equal(change.after, '2026-08-22T16:30:00.000Z');
    assert.equal(
      summariseFixtureChange(change),
      'fixture 1 kickoff changed from 2026-08-21T19:00:00.000Z to 2026-08-22T16:30:00.000Z',
    );
  });

  it('renders a postponement as a gameweek moving to none', () => {
    const diff = diffFixtures([fixture()], [fixture({ gameweek: null, kickoff: null })]);
    const fields = diff.changes.map((change) => `${change.field ?? ''}:${change.after ?? ''}`);
    assert.deepEqual(fields, ['gameweek:none', 'kickoff:none']);
  });

  it('reports a live score landing as several field changes on one fixture', () => {
    const diff = diffFixtures(
      [fixture()],
      [fixture({ homeScore: 2, awayScore: 1, started: true, finished: true })],
    );
    assert.equal(diff.updated, 1);
    assert.equal(diff.changes.length, 4);
  });

  it('counts an added and a removed fixture separately', () => {
    const diff = diffFixtures([fixture()], [fixture({ id: 2 })]);
    assert.equal(diff.added, 1);
    assert.equal(diff.removed, 1);
    assert.equal(diff.updated, 0);
  });
});
