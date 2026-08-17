import { z } from 'zod';
import { gameweekIdSchema, playerCodeSchema, playerIdSchema, teamIdSchema } from './ids.js';

/**
 * Two unrelated things share the word transfer in this domain, so they are
 * modelled separately: a player moving between clubs, and FPL managers moving
 * a player in or out of their squads.
 */

export const TRANSFER_TYPES = ['permanent', 'loan', 'free', 'end_of_loan', 'unknown'] as const;
export type TransferType = (typeof TRANSFER_TYPES)[number];

export const clubTransferSchema = z.object({
  /** Player code, not id: ids are reassigned each season, codes are not. */
  playerCode: playerCodeSchema,
  playerName: z.string().min(1),
  /** Null when the club is outside the Premier League, which the domain does not id. */
  fromTeamId: teamIdSchema.nullable(),
  fromTeamName: z.string().min(1),
  toTeamId: teamIdSchema.nullable(),
  toTeamName: z.string().min(1),
  type: z.enum(TRANSFER_TYPES),
  /** Reported fee in whole pounds, null when undisclosed or a free move. */
  feeGbp: z.number().int().nonnegative().nullable(),
  announcedAt: z.coerce.date().nullable(),
  window: z.string().min(1),
  provider: z.string().min(1),
});

export type ClubTransfer = z.infer<typeof clubTransferSchema>;

/**
 * How FPL managers moved a player in one gameweek. Net flow leads price
 * changes, so this is the input to any price prediction.
 */
export const ownershipFlowSchema = z.object({
  playerId: playerIdSchema,
  gameweek: gameweekIdSchema,
  transfersIn: z.number().int().nonnegative(),
  transfersOut: z.number().int().nonnegative(),
  /** Share of active managers owning the player, as a percentage. */
  selectedByPercent: z.number().min(0).max(100),
  /** Price movement across the gameweek, in tenths. */
  priceChange: z.number().int(),
  capturedAt: z.coerce.date(),
});

export type OwnershipFlow = z.infer<typeof ownershipFlowSchema>;

export const netTransfers = (flow: OwnershipFlow): number => flow.transfersIn - flow.transfersOut;
