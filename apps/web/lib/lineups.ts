import 'server-only';
import type { Match, MatchDetail, Player } from '@fpl/core';
import { likelyStarters, quotaFor, selectionRecord, type SelectionMatch } from './selection';

export { selectionHistory } from './selection';
import type { DrawnSheet, SheetPerson } from '@/components/team-sheet';

/**
 * What a club is likely to put out, built from what it usually puts out.
 *
 * Nobody publishes a teamsheet before the referee gets it, so a page written
 * before kickoff has to say where its eleven came from. This one used to say
 * "the last eleven they named", and that was wrong for a reason anyone who
 * watches football knows: the last eleven is frequently a cup side. One
 * rotated Tuesday and the site predicted that team for a month, because a
 * single sheet cannot tell "this is the team" from "this was Tuesday".
 *
 * It is now a record: over the club's recent matches **in this competition**,
 * who starts, how recently, and how settled selection has been, from
 * `selection.ts`. Anyone unavailable is replaced and the replacement is named,
 * and the page prints how much to trust the whole thing, because a club
 * rotating through a European week is genuinely less predictable than one with
 * a free midweek and the number should say so rather than the eleven pretending
 * otherwise.
 */

export interface LikelyEleven {
  sheet: DrawnSheet;
  /** The newest match the record read, so the page can name it. */
  basis: Match | null;
  /** Names swapped out, and why, printed under the pitch. */
  replacements: { out: string; in: string | null; reason: string }[];
  /** True where no record existed at all and this is minutes alone. */
  fromScratch: boolean;
  /** Matches the record read, and how settled selection was across them. */
  read: number;
  /**
   * 0 to 1: how much of one eleven survives into the next, at this club.
   * Null below two matches, where there is nothing to compare.
   */
  confidence: number | null;
}

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

/**
 * The eleven a club is likely to start, and the reasoning behind every change
 * from the last one. `squad` is the club's current FPL players; `previous` is
 * the newest match detail the lake holds for them.
 */
/**
 * The eleven a club is likely to start, and the reasoning behind every change.
 *
 * `squad` is the club's current FPL players, `history` its recent teamsheets in
 * the competition being predicted, and `rotationRisk` how much football it is
 * about to play. The shape is the one the club names most often rather than the
 * one it named last, for the same reason the eleven is.
 */
