import type { Metadata } from 'next';
import { Suspense } from 'react';
import { GAMEWEEKS_PER_SEASON, currentGameweek, nextGameweek } from '@fpl/core';
import { Planner, type PlannerClub } from '@/components/planner';
import { buildPool } from '@/lib/planner/projections';
import { getFixtures, getGameweeks, getPlayerHistory, getPlayers, getTeams } from '@/lib/lake';

export const metadata: Metadata = {
  title: 'The plan, explained | FPL Lake',
  description:
    'What a strategy is expected to be worth, gameweek by gameweek: the transfers, the hits, the captain, the chips, and how sure any of it is.',
};

export default async function PlannerPage() {
  const [players, teams, fixtures, gameweeks] = await Promise.all([
    getPlayers(),
    getTeams(),
    getFixtures(),
    getGameweeks(),
  ]);

  const week = currentGameweek(gameweeks) ?? nextGameweek(gameweeks) ?? gameweeks[0];
  const fromGameweek = week?.id ?? 1;
  // The plan can only reach the end of the season, so the horizon is what is
  // left rather than a fixed number the interface would then have to explain.
  const horizon = Math.max(1, GAMEWEEKS_PER_SEASON - fromGameweek + 1);

  const histories = new Map<number, Awaited<ReturnType<typeof getPlayerHistory>>>();
  await Promise.all(
    players.map(async (player) => {
      histories.set(Number(player.id), await getPlayerHistory(player.id));
    }),
  );

  const pool = buildPool(players, teams, fixtures, (playerId) => histories.get(playerId) ?? [], {
    fromGameweek,
    horizon,
  });

  const clubs: PlannerClub[] = teams.map((team) => ({
    code: team.code,
    name: team.name,
    shortName: team.shortName,
  }));

  const deadlines = gameweeks
    .filter((entry) => Number(entry.id) >= fromGameweek)
    .map((entry) => ({ gameweek: Number(entry.id), deadline: entry.deadline.toISOString() }));

  return (
    // The strategy arrives in the query string, and reading it is a client
    // concern, so the prerender needs somewhere to stop.
    <Suspense fallback={null}>
      <Planner
        pool={pool}
        clubs={clubs}
        deadlines={deadlines}
        fromGameweek={fromGameweek}
        horizon={horizon}
      />
    </Suspense>
  );
}
