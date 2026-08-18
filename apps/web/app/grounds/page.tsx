import type { Metadata } from 'next';
import Link from 'next/link';
import { Crest } from '@/components/crest';
import { GroundPhoto } from '@/components/ground-photo';
import { getGroundImages, getGrounds, getTeamsByCode } from '@/lib/lake';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Grounds | FPL Lake',
  description: 'Every Premier League ground, its capacity, and where it is',
};

export default async function GroundsPage() {
  const [grounds, images, teamsByCode] = await Promise.all([
    getGrounds(),
    getGroundImages(),
    getTeamsByCode(),
  ]);

  if (grounds.length === 0) {
    return (
      <div className="shell">
        <header className={styles.head}>
          <h1 className={styles.title}>Grounds</h1>
        </header>
        <p className={styles.empty}>
          No grounds stored. Run <code>fpl official matches</code>, then{' '}
          <code>fpl official grounds</code> for the photographs.
        </p>
      </div>
    );
  }

  const ordered = [...grounds].sort((a, b) => (b.capacity ?? 0) - (a.capacity ?? 0));
  const photographed = ordered.filter((ground) => images.has(ground.groundId)).length;
  const totalSeats = ordered.reduce((sum, ground) => sum + (ground.capacity ?? 0), 0);

  return (
    <div className="shell">
      <header className={styles.head}>
        <p className="eyebrow">
          {grounds.length} grounds · {totalSeats.toLocaleString('en-GB')} seats
        </p>
        <h1 className={styles.title}>Grounds</h1>
        <p className={styles.lede}>
          Where the season is played, largest first. Photographs are freely licensed files from
          Wikimedia Commons, matched to each ground by its coordinates rather than by its name, and
          every one carries its photographer and licence. {photographed} of {grounds.length} have
          one: the rest had no file whose credit could be read, and publishing a photograph without
          its credit is not something this site will do.
        </p>
      </header>

      <ul className={styles.grid}>
        {ordered.map((ground) => {
          const club = ground.teamCode === null ? undefined : teamsByCode.get(ground.teamCode);
          return (
            <li key={ground.groundId} className={styles.card}>
              <GroundPhoto ground={ground} image={images.get(ground.groundId)} size="card" />
              {club !== undefined && (
                <Link className={styles.club} href={`/teams/${String(club.code)}`}>
                  <Crest code={club.code} name={club.name} size={22} />
                  <span>{club.name}</span>
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
