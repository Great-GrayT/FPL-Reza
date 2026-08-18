import 'server-only';
import { SQUAD_QUOTA, type Match, type MatchDetail, type Player } from '@fpl/core';
import type { DrawnSheet, SheetPerson } from '@/components/team-sheet';

/**
 * What a club is likely to put out, built from what it last put out.
 *
 * Nobody publishes a teamsheet before the referee gets it, so a page written
 * before kickoff has to say where its eleven came from. This one is explicit:
 * it is the last eleven the club actually started, in the shape they started
 * in, with anyone who has since left the club or is unavailable removed and
 * replaced by the next player at that position by minutes played. That is a
 * statement about the past plus one rule, which a reader can argue with,
 * rather than a prediction that hides its reasoning.
 */

export interface LikelyEleven {
  sheet: DrawnSheet;
  /** The match the shape was taken from, so the page can name it. */
  basis: Match | null;
  /** Names swapped out, and why, printed under the pitch. */
  replacements: { out: string; in: string; reason: string }[];
  /** True where no previous teamsheet existed and this is minutes alone. */
  fromScratch: boolean;
}

const POSITION_ORDER = ['GKP', 'DEF', 'MID', 'FWD'] as const;

function toPerson(
  name: string,
  personId: number,
  playerCode: number | null,
  player: Player | undefined,
  shirt: number | null,
  positionInfo: string | null,
  captain = false,
): SheetPerson {
  return {
    personId,
    playerCode,
    playerId: player === undefined ? null : player.id,
    name: player?.webName ?? name,
    shirt,
    captain,
    positionInfo,
  };
}

const isAvailable = (player: Player): boolean =>
  player.availability === 'available' || player.availability === 'doubtful';

/** A club's players at one position, most minutes first. */
function poolFor(players: readonly Player[], position: string): Player[] {
  return players
    .filter((player) => player.position === position && isAvailable(player))
    .sort((a, b) => b.minutes - a.minutes || b.totalPoints - a.totalPoints);
}

/**
 * The eleven a club is likely to start, and the reasoning behind every change
 * from the last one. `squad` is the club's current FPL players; `previous` is
 * the newest match detail the lake holds for them.
 */
export function likelyEleven(
  teamCode: number,
  teamName: string,
  squad: readonly Player[],
  previous: { detail: MatchDetail; match: Match } | null,
): LikelyEleven {
  const byCode = new Map(squad.map((player) => [player.code, player]));
  const used = new Set<number>();
  const replacements: LikelyEleven['replacements'] = [];

  const sheet = previous?.detail.sheets.find((entry) => entry.teamCode === teamCode);

  if (sheet === undefined || sheet.formationRows.length === 0) {
    // No previous teamsheet: fall back to the squad's own minutes, in the
    // shape FPL itself assumes when it validates a starting eleven.
    const rows: SheetPerson[][] = [];
    const shape: Record<string, number> = { GKP: 1, DEF: 4, MID: 4, FWD: 2 };
    for (const position of POSITION_ORDER) {
      const wanted = shape[position] ?? 0;
      const pool = poolFor(squad, position).slice(0, wanted);
      rows.push(
        pool.map((player) =>
          toPerson(player.webName, player.id as number, player.code, player, null, position),
        ),
      );
      for (const player of pool) used.add(player.code);
    }

    const bench = squad
      .filter((player) => isAvailable(player) && !used.has(player.code))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, SQUAD_QUOTA.GKP + 2)
      .map((player) =>
        toPerson(player.webName, player.id as number, player.code, player, null, player.position),
      );

    return {
      sheet: { teamCode, teamName, formation: '4-4-2', rows, substitutes: bench },
      basis: null,
      replacements: [],
      fromScratch: true,
    };
  }

  const lineupByPerson = new Map(sheet.lineup.map((person) => [person.personId, person]));

  const rows: SheetPerson[][] = sheet.formationRows.map((band) =>
    band.flatMap((personId): SheetPerson[] => {
      const person = lineupByPerson.get(personId);
      if (person === undefined) return [];
      const player = person.playerCode === null ? undefined : byCode.get(person.playerCode);

      if (player !== undefined && isAvailable(player)) {
        used.add(player.code);
        return [
          toPerson(
            person.name,
            person.personId,
            person.playerCode,
            player,
            person.shirt,
            person.positionInfo,
            person.captain,
          ),
        ];
      }

      // Gone, or unavailable. The replacement is the next player at that
      // position by minutes who is not already in the eleven.
      const position = person.position ?? 'MID';
      const replacement = poolFor(squad, position).find((candidate) => !used.has(candidate.code));
      if (replacement === undefined) return [];
      used.add(replacement.code);
      replacements.push({
        out: person.name,
        in: replacement.webName,
        reason:
          player === undefined
            ? 'no longer in the squad'
            : `${player.availability.replace('_', ' ')}${player.news === '' ? '' : `: ${player.news}`}`,
      });
      return [
        toPerson(
          replacement.webName,
          replacement.id,
          replacement.code,
          replacement,
          person.shirt,
          person.positionInfo,
        ),
      ];
    }),
  );

  const substitutes = squad
    .filter((player) => isAvailable(player) && !used.has(player.code))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 9)
    .map((player) =>
      toPerson(player.webName, player.id as number, player.code, player, null, player.position),
    );

  return {
    sheet: { teamCode, teamName, formation: sheet.formation, rows, substitutes },
    basis: previous?.match ?? null,
    replacements,
    fromScratch: false,
  };
}

/** The confirmed teamsheet, where one exists, drawn the same way. */
export function confirmedSheet(
  detail: MatchDetail,
  teamCode: number,
  teamName: string,
  playersByCode: ReadonlyMap<number, Player>,
): DrawnSheet | null {
  const sheet = detail.sheets.find((entry) => entry.teamCode === teamCode);
  if (sheet === undefined) return null;

  const lineupByPerson = new Map(sheet.lineup.map((person) => [person.personId, person]));
  const rows: SheetPerson[][] =
    sheet.formationRows.length > 0
      ? sheet.formationRows.map((band) =>
          band.flatMap((personId): SheetPerson[] => {
            const person = lineupByPerson.get(personId);
            if (person === undefined) return [];
            return [
              toPerson(
                person.name,
                person.personId,
                person.playerCode,
                person.playerCode === null ? undefined : playersByCode.get(person.playerCode),
                person.shirt,
                person.positionInfo,
                person.captain,
              ),
            ];
          }),
        )
      : [
          sheet.lineup.map((person) =>
            toPerson(
              person.name,
              person.personId,
              person.playerCode,
              person.playerCode === null ? undefined : playersByCode.get(person.playerCode),
              person.shirt,
              person.positionInfo,
              person.captain,
            ),
          ),
        ];

  return {
    teamCode,
    teamName,
    formation: sheet.formation,
    rows,
    substitutes: sheet.substitutes.map((person) =>
      toPerson(
        person.name,
        person.personId,
        person.playerCode,
        person.playerCode === null ? undefined : playersByCode.get(person.playerCode),
        person.shirt,
        person.positionInfo,
        person.captain,
      ),
    ),
  };
}
