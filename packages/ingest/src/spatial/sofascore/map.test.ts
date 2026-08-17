import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { asFixtureId, asPlayerId, asTeamId, thirdOf, zoneOf } from '@fpl/core';
import {
  sofascoreAveragePositionsSchema,
  sofascoreHeatmapSchema,
  sofascoreLineupsSchema,
  sofascoreShotmapSchema,
} from './schemas.js';
import {
  fromShotFrame,
  fromTeamFrame,
  phaseOfSituation,
  toMatchEvent,
  toPlayerMatchSpatial,
  touchesByZone,
} from './map.js';
import {
  SOFASCORE_AVERAGE_POSITIONS,
  SOFASCORE_HEATMAP,
  SOFASCORE_LINEUPS,
  SOFASCORE_SHOTMAP,
} from './fixture.test-data.js';

const lineups = sofascoreLineupsSchema.parse(SOFASCORE_LINEUPS);
const shots = sofascoreShotmapSchema.parse(SOFASCORE_SHOTMAP).shotmap;
const averages = sofascoreAveragePositionsSchema.parse(SOFASCORE_AVERAGE_POSITIONS);
const heatmap = sofascoreHeatmapSchema.parse(SOFASCORE_HEATMAP).heatmap;

const fixtureId = asFixtureId(101);
const teamId = asTeamId(7);
const playerId = asPlayerId(11);

const lineupNamed = (side: 'home' | 'away', name: string) => {
  const found = lineups[side].players.find((entry) => entry.player.name === name);
  assert.ok(found, `missing ${name}`);
  return found;
};

const shotBy = (name: string) => {
  const found = shots.find((shot) => shot.player.name === name);
  assert.ok(found, `missing shot by ${name}`);
  return found;
};

describe('coordinate normalisation', () => {
  it('keeps the attacking axis and flips the lateral axis for team frame points', () => {
    // A goalkeeper sits at x 11 in the provider's team frame, which is already
    // the domain's own goal end.
    const keeper = averages.home.find((entry) => entry.player.name === 'Dean Henderson');
    assert.ok(keeper);
    const point = fromTeamFrame({ x: keeper.averageX, y: keeper.averageY });
    assert.equal(thirdOf(point.x), 'defensive');
  });

  it('puts a left back in the left channel once y is flipped', () => {
    const leftBack = averages.home.find((entry) => entry.player.name === 'Tyrick Mitchell');
    assert.ok(leftBack);
    // The provider files left sided players high on y (80.3 here).
    assert.ok(leftBack.averageY > 50);
    assert.equal(
      zoneOf(fromTeamFrame({ x: leftBack.averageX, y: leftBack.averageY })),
      'middle:left',
    );
  });

  it('puts a right winger in a right channel once y is flipped', () => {
    const winger = averages.away.find((entry) => entry.player.name === 'Noni Madueke');
    assert.ok(winger);
    const point = fromTeamFrame({ x: winger.averageX, y: winger.averageY });
    assert.equal(zoneOf(point), 'attacking:right');
  });

  it('flips the shot frame onto the attacking goal', () => {
    // The provider measures a shot's x as distance from the goal it attacks.
    const goal = shotBy('Jean-Philippe Mateta');
    assert.ok(goal.playerCoordinates);
    assert.equal(goal.playerCoordinates.x, 6.4);
    const location = fromShotFrame(goal.playerCoordinates);
    assert.equal(location.x, 93.6);
    assert.equal(thirdOf(location.x), 'attacking');
  });

  it('lands a shot destination on the goal line', () => {
    const goal = shotBy('Jean-Philippe Mateta');
    assert.ok(goal.goalMouthCoordinates);
    assert.equal(fromShotFrame(goal.goalMouthCoordinates).x, 100);
  });

  it('agrees with the team frame about which side a shooter is on', () => {
    // Madueke is a right winger: his average position and his shots must land
    // on the same side of the pitch after each frame is normalised.
    const winger = averages.away.find((entry) => entry.player.name === 'Noni Madueke');
    const shot = shotBy('Noni Madueke');
    assert.ok(winger);
    assert.ok(shot.playerCoordinates);
    assert.ok(fromTeamFrame({ x: winger.averageX, y: winger.averageY }).y > 50);
    assert.ok(fromShotFrame(shot.playerCoordinates).y > 50);
  });

  it('clamps a value that falls outside the pitch', () => {
    assert.deepEqual(fromShotFrame({ x: -5, y: 120 }), { x: 100, y: 100 });
  });
});

describe('phaseOfSituation', () => {
  it('reads set pieces, breaks, and open play apart', () => {
    assert.equal(phaseOfSituation('corner'), 'set_piece_attacking');
    assert.equal(phaseOfSituation('throw-in-set-piece'), 'set_piece_attacking');
    assert.equal(phaseOfSituation('penalty'), 'set_piece_attacking');
    assert.equal(phaseOfSituation('fast-break'), 'transition_to_attack');
    assert.equal(phaseOfSituation('assisted'), 'attack');
    assert.equal(phaseOfSituation(null), 'unknown');
  });
});

