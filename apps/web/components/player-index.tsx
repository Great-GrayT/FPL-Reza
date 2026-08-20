'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Crest } from './crest';
import { PersonPhoto } from './person-photo';
import styles from './player-index.module.css';

/**
 * Every player, as a table dense enough to decide from.
 *
 * The table is its own scrolling pane rather than part of the page's scroll,
 * and that is the whole reason the header stays put. A header set to stick
 * inside a horizontally scrolling wrapper sticks to that wrapper, which is as
 * tall as the table, so it scrolls away with everything else: the rule was
 * there before this and did nothing. Making the pane scroll in both directions
 * gives the header something to stick to, and gives the name column the same,
 * so a row three hundred deep and eight columns across still says who it is and
 * what the number under the cursor means.
 *
 * Columns carry a priority. Below the wide breakpoints the lowest priorities are
 * dropped rather than squeezed, because a phone showing eighteen columns at four
 * pixels each shows nothing.
 */

export interface IndexRow {
  id: number;
  code: number;
  name: string;
  fullName: string;
  team: string;
  teamCode: number;
  position: string;
  price: number;
  /** Tenths moved since the season opened: what the market thinks. */
  priceChange: number;
  points: number;
  pointsPerGame: number;
  form: number;
  owned: number;
  minutes: number;
  goals: number;
  assists: number;
  cleanSheets: number;
  bonus: number;
  bps: number;
  expectedGoals: number;
  expectedAssists: number;
  expectedInvolvement: number;
  /** The next three fixtures by difficulty, 1 easy to 5 hard, with the opponent. */
  next: { opponent: string; home: boolean; difficulty: number }[];
  available: boolean;
}

const POSITIONS = ['ALL', 'GKP', 'DEF', 'MID', 'FWD'] as const;

type SortKey =
  | 'name'
  | 'price'
  | 'priceChange'
  | 'points'
  | 'pointsPerGame'
  | 'value'
  | 'form'
  | 'owned'
  | 'minutes'
  | 'goals'
  | 'assists'
  | 'expectedGoals'
  | 'expectedAssists'
  | 'expectedInvolvement'
  | 'cleanSheets'
  | 'bonus'
  | 'bps'
  | 'fixtures';

/**
 * Priority 1 is always shown. 2 goes at the tablet breakpoint, 3 on a phone,
 * so what survives on the smallest screen is who, where, what he costs, what he
 * has scored, and what is coming.
 */
interface Column {
  key: SortKey;
  label: string;
  /** What the abbreviation means, since a column head has room for neither. */
  title: string;
  priority: 1 | 2 | 3;
}

const COLUMNS: readonly Column[] = [
  { key: 'price', label: '£', title: 'Price, in millions', priority: 1 },
  { key: 'priceChange', label: 'Δ£', title: 'Price moved since the season opened', priority: 3 },
  { key: 'points', label: 'Pts', title: 'Total points this season', priority: 1 },
  { key: 'value', label: 'Pts/£', title: 'Points per million spent', priority: 2 },
  { key: 'pointsPerGame', label: 'PPG', title: 'Points per match played', priority: 3 },
  {
    key: 'form',
    label: 'Form',
    title: 'Points per match over the last five gameweeks',
    priority: 2,
  },
  { key: 'minutes', label: 'Min', title: 'Minutes played', priority: 3 },
  { key: 'goals', label: 'G', title: 'Goals', priority: 2 },
  { key: 'assists', label: 'A', title: 'Assists', priority: 2 },
  { key: 'expectedGoals', label: 'xG', title: 'Expected goals', priority: 3 },
  { key: 'expectedAssists', label: 'xA', title: 'Expected assists', priority: 3 },
  {
    key: 'expectedInvolvement',
    label: 'xGI',
    title: 'Expected goals plus expected assists',
    priority: 2,
  },
  { key: 'cleanSheets', label: 'CS', title: 'Clean sheets', priority: 3 },
  { key: 'bonus', label: 'B', title: 'Bonus points', priority: 3 },
  {
    key: 'bps',
    label: 'BPS',
    title: 'Bonus points system score, which decides the bonus',
    priority: 3,
  },
  { key: 'owned', label: 'Own', title: 'Share of managers who own him', priority: 2 },
  { key: 'fixtures', label: 'Next 3', title: 'The next three fixtures by difficulty', priority: 1 },
];

const normalise = (value: string): string =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The number a column sorts on, so sorting and rendering cannot disagree. */
function sortValue(row: IndexRow, key: SortKey): number {
  switch (key) {
    case 'name':
      return 0;
    case 'value':
      return row.points / Math.max(row.price / 10, 0.1);
    case 'fixtures': {
      // Easiest run first, and a player with no fixtures at all sorts last
      // rather than best, since a blank is not an easy match.
      if (row.next.length === 0) return -99;
      return -row.next.reduce((total, entry) => total + entry.difficulty, 0) / row.next.length;
    }
    default:
      return row[key];
  }
}

