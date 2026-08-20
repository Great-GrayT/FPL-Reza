/**
 * Who a player actually faces.
 *
 * A fixture difficulty rating says Liverpool are hard. It does not say that a
 * left winger is about to spend ninety minutes against a right back who has
 * been beaten for pace all season, which is the thing that decides whether he
 * returns. This module turns two teamsheets into that: for a player in a slot,
 * the opposing slots he is matched against, and how much of the duel each one
 * carries.
 *
 * The provider gives a formation as rows of player ids running from the
 * goalkeeper outwards, `[[GK], [RB, CB, CB, LB], [CM, CM], [RW, AM, LW], [ST]]`,
 * and a position letter per player. Nothing in it says which touchline a row
 * starts at, and it does not need to: both teamsheets come from the same
 * provider in the same convention, so a player at a fifth of the way across one
 * sheet meets whoever is four fifths of the way across the other. Mirroring is
 * exact up to a reflection that cancels.
 */

export interface Slot {
  /** Row index, 0 being the goalkeeper's row. */
  row: number;
  /** Position within the row, as the teamsheet lists it. */
  index: number;
  /** Players in that row, which is what makes the lateral position meaningful. */
  rowSize: number;
  /** Rows in the formation, including the goalkeeper's. */
  rows: number;
}

export interface Duel {
  slot: Slot;
  /**
   * Share of this player's duels the opposing slot accounts for, summing to one
   * across the returned slots.
   */
  weight: number;
}

/**
 * How far across the pitch a slot sits, from 0 at one touchline to 1 at the
 * other. A lone striker sits at 0.5; the wider of two sits at 0.25 and 0.75.
 */
export function lateralOf(slot: Slot): number {
  if (slot.rowSize <= 1) return 0.5;
  return (slot.index + 0.5) / slot.rowSize;
}

/**
 * How advanced a slot is, from 0 at the defensive line to 1 at the furthest
 * forward row. The goalkeeper is outside the scale rather than at the bottom of
 * it: including him puts the defensive line a third of the way up the pitch, so
 * a winger's mirrored target lands on the keeper and misses the full back he
 * actually plays against.
 */
export function advancementOf(slot: Slot): number {
  const outfieldRows = slot.rows - 1;
  if (outfieldRows <= 1) return slot.row === 0 ? 0 : 1;
  if (slot.row === 0) return 0;
  return (slot.row - 1) / (outfieldRows - 1);
}

/** Every slot a formation's rows describe, ready to be matched against. */
export function slotsOf(formationRows: readonly (readonly unknown[])[]): Slot[] {
  const rows = formationRows.length;
  return formationRows.flatMap((row, rowIndex) =>
    row.map((_, index) => ({ row: rowIndex, index, rowSize: row.length, rows })),
  );
}

/** Parse a printed formation such as "4-2-3-1" into its row sizes, keeper first. */
export function rowsOfLabel(label: string): number[] | null {
  const parts = label.split('-').map((part) => Number(part.trim()));
  if (parts.length < 2 || parts.some((part) => !Number.isInteger(part) || part <= 0)) return null;
  const outfield = parts.reduce((total, part) => total + part, 0);
  if (outfield !== 10) return null;
  return [1, ...parts];
}

export interface DuelOptions {
  /**
   * How far apart two slots may sit across the pitch and still be considered
   * matched, as a share of the pitch width. A back four covers a quarter of the
   * width each, so a quarter is the width of one player's zone.
   */
  lateralTolerance?: number;
  /**
   * How far apart in advancement two slots may sit and still be matched. A
   * winger meets the full back in front of him and, more loosely, the wide
   * midfielder tracking back, which is one row either side.
   */
  depthTolerance?: number;
  /**
   * Share below which a duel is dropped. A winger technically overlaps the far
   * side of a midfield four by a percent or two, and carrying that into a
   * feature is carrying noise.
   */
  minimumWeight?: number;
}

/**
 * A player owns the share of the width his row divides between its members, so
 * the lateral tolerance is read off the row rather than fixed: a quarter of the
 * pitch for one of four, a fifth for one of five.
 */
const LATERAL_FLOOR = 0.16;
/**
 * Wide enough to reach the band in front of the one directly opposite, which is
 * what puts a flat four's wide midfielder into a winger's duels alongside the
 * full back, and narrow enough that a defender never faces a defender.
 */
const DEFAULT_DEPTH = 0.55;
const DEFAULT_MINIMUM_WEIGHT = 0.03;

