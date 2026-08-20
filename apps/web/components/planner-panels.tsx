'use client';

import { formatPrice, type Position } from '@fpl/core';
import type { PlannerPlayer, WeekPlan } from '@fpl/planner';
import styles from './planner-panels.module.css';

/**
 * The instruments on the plan page.
 *
 * A plan is a sequence of decisions and the page's job is to let a reader
 * interrogate them, so the layout is a terminal rather than an article: every
 * panel answers one question, sits in the same grid, and is dense enough that
 * two panels can be compared without scrolling between them. Figures are
 * monospace and right aligned so a column reads as a column; charts are hand
 * rolled and small, because at this size a charting library is mostly padding.
 *
 * Every panel here is a view of the plan the worker already solved. None of
 * them decides anything, and none of them recomputes a projection: that would
 * be a second opinion on the page whose whole point is that there is one.
 */

const POSITIONS: Position[] = ['GKP', 'DEF', 'MID', 'FWD'];

export interface WeekRow extends WeekPlan {
  spread: number;
}

/** A panel: a label, an optional figure in the corner, and the instrument. */
export function Panel({
  title,
  note,
  span = 6,
  children,
}: {
  title: string;
  note?: string | undefined;
  /** Columns out of twelve. */
  span?: number;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.panel} data-span={span}>
      <header className={styles.panelHead}>
        <h2 className={styles.panelTitle}>{title}</h2>
        {note !== undefined && <span className={`num ${styles.panelNote}`}>{note}</span>}
      </header>
      <div className={styles.panelBody}>{children}</div>
    </section>
  );
}

/**
 * Expected points per gameweek, with the band the spread implies, and the
 * running total over it.
 *
 * The band is one standard deviation of that week's own eleven. It is drawn
 * rather than printed because the shape of the uncertainty is the point: a
 * plan whose band never narrows is a plan resting on players nobody is sure
 * about, and that is invisible in a total.
 */
export function PointsSeries({ weeks }: { weeks: readonly WeekRow[] }) {
  if (weeks.length === 0) return null;
  const width = 100;
  const height = 46;
  const top = Math.max(...weeks.map((week) => week.expectedPoints + week.spread), 1);
  const x = (index: number): number =>
    weeks.length === 1 ? width / 2 : (index / (weeks.length - 1)) * width;
  const y = (value: number): number => height - (value / top) * height;

  const mid = weeks.map((week, index) => `${String(x(index))},${String(y(week.expectedPoints))}`);
  const upper = weeks.map(
    (week, index) => `${String(x(index))},${String(y(week.expectedPoints + week.spread))}`,
  );
  const lower = [...weeks]
    .map((week, index) => ({ week, index }))
    .reverse()
    .map(
      ({ week, index }) =>
        `${String(x(index))},${String(y(Math.max(0, week.expectedPoints - week.spread)))}`,
    );

  const total = weeks.reduce((sum, week) => sum + week.expectedPoints, 0);

  return (
    <div className={styles.chartRow}>
      <svg
        className={styles.spark}
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Expected points per gameweek, ${weeks[0]?.expectedPoints.toFixed(1) ?? ''} to ${weeks.at(-1)?.expectedPoints.toFixed(1) ?? ''}, totalling ${total.toFixed(1)}.`}
      >
        <polygon className={styles.band} points={[...upper, ...lower].join(' ')} />
        <polyline className={styles.line} points={mid.join(' ')} fill="none" />
      </svg>
      <ol className={styles.weekScale}>
        {weeks.map((week) => (
          <li key={week.gameweek} className="num">
            {week.gameweek}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The running total, which is what a manager actually banks. */
export function CumulativeSeries({ weeks }: { weeks: readonly WeekRow[] }) {
  if (weeks.length === 0) return null;
  const width = 100;
  const height = 46;
  let running = 0;
  const points = weeks.map((week) => {
    running += week.expectedPoints;
    return running;
  });
  const top = Math.max(...points, 1);
  const x = (index: number): number =>
    weeks.length === 1 ? width / 2 : (index / (weeks.length - 1)) * width;

  return (
    <div className={styles.chartRow}>
      <svg
        className={styles.spark}
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Running total, reaching ${running.toFixed(1)} points.`}
      >
        <polyline
          className={styles.line}
          fill="none"
          points={points
            .map((value, index) => `${String(x(index))},${String(height - (value / top) * height)}`)
            .join(' ')}
        />
      </svg>
      <p className={styles.figureLine}>
        <span className="num">{running.toFixed(1)}</span> points by gameweek{' '}
        <span className="num">{weeks.at(-1)?.gameweek ?? ''}</span>
      </p>
    </div>
  );
}

