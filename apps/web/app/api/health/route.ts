import { getFixtures, getGameweeks, getPlayers, getTeams, lakeRoot, season } from '@/lib/lake';
import { isProtected, lakeIsWritable } from '@/lib/refresh';

export const dynamic = 'force-dynamic';

/** What the deployment can actually see, for a scheduler to check before it acts. */
export async function GET(): Promise<Response> {
  const [teams, players, gameweeks, fixtures, writable] = await Promise.all([
    getTeams(),
    getPlayers(),
    getGameweeks(),
    getFixtures(),
    lakeIsWritable(),
  ]);

  const current = gameweeks.find((week) => week.isCurrent);
  const next = gameweeks.find((week) => week.isNext);

  return Response.json({
    status: 'ok',
    season,
    lakeRoot,
    storage: writable ? 'writable' : 'read only',
    refreshProtected: isProtected(),
    counts: {
      teams: teams.length,
      players: players.length,
      gameweeks: gameweeks.length,
      fixtures: fixtures.length,
    },
    currentGameweek: current?.id ?? null,
    nextDeadline: next?.deadline ?? current?.deadline ?? null,
  });
}
