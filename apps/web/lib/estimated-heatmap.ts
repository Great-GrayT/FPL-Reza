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
 * This half is the prior: the shape the club last named, which slot in that
 * shape this player filled, and his position, through the same geometry the
 * duel features use. It says where a left back stands, and it says the same
 * thing about every left back alive. What separates one from another is his
 * own record, and that is applied in `heatmap-lobes.ts`, which runs in the
 * browser so the figure can follow the gameweek ribbon.
 *
 * This file stays on the server because it needs the stored teamsheets, and
 * because `@fpl/model` pulls `@fpl/store`, and therefore `node:fs`, in behind
 * it. Nothing in a client component may import it.
 */

export type { EstimatedHeatmap, HeatmapBasis, HeatmapPrior, ShapeSource } from './heatmap-lobes';

export interface NamedShape extends ShapeSource {
  formationRows: readonly (readonly number[])[];
  formation: string | null;
}

/** A player's own slot in a formation, if the teamsheet named him in one. */
export function slotOf(
  formationRows: readonly (readonly number[])[],
  playerCode: number,
): { lateral: number; advancement: number } | null {
  const slots = slotsOf(formationRows);
  let index = 0;
  for (const row of formationRows) {
    for (const code of row) {
      if (code === playerCode) {
        const slot = slots[index];
        return slot === undefined
          ? null
          : { lateral: lateralOf(slot), advancement: advancementOf(slot) };
      }
      index += 1;
    }
  }
  return null;
}

/**
 * The shape a player was last named in, and the shape his club last named at
 * all, from one pass over every stored teamsheet.
 *
 * One pass rather than one per page: the alternative is 590 player pages each
 * walking 13,546 matches, which is the same answer computed six hundred times.
 * A player who has never been named in a stored teamsheet, which is most of a
 * squad in August, falls back to his club's last shape, so the estimate still
 * knows whether that club plays three at the back.
 */
export function buildNamedShapes(
  matches: readonly Match[],
  details: ReadonlyMap<number, MatchDetail>,
): { forPlayer: (playerCode: number, teamCode: number) => NamedShape | null } {
  const byPlayer = new Map<number, NamedShape>();
  const byTeam = new Map<number, NamedShape>();

  // Newest first: a shape from April says more than one from August.
  const ordered = [...matches].sort(
    (a, b) => (b.kickoff?.getTime() ?? 0) - (a.kickoff?.getTime() ?? 0),
  );

  for (const match of ordered) {
    const detail = details.get(match.matchId);
    if (detail === undefined) continue;
    for (const sheet of detail.sheets) {
      if (sheet.formationRows.length === 0) continue;
      const home = sheet.teamCode === match.homeTeamCode;
      const shape: NamedShape = {
        formationRows: sheet.formationRows,
        formation: sheet.formation,
        season: match.season,
        gameweek: match.round,
        opponent: home ? match.awayTeamName : match.homeTeamName,
      };
      if (!byTeam.has(sheet.teamCode)) byTeam.set(sheet.teamCode, shape);
      for (const row of sheet.formationRows) {
        for (const code of row) {
          if (!byPlayer.has(code)) byPlayer.set(code, shape);
        }
      }
    }
  }

  return {
    forPlayer: (playerCode, teamCode) => byPlayer.get(playerCode) ?? byTeam.get(teamCode) ?? null,
  };
}

/**
 * The role prior for one player: his slot where a teamsheet named him, his
 * position where none did, and the match the shape was read from either way,
 * so the figure carries a date like every other one on the site.
 */
export function estimatePrior(input: {
  position: Position;
  playerCode?: number;
  shape?: NamedShape | null;
}): HeatmapPrior {
  const shape = input.shape ?? null;
  const placed =
    shape === null || input.playerCode === undefined
      ? null
      : slotOf(shape.formationRows, input.playerCode);

  return priorFor({
    position: input.position,
    basis: placed === null ? 'position' : 'slot',
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
