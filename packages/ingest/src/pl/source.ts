import {
  asSeason,
  type Ground,
  type Manager,
  type Match,
  type MatchDetail,
  type Season,
} from '@fpl/core';
import type { HttpClient } from '../http.js';
import { DATASETS, type Source, type SourceBatch, type SourceContext } from '../source.js';
import { PremierLeagueClient } from './client.js';
import {
  normaliseSeasonLabel,
  refereeOf,
  toGrounds,
  toManagers,
  toMatch,
  toMatchDetail,
} from './map.js';

/** The lake writes a season as "2025-26" in a path segment. */
const partitionOf = (season: Season): string => season.replace('/', '-');

export interface PlMatchesOptions {
  /**
   * How many seasons of results to pull, newest first. The provider carries 35
   * and every one of them is four listing requests, so the default is all of
   * them: a complete head to head record is the point of the dataset, and
   * 13,500 slim rows are 1 MB as Parquet.
   */
  seasons?: number;
  /**
   * Seasons to pull teamsheets, officials, and timelines for, newest first.
   * One request per match, so this is the expensive half: three seasons is
   * about 1,140 requests, and thirty five would be 13,500.
   */
  detailSeasons?: number;
  /** Stop after this many detail requests. For a bounded first run. */
  maxDetail?: number;
  progressEvery?: number;
}

/**
 * Results, teamsheets, officials, managers, and grounds from the Premier
 * League's own API. One source rather than five because they all hang off the
 * same season list, and splitting them would mean resolving that list five
 * times.
 *
 * Nothing here is joined by name. The provider publishes the Opta id beside
 * its own for every club and every player, and those digits are FPL's `code`,
 * so the join is exact and a row that cannot produce one is dropped rather
 * than guessed at.
 */
export function plMatchesSource(http: HttpClient, options: PlMatchesOptions = {}): Source {
  const seasonCount = options.seasons ?? 35;
  const detailCount = options.detailSeasons ?? 3;
  const progressEvery = options.progressEvery ?? 50;

  return {
    name: 'pl-official',
    datasets: [DATASETS.matches, DATASETS.matchDetails, DATASETS.managers, DATASETS.grounds],

    async *run(context: SourceContext): AsyncIterable<SourceBatch> {
      const client = new PremierLeagueClient(http);
      const compSeasons = await client.compSeasons();

      const resolved = compSeasons
        .map((entry) => ({ id: Math.round(entry.id), season: normaliseSeasonLabel(entry.label) }))
        .filter((entry): entry is { id: number; season: Season } => entry.season !== null)
        .sort((a, b) => b.season.localeCompare(a.season));

      const wanted = resolved.slice(0, seasonCount);
      const detailWanted = new Set(resolved.slice(0, detailCount).map((entry) => entry.season));
      context.logger.info('resolved seasons', {
        available: resolved.length,
        results: wanted.length,
        details: detailWanted.size,
      });

      // Grounds and managers come from the current season's team list, which
      // is the only one that describes today's clubs. Older grounds arrive on
      // the match rows themselves.
      const newest = wanted[0];
      const grounds: Ground[] = [];
      const managers: Manager[] = [];

      if (newest !== undefined) {
        const teams = await client.teams(newest.id);
        grounds.push(...toGrounds(teams));

        // A manager per club per season for however many seasons carry detail,
        // so a match page can name who was in charge on the day rather than
        // who is in charge now.
        for (const entry of resolved.slice(0, detailCount)) {
          const seasonTeams = entry.id === newest.id ? teams : await client.teams(entry.id);
          for (const team of seasonTeams) {
            const teamCode = Number(team.altIds?.opta?.slice(1) ?? Number.NaN);
            if (!Number.isInteger(teamCode)) continue;
            try {
              const staff = await client.staff(Math.round(team.id), entry.id);
              managers.push(...toManagers(staff, entry.season, teamCode));
            } catch (error) {
              // A club with no published staff for a season is a gap in the
              // provider, not a failed run.
              context.logger.warn('no staff', {
                team: team.name,
                season: entry.season,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
          context.logger.info('managers read', { season: entry.season, total: managers.length });
        }
      }

      if (grounds.length > 0) {
        yield { dataset: DATASETS.grounds, rows: grounds, format: 'jsonl' };
      }
      if (managers.length > 0) {
        yield { dataset: DATASETS.managers, rows: managers, format: 'jsonl' };
      }

      let detailRequests = 0;

      for (const entry of wanted) {
        const raw = await client.allFixtures(entry.id);
        const matches: Match[] = [];
        let dropped = 0;
        for (const fixture of raw) {
          const match = toMatch(fixture, entry.season);
          if (match === null) dropped += 1;
          else matches.push(match);
        }

        const details: MatchDetail[] = [];
        if (detailWanted.has(entry.season)) {
          const byId = new Map(matches.map((match) => [match.matchId as number, match]));
          for (const match of matches) {
            if (options.maxDetail !== undefined && detailRequests >= options.maxDetail) break;
            // An unplayed match has no teamsheet and no timeline, and the
            // officials are not appointed until the week of it, so there is
            // nothing to spend a request on until it kicks off.
            if (match.status === 'upcoming') continue;
            detailRequests += 1;
            try {
              const detail = toMatchDetail(await client.fixtureDetail(match.matchId), entry.season);
              if (detail === null) continue;
              details.push(detail);
              const referee = refereeOf(detail);
              const slim = byId.get(match.matchId);
              if (referee !== null && slim !== undefined) {
                slim.refereeId = referee.id;
                slim.refereeName = referee.name;
              }
            } catch (error) {
              context.logger.warn('detail failed', {
                match: match.matchId,
                error: error instanceof Error ? error.message : String(error),
              });
            }
            if (detailRequests % progressEvery === 0) {
              context.logger.info('details read', { count: detailRequests });
            }
          }
        }

        context.logger.info('season read', {
          season: entry.season,
          matches: matches.length,
          details: details.length,
          dropped,
        });

        if (matches.length > 0) {
          // Parquet: 13,500 rows across 35 seasons is about 1 MB here and 20 MB
          // as JSONL, and the lake is committed to git.
          yield {
            dataset: DATASETS.matches,
            partition: partitionOf(entry.season),
            rows: matches,
            format: 'parquet',
          };
        }
        if (details.length > 0) {
          // JSONL: a teamsheet is a nested array, which Parquet would flatten
          // to JSON text that could not be read back through the schema.
          yield {
            dataset: DATASETS.matchDetails,
            partition: partitionOf(entry.season),
            rows: details,
            format: 'jsonl',
          };
        }
      }
    },
  };
}

/** The season a `matches` partition name describes, as the domain spells it. */
export const seasonFromPartition = (partition: string): Season =>
  asSeason(partition.replace('-', '/'));
