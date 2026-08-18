import {
  asFixtureId,
  asGameweekId,
  fixtureSchema,
  matchSchema,
  playerSchema,
  teamSchema,
  type Fixture,
  type FixtureId,
  type Match,
  type Player,
  type PlayerId,
  type Team,
  type TeamId,
} from '@fpl/core';
import { DATASETS, type Source, type SourceBatch, type SourceContext } from '../../source.js';
import type { SofascoreClient } from './client.js';
import { buildFixtureResolver, buildPlayerResolver, type PlayerResolver } from './identity.js';
import { toMatchEvent, toPlayerMatchSpatial } from './map.js';
import type { SofascoreEvent, SofascoreHeatmapPoint } from './schemas.js';

/**
 * The provider numbers its seasons opaquely, so the label to id map is hand
 * maintained. A season that is not listed has to be passed in explicitly.
 */
export const SOFASCORE_SEASON_IDS: Readonly<Record<string, number>> = {
  '2025/26': 76986,
  // Read from unique-tournament/17/seasons on 2026-08-18.
  '2026/27': 96668,
};

export interface SofascoreSpatialOptions {
  /** The provider's season id. Defaults to the table above for a known season. */
  seasonId?: number;
  /** Cap on events processed, so a smoke run stays cheap. */
  maxEvents?: number;
  /** Ignore anything before this gameweek, for an incremental catch up run. */
  sinceGameweek?: number;
  /** Listing pages to walk. Each page holds about 30 events. */
  maxPages?: number;
  /**
   * Backfill a completed season instead of the one the lake is filed under.
   *
   * FPL serves fixtures for the live season only, so a past season has no
   * `fixtures` dataset to resolve against. The official record does have it,
   * as `matches`, and carries the same clubs by code, so those rows stand in
   * as the fixture spine. Partitions are then written as `{season}-gw{n}`
   * rather than `gw{n}`, because two seasons of gameweek 3 are not the same
   * partition and writing both to `gw3` would silently replace one with the
   * other.
   */
  backfillSeason?: string;
  /** Stop after this gameweek. With `sinceGameweek`, bounds a run to a window. */
  untilGameweek?: number;
}

const EVENTS_PER_PAGE = 30;
const DEFAULT_MAX_PAGES = 20;

interface ResolvedEvent {
  event: SofascoreEvent;
  fixtureId: FixtureId;
  gameweek: number;
  homeTeam: TeamId;
  awayTeam: TeamId;
}

/**
 * Player movement from Sofascore: heatmaps, average positions, per player match
 * statistics, and shot coordinates. Requires teams, players, and fixtures
 * because every provider row has to be joined onto a domain id before it is
 * worth storing; an unjoinable row is counted and dropped, never guessed at.
 */
