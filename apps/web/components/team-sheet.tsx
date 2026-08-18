import Link from 'next/link';
import { PersonPhoto } from './person-photo';
import { PITCH_LENGTH, PITCH_WIDTH } from './pitch';
import styles from './team-sheet.module.css';

/**
 * A teamsheet drawn where the players actually stood, not as a list.
 *
 * The provider publishes the shape as rows of person ids from the back, which
 * is the only honest way to place eleven names: a label like "4-2-3-1" says
 * how many are in each band and nothing about who. Each band is spread evenly
 * across the width and stacked up the length, so the drawing is the formation
 * rather than a decoration beside it.
 */

export interface SheetPerson {
  personId: number;
  playerCode: number | null;
  playerId: number | null;
  name: string;
  shirt: number | null;
  captain: boolean;
  positionInfo: string | null;
}

export interface DrawnSheet {
  teamCode: number;
  teamName: string;
  formation: string | null;
  rows: SheetPerson[][];
  substitutes: SheetPerson[];
}

/** Where the bands sit along the pitch, keeper at the goal line outwards. */
function bandX(index: number, bands: number): number {
  if (bands <= 1) return 50;
  const first = 8;
  const last = 82;
  return first + ((last - first) * index) / (bands - 1);
}

function slotY(index: number, count: number): number {
  if (count <= 1) return 50;
  const margin = 12;
  return margin + ((100 - 2 * margin) * index) / (count - 1);
}

export function TeamSheetPitch({
  sheet,
  mirrored = false,
}: {
  sheet: DrawnSheet;
  mirrored?: boolean;
}) {
  const bands = sheet.rows.length;

  return (
    <div className={styles.pitchWrap}>
      <svg
        className={styles.pitch}
        viewBox={`0 0 ${String(PITCH_LENGTH)} ${String(PITCH_WIDTH)}`}
        role="img"
        aria-label={`${sheet.teamName} lined up ${sheet.formation ?? 'as shown'}`}
      >
        <rect x={0} y={0} width={PITCH_LENGTH} height={PITCH_WIDTH} className={styles.turf} />
        <g className={styles.lines}>
          <rect x={0.5} y={0.5} width={PITCH_LENGTH - 1} height={PITCH_WIDTH - 1} />
          <line x1={PITCH_LENGTH} y1={0} x2={PITCH_LENGTH} y2={PITCH_WIDTH} />
          <circle cx={PITCH_LENGTH} cy={PITCH_WIDTH / 2} r={9.15} />
          <rect x={0.5} y={(PITCH_WIDTH - 40.3) / 2} width={16.5} height={40.3} />
          <rect x={0.5} y={(PITCH_WIDTH - 18.3) / 2} width={5.5} height={18.3} />
        </g>

        {sheet.rows.map((band, bandIndex) =>
          band.map((person, slot) => {
            const x = (bandX(bandIndex, bands) / 100) * PITCH_LENGTH;
            const y = (slotY(slot, band.length) / 100) * PITCH_WIDTH;
            const drawnX = mirrored ? PITCH_LENGTH - x : x;
            return (
              <g key={person.personId} className={styles.node}>
                <circle cx={drawnX} cy={y} r={3.4} />
                <text x={drawnX} y={y + 1.2} textAnchor="middle" className={styles.shirt}>
                  {person.shirt ?? ''}
                </text>
                <text x={drawnX} y={y + 7.6} textAnchor="middle" className={styles.label}>
                  {person.name.split(' ').slice(-1)[0]}
                </text>
              </g>
            );
          }),
        )}
      </svg>
    </div>
  );
}

function PersonLine({ person }: { person: SheetPerson }) {
  const body = (
    <>
      <span className={`num ${styles.shirtNumber}`}>{person.shirt ?? '-'}</span>
      <PersonPhoto kind="player" code={person.playerCode} name={person.name} size="xs" />
      <span className={styles.personName}>
        {person.name}
        {person.captain && <abbr title="Captain"> (C)</abbr>}
      </span>
      <span className={styles.personRole}>{person.positionInfo ?? ''}</span>
    </>
  );

  return (
    <li className={styles.person}>
      {person.playerId === null ? (
        <span className={styles.personInner}>{body}</span>
      ) : (
        <Link
          className={`${styles.personInner} ${styles.personLink}`}
          href={`/players/${String(person.playerId)}`}
        >
          {body}
        </Link>
      )}
    </li>
  );
}

export function TeamSheetList({ sheet }: { sheet: DrawnSheet }) {
  const starters = sheet.rows.flat();
  return (
    <div className={styles.listWrap}>
      <ol className={styles.people}>
        {starters.map((person) => (
          <PersonLine key={person.personId} person={person} />
        ))}
      </ol>
      {sheet.substitutes.length > 0 && (
        <>
          <p className={`eyebrow ${styles.subsHeading}`}>Substitutes</p>
          <ol className={styles.people}>
            {sheet.substitutes.map((person) => (
              <PersonLine key={person.personId} person={person} />
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
