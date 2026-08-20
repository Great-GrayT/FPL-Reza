import type { Metadata } from 'next';
import {
  GAMEWEEKS_PER_SEASON,
  asGameweekId,
  currentGameweek,
  nextGameweek,
  type Player,
  type PlayerGameweek,
} from '@fpl/core';
import { fixtureDifficulty, projectPoints, rollingForm } from '@fpl/analytics';
import { SquadBuilder, type BuilderPlayer, type BuilderTeam } from '@/components/squad-builder';
import { kickoff } from '@/lib/display';
import { buildPool } from '@/lib/planner/projections';
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

  // Read every history once. The display rows need it for form, and the search
  // pool needs it for a projection per gameweek, and reading it twice would
  // double the slowest part of this page's build.
  const histories = new Map<number, readonly PlayerGameweek[]>(
    await Promise.all(
      players.map(async (player: Player): Promise<[number, readonly PlayerGameweek[]]> => [
        Number(player.id),
        await getPlayerHistory(player.id),
      ]),
    ),
  );

  // Projections are computed here, at build time, and shipped as one number and
  // one explanation per player. The browser never sees the model, and the page
  // never recomputes 590 projections on a keystroke.
  const rows: BuilderPlayer[] = players.map((player: Player): BuilderPlayer => {
    const history = histories.get(Number(player.id)) ?? [];
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
  });

  // The optimiser searches over the rest of the season, so the pool carries a
  // projection per remaining gameweek: a blank is a zero and a double is two
  // matches, and a squad chosen on an average of them would be blind to both.
  const remaining = Math.max(1, GAMEWEEKS_PER_SEASON - Number(fromGameweek) + 1);
  const full = buildPool(players, teams, fixtures, (id: number) => histories.get(id) ?? [], {
    fromGameweek: Number(fromGameweek),
    horizon: remaining,
  });

  // The spreads and the price rise probabilities are dropped here, and that is
  // not a saving for its own sake: this page's search runs at a risk aversion of
  // zero and never advances a price, so shipping them would be two thirds of the
  // pool's weight to the reader for numbers nothing on the page reads. Adding a
  // risk control here means putting the spreads back.
  const pool = {
    ...full,
    players: full.players.map((player) => ({
      code: player.code,
      name: player.name,
      position: player.position,
      teamCode: player.teamCode,
      price: player.price,
      projections: player.projections,
      ...(player.available === undefined ? {} : { available: player.available }),
    })),
  };

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
      deadline={week === undefined ? null : kickoff(week.deadline)}
      horizon={HORIZON}
      pool={pool}
    />
  );
}