export function sofascoreSpatialSource(
  client: SofascoreClient,
  options: SofascoreSpatialOptions = {},
): Source {
  return {
    name: 'spatial-sofascore',
    datasets: [DATASETS.playerMatchSpatial, DATASETS.matchEvents],
    requires: [DATASETS.teams, DATASETS.players, DATASETS.fixtures],

    async *run(context: SourceContext): AsyncIterable<SourceBatch> {
      // Resolved before anything is read, since without it there is nothing to
      // ask the provider for and the reads would be wasted.
      // A backfill asks the provider for the season being backfilled, not the
      // one the lake is filed under: the two differ by exactly one season, and
      // asking for the wrong one answers 404 rather than answering wrongly.
      const targetSeason = options.backfillSeason ?? context.season;
      const seasonId = options.seasonId ?? SOFASCORE_SEASON_IDS[targetSeason];
      if (seasonId === undefined) {
        context.logger.warn('no sofascore season id for this season', { season: targetSeason });
        return;
      }

      const key = { season: context.season };
      const [teams, players] = await Promise.all([
        context.store.read<Team>({ ...key, dataset: DATASETS.teams }, teamSchema),
        context.store.read<Player>({ ...key, dataset: DATASETS.players }, playerSchema),
      ]);

      const backfill = options.backfillSeason;
      const fixtures =
        backfill === undefined
          ? await context.store.read<Fixture>({ ...key, dataset: DATASETS.fixtures }, fixtureSchema)
          : await fixturesFromMatches(context, teams, backfill);

      if (fixtures.length === 0) {
        context.logger.warn('no fixture spine to resolve against', {
          season: backfill ?? context.season,
        });
        return;
      }
      const partitionPrefix = backfill === undefined ? '' : `${backfill.replace('/', '-')}-`;

      const resolveFixture = buildFixtureResolver(fixtures, teams);
      const resolvePlayer = buildPlayerResolver(players, teams);
      const fixtureById = new Map<FixtureId, Fixture>(fixtures.map((f) => [f.id, f]));

      const resolved = await collectEvents(client, context, seasonId, options, (event) => {
        const fixtureId = resolveFixture({
          homeTeamName: event.homeTeam.name,
          awayTeamName: event.awayTeam.name,
          kickoff: new Date(event.startTimestamp * 1000),
          round: event.roundInfo?.round ?? null,
        });
        if (fixtureId === undefined) return undefined;
        const fixture = fixtureById.get(fixtureId);
        // A fixture with no gameweek (postponed, not yet rescheduled) has no
        // partition to land in, so it is left for a later run.
        if (fixture?.gameweek === null || fixture?.gameweek === undefined) return undefined;
        return {
          event,
          fixtureId,
          gameweek: fixture.gameweek,
          homeTeam: fixture.homeTeam,
          awayTeam: fixture.awayTeam,
        };
      });

      // Rows are grouped before anything is yielded so each gameweek partition
      // is written once, matching how player histories are landed.
      const spatialByGameweek = new Map<number, Record<string, unknown>[]>();
      const eventsByGameweek = new Map<number, Record<string, unknown>[]>();
      let unresolvedPlayers = 0;
      let unresolvedShotTakers = 0;

      for (const target of resolved) {
        const counts = await ingestEvent(client, context, target, resolvePlayer, {
          spatial: bucket(spatialByGameweek, target.gameweek),
          events: bucket(eventsByGameweek, target.gameweek),
        });
        unresolvedPlayers += counts.unresolvedPlayers;
        unresolvedShotTakers += counts.unresolvedShotTakers;
      }

      context.logger.info('sofascore spatial ingested', {
        events: resolved.length,
        playerRows: [...spatialByGameweek.values()].reduce((sum, rows) => sum + rows.length, 0),
        eventRows: [...eventsByGameweek.values()].reduce((sum, rows) => sum + rows.length, 0),
        unresolvedPlayers,
        unresolvedShotTakers,
      });

      for (const [gameweek, rows] of sorted(spatialByGameweek)) {
        yield {
          dataset: DATASETS.playerMatchSpatial,
          partition: `${partitionPrefix}gw${String(gameweek)}`,
          rows,
        };
      }
      for (const [gameweek, rows] of sorted(eventsByGameweek)) {
        yield {
          dataset: DATASETS.matchEvents,
          partition: `${partitionPrefix}gw${String(gameweek)}`,
          rows,
        };
      }
    },
  };
}

/**
 * A fixture spine for a completed season, built from the official record.
 *
 * A club that has since left the division has no current FPL team id, so its
 * matches cannot be joined and are dropped with a count. That is the right
 * outcome rather than a widened match: half a season of Sunderland attributed
 * to whoever replaced them would be undetectable downstream.
 */
async function fixturesFromMatches(
  context: SourceContext,
  teams: readonly Team[],
  seasonLabel: string,
): Promise<Fixture[]> {
  const teamIdByCode = new Map(teams.map((team) => [team.code, team.id]));
  const matches = await context.store.read<Match>(
    {
      season: context.season,
      dataset: DATASETS.matches,
      partition: seasonLabel.replace('/', '-'),
    },
    matchSchema,
  );

  const fixtures: Fixture[] = [];
  let dropped = 0;
  for (const match of matches) {
    const home = teamIdByCode.get(match.homeTeamCode);
    const away = teamIdByCode.get(match.awayTeamCode);
    if (home === undefined || away === undefined || match.round === null) {
      dropped += 1;
      continue;
    }
    fixtures.push({
      id: asFixtureId(match.matchId),
      gameweek: asGameweekId(Math.min(38, match.round)),
      kickoff: match.kickoff,
      homeTeam: home,
      awayTeam: away,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      finished: match.status === 'completed',
      started: match.status !== 'upcoming',
      // The official record carries no fantasy difficulty, and this spine is
      // only ever used to resolve an identity, never to rate a fixture.
      homeDifficulty: 3,
      awayDifficulty: 3,
    });
  }

  context.logger.info('fixture spine from the official record', {
    season: seasonLabel,
    fixtures: fixtures.length,
    dropped,
    note: 'dropped matches involve a club no longer in the division',
  });
  // Parsed once at the end so a malformed spine fails here rather than inside
  // the resolver, where it would look like a join failure.
  return fixtures.map((fixture) => fixtureSchema.parse(fixture));
}

