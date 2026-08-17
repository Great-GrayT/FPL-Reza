import {
  buildHeatmap,
  matchEventSchema,
  playerMatchSpatialSchema,
  zoneOf,
  PITCH_MAX,
  PITCH_MIN,
  type FixtureId,
  type MatchEvent,
  type Phase,
  type PlayerId,
  type PlayerMatchSpatial,
  type Point,
  type TeamId,
} from '@fpl/core';
import type {
  SofascoreAveragePosition,
  SofascoreCoordinates,
  SofascoreHeatmapPoint,
  SofascoreLineupPlayer,
  SofascorePlayerStatistics,
  SofascoreShot,
} from './schemas.js';

export const SOFASCORE_PROVIDER = 'sofascore';

/**
 * Coordinate conventions, established from the 2026-05-24 Crystal Palace versus
 * Arsenal payloads rather than from documentation, which the provider does not
 * publish.
 *
 * Average positions and heatmaps share one frame: x already runs 0 at the
 * team's own goal to 100 at the goal it attacks (both goalkeepers sit at x of
 * about 11), so the attacking axis matches the domain already. The lateral axis
 * does not: left sided players sit high (Mitchell, a left back, at y 80.3) and
 * right sided players sit low (Munoz, a right back, at y 14.8), while the
 * domain's channels name y 0 as the attacking team's left. So y is flipped.
 *
 * The shot frame is that same frame rotated 180 degrees: x is the distance from
 * the goal being attacked (a headed goal from six yards reads x 6.4, the goal
 * line reads x 0), and the lateral axis is consequently reversed relative to
 * average positions, which the shooters confirm (Madueke, a right winger with
 * an average y of 17.3, shoots from y 68 to 72; Eze, playing left, shoots from
 * y 43.6). So a shot needs its x flipped and its y left alone.
 */
const clamp = (value: number): number => Math.min(PITCH_MAX, Math.max(PITCH_MIN, value));

/** Average position and heatmap frame to the domain frame. */
export const fromTeamFrame = (point: { x: number; y: number }): Point => ({
  x: clamp(point.x),
  y: clamp(PITCH_MAX - point.y),
});

/** Shot frame to the domain frame. */
export const fromShotFrame = (point: SofascoreCoordinates): Point => ({
  x: clamp(PITCH_MAX - point.x),
  y: clamp(point.y),
});

/**
 * A count the provider omitted stays null: null means "not carried", which is
 * distinct from a measured zero. Rounding guards against a provider float in an
 * integer field, which would otherwise fail the row rather than the value.
 */
const count = (value: number | null | undefined): number | null =>
  value === null || value === undefined ? null : Math.max(0, Math.round(value));

const amount = (value: number | null | undefined): number | null =>
  value === null || value === undefined ? null : Math.max(0, value);

/** Provider situation to the domain's phase vocabulary. */
export function phaseOfSituation(situation: string | null | undefined): Phase {
  if (situation === null || situation === undefined || situation === '') return 'unknown';
  const key = situation.toLowerCase();
  if (key.includes('set-piece') || key.includes('corner') || key.includes('free-kick')) {
    return 'set_piece_attacking';
  }
  if (key.includes('penalty')) return 'set_piece_attacking';
  if (key.includes('fast-break') || key.includes('counter')) return 'transition_to_attack';
  return 'attack';
}

export interface PlayerSpatialInput {
  playerId: PlayerId;
  fixtureId: FixtureId;
  teamId: TeamId;
  lineup: SofascoreLineupPlayer;
  /** Raw heatmap points in the provider's frame, or null when it holds none. */
  heatmap?: readonly SofascoreHeatmapPoint[] | null | undefined;
  averagePosition?: SofascoreAveragePosition | null | undefined;
}

/** Counts per zone, from the heatmap samples the provider exposes per player. */
export function touchesByZone(points: readonly Point[]): Record<string, number> {
  const zones: Record<string, number> = {};
  for (const point of points) {
    const key = zoneOf(point);
    zones[key] = (zones[key] ?? 0) + 1;
  }
  return zones;
}

