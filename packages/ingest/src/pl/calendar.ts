import {
  COMPETITIONS,
  CONGESTION_COMPETITIONS,
  clubFixtureSchema,
  type ClubFixture,
  type CompetitionId,
  type Season,
} from '@fpl/core';
import { DATASETS, type Source, type SourceContext } from '../source.js';
import type { PremierLeagueClient } from './client.js';
import { normaliseSeasonLabel, teamCodeOf } from './map.js';
import type { PlFixture } from './schemas.js';

/**
 * Every fixture a Premier League club plays, in every competition.
 *
 * FPL's feed carries the Premier League and nothing else, so to it a club
 * playing Thursday in Milan and Sunday at lunchtime looks exactly like a club
 * that has not played since last weekend. That difference is rotation, and
 * rotation is most of why a projection built on recent minutes goes wrong in
 * February: a squad in three competitions is a squad whose best eleven does not
 * start, and one out of everything by January is a squad that rests nobody.
 *
 * The Premier League's own API already publishes it. Competition 1 is the
 * league, 2 and 3 are the European ties it tracks for its clubs, 4 is the FA
 * Cup and 5 the League Cup, and every one of them carries the same Opta alt ids
 * the rest of this lake joins on, so no name matching is involved anywhere.
 *
 * Rows land in their own dataset rather than in `matches`. `matches` is the
 * league record and `estimateStrength` reads all of it: folding a cup tie
 * against a fourth tier club into that would rate a side on opposition it will
 * never meet in the league, which is a worse error than the gap this closes.
 */

export interface CalendarOptions {
  /** Competitions to pull. Defaults to the five a Premier League squad plays. */
  competitions?: readonly CompetitionId[];
  /** Seasons back from the newest, per competition. One is the current one. */
  seasons?: number;
}

/** One provider fixture as a row of the calendar, or null where it cannot be joined. */
export function toClubFixture(
  raw: PlFixture,
  competitionId: CompetitionId,
  fallbackSeason: Season,
): ClubFixture | null {
  const home = raw.teams[0];
  const away = raw.teams[1];
  if (home === undefined || away === undefined) return null;

  const season = normaliseSeasonLabel(raw.gameweek?.compSeason?.label ?? '') ?? fallbackSeason;

  return clubFixtureSchema.parse({
    fixtureId: raw.id,
    competitionId,
    competition: COMPETITIONS[competitionId],
    season,
    kickoff: raw.kickoff?.millis === undefined ? null : new Date(raw.kickoff.millis),
    // Null rather than dropped: a Premier League club's tie against a club FPL
    // has never heard of is exactly the fixture this dataset exists to count.
    homeTeamCode: teamCodeOf(home.team),
    awayTeamCode: teamCodeOf(away.team),
    homeTeamName: home.team.name,
    awayTeamName: away.team.name,
    round: raw.gameweek?.gameweek === undefined ? null : String(raw.gameweek.gameweek),
    finished: raw.status === 'C',
  });
}

/**
 * The calendar source.
 *
 * Cheap by construction: one season of one competition is a handful of listing
 * requests, and five competitions for the current season is under twenty. It is
 * therefore safe to run on the nightly schedule, unlike the detail pass.
 */
export function plCalendarSource(
  client: PremierLeagueClient,
  options: CalendarOptions = {},
): Source {
  const competitions = options.competitions ?? CONGESTION_COMPETITIONS;
  const seasons = Math.max(1, options.seasons ?? 1);

  return {
    name: 'pl-calendar',
    datasets: [DATASETS.clubFixtures],
    async *run(context: SourceContext) {
      const rows: ClubFixture[] = [];
      let unjoined = 0;

      for (const competition of competitions) {
        let compSeasons;
        try {
          compSeasons = await client.compSeasons(competition);
        } catch (error) {
          // A competition the provider stops publishing must not fail the run:
          // the other four are still the calendar.
          context.logger.warn('competition season list failed', {
            competition,
            error: error instanceof Error ? error.message : String(error),
          });
          continue;
        }

        for (const compSeason of compSeasons.slice(0, seasons)) {
          const fixtures = await client.allFixtures(compSeason.id, competition);
          for (const fixture of fixtures) {
            const row = toClubFixture(fixture, competition, context.season);
            if (row === null) {
              unjoined += 1;
              continue;
            }
            rows.push(row);
          }
          context.logger.info('competition season read', {
            competition: COMPETITIONS[competition],
            season: compSeason.label,
            fixtures: fixtures.length,
          });
        }
      }

      if (unjoined > 0) context.logger.warn('fixtures without two clubs', { unjoined });

      // Partitioned by the fixture's own season rather than the run's. The
      // European competitions and the FA Cup publish a new season only once it
      // is drawn, so a run in August legitimately returns last season's ties
      // for three of the five: filing those under this season would be a claim
      // nobody made.
      const bySeason = new Map<string, ClubFixture[]>();
      for (const row of rows) {
        const key = row.season.replace('/', '-');
        const list = bySeason.get(key) ?? [];
        list.push(row);
        bySeason.set(key, list);
      }

      for (const [partition, batch] of bySeason) {
        yield { dataset: DATASETS.clubFixtures, partition, rows: batch };
      }
    },
  };
}