function bucket(
  store: Map<number, Record<string, unknown>[]>,
  gameweek: number,
): Record<string, unknown>[] {
  const existing = store.get(gameweek);
  if (existing !== undefined) return existing;
  const created: Record<string, unknown>[] = [];
  store.set(gameweek, created);
  return created;
}

const sorted = (
  store: Map<number, Record<string, unknown>[]>,
): [number, Record<string, unknown>[]][] => [...store.entries()].sort(([a], [b]) => a - b);

/** Walks the listing pages until enough finished, resolvable events are found. */
async function collectEvents(
  client: SofascoreClient,
  context: SourceContext,
  seasonId: number,
  options: SofascoreSpatialOptions,
  resolve: (event: SofascoreEvent) => ResolvedEvent | undefined,
): Promise<ResolvedEvent[]> {
  const wanted = options.maxEvents ?? Number.POSITIVE_INFINITY;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const collected: ResolvedEvent[] = [];
  let unresolvedEvents = 0;

  for (let page = 0; page < maxPages && collected.length < wanted; page += 1) {
    const listing = await client.events(seasonId, page);
    for (const event of listing.events) {
      if (event.status?.type !== 'finished') continue;
      const target = resolve(event);
      if (target === undefined) {
        unresolvedEvents += 1;
        continue;
      }
      if (options.sinceGameweek !== undefined && target.gameweek < options.sinceGameweek) continue;
      if (options.untilGameweek !== undefined && target.gameweek > options.untilGameweek) continue;
      collected.push(target);
      if (collected.length >= wanted) break;
    }
    if (listing.hasNextPage !== true || listing.events.length < EVENTS_PER_PAGE) break;
  }

  if (unresolvedEvents > 0) {
    context.logger.warn('sofascore events without a domain fixture', { count: unresolvedEvents });
  }
  return collected;
}

interface EventCounts {
  unresolvedPlayers: number;
  /** A shot still lands, with a null player, so this is counted separately. */
  unresolvedShotTakers: number;
}

/** Pulls one match: lineups, average positions, shots, and a heatmap per player. */
async function ingestEvent(
  client: SofascoreClient,
  context: SourceContext,
  target: ResolvedEvent,
  resolvePlayer: PlayerResolver,
  into: { spatial: Record<string, unknown>[]; events: Record<string, unknown>[] },
): Promise<EventCounts> {
  const eventId = target.event.id;
  const lineups = await client.lineups(eventId);
  const averages = await client.averagePositions(eventId);
  const shots = await client.shotmap(eventId);

  const averageByProviderId = new Map(
    [...averages.home, ...averages.away].map((entry) => [entry.player.id, entry]),
  );
  const wantsHeatmap = target.event.hasEventPlayerHeatMap !== false;
  let unresolvedPlayers = 0;
  let unresolvedShotTakers = 0;

  for (const [side, teamId] of [
    ['home', target.homeTeam],
    ['away', target.awayTeam],
  ] as const) {
    for (const lineup of lineups[side].players) {
      const minutes = lineup.statistics?.minutesPlayed ?? 0;
      if (minutes <= 0) continue;

      const playerId = resolvePlayer(lineup.player.name, teamId);
      if (playerId === undefined) {
        unresolvedPlayers += 1;
        context.logger.debug('sofascore player unresolved', {
          name: lineup.player.name,
          providerId: lineup.player.id,
          eventId,
        });
        continue;
      }

      const heatmap: SofascoreHeatmapPoint[] | null = wantsHeatmap
        ? await client.tryHeatmap(eventId, lineup.player.id)
        : null;

      into.spatial.push(
        toPlayerMatchSpatial({
          playerId,
          fixtureId: target.fixtureId,
          teamId,
          lineup,
          heatmap,
          averagePosition: averageByProviderId.get(lineup.player.id) ?? null,
        }),
      );
    }
  }

  for (const shot of shots) {
    const teamId = shot.isHome ? target.homeTeam : target.awayTeam;
    const playerId: PlayerId | null = resolvePlayer(shot.player.name, teamId) ?? null;
    if (playerId === null) {
      unresolvedShotTakers += 1;
      context.logger.debug('sofascore shot taker unresolved', {
        name: shot.player.name,
        providerId: shot.player.id,
        eventId,
      });
    }
    into.events.push(toMatchEvent({ fixtureId: target.fixtureId, teamId, playerId, shot }));
  }

  context.logger.debug('sofascore event ingested', {
    eventId,
    fixtureId: target.fixtureId,
    gameweek: target.gameweek,
    shots: shots.length,
  });

  return { unresolvedPlayers, unresolvedShotTakers };
}
