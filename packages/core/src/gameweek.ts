import { z } from 'zod';
import { gameweekIdSchema, playerIdSchema } from './ids.js';

export const gameweekSchema = z.object({
  id: gameweekIdSchema,
  name: z.string().min(1),
  deadline: z.coerce.date(),
  finished: z.boolean(),
  isCurrent: z.boolean(),
  isNext: z.boolean(),
  averageEntryScore: z.number().int().nonnegative(),
  highestScore: z.number().int().nonnegative().nullable(),
  mostCaptainedId: playerIdSchema.nullable(),
  /** Chips played this gameweek, keyed by chip name. */
  chipPlays: z.record(z.string(), z.number().int().nonnegative()),
});

export type Gameweek = z.infer<typeof gameweekSchema>;

export const currentGameweek = (gameweeks: readonly Gameweek[]): Gameweek | undefined =>
  gameweeks.find((gameweek) => gameweek.isCurrent);

export const nextGameweek = (gameweeks: readonly Gameweek[]): Gameweek | undefined =>
  gameweeks.find((gameweek) => gameweek.isNext);

/**
 * Where the reader stands in the season.
 *
 * A plan that begins at the gameweek in progress is planning a week nobody can
 * change: once the deadline passes, the squad is locked, the transfers are
 * spent, and the points are being scored rather than predicted. Treating that
 * week as an open decision was the single most misleading thing the planner
 * did, because every suggestion it made for it was unenterable.
 *
 * So the season is split at the deadline rather than at the results: the weeks
 * already locked, the week in progress if there is one, and the first week a
 * transfer can still be made in, which is where planning actually starts.
 */
export interface PlanningWindow {
  /**
   * The gameweek whose deadline has passed but which is not finished: the squad
   * is fixed and the points are part scored. Null between weeks.
   */
  locked: Gameweek | null;
  /** The first gameweek that can still be changed, which is where a plan opens. */
  from: Gameweek | null;
  /** Gameweeks already complete, oldest first. */
  played: Gameweek[];
}

/**
 * Split the season at the deadline.
 *
 * The deadline decides, not the `isCurrent` flag: FPL keeps a gameweek current
 * from its deadline until the last match is settled, which is exactly the
 * window where a plan must not offer a transfer, and it is also the window
 * where some of the week's points already exist.
 */
export function planningWindow(gameweeks: readonly Gameweek[], now: Date): PlanningWindow {
  const ordered = [...gameweeks].sort((a, b) => Number(a.id) - Number(b.id));

  const played = ordered.filter((week) => week.finished);
  const locked =
    ordered.find((week) => !week.finished && week.deadline.getTime() <= now.getTime()) ?? null;
  const from = ordered.find((week) => week.deadline.getTime() > now.getTime()) ?? null;

  return { locked, from, played };
}

/** Whether a gameweek's squad can still be changed. */
export function isChangeable(gameweek: Gameweek, now: Date): boolean {
  return gameweek.deadline.getTime() > now.getTime();
}
