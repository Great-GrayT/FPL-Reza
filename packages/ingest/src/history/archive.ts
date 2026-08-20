import {
  asSeason,
  historicPlayerGameweekSchema,
  teamSeasonSchema,
  type HistoricPlayerGameweek,
  type Position,
  type TeamSeason,
} from '@fpl/core';
import { parseCsvObjects } from '../csv.js';
import type { HttpClient } from '../http.js';
import { DATASETS, type Source, type SourceBatch, type SourceContext } from '../source.js';

/**
 * Per gameweek history for completed seasons. FPL stops serving this the moment
 * a season closes: the element summary endpoint keeps only totals per past
 * season, so the gameweek grain has to come from an archive that captured it
 * while it was live. This reads the community archive at
 * github.com/vaastav/Fantasy-Premier-League, which has published a merged
 * gameweek file per season since 2016/17.
 *
 * The archive keys rows by that season's element id, which FPL reassigns every
 * summer, so every row is rekeyed to the permanent player code through the same
 * season's players_raw.csv before it is stored. A row whose code cannot be
 * resolved is counted and dropped, never guessed at.
 */

export const ARCHIVE_BASE_URL =
  'https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data';

/** The first season the archive published a merged gameweek file for. */
export const ARCHIVE_FIRST_SEASON = '2016/17';

export const archiveSeasonPath = (season: string): string => season.replace('/', '-');

export const archiveGameweeksUrl = (season: string, base = ARCHIVE_BASE_URL): string =>
  `${base}/${archiveSeasonPath(season)}/gws/merged_gw.csv`;

export const archivePlayersUrl = (season: string, base = ARCHIVE_BASE_URL): string =>
  `${base}/${archiveSeasonPath(season)}/players_raw.csv`;

export const archiveTeamsUrl = (season: string, base = ARCHIVE_BASE_URL): string =>
  `${base}/${archiveSeasonPath(season)}/teams.csv`;