const cell = (row: IndexRow, key: SortKey): string => {
  switch (key) {
    case 'price':
      return (row.price / 10).toFixed(1);
    case 'priceChange':
      return row.priceChange === 0
        ? '0.0'
        : `${row.priceChange > 0 ? '+' : '−'}${(Math.abs(row.priceChange) / 10).toFixed(1)}`;
    case 'points':
      return String(row.points);
    case 'value':
      return (row.points / Math.max(row.price / 10, 0.1)).toFixed(1);
    case 'pointsPerGame':
      return row.pointsPerGame.toFixed(1);
    case 'form':
      return row.form.toFixed(1);
    case 'minutes':
      return row.minutes.toLocaleString('en-GB');
    case 'expectedGoals':
      return row.expectedGoals.toFixed(2);
    case 'expectedAssists':
      return row.expectedAssists.toFixed(2);
    case 'expectedInvolvement':
      return row.expectedInvolvement.toFixed(2);
    case 'owned':
      return `${row.owned.toFixed(1)}%`;
    case 'goals':
      return String(row.goals);
    case 'assists':
      return String(row.assists);
    case 'cleanSheets':
      return String(row.cleanSheets);
    case 'bonus':
      return String(row.bonus);
    case 'bps':
      return String(row.bps);
    default:
      return '';
  }
};

const LIMIT = 300;

export function PlayerIndex({ rows }: { rows: readonly IndexRow[] }) {
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState<(typeof POSITIONS)[number]>('ALL');
  const [sort, setSort] = useState<SortKey>('points');

  const shown = useMemo(() => {
    const needle = normalise(query.trim());
    const filtered = rows.filter((row) => {
      if (position !== 'ALL' && row.position !== position) return false;
      if (needle === '') return true;
      return normalise(`${row.fullName} ${row.name} ${row.team}`).includes(needle);
    });

    // Name sorts alphabetically; every other key sorts best first, since
    // "worst form" is not a thing anyone is looking for.
    return [...filtered].sort((a, b) =>
      sort === 'name' ? a.name.localeCompare(b.name) : sortValue(b, sort) - sortValue(a, sort),
    );
  }, [rows, query, position, sort]);

  return (
    <>
      <div className={styles.controls}>
        <label className={styles.search}>
          <span className="visually-hidden">Search players</span>
          <input
            type="search"
            value={query}
            placeholder="Search a player or club"
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </label>

        <div className={styles.filters} role="group" aria-label="Position">
          {POSITIONS.map((entry) => (
            <button
              key={entry}
              type="button"
              aria-pressed={entry === position}
              className={entry === position ? styles.chipOn : styles.chip}
              onClick={() => {
                setPosition(entry);
              }}
            >
              {entry === 'ALL' ? 'All' : entry}
            </button>
          ))}
        </div>
      </div>

      <p className={styles.status} role="status">
        {shown.length} of {rows.length} players, sorted by{' '}
        {COLUMNS.find((column) => column.key === sort)?.title.toLowerCase() ?? 'name'}.{' '}
        <span className={styles.hint}>Press a column to sort by it.</span>
      </p>

      {shown.length === 0 ? (
        <p className={styles.empty}>
          Nothing matches that. Clear the search or pick a different position.
        </p>
      ) : (
        <>
          <div className={styles.pane}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col" className={styles.nameHead}>
                    <button
                      type="button"
                      className={styles.sortButton}
                      aria-sort={sort === 'name' ? 'ascending' : 'none'}
                      onClick={() => {
                        setSort('name');
                      }}
                    >
                      Player
                    </button>
                  </th>
                  <th scope="col" className={styles.clubHead}>
                    Club
                  </th>
                  {COLUMNS.map((column) => (
                    <th
                      key={column.key}
                      scope="col"
                      data-priority={column.priority}
                      aria-sort={sort === column.key ? 'descending' : 'none'}
                    >
                      <button
                        type="button"
                        className={styles.sortButton}
                        title={column.title}
                        onClick={() => {
                          setSort(column.key);
                        }}
                      >
                        {column.label}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, LIMIT).map((row) => (
                  <tr key={row.id} data-sorted={sort}>
                    <th scope="row" className={styles.nameCell}>
                      <Link href={`/players/${String(row.id)}`} className={styles.link}>
                        <PersonPhoto kind="player" code={row.code} name={row.fullName} size="xs" />
                        <span className={styles.linkName}>{row.name}</span>
                        <span className={styles.pos}>{row.position}</span>
                      </Link>
                      {!row.available && (
                        <span className={styles.flag} title="Not fully available">
                          !
                        </span>
                      )}
                    </th>
                    <td className={styles.clubCell}>
                      <Link className={styles.club} href={`/teams/${String(row.teamCode)}`}>
                        <Crest code={row.teamCode} name={row.team} size={18} />
                        <span>{row.team}</span>
                      </Link>
                    </td>
                    {COLUMNS.map((column) =>
                      column.key === 'fixtures' ? (
                        <td key={column.key} data-priority={column.priority}>
                          <span className={styles.runway}>
                            {row.next.length === 0 ? (
                              <span className={styles.blank}>blank</span>
                            ) : (
                              row.next.map((entry, index) => (
                                <span
                                  key={`${entry.opponent}-${String(index)}`}
                                  className={styles.tick}
                                  data-difficulty={entry.difficulty}
                                  title={`${entry.home ? 'Home to' : 'Away at'} ${entry.opponent}, difficulty ${String(entry.difficulty)}`}
                                >
                                  {entry.opponent}
                                </span>
                              ))
                            )}
                          </span>
                        </td>
                      ) : (
                        <td
                          key={column.key}
                          data-priority={column.priority}
                          data-on={sort === column.key ? 'true' : undefined}
                          className="num"
                        >
                          {cell(row, column.key)}
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {shown.length > LIMIT && (
            <p className="eyebrow">
              Showing the first {LIMIT}. Narrow the search to see further down the list.
            </p>
          )}
        </>
      )}
    </>
  );
}
