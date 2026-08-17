import type { Metadata } from 'next';
import { playerFullName } from '@fpl/core';
import { PlayerIndex, type IndexRow } from '@/components/player-index';
import { getPlayers, getTeamsById } from '@/lib/lake';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Players | FPL Lake',
  description: 'Every Fantasy Premier League player, searchable and sortable',
};

export default async function PlayersPage() {
  const [players, teams] = await Promise.all([getPlayers(), getTeamsById()]);

  const rows: IndexRow[] = players.map((player) => {
    const team = teams.get(player.teamId);
    return {
      id: player.id,
      code: player.code,
      name: player.webName,
      fullName: playerFullName(player),
      team: team?.shortName ?? '???',
      teamCode: team?.code ?? 0,
      position: player.position,
      price: player.price,
      points: player.totalPoints,
      form: player.form,
      owned: player.selectedByPercent,
      minutes: player.minutes,
      expectedInvolvement: player.expectedGoals + player.expectedAssists,
      available: player.availability === 'available',
    };
  });

  return (
    <div className="shell">
      <header className={styles.head}>
        <p className="eyebrow">{rows.length} registered</p>
        <h1 className={styles.title}>Players</h1>
        <p className={styles.lede}>
          Search a name or a club, filter by position, and sort by whichever column you are actually
          deciding on. Open a player for their season gameweek by gameweek.
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