const int = (value: string | undefined): number | null => {
  if (value === undefined || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
};

const num = (value: string | undefined): number | null => {
  if (value === undefined || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const nonNegative = (value: string | undefined): number => Math.max(0, int(value) ?? 0);

const text = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? null : trimmed;
};

/** The archive prints positions as GK, DEF, MID, FWD, and older files omit them. */
const POSITION_ALIASES: Readonly<Record<string, Position>> = {
  GK: 'GKP',
  GKP: 'GKP',
  DEF: 'DEF',
  MID: 'MID',
  FWD: 'FWD',
};

const toPosition = (value: string | undefined): Position | null => {
  const key = value?.trim().toUpperCase();
  if (key === undefined || key === '') return null;
  return POSITION_ALIASES[key] ?? null;
};

/**
 * Expected goals reach the archive only from 2022/23, the season FPL began
 * publishing them. Before that the columns are absent, and an absent column
 * must not become a zero.
 */
const XG_FROM_SEASON = 2022;

/**
 * The season's clubs, with both numbers: the id a gameweek row cites and the
 * permanent code everything else joins on. Without this the opponent named in a
 * 2018/19 row cannot be tied to the club that played it, because FPL renumbers
 * its team ids every summer.
 */
export function parseArchiveTeams(season: string, teamsCsv: string): TeamSeason[] {
  const rows: TeamSeason[] = [];
  for (const row of parseCsvObjects(teamsCsv)) {
    const teamId = int(row['id']);
    const teamCode = int(row['code']);
    const name = text(row['name']);
    if (teamId === null || teamCode === null || name === null) continue;
    rows.push(
      teamSeasonSchema.parse({
        season: asSeason(season),
        teamId,
        teamCode,
        name,
        shortName: text(row['short_name']) ?? name.slice(0, 3).toUpperCase(),
        strength: int(row['strength']),
        strengthOverallHome: int(row['strength_overall_home']),
        strengthOverallAway: int(row['strength_overall_away']),
        strengthAttackHome: int(row['strength_attack_home']),
        strengthAttackAway: int(row['strength_attack_away']),
        strengthDefenceHome: int(row['strength_defence_home']),
        strengthDefenceAway: int(row['strength_defence_away']),
      }),
    );
  }
  return rows;
}

/**
 * The season's clubs, derived from the player list, for the seasons before the
 * archive published a club table. Every player row carries the season's team id
 * and the permanent team code, so the pairing is there to be read; what is not
 * there is the club's name or FPL's strength ratings, which stay null.
 */
export function teamsFromPlayers(season: string, playersCsv: string): TeamSeason[] {
  const byId = new Map<number, number>();
  for (const row of parseCsvObjects(playersCsv)) {
    const teamId = int(row['team']);
    const teamCode = int(row['team_code']);
    if (teamId === null || teamCode === null) continue;
    byId.set(teamId, teamCode);
  }
  return [...byId.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([teamId, teamCode]) =>
      teamSeasonSchema.parse({
        season: asSeason(season),
        teamId,
        teamCode,
        name: `club ${String(teamCode)}`,
        shortName: String(teamCode),
        strength: null,
        strengthOverallHome: null,
        strengthOverallAway: null,
        strengthAttackHome: null,
        strengthAttackAway: null,
        strengthDefenceHome: null,
        strengthDefenceAway: null,
      }),
    );
}

/** code by that season's element id, read from the season's players_raw.csv. */
export function buildCodeIndex(playersCsv: string): Map<number, number> {
  const byElement = new Map<number, number>();
  for (const row of parseCsvObjects(playersCsv)) {
    const element = int(row['id']);
    const code = int(row['code']);
    if (element === null || code === null || code <= 0) continue;
    byElement.set(element, code);
  }
  return byElement;
}

export interface ArchiveParseResult {
  rows: HistoricPlayerGameweek[];
  /** Rows whose element id was not in that season's player list. */
  unresolved: number;
}

export function parseArchiveSeason(
  season: string,
  gameweeksCsv: string,
  codeByElement: Map<number, number>,
): ArchiveParseResult {
  const rows: HistoricPlayerGameweek[] = [];
  const measuresXg = Number(season.slice(0, 4)) >= XG_FROM_SEASON;
  let unresolved = 0;

  for (const row of parseCsvObjects(gameweeksCsv)) {
    const element = int(row['element']);
    const gameweek = int(row['GW']);
    const code = element === null ? null : (codeByElement.get(element) ?? null);
    if (code === null || gameweek === null || gameweek < 1) {
      unresolved += 1;
      continue;
    }

    rows.push(
      historicPlayerGameweekSchema.parse({
        playerCode: code,
        season: asSeason(season),
        gameweek,
        name: text(row['name']) ?? `player ${String(element)}`,
        position: toPosition(row['position']),
        team: text(row['team']),
        opponentTeam: int(row['opponent_team']),
        wasHome: row['was_home'] === undefined ? null : row['was_home'].toLowerCase() === 'true',
        kickoff: text(row['kickoff_time']),
        minutes: nonNegative(row['minutes']),
        totalPoints: int(row['total_points']) ?? 0,
        goals: nonNegative(row['goals_scored']),
        assists: nonNegative(row['assists']),
        cleanSheets: nonNegative(row['clean_sheets']),
        goalsConceded: nonNegative(row['goals_conceded']),
        ownGoals: nonNegative(row['own_goals']),
        penaltiesSaved: nonNegative(row['penalties_saved']),
        penaltiesMissed: nonNegative(row['penalties_missed']),
        yellowCards: nonNegative(row['yellow_cards']),
        redCards: nonNegative(row['red_cards']),
        saves: nonNegative(row['saves']),
        bonus: nonNegative(row['bonus']),
        bps: int(row['bps']) ?? 0,
        price: int(row['value']),
        selectedBy: int(row['selected']),
        expectedGoals: measuresXg ? num(row['expected_goals']) : null,
        expectedAssists: measuresXg ? num(row['expected_assists']) : null,
        expectedGoalsConceded: measuresXg ? num(row['expected_goals_conceded']) : null,
        // The ICT family is in every archive season, including the ones before
        // expected goals existed, so it is the only measure of shot volume and
        // location the lake can reach for 2016/17 through 2021/22.
        influence: num(row['influence']),
        creativity: num(row['creativity']),
        threat: num(row['threat']),
        ictIndex: num(row['ict_index']),
        expectedPoints: num(row['xP']),
      }),
    );
  }

  return { rows, unresolved };
}

/** What the lake already holds, so a partial run adds rather than replaces. */
async function readStoredTeamSeasons(context: SourceContext): Promise<TeamSeason[]> {
  try {
    return await context.store.read<TeamSeason>(
      { season: context.season, dataset: DATASETS.teamSeasons },
      teamSeasonSchema,
    );
  } catch {
    return [];
  }
}

export interface ArchiveSourceOptions {
  /** Seasons to pull, newest or oldest first does not matter. */
  seasons: readonly string[];
  /** Override for a mirror or a local copy. */
  baseUrl?: string;
}

/**
 * One batch per season, partitioned by season, so a backfill can add a season
 * without rewriting the others. Completed seasons never change, which is why
 * this belongs in a one off backfill rather than in the nightly sync.
 */
export function archiveHistorySource(http: HttpClient, options: ArchiveSourceOptions): Source {
  const base = options.baseUrl ?? ARCHIVE_BASE_URL;

  return {
    name: 'history-archive',
    datasets: [DATASETS.playerGameweeksHistory, DATASETS.teamSeasons],

    async *run(context: SourceContext): AsyncIterable<SourceBatch> {
      const teamSeasons: TeamSeason[] = [];

      for (const season of options.seasons) {
        const playersCsv = await http.getText(archivePlayersUrl(season, base));
        const codeByElement = buildCodeIndex(playersCsv);

        // The club table is two hundred rows across ten seasons, so it is
        // gathered across the run and written once rather than partitioned.
        // The archive only published teams.csv from 2019/20, so the seasons
        // before it fall back to the player list, which carries both the id and
        // the code on every row and therefore answers the same question without
        // the strength ratings.
        let teamsForSeason: TeamSeason[] = [];
        try {
          teamsForSeason = parseArchiveTeams(
            season,
            await http.getText(archiveTeamsUrl(season, base)),
          );
        } catch {
          teamsForSeason = teamsFromPlayers(season, playersCsv);
          context.logger.info('teams read from the player list', {
            source: 'history-archive',
            season,
            teams: teamsForSeason.length,
          });
        }
        teamSeasons.push(...teamsForSeason);

        const gameweeksCsv = await http.getText(archiveGameweeksUrl(season, base));
        const { rows, unresolved } = parseArchiveSeason(season, gameweeksCsv, codeByElement);

        context.logger.info('archive season parsed', {
          source: 'history-archive',
          season,
          players: codeByElement.size,
          rows: rows.length,
          unresolvedRows: unresolved,
        });

        yield {
          dataset: DATASETS.playerGameweeksHistory,
          partition: archiveSeasonPath(season),
          rows,
        };
      }

      if (teamSeasons.length > 0) {
        // The club table is one dataset rather than one partition per season,
        // and a read takes the newest snapshot whole, so a run covering three
        // seasons must not erase the other seven. Stored rows are carried
        // through and the run's own rows win where both describe a season.
        const merged = new Map<string, TeamSeason>();
        for (const row of await readStoredTeamSeasons(context)) {
          merged.set(`${row.season}:${String(row.teamId)}`, row);
        }
        for (const row of teamSeasons) {
          merged.set(`${row.season}:${String(row.teamId)}`, row);
        }
        yield {
          dataset: DATASETS.teamSeasons,
          rows: [...merged.values()].sort((a, b) =>
            a.season === b.season ? a.teamId - b.teamId : a.season.localeCompare(b.season),
          ),
          format: 'jsonl',
        };
      }
    },
  };
}