export function toPlayerMatchSpatial(input: PlayerSpatialInput): PlayerMatchSpatial {
  const stats: SofascorePlayerStatistics = input.lineup.statistics ?? {};
  const points = (input.heatmap ?? []).map(fromTeamFrame);
  // Heatmap samples are the provider's positional sampling, not a touch log, so
  // they describe where a player was rather than where the ball was played.
  const hasPoints = points.length > 0;

  return playerMatchSpatialSchema.parse({
    playerId: input.playerId,
    fixtureId: input.fixtureId,
    teamId: input.teamId,
    provider: SOFASCORE_PROVIDER,
    minutes: Math.min(120, count(stats.minutesPlayed) ?? 0),

    averagePosition:
      input.averagePosition === null || input.averagePosition === undefined
        ? null
        : fromTeamFrame({ x: input.averagePosition.averageX, y: input.averagePosition.averageY }),
    heatmap: hasPoints ? buildHeatmap(points) : null,
    touchesByZone: hasPoints ? touchesByZone(points) : null,
    touchesByPhase: null,

    touches: count(stats.touches),
    passesAttempted: count(stats.totalPass),
    passesCompleted: count(stats.accuratePass),
    // The provider reports progression as a distance mixing passes and carries,
    // so there is no pass only progressive count to map.
    progressivePasses: null,
    progressiveCarries: count(stats.progressiveBallCarriesCount),
    carryDistanceM: amount(stats.totalBallCarriesDistance),
    shots: count(stats.totalShots),
    shotsOnTarget: count(stats.onTargetScoringAttempt),
    touchesInBox: null,

    tackles: count(stats.totalTackle),
    interceptions: count(stats.interceptionWon),
    clearances: count(stats.totalClearance),
    blocks: count(stats.outfielderBlock),
    recoveries: count(stats.ballRecovery),
    pressures: null,
    aerialsWon: count(stats.aerialWon),
    defensiveActionsByThird: null,

    distanceKm: amount(stats.kilometersCovered),
    sprints: count(stats.numberOfSprints),
    topSpeedKmh: amount(stats.topSpeed),
  });
}

export interface MatchEventInput {
  fixtureId: FixtureId;
  teamId: TeamId;
  playerId: PlayerId | null;
  shot: SofascoreShot;
}

export function toMatchEvent(input: MatchEventInput): MatchEvent {
  const shot = input.shot;
  const minute = (shot.time ?? 0) + (shot.addedTime ?? 0);

  return matchEventSchema.parse({
    fixtureId: input.fixtureId,
    provider: SOFASCORE_PROVIDER,
    providerEventId: String(shot.id),
    playerId: input.playerId,
    teamId: input.teamId,
    minute: Math.min(120, Math.max(0, minute)),
    second:
      shot.timeSeconds === null || shot.timeSeconds === undefined ? null : shot.timeSeconds % 60,
    type: `shot_${shot.shotType}`,
    // The phase mapping flattens several provider situations into one bucket,
    // so the raw token is kept rather than lost.
    outcome: shot.situation ?? null,
    phase: phaseOfSituation(shot.situation),
    location:
      shot.playerCoordinates === null || shot.playerCoordinates === undefined
        ? null
        : fromShotFrame(shot.playerCoordinates),
    // Where the ball crossed the goal line, which is what a shot's destination
    // means here. A block point exists on some rows but the domain has no slot.
    endLocation:
      shot.goalMouthCoordinates === null || shot.goalMouthCoordinates === undefined
        ? null
        : fromShotFrame(shot.goalMouthCoordinates),
    bodyPart: shot.bodyPart ?? null,
    expectedGoals: amount(shot.xg),
    // A shot row carries no expected assist value; the creator's is on the
    // lineup statistics block instead.
    expectedAssists: null,
  });
}
