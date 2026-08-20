import type { Match, MatchDetail, Position } from '@fpl/core';
import { advancementOf, lateralOf, slotsOf } from '@fpl/model';
import { priorFor, type HeatmapPrior, type ShapeSource } from './heatmap-lobes';

/**
 * Where a player's role puts him, before his own record is read.
 *
 * A real heatmap comes from tracking data, one grid per player per match, and
 * this site has none: the provider that publishes it answers every request
 * with a challenge. So the choice was between an empty panel and a modelled
 * one, and an empty panel on the page where a reader has come to look at
 * movement is a page that has given up.
 *
 * This half is the prior: the role the provider names him in, the shape his
 * club last named, and his position, in that order of preference. It says
 * where a right back stands, and it says the same thing about every right back
 * alive. What separates one from another is his own record, applied in
 * `heatmap-lobes.ts`, which runs in the browser so the figure can follow the
 * gameweek ribbon.
 *
 * This file stays on the server because it needs the stored teamsheets, and
 * because `@fpl/model` pulls `@fpl/store`, and therefore `node:fs`, in behind
 * it. Nothing in a client component may import it.
 */

export type { EstimatedHeatmap, HeatmapBasis, HeatmapPrior, ShapeSource } from './heatmap-lobes';

export interface NamedShape extends ShapeSource {
  formationRows: readonly (readonly number[])[];
  formation: string | null;
  /**
   * This player's own person id in that sheet.
   *
   * `formationRows` holds person ids, not player codes: two numbering systems
   * from the same provider, and nothing about them collides loudly. Looking a
   * player up in the rows by his player code silently found nothing for every
   * player in the league, so the slot geometry never ran and every figure on
   * the site was the four bucket position fallback. Measured over 2025/26: 0 of
   * 8,360 lineup entries matched by player code, 8,360 of 8,360 by person id.
   * The id that indexes the rows is therefore carried beside them rather than
   * assumed at the call site.
   */
  personId: number | null;
  /** The provider's own words for the role he most often started in. */
  role: string | null;
  /** How many of the starts read carried that role, and how many were read. */
  roleStarts: number;
  roleOf: number;
}

/** How many recent starts the modal role is taken over. */
export const ROLE_WINDOW = 12;

/**
 * A player's slot in a formation, by the person id the rows are keyed on.
 *
 * The lateral is flipped, because the provider writes each row right to left
 * while the domain runs 0 at the left touchline. That is measured rather than
 * assumed: across every stored teamsheet, the 5,031 players it calls "Left
 * something" sit at a mean slot lateral of 0.736 and the 4,223 it calls "Right
 * something" at 0.240. Aligning the slot to the provider's own words is what
 * stops a right back being drawn on the left wing whenever his label carries no
 * side of its own.
 */
export function slotOf(
  formationRows: readonly (readonly number[])[],
  personId: number,
): { lateral: number; advancement: number } | null {
  const slots = slotsOf(formationRows);
  let index = 0;
  for (const row of formationRows) {
    for (const id of row) {
      if (id === personId) {
        const slot = slots[index];
        return slot === undefined
          ? null
          : { lateral: 1 - lateralOf(slot), advancement: advancementOf(slot) };
      }
      index += 1;
    }
  }
  return null;
}

/**
 * The role a player most often started in, over the starts that were read.
 *
 * The mode rather than the newest, because a role is a habit: a right back
 * played once at centre back is still a right back, and the newest sheet alone
 * would redraw him on the strength of one match. A tie goes to the most
 * recent, which is the only tiebreak that says anything.
 */
function modalRole(labels: readonly string[]): { role: string | null; starts: number; of: number } {
  if (labels.length === 0) return { role: null, starts: 0, of: 0 };
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);

  let best: string | null = null;
  let bestCount = 0;
  // `labels` is newest first, so a later entry never displaces an equal
  // earlier one and the tie resolves to the most recent by construction.
  for (const label of labels) {
    const count = counts.get(label) ?? 0;
    if (count > bestCount) {
      best = label;
      bestCount = count;
    }
  }
  return { role: best, starts: bestCount, of: labels.length };
}

