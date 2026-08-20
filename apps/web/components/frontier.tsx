'use client';

import type { CSSProperties } from 'react';
import { formatPrice } from '@fpl/core';
import type { PortfolioView } from '@/lib/planner/protocol';
import styles from './frontier.module.css';

/**
 * The squad as a portfolio, and the trade it made.
 *
 * A plan reports one number and a band around it. The band is a consequence of
 * the fifteen it holds, and on its own it says nothing about whether that was a
 * good trade: a safer squad is available at every level of return, and the
 * question is how much return this one gave up to be as safe as it is.
 *
 * So the frontier is drawn, and the held squad is drawn on it. A point above
 * and left of the curve is impossible under the constraints; a point below and
 * right of it is a squad that could have had more expected points at the same
 * risk, and the gap is what that costs. Both axes are the horizon's totals, not
 * a week's, because a horizon is what was planned.
 *
 * Hand rolled rather than charted: it is fifteen points and a line, and a
 * charting library would be asked to hide most of itself.
 */

const WIDTH = 320;
const HEIGHT = 200;
const PAD = { top: 14, right: 14, bottom: 30, left: 40 };

export function Frontier({ portfolio }: { portfolio: PortfolioView }) {
  const points = [...portfolio.frontier].sort((a, b) => a.risk - b.risk);
  if (points.length < 2) return null;

  const risks = [...points.map((point) => point.risk), portfolio.held.risk];
  const returns = [...points.map((point) => point.expected), portfolio.held.expected];
  const minRisk = Math.min(...risks);
  const maxRisk = Math.max(...risks);
  const minReturn = Math.min(...returns);
  const maxReturn = Math.max(...returns);

  const spanRisk = maxRisk - minRisk || 1;
  const spanReturn = maxReturn - minReturn || 1;
  const x = (risk: number): number =>
    PAD.left + ((risk - minRisk) / spanRisk) * (WIDTH - PAD.left - PAD.right);
  const y = (value: number): number =>
    HEIGHT - PAD.bottom - ((value - minReturn) / spanReturn) * (HEIGHT - PAD.top - PAD.bottom);

  const curve = points.map((point) => `${String(x(point.risk))},${String(y(point.expected))}`);

  // What the same risk could have returned, read off the curve by walking to
  // the nearest frontier point at or below this squad's risk. That is the one
  // number the picture exists to produce.
  const comparable = points.filter((point) => point.risk <= portfolio.held.risk).pop() ?? points[0];
  const forgone =
    comparable === undefined
      ? null
      : Math.round((comparable.expected - portfolio.held.expected) * 10) / 10;

  return (
    <figure className={styles.figure}>
      <svg
        className={styles.chart}
        viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
        role="img"
        aria-label={`Expected points against risk. This squad returns ${portfolio.held.expected.toFixed(1)} at a spread of ${portfolio.held.risk.toFixed(1)}.`}
      >
        <g className={styles.axes}>
          <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={HEIGHT - PAD.bottom} />
          <line
            x1={PAD.left}
            y1={HEIGHT - PAD.bottom}
            x2={WIDTH - PAD.right}
            y2={HEIGHT - PAD.bottom}
          />
        </g>

        <polyline className={styles.curve} points={curve.join(' ')} fill="none" />

        {points.map((point) => (
          <circle
            key={point.lambda}
            className={styles.point}
            cx={x(point.risk)}
            cy={y(point.expected)}
            r={2.4}
          >
            <title>{`Best at risk aversion ${String(point.lambda)}: ${point.expected.toFixed(1)} points, spread ${point.risk.toFixed(1)}, ${formatPrice(point.cost)}`}</title>
          </circle>
        ))}

        <circle
          className={styles.held}
          cx={x(portfolio.held.risk)}
          cy={y(portfolio.held.expected)}
          r={4.5}
        >
          <title>{`This squad: ${portfolio.held.expected.toFixed(1)} points, spread ${portfolio.held.risk.toFixed(1)}`}</title>
        </circle>

        <text className={styles.axisLabel} x={PAD.left} y={HEIGHT - 8}>
          Spread over the horizon
        </text>
        <text
          className={styles.axisLabel}
          x={4}
          y={PAD.top}
          transform={`rotate(-90 4 ${String(PAD.top)})`}
        >
          Expected points
        </text>
      </svg>

      <figcaption className={styles.caption}>
        Every point is the best legal fifteen at one risk appetite, under the same budget, quota,
        and three per club. The filled mark is the squad being explained.{' '}
        {forgone === null || forgone <= 0.05
          ? 'It sits on the frontier: nothing legal returns more at this level of risk.'
          : `A squad at the same risk was available returning ${forgone.toFixed(1)} more, which is what this one's other constraints cost.`}{' '}
        Two players at one club are treated as {Math.round(portfolio.clubCorrelation * 100)} percent
        correlated, because a clean sheet is one event shared by a defence.
      </figcaption>
    </figure>
  );
}

export function RiskShare({ portfolio }: { portfolio: PortfolioView }) {
  const rows = portfolio.contributions.filter((row) => Number.isFinite(row.share));
  if (rows.length === 0) return null;
  const largest = Math.max(...rows.map((row) => Math.abs(row.share)));

  return (
    <div className={styles.shares}>
      <h4 className={styles.sharesHead}>Where the risk sits</h4>
      <ul className={styles.shareList}>
        {rows.map((row) => (
          <li key={`${row.name}-${row.club}`} className={styles.share}>
            <span className={styles.shareName}>{row.name}</span>
            <span
              className={styles.shareBar}
              style={{ '--share': Math.abs(row.share) / largest } as CSSProperties}
            />
            <span className={`num ${styles.shareValue}`}>{(row.share * 100).toFixed(0)}%</span>
          </li>
        ))}
      </ul>
      <p className={styles.sharesNote}>
        Share of the squad&apos;s variance each player accounts for, including the club term, so a
        pair from one defence carries more than either would alone.
      </p>
    </div>
  );
}
