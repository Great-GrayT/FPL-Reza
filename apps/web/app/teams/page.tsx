import type { Metadata } from 'next';
import Link from 'next/link';
import { recentForm, teamRecord } from '@fpl/core';
import { estimateStrength } from '@fpl/analytics';
import { Crest } from '@/components/crest';
import { PersonChip } from '@/components/person-photo';
import { getAllMatches, getManagersByTeamCode, getTeams, season } from '@/lib/lake';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Clubs | FPL Lake',
  description: 'Every Premier League club, with its manager, its form, and its estimated strength',
};

export default async function TeamsPage() {
  const [teams, allMatches, managersByTeam] = await Promise.all([
    getTeams(),
    getAllMatches(),
    getManagersByTeamCode(),
  ]);

  const model = estimateStrength(allMatches);
  const thisSeason = allMatches.filter((match) => match.season === season);

  const rows = teams
    .map((team) => ({
      team,
      record: teamRecord(thisSeason, team.code),
      form: recentForm(allMatches, team.code),
      strength: model.teams.get(team.code),
      manager: managersByTeam
        .get(team.code)
        ?.find((entry) => entry.role.toLowerCase() === 'manager'),
    }))
    .sort(
      (a, b) =>
        b.record.points - a.record.points ||
        b.record.goalsFor - b.record.goalsAgainst - (a.record.goalsFor - a.record.goalsAgainst) ||
        a.team.name.localeCompare(b.team.name),
    );

  return (
    <div className="shell">
      <header className={styles.head}>
        <p className="eyebrow">
          {teams.length} clubs · {season}
        </p>
        <h1 className={styles.title}>Clubs</h1>
        <p className={styles.lede}>
          Ordered by this season&apos;s table where one exists, alphabetically before a ball is
          kicked. Attack and defence are ratios to the division average, estimated from results
          across every season on record and weighted so recent ones count for more.
        </p>
      </header>

      <ul className={styles.grid}>
        {rows.map(({ team, record, form, strength, manager }) => (
          <li key={team.code} className={styles.card}>
            <Link className={styles.cardLink} href={`/teams/${String(team.code)}`}>
              <Crest code={team.code} name={team.name} size={44} />
              <span className={styles.name}>{team.name}</span>
              <span className={`num ${styles.short}`}>{team.shortName}</span>
            </Link>

            {manager !== undefined && (
              <div className={styles.manager}>
                <PersonChip
                  kind="manager"
                  code={manager.photoCode}
                  name={manager.name}
                  detail="Manager"
                  size="sm"
                  href={`/managers/${String(manager.managerId)}`}
                />
              </div>
            )}

            <dl className={styles.stats}>
              <div>
                <dt>Played</dt>
                <dd className="num">{record.played}</dd>
              </div>
              <div>
                <dt>Points</dt>
                <dd className="num">{record.points}</dd>
              </div>
              <div>
                <dt>Attack</dt>
                <dd className="num">{strength === undefined ? '-' : strength.attack.toFixed(2)}</dd>
              </div>
              <div>
                <dt>Defence</dt>
                <dd className="num">
                  {strength === undefined ? '-' : strength.defence.toFixed(2)}
                </dd>
              </div>
            </dl>

            {form.length > 0 && (
              <p className={styles.form} aria-label={`Recent form: ${form.join(', ')}`}>
                {form.map((result, index) => (
                  <span key={index} className={styles[`form${result}`]} aria-hidden>
                    {result}
                  </span>
                ))}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
