import {
  clubFixtureSchema,
  matchTeamStatsSchema,
  type ClubFixture,
  type CompetitionId,
  type MatchTeamStats,
} from '@fpl/core';
import { DATASETS, type Source, type SourceContext } from '../source.js';
import type { PremierLeagueClient } from './client.js';
import { optaDigits } from './map.js';
import type { PlMatchStats } from './schemas.js';

/**
 * The analysis under the scoreline.
 *
 * FPL publishes about a dozen columns per player and nothing at all per club.
 * The Premier League's own API publishes a hundred and eighty one measures per
 * club per match, from the same Opta feed its broadcasters use: possession and
 * passing, PPDA and pressing, carries and progressive carries, entries into the
 * final third and the penalty area, big chances created and missed, duels,
 * errors leading to a shot, and shots split by placement and body part.
 *
 * It sat one endpoint away from fixtures this lake already pulled, and nothing
 * here was reading it. It is the single largest unclaimed dataset the platform
 * has access to, and it works for every competition, not only the league.
 *
 * The cost is one request per match, which is why this is incremental: matches
 * already stored are carried through untouched and only new ones are fetched,
 * so a nightly run costs the handful of matches that were played since the last.
 */

export interface MatchStatsOptions {
  /** Cap the requests, for a bounded first run. */
  maxMatches?: number;
  /** Only these competitions. Defaults to every one in the calendar. */
  competitions?: readonly CompetitionId[];
  progressEvery?: number;
}

/** One provider payload as one row per club, or an empty list where it cannot be joined. */
export function toMatchTeamStats(
  raw: PlMatchStats,
  fixture: Pick<ClubFixture, 'competitionId' | 'competition' | 'season' | 'kickoff'>,
): MatchTeamStats[] {
  const teams = raw.entity.teams;
  const home = teams[0]?.team;
  const away = teams[1]?.team;
  if (home === undefined || away === undefined) return [];

  const rows: MatchTeamStats[] = [];
  for (const [key, payload] of Object.entries(raw.data)) {
    const teamId = Number(key);
    if (!Number.isInteger(teamId)) continue;
    const isHome = teamId === home.id;
    const self = isHome ? home : away;
    const other = isHome ? away : home;

    const stats: Record<string, number> = {};
    for (const measure of payload.M) {
      // Last value wins, which is what the provider itself does when a measure
      // appears twice: the array is a feed, not a set.
      stats[measure.name] = measure.value;
    }
    if (Object.keys(stats).length === 0) continue;

    rows.push(
      matchTeamStatsSchema.parse({
        fixtureId: raw.entity.id,
        competitionId: fixture.competitionId,
        competition: fixture.competition,
        season: fixture.season,
        kickoff: fixture.kickoff,
        teamId,
        teamCode: optaDigits(self.altIds?.opta, 't'),
        teamName: self.name,
        opponentCode: optaDigits(other.altIds?.opta, 't'),
        opponentName: other.name,
        home: isHome,
        stats,
      }),
    );
  }
  return rows;
}

export function plMatchStatsSource(
  client: PremierLeagueClient,
  options: MatchStatsOptions = {},
): Source {
  const progressEvery = options.progressEvery ?? 25;

  return {
    name: 'pl-match-stats',
    datasets: [DATASETS.matchTeamStats],
    requires: [DATASETS.clubFixtures],
    async *run(context: SourceContext) {
      const partitions = await context.store.partitions({
        season: context.season,
        dataset: DATASETS.clubFixtures,
      });

      for (const partition of partitions) {
        const fixtures = await context.store.read<ClubFixture>(
          { season: context.season, dataset: DATASETS.clubFixtures, partition },
          clubFixtureSchema,
        );

        // What is already stored is carried through rather than refetched: one
        // request per match makes a full refresh expensive and a season's
        // statistics do not change once the match has been played.
        let stored: MatchTeamStats[] = [];
        try {
          stored = await context.store.read<MatchTeamStats>(
            { season: context.season, dataset: DATASETS.matchTeamStats, partition },
            matchTeamStatsSchema,
          );
        } catch {
          stored = [];
        }
        const have = new Set(stored.map((row) => row.fixtureId));

        const wanted = fixtures
          .filter((fixture) => fixture.finished)
          .filter(
            (fixture) =>
              options.competitions === undefined ||
              options.competitions.includes(fixture.competitionId as CompetitionId),
          )
          .filter((fixture) => !have.has(fixture.fixtureId));

        const budget = options.maxMatches ?? wanted.length;
        const fresh: MatchTeamStats[] = [];
        let failed = 0;

        for (const [index, fixture] of wanted.slice(0, budget).entries()) {
          try {
            const payload = await client.matchStats(fixture.fixtureId);
            fresh.push(...toMatchTeamStats(payload, fixture));
          } catch (error) {
            // A match the provider has no analysis for must not stop the rest:
            // an abandoned tie or a very old round simply has none.
            failed += 1;
            context.logger.warn('match statistics unavailable', {
              fixtureId: fixture.fixtureId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          if ((index + 1) % progressEvery === 0) {
            context.logger.info('match statistics', {
              partition,
              done: index + 1,
              of: Math.min(budget, wanted.length),
            });
          }
        }

        if (fresh.length === 0 && stored.length === 0) continue;

        context.logger.info('match statistics read', {
          partition,
          played: fixtures.filter((fixture) => fixture.finished).length,
          fetched: fresh.length / 2,
          carried: stored.length / 2,
          failed,
          remaining: Math.max(0, wanted.length - budget),
        });

        yield {
          dataset: DATASETS.matchTeamStats,
          partition,
          // A snapshot read takes the newest file whole, so a partial write
          // would erase every match it did not fetch this run.
          rows: [...stored, ...fresh],
        };
      }
    },
  };
}