export function likelyEleven(
  teamCode: number,
  teamName: string,
  squad: readonly Player[],
  history: readonly SelectionMatch[],
  options: { basis?: Match | null; rotationRisk?: number; competitionId?: number } = {},
): LikelyEleven {
  // Codes are branded upstream and plain numbers inside the record, so the map
  // is keyed on the plain number the record hands back.
  const byCode = new Map<number, Player>(squad.map((player) => [player.code, player]));
  const record = selectionRecord(history, options.competitionId ?? 1);

  const eleven = likelyStarters(record, {
    isAvailable: (code) => {
      const player = byCode.get(code);
      return player !== undefined && isAvailable(player);
    },
    positionOf: (code) => byCode.get(code)?.position ?? 'MID',
    pool: squad.map((player) => player.code),
    minutesOf: (code) => byCode.get(code)?.minutes ?? 0,
    ...(options.rotationRisk === undefined ? {} : { rotationRisk: options.rotationRisk }),
  });

  const replacements = eleven.changes.flatMap((change) => {
    const out = byCode.get(change.out);
    const incoming = change.in === null ? undefined : byCode.get(change.in);
    return [
      {
        // A departed player is not in FPL's list, so the teamsheet's own
        // spelling is the only name anyone has for him.
        out: out?.webName ?? record.players.get(change.out)?.name ?? `player ${String(change.out)}`,
        // Null where the shape shifted rather than a like for like swap: the
        // page says he is out and names nobody, which is what is known.
        in: incoming?.webName ?? null,
        reason:
          out === undefined
            ? 'no longer in the squad'
            : `${out.availability.replace('_', ' ')}${out.news === '' ? '' : `: ${out.news}`}`,
      },
    ];
  });

  // The shape the club usually names, filled band by band.
  //
  // A printed formation is bands, not FPL positions: 3-4-2-1 is three
  // defenders, six midfielders across two bands, and one forward, and FPL calls
  // a winger a midfielder. Matching each band against an FPL position drew the
  // second midfield band from whatever was left, which put a defender at centre
  // forward in every 3-4-2-1, the third most common shape in the record.
  const quota = quotaFor(record.formation);
  const bands = bandsOfFormation(record.formation);
  const byPosition = new Map<string, number[]>([
    ['GKP', []],
    ['DEF', []],
    ['MID', []],
    ['FWD', []],
  ]);
  for (const code of eleven.starters) {
    byPosition.get(byCode.get(code)?.position ?? 'MID')?.push(code);
  }

  // Where the eleven and the label disagree about how many of a line there
  // are, the eleven wins: it is who the club picks, and the label is a
  // description of it. The bands stretch to fit rather than dropping anyone.
  const counts = {
    GKP: 1,
    DEF: byPosition.get('DEF')?.length ?? quota.DEF,
    MID: byPosition.get('MID')?.length ?? quota.MID,
    FWD: byPosition.get('FWD')?.length ?? quota.FWD,
  };

  const rows: SheetPerson[][] = [];
  const draw = (code: number): SheetPerson | null => {
    const player = byCode.get(code);
    return player === undefined
      ? null
      : toPerson(
          player.webName,
          player.id,
          player.code,
          player,
          null,
          record.players.get(code)?.role ?? player.position,
        );
  };

  for (const band of bands) {
    const pool = byPosition.get(band.position) ?? [];
    // Each midfield band takes its share of the midfielders, in order.
    const share =
      band.position === 'MID'
        ? Math.max(1, Math.round((band.count / Math.max(1, quota.MID)) * counts.MID))
        : counts[band.position];
    const row = pool.splice(0, share).flatMap((code) => draw(code) ?? []);
    if (row.length > 0) rows.push(row);
  }

  // Anyone the bands could not place still starts: a row of their own beats
  // being dropped from an eleven the record actually named.
  const leftover = [
    ...(byPosition.get('DEF') ?? []),
    ...(byPosition.get('MID') ?? []),
    ...(byPosition.get('FWD') ?? []),
  ];
  if (leftover.length > 0) {
    rows.push(leftover.flatMap((code) => draw(code) ?? []));
  }

  const substitutes = eleven.bench.flatMap((code) => {
    const player = byCode.get(code);
    return player === undefined
      ? []
      : [toPerson(player.webName, player.id, player.code, player, null, player.position)];
  });

  return {
    sheet: {
      teamCode,
      teamName,
      formation: record.formation ?? '4-4-2',
      rows,
      substitutes,
    },
    basis: options.basis ?? null,
    replacements,
    fromScratch: record.matches === 0,
    read: record.matches,
    confidence: eleven.confidence,
  };
}

/** A printed formation as bands, keeper first, each band's own position named. */
function bandsOfFormation(
  formation: string | null,
): { position: 'GKP' | 'DEF' | 'MID' | 'FWD'; count: number }[] {
  const parts = (formation ?? '4-4-2').split('-').map((part) => Number(part.trim()));
  if (parts.some((part) => !Number.isInteger(part) || part <= 0)) {
    return [
      { position: 'GKP', count: 1 },
      { position: 'DEF', count: 4 },
      { position: 'MID', count: 4 },
      { position: 'FWD', count: 2 },
    ];
  }

  // A four band shape such as 4-2-3-1 has two midfield bands: everything
  // between the defenders and the last band is midfield, which is what the
  // label means and what a pitch shows.
  const bands: { position: 'GKP' | 'DEF' | 'MID' | 'FWD'; count: number }[] = [
    { position: 'GKP', count: 1 },
  ];
  parts.forEach((count, index) => {
    const position = index === 0 ? 'DEF' : index === parts.length - 1 ? 'FWD' : 'MID';
    bands.push({ position, count });
  });
  return bands;
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