describe('toPlayerMatchSpatial', () => {
  const hughes = toPlayerMatchSpatial({
    playerId,
    fixtureId,
    teamId,
    lineup: lineupNamed('home', 'Will Hughes'),
    heatmap,
    averagePosition: averages.home[0],
  });

  it('maps the provider counters onto the domain fields', () => {
    assert.equal(hughes.minutes, 90);
    assert.equal(hughes.touches, 43);
    assert.equal(hughes.passesAttempted, 31);
    assert.equal(hughes.passesCompleted, 26);
    assert.equal(hughes.distanceKm, 10.43);
    assert.equal(hughes.sprints, 2);
    assert.equal(hughes.topSpeedKmh, 30.77);
  });

  it('leaves a measure the provider does not carry as null, never as zero', () => {
    const keeper = toPlayerMatchSpatial({
      playerId,
      fixtureId,
      teamId,
      lineup: lineupNamed('home', 'Dean Henderson'),
      heatmap: null,
      averagePosition: null,
    });

    // The keeper's row has no tracking block at all in this match.
    assert.equal(keeper.distanceKm, null);
    assert.equal(keeper.sprints, null);
    assert.equal(keeper.topSpeedKmh, null);
    assert.equal(keeper.tackles, null);
    // A counter the provider did report as zero stays zero.
    assert.equal(keeper.shots, 0);
    assert.equal(keeper.progressiveCarries, 0);
    // Nothing in these endpoints carries these, so they are null by design.
    assert.equal(keeper.progressivePasses, null);
    assert.equal(keeper.touchesInBox, null);
    assert.equal(keeper.pressures, null);
    assert.equal(keeper.touchesByPhase, null);
  });

  it('builds a heatmap grid and its zone counts from the point list', () => {
    assert.ok(hughes.heatmap);
    assert.equal(hughes.heatmap.cols * hughes.heatmap.rows, hughes.heatmap.counts.length);
    assert.equal(
      hughes.heatmap.counts.reduce((sum, value) => sum + value, 0),
      heatmap.length,
    );
    assert.ok(hughes.touchesByZone);
    assert.equal(
      Object.values(hughes.touchesByZone).reduce((sum, value) => sum + value, 0),
      heatmap.length,
    );
  });

  it('has no heatmap when the provider holds none', () => {
    const none = toPlayerMatchSpatial({
      playerId,
      fixtureId,
      teamId,
      lineup: lineupNamed('away', 'Martín Zubimendi'),
      heatmap: null,
      averagePosition: null,
    });
    assert.equal(none.heatmap, null);
    assert.equal(none.touchesByZone, null);
    assert.equal(none.averagePosition, null);
  });

  it('treats an unused substitute as a zero minute row', () => {
    const unused = toPlayerMatchSpatial({
      playerId,
      fixtureId,
      teamId,
      lineup: lineupNamed('away', 'Tommy Setford'),
    });
    assert.equal(unused.minutes, 0);
    assert.equal(unused.touches, null);
  });
});

describe('touchesByZone', () => {
  it('counts one point per zone key', () => {
    const zones = touchesByZone([
      { x: 10, y: 10 },
      { x: 10, y: 12 },
      { x: 90, y: 90 },
    ]);
    assert.deepEqual(zones, { 'defensive:left': 2, 'attacking:right': 1 });
  });
});

describe('toMatchEvent', () => {
  const goal = toMatchEvent({
    fixtureId,
    teamId,
    playerId,
    shot: shotBy('Noni Madueke'),
  });

  it('names the event from the provider shot type and keeps the raw situation', () => {
    assert.equal(goal.type, 'shot_goal');
    // Scored from a corner, so the raw token survives and the phase is derived.
    assert.equal(goal.outcome, 'corner');
    assert.equal(goal.phase, 'set_piece_attacking');
    assert.equal(goal.provider, 'sofascore');
    assert.equal(goal.bodyPart, 'left-foot');
  });

  it('maps an open play shot to the attacking phase', () => {
    const open = toMatchEvent({ fixtureId, teamId, playerId, shot: shotBy('Christian Nørgaard') });
    assert.equal(open.type, 'shot_miss');
    assert.equal(open.phase, 'attack');
  });

  it('carries the provider event id for deduplication', () => {
    assert.equal(goal.providerEventId, String(shotBy('Noni Madueke').id));
  });

  it('takes expected goals from xg and leaves expected assists null', () => {
    assert.equal(goal.expectedGoals, shotBy('Noni Madueke').xg);
    assert.equal(goal.expectedAssists, null);
  });

  it('adds stoppage time into the minute and reads seconds from the clock', () => {
    const late = toMatchEvent({ fixtureId, teamId, playerId, shot: shotBy('Eberechi Eze') });
    // 90 plus 8 minutes, with the running clock at 5868 seconds.
    assert.equal(late.minute, 98);
    assert.equal(late.second, 48);
  });

  it('accepts a shot whose taker could not be resolved', () => {
    const anonymous = toMatchEvent({
      fixtureId,
      teamId,
      playerId: null,
      shot: shotBy('Gabriel Jesus'),
    });
    assert.equal(anonymous.playerId, null);
    assert.equal(anonymous.teamId, teamId);
  });
});
