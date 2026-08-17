import { z } from 'zod';
import { teamIdSchema } from './ids.js';

export const teamSchema = z.object({
  id: teamIdSchema,
  /** Stable across seasons; `id` is renumbered every promotion cycle. */
  code: z.number().int().positive(),
  name: z.string().min(1),
  shortName: z.string().min(2).max(4),
  /** Null until FPL publishes ratings, which it does not do before a season opens. */
  strength: z.number().int().nullable(),
  strengthOverallHome: z.number().int(),
  strengthOverallAway: z.number().int(),
  /** Zero until the season opens, so treat 0 as unrated rather than as weakest. */
  strengthAttackHome: z.number().int(),
  strengthAttackAway: z.number().int(),
  strengthDefenceHome: z.number().int(),
  strengthDefenceAway: z.number().int(),
});

export type Team = z.infer<typeof teamSchema>;