/**
 * Team value and the bank, week by week.
 *
 * Where the plan moves neither, the chart is replaced by the sentence that
 * says so: a flat line drawn as a chart implies a measurement that was never
 * made, and the price model in this lake moves almost nothing.
 */
export function ValueSeries({ weeks }: { weeks: readonly WeekRow[] }) {
  const values = weeks.map((week) => week.squadValue + week.bank);
  const moved = new Set(values).size > 1;
  if (!moved) {
    return (
      <p className={styles.flat}>
        The plan moves no money: every squad it holds is worth{' '}
        <span className="num">{formatPrice(values[0] ?? 0)}</span>. Prices are held at today&apos;s,
        and no player in this pool reaches the rise probability the price model needs, so a chart
        here would draw a measurement nobody made.
      </p>
    );
  }

  const top = Math.max(...values);
  const floor = Math.min(...values);
  const span = top - floor || 1;
  return (
    <div className={styles.chartRow}>
      <svg
        className={styles.spark}
        viewBox="0 0 100 46"
        preserveAspectRatio="none"
        role="img"
        aria-label="Team value across the horizon."
      >
        <polyline
          className={styles.line}
          fill="none"
          points={values
            .map(
              (value, index) =>
                `${String((index / Math.max(1, values.length - 1)) * 100)},${String(46 - ((value - floor) / span) * 46)}`,
            )
            .join(' ')}
        />
      </svg>
      <p className={styles.figureLine}>
        <span className="num">{formatPrice(floor)}</span> to{' '}
        <span className="num">{formatPrice(top)}</span>
      </p>
    </div>
  );
}

/**
 * The armband, and how much it was worth choosing.
 *
 * A captain is doubled, so the decision is worth the margin between the best
 * starter and the second best, not the captain's projection. A week with a
 * margin of a tenth is a week where the armband did not matter and a reader
 * should stop agonising over it.
 */
export function Captaincy({
  weeks,
  byCode,
  fromGameweek,
}: {
  weeks: readonly WeekRow[];
  byCode: Map<number, PlannerPlayer>;
  fromGameweek: number;
}) {
  const rows = weeks.map((week) => {
    const index = week.gameweek - fromGameweek;
    const scored = week.starters
      .map((code) => ({ code, points: byCode.get(code)?.projections[index] ?? 0 }))
      .sort((a, b) => b.points - a.points);
    const best = scored[0];
    const next = scored[1];
    return {
      gameweek: week.gameweek,
      name: week.captain === null ? '—' : (byCode.get(week.captain)?.name ?? '—'),
      points: best?.points ?? 0,
      margin: (best?.points ?? 0) - (next?.points ?? 0),
    };
  });

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">GW</th>
          <th scope="col">Captain</th>
          <th scope="col" className={styles.right}>
            Proj
          </th>
          <th scope="col" className={styles.right}>
            Margin
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.gameweek} data-close={row.margin < 0.5 ? 'true' : undefined}>
            <td className="num">{row.gameweek}</td>
            <td>{row.name}</td>
            <td className={`num ${styles.right}`}>{row.points.toFixed(1)}</td>
            <td className={`num ${styles.right}`}>{row.margin.toFixed(1)}</td>
          </tr>
        ))}
      </tbody>
      <caption className={styles.caption}>
        Margin is the gap to the next best starter, which is what the armband is actually worth.
        Rows under half a point are marked: those weeks the choice does not matter.
      </caption>
    </table>
  );
}

