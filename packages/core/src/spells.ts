import { z } from 'zod';

/**
 * Who was in charge, and when.
 *
 * This exists because neither football provider in the lake can answer that
 * question. The Premier League's staff endpoint lists every registered official
 * carrying the role "Manager" with no start date to separate them, so a club
 * mid handover returns two active managers and no way to tell which one picks
 * the team; asked for a past season it returns whoever happened to sit in the
 * dugout for one match. The fixture detail payload carries no manager at all.
 *
 * A spell has dates, which is the whole point: the manager of a match is the
 * spell covering its kickoff, so the answer is a lookup rather than a guess,
 * and it is as available for a match in 1998 as for one next week.
 */
export const managerSpellSchema = z.object({
  /** FPL's permanent club code, so the row joins to everything else. */
  teamCode: z.number().int().positive(),
  teamName: z.string().min(1),
  /** The club's entity in the source that carries the dates. */
  clubEntityId: z.string().min(1),
  managerName: z.string().min(1),
  managerEntityId: z.string().min(1),
  /** Nationality where the source carries it, for a display line. */
  nationality: z.string().min(1).nullable(),
  from: z.coerce.date(),
  /** Null while the spell is open, which is what makes a manager current. */
  to: z.coerce.date().nullable(),
  /** Set where the source dates only a year, so a reader knows the day is inferred. */
  precision: z.enum(['day', 'month', 'year']),
});

export type ManagerSpell = z.infer<typeof managerSpellSchema>;

/**
 * The spell covering an instant, or null where none does.
 *
 * Overlapping spells are a fact of this data rather than a fault in it: a
 * caretaker's fortnight sits inside the gap between two permanent appointments,
 * and a source will sometimes date both to the same day. The shortest covering
 * spell wins, because a caretaker is by definition the shorter of the two and
 * is the one who actually took the match.
 */
export function managerAt(
  spells: readonly ManagerSpell[],
  teamCode: number,
  at: Date,
): ManagerSpell | null {
  const time = at.getTime();
  const covering = spells.filter((spell) => {
    if (spell.teamCode !== teamCode) return false;
    if (spell.from.getTime() > time) return false;
    return spell.to === null || spell.to.getTime() >= time;
  });
  if (covering.length === 0) return null;

  return covering.reduce((best, spell) =>
    lengthOf(spell, time) < lengthOf(best, time) ? spell : best,
  );
}

function lengthOf(spell: ManagerSpell, fallbackEnd: number): number {
  return (spell.to?.getTime() ?? fallbackEnd) - spell.from.getTime();
}

/** The club's current manager: the open spell, or the latest one that closed. */
export function currentManager(
  spells: readonly ManagerSpell[],
  teamCode: number,
): ManagerSpell | null {
  const forClub = spells.filter((spell) => spell.teamCode === teamCode);
  if (forClub.length === 0) return null;
  const open = forClub.filter((spell) => spell.to === null);
  const pool = open.length > 0 ? open : forClub;
  return pool.reduce((latest, spell) =>
    spell.from.getTime() > latest.from.getTime() ? spell : latest,
  );
}

export interface ManagerTenure {
  spell: ManagerSpell;
  /** Days between the spell opening and the instant asked about. */
  days: number;
  /** True inside the first five weeks, where a club's form breaks from its past. */
  newlyAppointed: boolean;
}

const NEW_MANAGER_DAYS = 35;

/**
 * How long the manager had been in the job, which is the feature that matters:
 * a club under a manager appointed nine days ago is not the club whose last six
 * results were recorded, and a model given only those results will say it is.
 */
export function tenureAt(
  spells: readonly ManagerSpell[],
  teamCode: number,
  at: Date,
): ManagerTenure | null {
  const spell = managerAt(spells, teamCode, at);
  if (spell === null) return null;
  const days = Math.max(0, (at.getTime() - spell.from.getTime()) / 86_400_000);
  return { spell, days, newlyAppointed: days <= NEW_MANAGER_DAYS };
}

/** Every spell for a club, newest first, for a club page or an audit. */
export function spellsFor(spells: readonly ManagerSpell[], teamCode: number): ManagerSpell[] {
  return spells
    .filter((spell) => spell.teamCode === teamCode)
    .sort((a, b) => b.from.getTime() - a.from.getTime());
}
