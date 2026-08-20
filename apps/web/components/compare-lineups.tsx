'use client';

import { useMemo, useState } from 'react';
import { SQUAD_QUOTA, formatPrice, type Position } from '@fpl/core';
import { StrategyCodeError, decodeStrategy, encodeStrategy, type Strategy } from '@fpl/planner';
import type { PlannerPool } from '@/lib/planner/projections';
import type { ComparedLineup } from '@/lib/planner/protocol';
import { MiniPitch, type MiniPlayer } from './mini-pitch';
import styles from './compare-lineups.module.css';

/**
 * Line-ups a reader wants to put beside the optimiser's.
 *
 * The frontier answers "how good is this squad" against every legal squad at
 * once, which is a strong claim and an abstract one. What a manager actually
 * wants to know is narrower: how does the team I already own compare, and how
 * much does my one stubborn pick cost me. So a line-up can be added by hand or
 * pasted as a code, and it lands on the same scatter under the same axes.
 *
 * The switch is the interesting control. Off, the fifteen are held exactly as
 * given for the whole horizon, which answers "what is my team worth". On, they
 * are the squad the plan starts from and it may transfer over the horizon,
 * which answers "what is my team worth if I manage it". Those are different
 * questions with different answers and the page keeps them apart.
 *
 * Every added line-up carries a strategy code, because each one went through
 * the same search: a dot on a chart that cannot be reproduced is a claim
 * nobody can check.
 */

export interface Candidate {
  id: string;
  label: string;
  picks: number[];
  optimised: boolean;
  result: ComparedLineup;
  code: string;
}

const POSITIONS: Position[] = ['GKP', 'DEF', 'MID', 'FWD'];

