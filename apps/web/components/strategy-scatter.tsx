'use client';

import { useMemo, useState } from 'react';
import { formatPrice } from '@fpl/core';
import type { Chip } from '@fpl/planner';
import type { StrategyDot, StrategySpace } from '@/lib/planner/protocol';
import styles from './strategy-scatter.module.css';

/**
 * The strategy space, drawn.
 *
 * A frontier alone answers "what is optimal", which is a question nobody is
 * really asking. The cloud answers "how much does being optimal buy me", and
 * the answer is usually less than a reader expects: two hundred legal squads
 * sit within a couple of points of the best one, and seeing that is worth more
 * than seeing the curve.
 *
 * Three marks carry meaning and nothing else does. The **cloud** is every
 * strategy that survived the prune. The **capital market line** runs from the
 * risk free squad through the tangency portfolio, the best return per unit of
 * risk, which is the squad to hold in the absence of a reason to hold another.
 * The **pinned mark** is the strategy the builder handed over, and it stays put
 * whatever else is selected, because exploring without a way back is not
 * exploring.
 *
 * The risk free point is not a metaphor here: a legal fifteen of players who
 * will not play returns nothing with certainty. That is cash, and the Sharpe
 * ratio measured from it is the textbook quantity rather than an analogy.
 */

const WIDTH = 460;
const HEIGHT = 300;
const PAD = { top: 16, right: 18, bottom: 34, left: 46 };

export interface ScatterMark {
  label: string;
  expected: number;
  risk: number;
}

