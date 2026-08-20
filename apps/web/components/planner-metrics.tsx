'use client';

import { formatPrice } from '@fpl/core';
import type { WirePlayer } from '@/lib/planner/projections';
import type { WeekRow } from './planner-panels';
import styles from './planner-panels.module.css';

/**
 * What a squad is made of, and what it costs to run.
 *
 * The rest of the page answers "what is this plan worth". These answer the two
 * questions a reader asks next: where the money goes, and what the projection
 * is actually built from. A projection nobody can take apart is one they can
 * only trust or ignore, and neither is what this site is for.
 */

/**
 * Money in and out, week by week.
 *
 * A plan that spends its bank in gameweek 3 has made a decision, and until now
 * nothing printed it. Receipts are what the squad gets for a sale, which is not
 * the seller's price: FPL passes on a fall in full and only half a rise, and the
 * plan prices every sale that way, so the ledger here matches the search rather
 * than a naive difference.
 */
export function CashFlow({
  weeks,
  byCode,
}: {
  weeks: readonly WeekRow[];
  byCode: Map<number, WirePlayer>;
}) {
  const priceOf = (code: number): number => byCode.get(code)?.price ?? 0;

  const rows = weeks.map((week) => {
    const spent = week.transfersIn.reduce((total, code) => total + priceOf(code), 0);
    const received = week.transfersOut.reduce((total, code) => total + priceOf(code), 0);
    return {
      gameweek: week.gameweek,
      spent,
      received,
      net: received - spent,
      bank: week.bank,
      value: week.squadValue,
      hit: week.hit,
    };
  });

  const moved = rows.some((row) => row.spent > 0 || row.received > 0);

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">GW</th>
          <th scope="col" className={styles.right}>
            Out
          </th>
          <th scope="col" className={styles.right}>
            In
          </th>
          <th scope="col" className={styles.right}>
            Net
          </th>
          <th scope="col" className={styles.right}>
            Bank
          </th>
          <th scope="col" className={styles.right}>
            Value
          </th>
          <th scope="col" className={styles.right}>
            Hit
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.gameweek} data-warn={row.hit > 0 ? 'true' : undefined}>
            <td className="num">{row.gameweek}</td>
            <td className={`num ${styles.right}`}>
              {row.received === 0 ? '·' : formatPrice(row.received)}
            </td>
            <td className={`num ${styles.right}`}>
              {row.spent === 0 ? '·' : formatPrice(row.spent)}
            </td>
            <td className={`num ${styles.right}`}>{row.net === 0 ? '·' : formatPrice(row.net)}</td>
            <td className={`num ${styles.right}`}>{formatPrice(row.bank)}</td>
            <td className={`num ${styles.right}`}>{formatPrice(row.value)}</td>
            <td className={`num ${styles.right}`}>{row.hit === 0 ? '·' : `-${String(row.hit)}`}</td>
          </tr>
        ))}
      </tbody>
      <caption className={styles.caption}>
        {moved
          ? 'Receipts are what a sale returns, which is the purchase price plus half of any rise, the same rule the search prices transfers with.'
          : 'The plan makes no transfer over this horizon, so no money moves: the bank and the value are the same every week.'}
      </caption>
    </table>
  );
}

/**
 * The rates the projection is built from, summed over the eleven that start.
 *
 * A team's expected goals in a gameweek is each starter's rate per ninety,
 * scaled by the minutes he is expected to play and by the matches his club
 * actually has that week: a blank is a zero and a double is two, the same way
 * the projection treats them.
 *
 * These are measured rates over a form window, not a forecast of one match, and
 * they are the ingredients of the projection rather than a second opinion on
 * it: if the two disagreed, one of them would be wrong.
 */