export function CompareLineups({
  pool,
  strategy,
  candidates,
  onAdd,
  onRemove,
  running,
  error,
}: {
  pool: PlannerPool;
  strategy: Strategy;
  candidates: readonly Candidate[];
  onAdd: (picks: number[], optimise: boolean, label: string) => void;
  onRemove: (id: string) => void;
  running: boolean;
  error: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [optimise, setOptimise] = useState(true);
  const [query, setQuery] = useState('');
  const [picks, setPicks] = useState<number[]>([]);
  const [pasted, setPasted] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);

  const byCode = useMemo(
    () => new Map(pool.players.map((player) => [player.code, player])),
    [pool.players],
  );

  const held = picks.map((code) => byCode.get(code)).filter((player) => player !== undefined);
  const spent = held.reduce((total, player) => total + player.price, 0);
  const counts = new Map<Position, number>();
  for (const player of held) counts.set(player.position, (counts.get(player.position) ?? 0) + 1);
  const clubs = new Map<number, number>();
  for (const player of held) clubs.set(player.teamCode, (clubs.get(player.teamCode) ?? 0) + 1);

  const legal =
    picks.length === 15 &&
    POSITIONS.every((position) => (counts.get(position) ?? 0) === SQUAD_QUOTA[position]) &&
    [...clubs.values()].every((count) => count <= 3) &&
    spent <= strategy.budget;

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];
    return pool.players
      .filter((player) => player.name.toLowerCase().includes(needle))
      .filter((player) => !picks.includes(player.code))
      .slice(0, 8);
  }, [query, pool.players, picks]);

  const mini: MiniPlayer[] = held.map((player, index) => ({
    code: player.code,
    position: player.position,
    teamCode: player.teamCode,
    name: player.name,
    // Nothing is solved yet, so the preview shows the shape rather than an
    // eleven it has not chosen: the first of each line stands in.
    starter: index < 11,
    captain: false,
  }));

  const addPasted = (): void => {
    try {
      const decoded = decodeStrategy(pasted);
      if (decoded.squad.length !== 15) {
        setPasteError('that code carries no fifteen, so there is nothing to compare');
        return;
      }
      setPasteError(null);
      onAdd(decoded.squad, optimise, `code ${decoded.startGameweek.toString()}`);
      setPasted('');
    } catch (error: unknown) {
      setPasteError(
        error instanceof StrategyCodeError ? error.message : 'that code could not be read',
      );
    }
  };

  return (
    <div className={styles.compare}>
      <div className={styles.rows}>
        {candidates.length === 0 ? (
          <p className={styles.empty}>
            Nothing added yet. A line-up put here is drawn on the scatter above, under the same
            axes, so the comparison is a picture rather than an argument.
          </p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Line-up</th>
                <th scope="col" className={styles.right}>
                  Exp
                </th>
                <th scope="col" className={styles.right}>
                  Risk
                </th>
                <th scope="col" className={styles.right}>
                  Plan
                </th>
                <th scope="col" className={styles.right}>
                  Tr
                </th>
                <th scope="col">Code</th>
                <th scope="col" aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {candidates.map((candidate, index) => (
                <tr key={candidate.id}>
                  <td>
                    <span className={styles.key} data-index={index % 5} aria-hidden="true" />
                    {candidate.label}
                    {candidate.optimised ? ' · managed' : ' · held'}
                  </td>
                  <td className={`num ${styles.right}`}>{candidate.result.expected.toFixed(1)}</td>
                  <td className={`num ${styles.right}`}>{candidate.result.risk.toFixed(1)}</td>
                  <td className={`num ${styles.right}`}>{candidate.result.planTotal.toFixed(1)}</td>
                  <td className={`num ${styles.right}`}>{candidate.result.transfers}</td>
                  <td className={`num ${styles.code}`}>{candidate.code}</td>
                  <td>
                    <button
                      type="button"
                      className={styles.remove}
                      onClick={() => {
                        onRemove(candidate.id);
                      }}
                    >
                      <span className="visually-hidden">Remove {candidate.label}</span>
                      <span aria-hidden="true">×</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.button}
          aria-expanded={open}
          onClick={() => {
            setOpen((current) => !current);
          }}
        >
          {open ? 'Close' : 'Add a line-up'}
        </button>
        <label className={styles.switch}>
          <input
            type="checkbox"
            checked={optimise}
            onChange={(event) => {
              setOptimise(event.target.checked);
            }}
          />
          <span>
            {optimise
              ? 'Managed: the plan may transfer over the horizon'
              : 'Held: exactly these fifteen, every gameweek'}
          </span>
        </label>
        {running && <span className={styles.working}>Solving.</span>}
        {error !== null && (
          <span className={styles.error} role="alert">
            {error}
          </span>
        )}
      </div>

      {open && (
        <div className={styles.builder}>
          <div className={styles.pickers}>
            <label className={styles.field}>
              <span className={styles.label}>Search a player</span>
              <input
                className={styles.input}
                value={query}
                spellCheck={false}
                placeholder="Name"
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
              />
            </label>
            <ul className={styles.results}>
              {matches.map((player) => (
                <li key={player.code}>
                  <button
                    type="button"
                    className={styles.result}
                    onClick={() => {
                      setPicks((current) =>
                        current.length >= 15 ? current : [...current, player.code],
                      );
                    }}
                  >
                    <span>{player.name}</span>
                    <span className={`num ${styles.resultMeta}`}>
                      {player.position} {formatPrice(player.price)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            <label className={styles.field}>
              <span className={styles.label}>Or paste a code</span>
              <input
                className={`num ${styles.input}`}
                value={pasted}
                spellCheck={false}
                placeholder="FPL2-..."
                onChange={(event) => {
                  setPasted(event.target.value);
                }}
              />
            </label>
            <button type="button" className={styles.button} onClick={addPasted} disabled={running}>
              Add from code
            </button>
            {pasteError !== null && (
              <p className={styles.error} role="alert">
                {pasteError}
              </p>
            )}
          </div>

          <div className={styles.draft}>
            <p className={styles.draftHead}>
              <span className="num">{picks.length}</span>/15 ·{' '}
              <span className="num">{formatPrice(spent)}</span> of{' '}
              <span className="num">{formatPrice(strategy.budget)}</span>
            </p>
            <ul className={styles.draftList}>
              {held.map((player) => (
                <li key={player.code}>
                  <button
                    type="button"
                    className={styles.drop}
                    onClick={() => {
                      setPicks((current) => current.filter((code) => code !== player.code));
                    }}
                  >
                    <span className={styles.draftPos}>{player.position}</span>
                    <span>{player.name}</span>
                    <span aria-hidden="true">×</span>
                    <span className="visually-hidden">Remove</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className={styles.legalNote}>
              {legal
                ? 'Legal: two, five, five, three, inside the budget, no more than three from a club.'
                : 'Needs a legal fifteen: 2 GKP, 5 DEF, 5 MID, 3 FWD, inside the budget, at most three from any club.'}
            </p>
            <button
              type="button"
              className={styles.button}
              disabled={!legal || running}
              onClick={() => {
                onAdd(picks, optimise, `line-up ${String(candidates.length + 1)}`);
                setPicks([]);
                setOpen(false);
              }}
            >
              Add to the scatter
            </button>
          </div>
        </div>
      )}

      {open && mini.length > 0 && <MiniPreview players={mini} />}
    </div>
  );
}

/** The draft squad on a pitch, at the size the corner panel uses. */
function MiniPreview({ players }: { players: MiniPlayer[] }) {
  return (
    <div className={styles.preview}>
      <MiniPitch
        players={players}
        watch={{ current: null }}
        label="Line-up being built"
        alwaysShown
      />
    </div>
  );
}

/** A code for a compared line-up, so a dot on the chart can be reproduced. */
export function codeForCandidate(strategy: Strategy, picks: number[], fingerprint: string): string {
  return encodeStrategy({
    ...strategy,
    squad: picks,
    locks: picks.map((code) => ({ code, mode: 'start' as const })),
    fingerprint,
  });
}
