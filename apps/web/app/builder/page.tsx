import type { Metadata } from 'next';
import { asGameweekId, currentGameweek, nextGameweek, type Player } from '@fpl/core';
import { fixtureDifficulty, projectPoints, rollingForm } from '@fpl/analytics';
import { SquadBuilder, type BuilderPlayer, type BuilderTeam } from '@/components/squad-builder';
import { getFixtures, getGameweeks, getPlayerHistory, getPlayers, getTeams } from '@/lib/lake';

export const metadata: Metadata = {
  title: 'Team builder | FPL Lake',
  description:
    'Build a fifteen player squad against the real budget, quota, and club limits, with every number defined.',
};

/** Gameweeks the projection weighs fixtures over. Three is a planning horizon. */
const HORIZON = 3;

export default async function BuilderPage() {
  const [players, teams, fixtures, gameweeks] = await Promise.all([
    getPlayers(),
    getTeams(),
    getFixtures(),
    getGameweeks(),
  ]);

  const week = currentGameweek(gameweeks) ?? nextGameweek(gameweeks) ?? gameweeks[0];
  const fromGameweek = week?.id ?? 1;

  // Projections are computed here, at build time, and shipped as one number and
  // one explanation per player. The browser never sees the model, and the page
  // never recomputes 590 projections on a keystroke.
  const rows: BuilderPlayer[] = await Promise.all(
    players.map(async (player: Player): Promise<BuilderPlayer> => {
      const history = await getPlayerHistory(player.id);
      const projection = projectPoints(player, {
        history,
        fixtures,
        fromGameweek,
        horizon: HORIZON,
      });

      // The next three, as the ticker on each shirt shows them: a plan is made
      // against the fixtures, so the fixtures belong on the player rather than
      // one screen away from him.
      const runway = fixtureDifficulty(fixtures, player.teamId, asGameweekId(fromGameweek), 3);
      const form = rollingForm(history, 6);

      return {
        id: player.id,
        code: player.code,
        webName: player.webName,
        teamId: player.teamId,
        position: player.position,
        price: player.price,
        totalPoints: player.totalPoints,
        form: player.form,
        ownership: player.selectedByPercent,
        minutes: player.minutes,
        availability: player.availability,
        news: player.news,
        projected: Math.round(projection.points * 10) / 10,
        why: projection.explain,
        starterReliability: Math.round(form.starterReliability * 100),
        pointsPer90: Math.round(form.pointsPer90 * 10) / 10,
        next: runway.entries.slice(0, 3).map((entry) => ({
          gameweek: Number(entry.gameweek),
          opponent: Number(entry.opponent),
          home: entry.isHome,
          difficulty: entry.difficulty,
        })),
        blanks: runway.blankGameweeks.map((week) => Number(week)),
      };
    }),
  );

  const clubs: BuilderTeam[] = teams.map((team) => ({
    id: team.id,
    code: team.code,
    name: team.name,
    shortName: team.shortName,
  }));

  return (
    <SquadBuilder
      players={rows}
      teams={clubs}
      gameweek={fromGameweek}
      deadline={week === undefined ? null : week.deadline.toISOString()}
      horizon={HORIZON}
    />
  );
}
