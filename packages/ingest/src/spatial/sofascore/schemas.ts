import { z } from 'zod';

/**
 * Raw Sofascore API shapes. Unknown keys are stripped rather than rejected, for
 * the same reason as fpl/schemas.ts: the provider adds fields without notice,
 * and a strict schema would turn that into an outage. Everything this adapter
 * does not need for identity is nullish, since a mid season payload legitimately
 * omits measures the provider never collected for that match.
 */

/** A counter that may simply be absent for a player, which is not the same as zero. */
const measure = z.number().nullish();

export const sofascorePlayerSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  slug: z.string().nullish(),
  shortName: z.string().nullish(),
  position: z.string().nullish(),
  jerseyNumber: z.string().nullish(),
});

export type SofascorePlayer = z.infer<typeof sofascorePlayerSchema>;

export const sofascoreTeamSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  shortName: z.string().nullish(),
  nameCode: z.string().nullish(),
  slug: z.string().nullish(),
});

const sofascoreScoreSchema = z.object({
  current: z.number().int().nullish(),
  display: z.number().int().nullish(),
});

export const sofascoreEventSchema = z.object({
  id: z.number().int().positive(),
  slug: z.string().nullish(),
  /** Kickoff as unix seconds. */
  startTimestamp: z.number().int(),
  status: z
    .object({
      code: z.number().int().nullish(),
      type: z.string().nullish(),
      description: z.string().nullish(),
    })
    .nullish(),
  roundInfo: z.object({ round: z.number().int().nullish() }).nullish(),
  homeTeam: sofascoreTeamSchema,
  awayTeam: sofascoreTeamSchema,
  homeScore: sofascoreScoreSchema.nullish(),
  awayScore: sofascoreScoreSchema.nullish(),
  hasEventPlayerStatistics: z.boolean().nullish(),
  hasEventPlayerHeatMap: z.boolean().nullish(),
});

export type SofascoreEvent = z.infer<typeof sofascoreEventSchema>;

export const sofascoreEventsPageSchema = z.object({
  events: z.array(sofascoreEventSchema),
  hasNextPage: z.boolean().nullish(),
});

export type SofascoreEventsPage = z.infer<typeof sofascoreEventsPageSchema>;

/** /event/{id} wraps the same event shape the listing returns. */
export const sofascoreEventEnvelopeSchema = z.object({ event: sofascoreEventSchema });

/**
 * Per player match statistics. Only the counters this adapter maps are named;
 * the rest of the provider's block (rating components, normalised values) is
 * stripped, since nothing downstream reads it.
 */
export const sofascorePlayerStatisticsSchema = z.object({
  minutesPlayed: measure,
  touches: measure,
  totalPass: measure,
  accuratePass: measure,
  accurateOppositionHalfPasses: measure,
  totalOppositionHalfPasses: measure,
  keyPass: measure,
  totalShots: measure,
  onTargetScoringAttempt: measure,
  shotOffTarget: measure,
  blockedScoringAttempt: measure,
  goals: measure,
  goalAssist: measure,
  expectedGoals: measure,
  expectedAssists: measure,
  totalTackle: measure,
  wonTackle: measure,
  interceptionWon: measure,
  totalClearance: measure,
  outfielderBlock: measure,
  ballRecovery: measure,
  aerialWon: measure,
  aerialLost: measure,
  duelWon: measure,
  duelLost: measure,
  saves: measure,
  goalsPrevented: measure,
  ballCarriesCount: measure,
  totalBallCarriesDistance: measure,
  progressiveBallCarriesCount: measure,
  totalProgressiveBallCarriesDistance: measure,
  totalProgression: measure,
  kilometersCovered: measure,
  numberOfSprints: measure,
  topSpeed: measure,
  rating: measure,
});

export type SofascorePlayerStatistics = z.infer<typeof sofascorePlayerStatisticsSchema>;

export const sofascoreLineupPlayerSchema = z.object({
  player: sofascorePlayerSchema,
  /** Sofascore's own club id, present on every lineup row. */
  teamId: z.number().int().positive().nullish(),
  position: z.string().nullish(),
  substitute: z.boolean().nullish(),
  /** An unused substitute still carries a statistics block, just an empty one. */
  statistics: sofascorePlayerStatisticsSchema.nullish(),
});

export type SofascoreLineupPlayer = z.infer<typeof sofascoreLineupPlayerSchema>;

const sofascoreLineupSideSchema = z.object({
  formation: z.string().nullish(),
  players: z.array(sofascoreLineupPlayerSchema),
});

export const sofascoreLineupsSchema = z.object({
  confirmed: z.boolean().nullish(),
  home: sofascoreLineupSideSchema,
  away: sofascoreLineupSideSchema,
});

export type SofascoreLineups = z.infer<typeof sofascoreLineupsSchema>;

/** The provider ships a z component for shot coordinates; the domain is 2D. */
export const sofascoreCoordinatesSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number().nullish(),
});

export type SofascoreCoordinates = z.infer<typeof sofascoreCoordinatesSchema>;

export const sofascoreShotSchema = z.object({
  id: z.number().int(),
  player: sofascorePlayerSchema,
  isHome: z.boolean(),
  shotType: z.string().min(1),
  goalType: z.string().nullish(),
  situation: z.string().nullish(),
  bodyPart: z.string().nullish(),
  playerCoordinates: sofascoreCoordinatesSchema.nullish(),
  goalMouthCoordinates: sofascoreCoordinatesSchema.nullish(),
  goalMouthLocation: z.string().nullish(),
  blockCoordinates: sofascoreCoordinatesSchema.nullish(),
  xg: z.number().nullish(),
  xgot: z.number().nullish(),
  time: z.number().int().nullish(),
  addedTime: z.number().int().nullish(),
  timeSeconds: z.number().int().nullish(),
});

export type SofascoreShot = z.infer<typeof sofascoreShotSchema>;

export const sofascoreShotmapSchema = z.object({ shotmap: z.array(sofascoreShotSchema) });

export const sofascoreAveragePositionSchema = z.object({
  player: sofascorePlayerSchema,
  averageX: z.number(),
  averageY: z.number(),
  /** Samples behind the average. A handful of points is not a settled position. */
  pointsCount: z.number().int().nullish(),
});

export type SofascoreAveragePosition = z.infer<typeof sofascoreAveragePositionSchema>;

export const sofascoreAveragePositionsSchema = z.object({
  home: z.array(sofascoreAveragePositionSchema),
  away: z.array(sofascoreAveragePositionSchema),
});

export type SofascoreAveragePositions = z.infer<typeof sofascoreAveragePositionsSchema>;

export const sofascoreHeatmapPointSchema = z.object({ x: z.number(), y: z.number() });

export const sofascoreHeatmapSchema = z.object({
  heatmap: z.array(sofascoreHeatmapPointSchema),
});

export type SofascoreHeatmapPoint = z.infer<typeof sofascoreHeatmapPointSchema>;
