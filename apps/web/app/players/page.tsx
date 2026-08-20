import type { Metadata } from 'next';
import { asGameweekId, currentGameweek, nextGameweek, playerFullName } from '@fpl/core';
import { fixtureDifficulty } from '@fpl/analytics';
import { PlayerIndex, type IndexRow } from '@/components/player-index';
import { getFixtures, getGameweeks, getPlayers, getTeamsById } from '@/lib/lake';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Players | FPL Lake',
  description: 'Every Fantasy Premier League player, searchable and sortable',
};

export default async function PlayersPage() {
  const [players, teams, fixtures, gameweeks] = await Promise.all([
    getPlayers(),
    getTeamsById(),
    getFixtures(),
    getGameweeks(),
  ]);

  const week = currentGameweek(gameweeks) ?? nextGameweek(gameweeks) ?? gameweeks[0];
  const from = asGameweekId(Number(week?.id ?? 1));

  const rows: IndexRow[] = players.map((player) => {
    const team = teams.get(player.teamId);
    // The run ahead belongs on the row a decision is made from, not one screen
    // away from it: nobody sorts by form and then opens three pages to find
    // out who those three players actually face.
    const runway = fixtureDifficulty(fixtures, player.teamId, from, 3);
    return {
      id: player.id,
      code: player.code,
      name: player.webName,
      fullName: playerFullName(player),
      team: team?.shortName ?? '???',
      teamCode: team?.code ?? 0,
      position: player.position,
      price: player.price,
      priceChange: player.price - player.startPrice,
      points: player.totalPoints,
      pointsPerGame: player.pointsPerGame,
      form: player.form,
      owned: player.selectedByPercent,
      minutes: player.minutes,
      goals: player.goals,
      assists: player.assists,
      cleanSheets: player.cleanSheets,
      bonus: player.bonus,
      bps: player.bps,
      expectedGoals: player.expectedGoals,
      expectedAssists: player.expectedAssists,
      expectedInvolvement: player.expectedGoals + player.expectedAssists,
      next: runway.entries.slice(0, 3).map((entry) => ({
        opponent: teams.get(entry.opponent)?.shortName ?? '???',
        home: entry.isHome,
        difficulty: entry.difficulty,
      })),
      available: player.availability === 'available',
    };
  });

  return (
    <div className="shell">
      <header className={styles.head}>
        <p className="eyebrow">{rows.length} registered</p>
        <h1 className={styles.title}>Players</h1>
        <p className={styles.lede}>
          Search a name or a club, filter by position, and press any column to sort by it. The
          header and the name stay put while the numbers scroll, so a row three hundred deep still
          says who it is. Open a player for their season gameweek by gameweek.
        </p>
      </header>

      {rows.length === 0 ? (
        <p className={styles.empty}>
          The lake holds no players yet. Run <code>pnpm sync</code> to fill it.
        </p>
      ) : (
        <PlayerIndex rows={rows} />
      )}
    </div>
  );
}
