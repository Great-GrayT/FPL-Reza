import {
  historicPlayerGameweekSchema,
  managerSpellSchema,
  matchDetailSchema,
  matchSchema,
  teamSeasonSchema,
  type HistoricPlayerGameweek,
  type ManagerSpell,
  type Match,
  type MatchDetail,
  type Season,
  type TeamSeason,
} from '@fpl/core';
import type { Store } from '@fpl/store';

/**
 * Everything a feature builder needs, loaded once and indexed.
 *
 * The panel is 254,000 rows and the joins around it are all by a key the rows
 * do not carry: a stored gameweek names its opponent by that season's FPL team
 * id, which FPL renumbers every summer, and it names nothing at all about who
 * managed the club or what shape it played. This assembles those indexes once,
 * so a builder is a lookup rather than a scan.
 */

export interface PanelSources {
  /** Season the lake is filed under, not the season of a row. */
  season: Season;
  /** Archive seasons to load, newest last. */
  seasons: readonly string[];
}

export interface Panel {
  rows: HistoricPlayerGameweek[];
  /** The permanent club code for a season's FPL team id. */
  teamCodeOf: (season: string, teamId: number) => number | null;
  /** The club a row belongs to, resolved from its team name that season. */
  ownTeamCodeOf: (row: HistoricPlayerGameweek) => number | null;
  spells: ManagerSpell[];
  /** Matches by season, kickoff ordered, for form and rest days. */
  matches: Match[];
  /** Teamsheets by match id, for formations and duels. */
  detailOf: (matchId: number) => MatchDetail | null;
  /** Which archive seasons carry teamsheets, since only some do. */
  detailSeasons: Set<string>;
}

/** Season labels differ between the archive and the domain: 2024-25 and 2024/25. */
const toDomainSeason = (label: string): string => label.replace('-', '/');
const toArchiveSeason = (label: string): string => label.replace('/', '-');

async function readOrEmpty<T>(
  store: Store,
  season: Season,
  dataset: string,
  schema: Parameters<typeof store.read<T>>[1],
  partition?: string,
): Promise<T[]> {
  try {
    return await store.read<T>(
      { season, dataset, ...(partition === undefined ? {} : { partition }) },
      schema,
    );
  } catch {
    return [];
  }
}

export async function loadPanel(store: Store, sources: PanelSources): Promise<Panel> {
  const rows: HistoricPlayerGameweek[] = [];
  for (const season of sources.seasons) {
    rows.push(
      ...(await readOrEmpty<HistoricPlayerGameweek>(
        store,
        sources.season,
        'player-gameweeks-history',
        historicPlayerGameweekSchema,
        toArchiveSeason(season),
      )),
    );
  }

  const teamSeasons = await readOrEmpty<TeamSeason>(
    store,
    sources.season,
    'team-seasons',
    teamSeasonSchema,
  );
  const codeBySeasonId = new Map<string, number>();
  const codeBySeasonName = new Map<string, number>();
  for (const entry of teamSeasons) {
    codeBySeasonId.set(`${entry.season}:${String(entry.teamId)}`, entry.teamCode);
    codeBySeasonName.set(`${entry.season}:${normalise(entry.name)}`, entry.teamCode);
    codeBySeasonName.set(`${entry.season}:${normalise(entry.shortName)}`, entry.teamCode);
  }

  const spells = await readOrEmpty<ManagerSpell>(
    store,
    sources.season,
    'manager-spells',
    managerSpellSchema,
  );

  const matchPartitions = await store
    .partitions({ season: sources.season, dataset: 'matches' })
    .catch(() => [] as string[]);
  const wanted = new Set(sources.seasons.map(toArchiveSeason));
  const matches: Match[] = [];
  for (const partition of matchPartitions) {
    if (!wanted.has(partition)) continue;
    matches.push(
      ...(await readOrEmpty<Match>(store, sources.season, 'matches', matchSchema, partition)),
    );
  }

  const detailPartitions = await store
    .partitions({ season: sources.season, dataset: 'match-details' })
    .catch(() => [] as string[]);
  const details = new Map<number, MatchDetail>();
  const detailSeasons = new Set<string>();
  for (const partition of detailPartitions) {
    if (!wanted.has(partition)) continue;
    const rowsForSeason = await readOrEmpty<MatchDetail>(
      store,
      sources.season,
      'match-details',
      matchDetailSchema,
      partition,
    );
    if (rowsForSeason.length > 0) detailSeasons.add(toDomainSeason(partition));
    for (const detail of rowsForSeason) details.set(detail.matchId, detail);
  }

  return {
    rows,
    teamCodeOf: (season, teamId) => codeBySeasonId.get(`${season}:${String(teamId)}`) ?? null,
    ownTeamCodeOf: (row) => {
      if (row.team === null) return null;
      return codeBySeasonName.get(`${row.season}:${normalise(row.team)}`) ?? null;
    },
    spells,
    matches,
    detailOf: (matchId) => details.get(matchId) ?? null,
    detailSeasons,
  };
}

/** Club names arrive spelt several ways, so the key is stripped to letters. */
function normalise(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export { toArchiveSeason, toDomainSeason, normalise };
