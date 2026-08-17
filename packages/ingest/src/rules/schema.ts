import { z } from 'zod';

/**
 * Structured view of the published rules page. This is a scraped secondary
 * source: where it disagrees with the FPL API, the API wins. Its value is
 * change detection, since the page carries deadlines, chip windows, and
 * scoring values that the API never exposes.
 */

export const RULES_URL = 'https://fantasy.premierleague.com/en/help/rules';

export const deadlineEntrySchema = z.object({
  gameweek: z.number().int().min(1).max(38),
  /** Exactly as printed, e.g. "Fri 21 Aug 18:30". */
  label: z.string().min(1),
  /** Resolved to an instant using Europe/London, or null if unparseable. */
  deadline: z.coerce.date().nullable(),
});

export const pointsRowSchema = z.object({
  action: z.string().min(1),
  /** Null when the page prints a range, such as the 1 to 3 bonus points. */
  points: z.number().nullable(),
  raw: z.string().min(1),
});

export const chipRowSchema = z.object({
  name: z.string().min(1),
  effect: z.string().min(1),
});

export const phaseRowSchema = z.object({
  name: z.string().min(1),
  from: z.number().int().min(1).max(38),
  to: z.number().int().min(1).max(38),
});

export const sectionSchema = z.object({
  heading: z.string().min(1),
  level: z.number().int().min(1).max(6),
  text: z.string(),
});

export const rulesDocumentSchema = z.object({
  sourceUrl: z.string().url(),
  fetchedAt: z.coerce.date(),
  /** SHA 256 of the normalised text, so an unchanged page is cheap to detect. */
  checksum: z.string().length(64),
  /** Which extraction path produced this document. */
  parsedFrom: z.enum(['html', 'next-data', 'none']),
  sections: z.array(sectionSchema),
  deadlines: z.array(deadlineEntrySchema),
  scoring: z.array(pointsRowSchema),
  bps: z.array(pointsRowSchema),
  chips: z.array(chipRowSchema),
  phases: z.array(phaseRowSchema),
  /** Values pulled out of prose, null when the sentence could not be matched. */
  squad: z.object({
    size: z.number().int().nullable(),
    budgetTenths: z.number().int().nullable(),
    maxPerClub: z.number().int().nullable(),
  }),
  transfers: z.object({
    hitPoints: z.number().int().nullable(),
    maxStoredFreeTransfers: z.number().int().nullable(),
    maxPerGameweek: z.number().int().nullable(),
  }),
});

export type RulesDocument = z.infer<typeof rulesDocumentSchema>;
export type DeadlineEntry = z.infer<typeof deadlineEntrySchema>;
export type PointsRow = z.infer<typeof pointsRowSchema>;
export type PhaseRow = z.infer<typeof phaseRowSchema>;
export type ChipRow = z.infer<typeof chipRowSchema>;
