import { playerSchema, type Player } from '@fpl/core';
import { DATASETS, type Source, type SourceBatch, type SourceContext } from '../source.js';
import type { FplClient } from './client.js';
import { toFixture, toGameweek, toPlayer, toPlayerGameweek, toTeam } from './map.js';

/** Teams, players and gameweeks all arrive in the single bootstrap payload. */
export function bootstrapSource(client: FplClient): Source {
  return {
    name: 'fpl-bootstrap',
    datasets: [DATASETS.teams, DATASETS.players, DATASETS.gameweeks],

    async *run(context: SourceContext): AsyncIterable<SourceBatch> {
      const raw = await client.bootstrap();
      context.logger.debug('bootstrap fetched', {
        teams: raw.teams.length,
        players: raw.elements.length,
        gameweeks: raw.events.length,
      });

      yield { dataset: DATASETS.teams, rows: raw.teams.map(toTeam) };
      yield { dataset: DATASETS.gameweeks, rows: raw.events.map(toGameweek) };
      yield { dataset: DATASETS.players, rows: raw.elements.map(toPlayer) };
    },
  };
}

export function fixturesSource(client: FplClient): Source {
  return {
    name: 'fpl-fixtures',
    datasets: [DATASETS.fixtures],

    async *run(context: SourceContext): AsyncIterable<SourceBatch> {
      const raw = await client.fixtures();
      context.logger.debug('fixtures fetched', { count: raw.length });
      yield { dataset: DATASETS.fixtures, rows: raw.map(toFixture) };
    },
  };
}

export interface PlayerHistoryOptions {
  /** Skip players who have not played, which is most of the list early on. */
  skipUnplayed?: boolean;
  /** Cap the number of players fetched. Useful for a smoke test run. */
  limit?: number;
  /** Log a progress line every N players. */
  progressEvery?: number;
}

/**
 * One request per player, so this is the expensive source: roughly 700 calls
 * gated by the client's minimum request interval. It reads the player list
 * from the store rather than refetching bootstrap, which is why it declares
 * `players` as a requirement.
 */
export function playerHistorySource(client: FplClient, options: PlayerHistoryOptions = {}): Source {
  const progressEvery = options.progressEvery ?? 50;

  return {
    name: 'fpl-player-history',
    datasets: [DATASETS.playerGameweeks],
    requires: [DATASETS.players],

    async *run(context: SourceContext): AsyncIterable<SourceBatch> {
      const all = await context.store.read<Player>(
        { season: context.season, dataset: DATASETS.players },
        playerSchema,
      );

      const players = selectPlayers(all, options);
      context.logger.info('fetching player histories', {
        players: players.length,
        of: all.length,
      });

      // Grouped by gameweek so each partition is written once, rather than
      // rewriting every gameweek file per player.
      const byGameweek = new Map<number, Record<string, unknown>[]>();

      for (const [index, player] of players.entries()) {
        const history = await client.playerHistory(player.id);
        for (const entry of history) {
          const row = toPlayerGameweek(entry);
          const bucket = byGameweek.get(row.gameweek);
          if (bucket === undefined) {
            byGameweek.set(row.gameweek, [row]);
          } else {
            bucket.push(row);
          }
        }

        if ((index + 1) % progressEvery === 0) {
          context.logger.info('player history progress', {
            done: index + 1,
            total: players.length,
          });
        }
      }

      for (const gameweek of [...byGameweek.keys()].sort((a, b) => a - b)) {
        yield {
          dataset: DATASETS.playerGameweeks,
          partition: `gw${gameweek}`,
          rows: byGameweek.get(gameweek) ?? [],
        };
      }
    },
  };
}

function selectPlayers(players: readonly Player[], options: PlayerHistoryOptions): Player[] {
  const filtered =
    options.skipUnplayed === true ? players.filter((player) => player.minutes > 0) : [...players];
  return options.limit === undefined ? filtered : filtered.slice(0, options.limit);
}