export function Output({
  weeks,
  byCode,
  matches,
  fromGameweek,
}: {
  weeks: readonly WeekRow[];
  byCode: Map<number, WirePlayer>;
  /** Matches per club per gameweek, in gameweek order. */
  matches: Record<string, number[]>;
  fromGameweek: number;
}) {
  const rows = weeks.map((week) => {
    const index = week.gameweek - fromGameweek;
    const totals = { xg: 0, xa: 0, cbi: 0, bps: 0 };
    for (const code of week.starters) {
      const player = byCode.get(code);
      if (player === undefined) continue;
      const played = matches[String(player.teamCode)]?.[index] ?? 1;
      const share = (player.minutes / 90) * played;
      totals.xg += player.xg90 * share;
      totals.xa += player.xa90 * share;
      totals.cbi += player.cbi90 * share;
      totals.bps += player.bps90 * share;
    }
    return { gameweek: week.gameweek, ...totals };
  });

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">GW</th>
          <th scope="col" className={styles.right}>
            xG
          </th>
          <th scope="col" className={styles.right}>
            xA
          </th>
          <th scope="col" className={styles.right}>
            xGI
          </th>
          <th scope="col" className={styles.right}>
            CBI
          </th>
          <th scope="col" className={styles.right}>
            BPS
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.gameweek}>
            <td className="num">{row.gameweek}</td>
            <td className={`num ${styles.right}`}>{row.xg.toFixed(2)}</td>
            <td className={`num ${styles.right}`}>{row.xa.toFixed(2)}</td>
            <td className={`num ${styles.right}`}>{(row.xg + row.xa).toFixed(2)}</td>
            <td className={`num ${styles.right}`}>{row.cbi.toFixed(1)}</td>
            <td className={`num ${styles.right}`}>{row.bps.toFixed(0)}</td>
          </tr>
        ))}
      </tbody>
      <caption className={styles.caption}>
        The starting eleven&apos;s own per ninety rates over the form window, scaled by expected
        minutes and by the matches each club plays that week. Ingredients of the projection, not a
        second opinion on it.
      </caption>
    </table>
  );
}

const SCATTER = { width: 210, height: 130, pad: { top: 8, right: 8, bottom: 18, left: 26 } };

/**
 * One relation, with the squad marked.
 *
 * Levels say what a squad is worth; relations say whether it is well built. The
 * cloud is every player in the pool and the filled marks are the fifteen, so a
 * player being carried shows up as a mark below the cloud at his price, and a
 * differential as one out on its own to the left.
 */
export function Relation({
  players,
  held,
  x,
  y,
  xLabel,
  yLabel,
  note,
}: {
  players: readonly WirePlayer[];
  held: readonly number[];
  x: (player: WirePlayer) => number;
  y: (player: WirePlayer) => number;
  xLabel: string;
  yLabel: string;
  note: string;
}) {
  const points = players.filter(
    (player) => Number.isFinite(x(player)) && Number.isFinite(y(player)),
  );
  if (points.length === 0) return null;
  const inSquad = new Set(held);

  const xs = points.map(x);
  const ys = points.map(y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const px = (value: number): number =>
    SCATTER.pad.left +
    ((value - minX) / Math.max(1e-9, maxX - minX)) *
      (SCATTER.width - SCATTER.pad.left - SCATTER.pad.right);
  const py = (value: number): number =>
    SCATTER.height -
    SCATTER.pad.bottom -
    ((value - minY) / Math.max(1e-9, maxY - minY)) *
      (SCATTER.height - SCATTER.pad.top - SCATTER.pad.bottom);

  return (
    <figure className={styles.relation}>
      <svg
        viewBox={`0 0 ${String(SCATTER.width)} ${String(SCATTER.height)}`}
        role="img"
        aria-label={`${yLabel} against ${xLabel}, with the squad marked.`}
      >
        <g className={styles.relationAxes}>
          <line
            x1={SCATTER.pad.left}
            y1={SCATTER.pad.top}
            x2={SCATTER.pad.left}
            y2={SCATTER.height - SCATTER.pad.bottom}
          />
          <line
            x1={SCATTER.pad.left}
            y1={SCATTER.height - SCATTER.pad.bottom}
            x2={SCATTER.width - SCATTER.pad.right}
            y2={SCATTER.height - SCATTER.pad.bottom}
          />
        </g>
        {points
          .filter((player) => !inSquad.has(player.code))
          .map((player) => (
            <circle
              key={player.code}
              className={styles.relationDot}
              cx={px(x(player))}
              cy={py(y(player))}
              r={1.1}
            />
          ))}
        {points
          .filter((player) => inSquad.has(player.code))
          .map((player) => (
            <circle
              key={player.code}
              className={styles.relationHeld}
              cx={px(x(player))}
              cy={py(y(player))}
              r={2.6}
            >
              <title>{`${player.name}: ${x(player).toFixed(1)}, ${y(player).toFixed(1)}`}</title>
            </circle>
          ))}
        <text className={styles.relationLabel} x={SCATTER.pad.left} y={SCATTER.height - 4}>
          {xLabel}
        </text>
        <text
          className={styles.relationLabel}
          x={4}
          y={SCATTER.pad.top}
          transform={`rotate(-90 4 ${String(SCATTER.pad.top)})`}
        >
          {yLabel}
        </text>
      </svg>
      <figcaption className={styles.caption}>{note}</figcaption>
    </figure>
  );
}