export function StrategyScatter({
  space,
  pinned,
  selected,
  chips,
  onChip,
  onSelect,
  running,
}: {
  space: StrategySpace;
  /** The builder's own strategy, kept on the chart whatever is selected. */
  pinned: ScatterMark | null;
  selected: StrategyDot | null;
  chips: readonly Chip[];
  onChip: (chip: Chip, on: boolean) => void;
  onSelect: (dot: StrategyDot | null) => void;
  running: boolean;
}) {
  const [hovered, setHovered] = useState<StrategyDot | null>(null);

  const bounds = useMemo(() => {
    const risks = [...space.dots.map((dot) => dot.risk), pinned?.risk ?? 0];
    const returns = [...space.dots.map((dot) => dot.expected), pinned?.expected ?? 0];
    return {
      minRisk: Math.min(...risks, 0),
      maxRisk: Math.max(...risks, 1),
      minReturn: Math.min(...returns, 0),
      maxReturn: Math.max(...returns, 1),
    };
  }, [space.dots, pinned]);

  const x = (risk: number): number =>
    PAD.left +
    ((risk - bounds.minRisk) / Math.max(1e-9, bounds.maxRisk - bounds.minRisk)) *
      (WIDTH - PAD.left - PAD.right);
  const y = (value: number): number =>
    HEIGHT -
    PAD.bottom -
    ((value - bounds.minReturn) / Math.max(1e-9, bounds.maxReturn - bounds.minReturn)) *
      (HEIGHT - PAD.top - PAD.bottom);

  const shown = hovered ?? selected;

  return (
    <div className={styles.wrap}>
      <div className={styles.chips} role="group" aria-label="Chips priced into the cloud">
        {CHIPS.map((entry) => (
          <button
            key={entry.chip}
            type="button"
            className={styles.chip}
            data-on={chips.includes(entry.chip) ? 'true' : undefined}
            aria-pressed={chips.includes(entry.chip)}
            disabled={running}
            onClick={() => {
              onChip(entry.chip, !chips.includes(entry.chip));
            }}
          >
            {entry.label}
          </button>
        ))}
        {running && <span className={styles.working}>Solving the space.</span>}
      </div>

      <svg
        className={styles.chart}
        viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
        role="img"
        aria-label={`${String(space.dots.length)} strategies by expected points against risk.`}
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

        {/* The capital market line: the ray from cash through the tangency
            portfolio. Dashed, because the points along it are a reference
            rather than squads anyone can hold: there is no borrowing here and
            no half a squad. */}
        {space.tangency !== null && (
          <line
            className={styles.cml}
            x1={x(space.riskFree.risk)}
            y1={y(space.riskFree.expected)}
            x2={x(bounds.maxRisk)}
            y2={y(
              space.riskFree.expected +
                space.tangency.sharpe * (bounds.maxRisk - space.riskFree.risk),
            )}
          />
        )}

        {space.dots.map((dot) => (
          <circle
            key={dot.id}
            className={styles.dot}
            data-selected={selected?.id === dot.id ? 'true' : undefined}
            cx={x(dot.risk)}
            cy={y(dot.expected)}
            r={selected?.id === dot.id ? 4 : 2.2}
            tabIndex={0}
            role="button"
            aria-label={`Strategy ${String(dot.id)}: ${dot.expected.toFixed(1)} points, risk ${dot.risk.toFixed(1)}`}
            onMouseEnter={() => {
              setHovered(dot);
            }}
            onMouseLeave={() => {
              setHovered(null);
            }}
            onFocus={() => {
              setHovered(dot);
            }}
            onBlur={() => {
              setHovered(null);
            }}
            onClick={() => {
              onSelect(dot);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(dot);
              }
            }}
          />
        ))}

        {space.tangency !== null && (
          <circle
            className={styles.tangency}
            cx={x(space.tangency.risk)}
            cy={y(space.tangency.expected)}
            r={4.5}
          >
            <title>{`Tangency: the best return per unit of risk, ${space.tangency.sharpe.toFixed(2)}`}</title>
          </circle>
        )}

        {pinned !== null && (
          <g className={styles.pinned}>
            <circle cx={x(pinned.risk)} cy={y(pinned.expected)} r={5}>
              <title>{`${pinned.label}: ${pinned.expected.toFixed(1)} points, risk ${pinned.risk.toFixed(1)}`}</title>
            </circle>
          </g>
        )}

        <text className={styles.axisLabel} x={PAD.left} y={HEIGHT - 8}>
          Risk (spread over the horizon)
        </text>
        <text
          className={styles.axisLabel}
          x={6}
          y={PAD.top}
          transform={`rotate(-90 6 ${String(PAD.top)})`}
        >
          Expected points
        </text>
      </svg>

      <dl className={styles.readout}>
        <div>
          <dt>Strategies</dt>
          <dd className="num">
            {space.dots.length} of {space.generated}
          </dd>
        </div>
        <div>
          <dt>Risk free</dt>
          <dd className="num">
            {space.riskFree.expected.toFixed(1)} ± {space.riskFree.risk.toFixed(1)}
          </dd>
        </div>
        <div>
          <dt>Best Sharpe</dt>
          <dd className="num">{space.tangency?.sharpe.toFixed(2) ?? '—'}</dd>
        </div>
        {shown !== null && (
          <>
            <div>
              <dt>Hovered</dt>
              <dd className="num">
                {shown.expected.toFixed(1)} pts, risk {shown.risk.toFixed(1)}
              </dd>
            </div>
            <div>
              <dt>Sharpe</dt>
              <dd className="num">{shown.sharpe.toFixed(2)}</dd>
            </div>
            <div>
              <dt>Cost</dt>
              <dd className="num">{formatPrice(shown.cost)}</dd>
            </div>
            {shown.chipGain > 0 && (
              <div>
                <dt>Chips</dt>
                <dd className="num">
                  +{shown.chipGain.toFixed(1)} (
                  {shown.chipWeeks.map((entry) => `GW${String(entry.gameweek + 1)}`).join(', ')})
                </dd>
              </div>
            )}
          </>
        )}
      </dl>

      <p className={styles.note}>
        Every dot is a legal fifteen under this budget, quota, and club limit, with the dominated
        ones dropped. The risk free point is a squad of players who will not play: it returns
        nothing, with certainty, which is what cash is. The dashed line runs from there through the
        tangency portfolio, the best return per unit of risk; points along it are a reference rather
        than squads, since nothing here can be borrowed or held in half.{' '}
        {selected === null
          ? 'Press a dot to explain that strategy.'
          : 'The pinned mark is the strategy the builder decided.'}{' '}
        Two players at one club are treated as {Math.round(space.clubCorrelation * 100)} percent
        correlated. Spread understates a striker, whose week has a long right tail that a standard
        deviation does not describe.
      </p>
    </div>
  );
}

const CHIPS: { chip: Chip; label: string }[] = [
  { chip: 'bench_boost', label: 'Bench boost' },
  { chip: 'triple_captain', label: 'Triple captain' },
  { chip: 'wildcard', label: 'Wildcard' },
  { chip: 'free_hit', label: 'Free hit' },
];
