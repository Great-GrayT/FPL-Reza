import type { Metadata } from 'next';
import { recentForm, teamRecord } from '@fpl/core';
import { Crest } from '@/components/crest';
import { PersonChip } from '@/components/person-photo';
import { getAllMatches, getManagers, getTeamsByCode, season } from '@/lib/lake';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Managers | FPL Lake',
  description: 'Who is in charge at every Premier League club, and what their side has done',
};

export default async function ManagersPage() {
  const [managers, teamsByCode, allMatches] = await Promise.all([
    getManagers(),
    getTeamsByCode(),
    getAllMatches(),
  ]);

  if (managers.length === 0) {
    return (
      <div className="shell">
        <header className={styles.head}>
          <h1 className={styles.title}>Managers</h1>
        </header>
        <p className={styles.empty}>
          No staff recorded. Run <code>fpl official matches</code> to read them from the Premier
          League&apos;s own record.
        </p>
      </div>
    );
  }

  const newestSeason = managers
    .map((manager) => manager.season)
    .sort((a, b) => b.localeCompare(a))[0];

  const heads = managers
    .filter(
      (manager) => manager.season === newestSeason && manager.role.toLowerCase() === 'manager',
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  const thisSeason = allMatches.filter((match) => match.season === season);

  return (
    <div className="shell">
      <header className={styles.head}>
        <p className="eyebrow">
          {heads.length} in charge · {newestSeason ?? season}
        </p>
        <h1 className={styles.title}>Managers</h1>
        <p className={styles.lede}>
          Head coaches as the Premier League records them, one per club per season. A club that
          changed manager mid season shows both, because that is what the record holds.
        </p>
      </header>

      <ul className={styles.grid}>
        {heads.map((manager) => {
          const club = teamsByCode.get(manager.teamCode);
          const record = teamRecord(thisSeason, manager.teamCode);
          const form = recentForm(allMatches, manager.teamCode);
          return (
            <li key={manager.managerId} className={styles.card}>
              <PersonChip
                kind="manager"
                code={manager.photoCode}
                name={manager.name}
                detail={manager.country ?? undefined}
                size="lg"
                href={`/managers/${String(manager.managerId)}`}
              />

              {club !== undefined && (
                <a className={styles.club} href={`/teams/${String(club.code)}`}>
                  <Crest code={club.code} name={club.name} size={22} />
                  <span>{club.name}</span>
                </a>
              )}

              <p className={styles.record}>
                <span className="num">{record.played}</span> played,{' '}
                <span className="num">{record.points}</span> points
              </p>

              <p className={styles.form}>
                {form.map((result, index) => (
                  <span key={index} className={styles[`form${result}`]}>
                    {result}
                  </span>
                ))}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
