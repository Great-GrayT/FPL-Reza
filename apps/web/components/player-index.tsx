'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import styles from './player-index.module.css';

export interface IndexRow {
  id: number;
  code: number;
  name: string;
  fullName: string;
  team: string;
  teamCode: number;
  position: string;
  price: number;
  points: number;
  form: number;
  owned: number;
  minutes: number;
  expectedInvolvement: number;
  available: boolean;
}

const POSITIONS = ['ALL', 'GKP', 'DEF', 'MID', 'FWD'] as const;

type SortKey = 'points' | 'form' | 'price' | 'owned' | 'value' | 'name';

const SORTS: readonly { key: SortKey; label: string }[] = [
  { key: 'points', label: 'Points' },
  { key: 'form', label: 'Form' },
  { key: 'price', label: 'Price' },
  { key: 'owned', label: 'Owned' },
  { key: 'value', label: 'Points per million' },
  { key: 'name', label: 'Name' },
];

const normalise = (value: string): string =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

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
    return [...filtered].sort((a, b) => {
      switch (sort) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'value':
          return b.points / b.price - a.points / a.price;
        default:
          return b[sort] - a[sort];
      }
    });
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

        <label className={styles.sort}>
          <span className="eyebrow">Sort</span>
          <select
            value={sort}
            onChange={(event) => {
              setSort(event.target.value as SortKey);
            }}
          >
            {SORTS.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="eyebrow" role="status">
        {shown.length} of {rows.length} players
      </p>

      {shown.length === 0 ? (
        <p className={styles.empty}>
          Nothing matches that. Clear the search or pick a different position.
        </p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Player</th>
                <th scope="col">Club</th>
                <th scope="col">Pos</th>
                <th scope="col" className={styles.right}>
                  Price
                </th>
                <th scope="col" className={styles.right}>
                  Pts
                </th>
                <th scope="col" className={styles.right}>
                  Form
                </th>
                <th scope="col" className={styles.right}>
                  Owned
                </th>
                <th scope="col" className={styles.right}>
                  Min
                </th>
                <th scope="col" className={styles.right}>
                  xG + xA
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, 300).map((row) => (
                <tr key={row.id}>
                  <th scope="row">
                    <Link href={`/players/${String(row.id)}`} className={styles.link}>
                      {row.name}
                    </Link>
                    {!row.available && (
                      <span className={styles.flag} title="Not fully available">
                        !
                      </span>
                    )}
                  </th>
                  <td className={styles.dim}>{row.team}</td>
                  <td className={styles.dim}>{row.position}</td>
                  <td className={`num ${styles.right}`}>{(row.price / 10).toFixed(1)}</td>
                  <td className={`num ${styles.right} ${styles.strong}`}>{row.points}</td>
                  <td className={`num ${styles.right}`}>{row.form.toFixed(1)}</td>
                  <td className={`num ${styles.right} ${styles.dim}`}>{row.owned.toFixed(1)}%</td>
                  <td className={`num ${styles.right} ${styles.dim}`}>{row.minutes}</td>
                  <td className={`num ${styles.right} ${styles.dim}`}>
                    {row.expectedInvolvement.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length > 300 && (
            <p className="eyebrow">
              Showing the first 300. Narrow the search to see further down the list.
            </p>
          )}
        </div>
      )}
    </>
  );
}