/**
 * The opposing slots a player is matched against, with weights.
 *
 * Depth is complementary: an attacker at 1.0 meets defenders at 0.0 in their
 * own frame, so the target advancement is one minus his own. Lateral position
 * is mirrored for the same reason a right winger meets a left back.
 *
 * A 4-3-3 winger comes back with essentially one opponent, the full back. The
 * same winger against a 4-4-2 comes back with two, the full back and the wide
 * midfielder, because a flat four puts a midfielder in the same channel at a
 * depth close enough to count. That is the behaviour this exists to produce.
 */
export function duelsFor(
  slot: Slot,
  opponentRows: readonly (readonly unknown[])[],
  options: DuelOptions = {},
): Duel[] {
  const depthTolerance = options.depthTolerance ?? DEFAULT_DEPTH;

  const lateral = lateralOf(slot);
  const advancement = advancementOf(slot);
  const targetLateral = 1 - lateral;
  const targetAdvancement = 1 - advancement;

  const scored = slotsOf(opponentRows)
    // The goalkeeper is nobody's direct opponent: he defends a goal, not a man.
    .filter((candidate) => candidate.row > 0)
    .map((candidate) => {
      const lateralTolerance =
        options.lateralTolerance ?? Math.max(LATERAL_FLOOR, 1 / candidate.rowSize);
      const lateralGap = Math.abs(lateralOf(candidate) - targetLateral);
      const depthGap = Math.abs(advancementOf(candidate) - targetAdvancement);
      if (lateralGap > lateralTolerance || depthGap > depthTolerance) return null;
      // A triangular kernel in each direction: dead centre counts fully, the
      // edge of tolerance counts for nothing, and the product is the overlap.
      const weight = (1 - lateralGap / lateralTolerance) * (1 - depthGap / depthTolerance);
      return weight > 0 ? { slot: candidate, weight } : null;
    })
    .filter((entry): entry is Duel => entry !== null);

  const total = scored.reduce((sum, entry) => sum + entry.weight, 0);
  if (total === 0) return [];

  const minimum = options.minimumWeight ?? DEFAULT_MINIMUM_WEIGHT;
  const kept = scored
    .map((entry) => ({ slot: entry.slot, weight: entry.weight / total }))
    .filter((entry) => entry.weight >= minimum);
  // Dropping the tail changes the denominator, so the survivors are normalised
  // again and the weights still answer "what share of his duels is this".
  const keptTotal = kept.reduce((sum, entry) => sum + entry.weight, 0);
  return kept
    .map((entry) => ({ slot: entry.slot, weight: entry.weight / keptTotal }))
    .sort((a, b) => b.weight - a.weight);
}

/**
 * The slot a player occupies on his own teamsheet, or null where the sheet does
 * not list him. Matching is by the id the row carries, never by name.
 */
export function slotOf(
  formationRows: readonly (readonly number[])[],
  playerCode: number,
): Slot | null {
  const rows = formationRows.length;
  for (let row = 0; row < rows; row += 1) {
    const entries = formationRows[row];
    if (entries === undefined) continue;
    const index = entries.indexOf(playerCode);
    if (index >= 0) return { row, index, rowSize: entries.length, rows };
  }
  return null;
}

/**
 * A coarse name for a slot, for a label and for grouping thin samples: a
 * player-versus-player duel is rare, but wide-attacker-versus-full-back is not.
 */
export function describeSlot(slot: Slot): string {
  const advancement = advancementOf(slot);
  const lateral = lateralOf(slot);
  const band =
    slot.row === 0
      ? 'keeper'
      : advancement <= 0.34
        ? 'defence'
        : advancement <= 0.67
          ? 'midfield'
          : 'attack';
  if (slot.row === 0) return 'keeper';
  const side = lateral < 0.33 ? 'left' : lateral > 0.67 ? 'right' : 'central';
  return `${side} ${band}`;
}

export interface DuelPair {
  /** The slot label on the player's own sheet. */
  slot: string;
  /** The slot label he is matched against, and its share of his duels. */
  against: string;
  weight: number;
}

/** Both sides of a duel as labels, which is the grain a model can actually fit. */
export function duelLabels(
  slot: Slot,
  opponentRows: readonly (readonly unknown[])[],
  options: DuelOptions = {},
): DuelPair[] {
  const own = describeSlot(slot);
  return duelsFor(slot, opponentRows, options).map((duel) => ({
    slot: own,
    against: describeSlot(duel.slot),
    weight: duel.weight,
  }));
}
