import {
  playerSeasonSchema,
  asSeason,
  type PlayerCode,
  type PlayerSeason,
  type Player,
  playerSchema,
} from '@fpl/core';
import { z } from 'zod';
import type { FplClient } from '../fpl/client.js';
import { DATASETS, type Source, type SourceBatch, type SourceContext } from '../source.js';

/**
 * Past seasons come from the same element summary endpoint the player history
 * source already calls, in a field it ignores. They are captured by their own
 * source rather than as a side effect of that one for two reasons: the daily
 * sync skips players with no minutes, and a partial snapshot would shadow a
 * complete one, since a read takes the newest snapshot whole. Past seasons also
 * only change once a year, at the rollover, so paying for a full pass over
 * every player is a decision to make deliberately, not every night.
 */

/** FPL prints its ICT family as strings, and older seasons omit newer measures. */
const numeric = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((value) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  });

const count = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((value) => {
    if (value === null || value === undefined || value === '') return 0;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
  });

export const rawHistoryPastSchema = z
  .object({
    season_name: z.string(),
    element_code: z.number().int().positive(),
    start_cost: z.number().int(),
    end_cost: z.number().int(),
    total_points: z.number().int(),
    minutes: z.number().int(),
    starts: numeric,
    goals_scored: count,
    assists: count,
    clean_sheets: count,
    goals_conceded: count,
    own_goals: count,
    penalties_saved: count,
    penalties_missed: count,
    yellow_cards: count,
    red_cards: count,
    saves: count,
    bonus: count,
    bps: z.number().int(),
    influence: numeric,
    creativity: numeric,
    threat: numeric,
    ict_index: numeric,
    expected_goals: numeric,
    expected_assists: numeric,
    expected_goals_conceded: numeric,
    defensive_contribution: numeric,
  })
  .passthrough();

export type RawHistoryPast = z.infer<typeof rawHistoryPastSchema>;

/**
 * A measure that did not exist in a season reads as 0 from FPL, which is a
 * different claim from "this player recorded none". Expected goals arrived in
 * 2022/23 and defensive contribution in 2025/26, so a 0 before then is treated
 * as absent.
 */
const XG_FROM_SEASON = '2022/23';
const DEFENSIVE_CONTRIBUTION_FROM_SEASON = '2025/26';

const startYear = (season: string): number => Number(season.slice(0, 4));

const measuredIn = (season: string, from: string): boolean => startYear(season) >= startYear(from);

const absentBefore = (value: number | null, season: string, from: string): number | null =>
  measuredIn(season, from) ? value : null;

export function toPlayerSeason(raw: RawHistoryPast): PlayerSeason {
  const season = raw.season_name;

  return playerSeasonSchema.parse({
    playerCode: raw.element_code,
    season: asSeason(season),
    startPrice: raw.start_cost,
    endPrice: raw.end_cost,
    totalPoints: raw.total_points,
    minutes: raw.minutes,
    starts: raw.starts,
    goals: raw.goals_scored,
    assists: raw.assists,
    cleanSheets: raw.clean_sheets,
    goalsConceded: raw.goals_conceded,
    ownGoals: raw.own_goals,
    penaltiesSaved: raw.penalties_saved,
    penaltiesMissed: raw.penalties_missed,
    yellowCards: raw.yellow_cards,
    redCards: raw.red_cards,
    saves: raw.saves,
    bonus: raw.bonus,
    bps: raw.bps,
    influence: raw.influence,
    creativity: raw.creativity,
    threat: raw.threat,
    ictIndex: raw.ict_index,
    expectedGoals: absentBefore(raw.expected_goals, season, XG_FROM_SEASON),
    expectedAssists: absentBefore(raw.expected_assists, season, XG_FROM_SEASON),
    expectedGoalsConceded: absentBefore(raw.expected_goals_conceded, season, XG_FROM_SEASON),
    defensiveContribution: absentBefore(
      raw.defensive_contribution,
      season,
      DEFENSIVE_CONTRIBUTION_FROM_SEASON,
    ),
  });
}

export interface PlayerSeasonsOptions {
  /** Cap the players fetched, for a smoke run. */
  limit?: number;
  /** Log a progress line every N players. */
  progressEvery?: number;
}

const DEFAULT_PROGRESS_EVERY = 50;

/**
 * One request per player, so this costs the same as a full player history pass.
 * It is not part of a nightly sync: run it once a season, after the rollover,
 * or when a mid season transfer window brings new players into the game.
 */
export function playerSeasonsSource(client: FplClient, options: PlayerSeasonsOptions = {}): Source {
  return {
    name: 'fpl-player-seasons',
    datasets: [DATASETS.playerSeasons],
    requires: [DATASETS.players],

    async *run(context: SourceContext): AsyncIterable<SourceBatch> {
      const players = await context.store.read<Player>(
        { season: context.season, dataset: DATASETS.players },
        playerSchema,
      );
      const selected = options.limit === undefined ? players : players.slice(0, options.limit);
      const progressEvery = options.progressEvery ?? DEFAULT_PROGRESS_EVERY;

      context.logger.info('fetching past seasons', {
        source: 'fpl-player-seasons',
        players: selected.length,
      });

      const rows: PlayerSeason[] = [];
      const seen = new Set<string>();
      let done = 0;

      for (const player of selected) {
        const summary = await client.playerSummary(player.id);
        for (const raw of summary.history_past) {
          const season = toPlayerSeason(rawHistoryPastSchema.parse(raw));
          // One player can appear in another player's summary only through a
          // shared code, which cannot happen, but a duplicated season row in
          // the payload would otherwise write the same key twice.
          const key = `${String(season.playerCode)}:${season.season}`;
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push(season);
        }

        done += 1;
        if (done % progressEvery === 0) {
          context.logger.info('past seasons progress', {
            source: 'fpl-player-seasons',
            done,
            total: selected.length,
          });
        }
      }

      context.logger.info('past seasons collected', {
        source: 'fpl-player-seasons',
        players: selected.length,
        rows: rows.length,
        careers: new Set(rows.map((row) => row.playerCode)).size,
      });

      yield { dataset: DATASETS.playerSeasons, rows };
    },
  };
}

/** Career rows grouped by player, newest season first, for a page to render. */
export function seasonsByPlayerCode(
  rows: readonly PlayerSeason[],
): Map<PlayerCode, PlayerSeason[]> {
  const byCode = new Map<PlayerCode, PlayerSeason[]>();
  for (const row of rows) {
    const existing = byCode.get(row.playerCode);
    if (existing === undefined) byCode.set(row.playerCode, [row]);
    else existing.push(row);
  }
  for (const seasons of byCode.values()) {
    seasons.sort((a, b) => b.season.localeCompare(a.season));
  }
  return byCode;
}