/**
 * The shape a player was last named in, the role he usually starts in, and the
 * shape his club last named at all, from one pass over every stored teamsheet.
 *
 * One pass rather than one per page: the alternative is 590 player pages each
 * walking 13,546 matches, which is the same answer computed six hundred times.
 * A player no stored teamsheet names, which is most of a squad in August,
 * falls back to his club's last shape, so the estimate still knows whether
 * that club plays three at the back.
 */
export function buildNamedShapes(
  matches: readonly Match[],
  details: ReadonlyMap<number, MatchDetail>,
): { forPlayer: (playerCode: number, teamCode: number) => NamedShape | null } {
  interface Placed {
    formationRows: readonly (readonly number[])[];
    formation: string | null;
    season: string;
    gameweek: number | null;
    opponent: string | null;
    personId: number;
  }

  const placedByPlayer = new Map<number, Placed>();
  const rolesByPlayer = new Map<number, string[]>();
  const byTeam = new Map<number, NamedShape>();

  // Newest first: a shape from April says more than one from August, and the
  // role window reads the most recent starts rather than the first ever.
  const ordered = [...matches].sort(
    (a, b) => (b.kickoff?.getTime() ?? 0) - (a.kickoff?.getTime() ?? 0),
  );

  for (const match of ordered) {
    const detail = details.get(match.matchId);
    if (detail === undefined) continue;
    for (const sheet of detail.sheets) {
      if (sheet.formationRows.length === 0) continue;
      const home = sheet.teamCode === match.homeTeamCode;
      const season = match.season;
      const gameweek = match.round;
      const opponent = home ? match.awayTeamName : match.homeTeamName;

      if (!byTeam.has(sheet.teamCode)) {
        byTeam.set(sheet.teamCode, {
          formationRows: sheet.formationRows,
          formation: sheet.formation,
          season,
          gameweek,
          opponent,
          personId: null,
          role: null,
          roleStarts: 0,
          roleOf: 0,
        });
      }

      // Only a start says where a player plays. A substitute's twenty minutes
      // are a role the match had already shaped, and counting them would let a
      // striker's cameo at left back rewrite where he is drawn.
      for (const entry of sheet.lineup) {
        const code = entry.playerCode;
        if (code === null) continue;
        if (!placedByPlayer.has(code)) {
          placedByPlayer.set(code, {
            formationRows: sheet.formationRows,
            formation: sheet.formation,
            season,
            gameweek,
            opponent,
            personId: entry.personId,
          });
        }
        if (entry.positionInfo !== null) {
          const seen = rolesByPlayer.get(code) ?? [];
          if (seen.length < ROLE_WINDOW) {
            seen.push(entry.positionInfo);
            rolesByPlayer.set(code, seen);
          }
        }
      }
    }
  }

  const byPlayer = new Map<number, NamedShape>();
  for (const [code, placed] of placedByPlayer) {
    const modal = modalRole(rolesByPlayer.get(code) ?? []);
    byPlayer.set(code, {
      formationRows: placed.formationRows,
      formation: placed.formation,
      season: placed.season,
      gameweek: placed.gameweek,
      opponent: placed.opponent,
      personId: placed.personId,
      role: modal.role,
      roleStarts: modal.starts,
      roleOf: modal.of,
    });
  }

  return {
    forPlayer: (playerCode, teamCode) => byPlayer.get(playerCode) ?? byTeam.get(teamCode) ?? null,
  };
}

/**
 * The role prior for one player: the role the provider usually names him in,
 * his slot in the shape where it names none, his position where neither does,
 * and the match the shape was read from either way, so the figure carries a
 * date like every other one on the site.
 */
export function estimatePrior(input: {
  position: Position;
  shape?: NamedShape | null;
}): HeatmapPrior {
  const shape = input.shape ?? null;
  const placed = shape?.personId == null ? null : slotOf(shape.formationRows, shape.personId);

  return priorFor({
    position: input.position,
    ...(shape?.role == null
      ? {}
      : { role: shape.role, roleStarts: shape.roleStarts, roleOf: shape.roleOf }),
    ...(placed === null ? {} : { lateral: placed.lateral, advancement: placed.advancement }),
    // The shape dates the estimate, so it is carried even where it only
    // supplied the formation and the player's own position placed him.
    ...(shape === null
      ? {}
      : {
          formation: shape.formation,
          from: { season: shape.season, gameweek: shape.gameweek, opponent: shape.opponent },
        }),
  });
}