/**
 * What the squad is exposed to: blanks, doubles, and how concentrated it is.
 *
 * A blank is asked of this squad rather than of the league, because a blank
 * nobody in the fifteen plays through is not this squad's blank.
 */
export function Exposure({
  weeks,
  byCode,
  calendar,
}: {
  weeks: readonly WeekRow[];
  byCode: Map<number, PlannerPlayer>;
  calendar: readonly { gameweek: number; blanks: number[]; doubles: number[] }[];
}) {
  const marks = new Map(calendar.map((entry) => [entry.gameweek, entry]));

  const rows = weeks.map((week) => {
    const clubs = week.picks.map((code) => byCode.get(code)?.teamCode ?? 0);
    const entry = marks.get(week.gameweek);
    const counts = new Map<number, number>();
    for (const club of clubs) counts.set(club, (counts.get(club) ?? 0) + 1);
    return {
      gameweek: week.gameweek,
      blanking: clubs.filter((club) => (entry?.blanks ?? []).includes(club)).length,
      doubling: clubs.filter((club) => (entry?.doubles ?? []).includes(club)).length,
      heaviest: Math.max(0, ...counts.values()),
      clubs: counts.size,
    };
  });

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">GW</th>
          <th scope="col" className={styles.right}>
            Blank
          </th>
          <th scope="col" className={styles.right}>
            Double
          </th>
          <th scope="col" className={styles.right}>
            Clubs
          </th>
          <th scope="col" className={styles.right}>
            Heaviest
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.gameweek} data-warn={row.blanking >= 3 ? 'true' : undefined}>
            <td className="num">{row.gameweek}</td>
            <td className={`num ${styles.right}`}>{row.blanking === 0 ? '·' : row.blanking}</td>
            <td className={`num ${styles.right}`}>{row.doubling === 0 ? '·' : row.doubling}</td>
            <td className={`num ${styles.right}`}>{row.clubs}</td>
            <td className={`num ${styles.right}`}>{row.heaviest}</td>
          </tr>
        ))}
      </tbody>
      <caption className={styles.caption}>
        Players of the fifteen whose club blanks or doubles that week, how many clubs the squad
        draws on, and the most it holds from any one. Three or more blanking is marked.
      </caption>
    </table>
  );
}

/** Where the money went, which is the decision a budget actually is. */
export function Spend({
  picks,
  byCode,
  bank,
}: {
  picks: readonly number[];
  byCode: Map<number, PlannerPlayer>;
  bank: number;
}) {
  const rows = POSITIONS.map((position) => {
    const held = picks
      .map((code) => byCode.get(code))
      .filter((player): player is PlannerPlayer => player?.position === position);
    return {
      position,
      count: held.length,
      spent: held.reduce((total, player) => total + player.price, 0),
    };
  });
  const spent = rows.reduce((total, row) => total + row.spent, 0);

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">Line</th>
          <th scope="col" className={styles.right}>
            No.
          </th>
          <th scope="col" className={styles.right}>
            Spent
          </th>
          <th scope="col" className={styles.right}>
            Share
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.position}>
            <td>{row.position}</td>
            <td className={`num ${styles.right}`}>{row.count}</td>
            <td className={`num ${styles.right}`}>{formatPrice(row.spent)}</td>
            <td className={`num ${styles.right}`}>
              {spent === 0 ? '·' : `${((row.spent / spent) * 100).toFixed(0)}%`}
            </td>
          </tr>
        ))}
        <tr className={styles.total}>
          <td>Bank</td>
          <td className={`num ${styles.right}`}>—</td>
          <td className={`num ${styles.right}`}>{formatPrice(bank)}</td>
          <td className={`num ${styles.right}`}>—</td>
        </tr>
      </tbody>
    </table>
  );
}
