'use client';

import { formatPrice } from '@fpl/core';
import styles from './horizon-forecast.module.css';

/**
 * Where a squad is expected to land, and how it gets there.
 *
 * A total on its own is not a forecast, it is a number. What makes this one
 * arguable is everything printed beside it: the week by week shape it is made
 * of, the band around it, the value the squad accrues on the way, and the
 * transfers the plan spends to get there. A reader who disagrees with any one
 * week can see exactly how much of the total that week is.
 *
 * The band is one standard deviation, added across gameweeks in quadrature,
 * from the spread of each player's own recent returns. It treats the eleven as
 * independent draws, which understates the truth, because two players at one
 * club share a clean sheet and a heavy defeat. That is said here rather than
 * left for the reader to discover.
 */

export interface ForecastWeek {
  gameweek: number;
  expectedPoints: number;
  spread: number;
  /** The fifteen at this week's prices, in tenths. */
  squadValue: number;
  bank: number;
  transfersIn: string[];
  transfersOut: string[];
  hit: number;
  chip: string | null;
  captain: string | null;
  blank: boolean;
  double: boolean;
}

export interface ForecastProps {
  weeks: ForecastWeek[];
  /** Expected points across the whole horizon, after every hit. */
  total: number;
  /** One standard deviation on that total. */
  spread: number;
  /** What the same fifteen would score held unchanged. */
  holdTotal: number;
  /** Which gameweek the reader is looking at, if any. */
  selected: number | null;
  onSelect: (gameweek: number | null) => void;
}

const CHART_HEIGHT = 120;
const VALUE_HEIGHT = 64;

export function HorizonForecast({
  weeks,
  total,
  spread,
  holdTotal,
  selected,
  onSelect,
}: ForecastProps) {
  if (weeks.length === 0) return null;

  const peak = Math.max(...weeks.map((week) => week.expectedPoints), 1);
  const cumulative: number[] = [];
  let running = 0;
  for (const week of weeks) {
    running += week.expectedPoints;
    cumulative.push(running);
  }
  const last = cumulative.at(-1) ?? 0;
  const mean = weeks.reduce((total, week) => total + week.expectedPoints, 0) / weeks.length;

  const values = weeks.map((week) => week.squadValue + week.bank);
  const valueLow = Math.min(...values);
  const valueHigh = Math.max(...values);
  const valueRange = Math.max(valueHigh - valueLow, 1);

  const step = 100 / weeks.length;
  const centre = (index: number): number => step * index + step / 2;
  const transfers = weeks.filter(
    (week) => week.transfersIn.length > 0 || week.transfersOut.length > 0,
  );

  return (
    <section className={styles.forecast} aria-labelledby="forecast">
      <h3 id="forecast" className={styles.head}>
        Where this lands
      </h3>

      <p className={styles.landing}>
        <span className={styles.total}>
          <span className="num">{Math.round(total)}</span>
        </span>
        <span className={styles.band}>
          <span className="num">± {Math.round(spread)}</span> points over {weeks.length}{' '}
          {weeks.length === 1 ? 'gameweek' : 'gameweeks'}
        </span>
        <span className={styles.against}>
          <span className="num">
            {total >= holdTotal ? '+' : '−'}
            {Math.abs(Math.round(total - holdTotal))}
          </span>{' '}
          on holding the same fifteen
        </span>
      </p>

      {/* Points per gameweek, against the mean of them. */}
      <figure className={styles.figure}>
        <figcaption className={styles.caption}>
          Points per gameweek, against the average of {mean.toFixed(1)}
        </figcaption>
        <div className={styles.plot}>
          <svg
            viewBox={`0 0 100 ${String(CHART_HEIGHT)}`}
            preserveAspectRatio="none"
            className={styles.chart}
            role="presentation"
          >
            {weeks.map((week, index) => {
              const height = (week.expectedPoints / peak) * (CHART_HEIGHT - 28);
              return (
                <rect
                  key={week.gameweek}
                  x={step * index + step * 0.18}
                  y={CHART_HEIGHT - height}
                  width={step * 0.64}
                  height={Math.max(height, 0.5)}
                  className={styles.bar}
                  data-on={selected === week.gameweek ? 'true' : undefined}
                />
              );
            })}
            {/* The mean, so a week reads against the others rather than only
                against zero. The bars themselves start at zero, because a bar
                that does not is a bar that lies about a ratio. */}
            <line
              className={styles.mean}
              x1={0}
              x2={100}
              y1={CHART_HEIGHT - (mean / peak) * (CHART_HEIGHT - 28)}
              y2={CHART_HEIGHT - (mean / peak) * (CHART_HEIGHT - 28)}
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          <ol className={styles.weeks}>
            {weeks.map((week) => (
              <li key={week.gameweek}>
                <button
                  type="button"
                  className={styles.week}
                  data-on={selected === week.gameweek ? 'true' : undefined}
                  aria-pressed={selected === week.gameweek}
                  onClick={() => {
                    onSelect(selected === week.gameweek ? null : week.gameweek);
                  }}
                >
                  <span className={styles.weekNumber}>{week.gameweek}</span>
                  <span className={`num ${styles.weekPoints}`}>
                    {week.expectedPoints.toFixed(0)}
                  </span>
                  <span className={styles.marks}>
                    {week.blank && (
                      <span className={styles.blank} title="Blank gameweek">
                        B
                      </span>
                    )}
                    {week.double && (
                      <span className={styles.double} title="Double gameweek">
                        D
                      </span>
                    )}
                    {week.hit > 0 && (
                      <span className={styles.hit} title="Points deducted for extra transfers">
                        −{week.hit}
                      </span>
                    )}
                    {week.chip !== null && (
                      <span className={styles.chip} title={`Chip played: ${week.chip}`}>
                        {week.chip.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </figure>

      {/* The running total, on its own strip. It was drawn over the bars at
          first, which put two different scales in one plot with no axis to tell
          them apart: a reader could not say what the line's height meant. */}
      <figure className={styles.figure}>
        <figcaption className={styles.caption}>
          Running total, reaching {Math.round(last)} by gameweek {weeks.at(-1)?.gameweek ?? 0}
        </figcaption>
        <svg
          viewBox={`0 0 100 ${String(VALUE_HEIGHT)}`}
          preserveAspectRatio="none"
          className={styles.valueChart}
          role="presentation"
        >
          <polyline
            className={styles.line}
            points={cumulative
              .map(
                (value, index) =>
                  `${String(centre(index))},${String(VALUE_HEIGHT - (value / Math.max(last, 1)) * (VALUE_HEIGHT - 10) - 5)}`,
              )
              .join(' ')}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </figure>

      {/* Value is the other half of a season, and a flat line is not a chart.
          Where the plan moves no money, that is said in a sentence instead. */}
      <figure className={styles.figure}>
        <figcaption className={styles.caption}>Team value</figcaption>
        {valueHigh - valueLow < 1 ? (
          <p className={styles.none}>
            Held at {formatPrice(values[0] ?? 0)} the whole way. Price rises are a stated guess from
            ownership and recent scoring, not a fitted forecast, and over this horizon it expects
            none of this squad to move.
          </p>
        ) : (
          <>
            <svg
              viewBox={`0 0 100 ${String(VALUE_HEIGHT)}`}
              preserveAspectRatio="none"
              className={styles.valueChart}
              role="presentation"
            >
              <polyline
                className={styles.valueLine}
                points={values
                  .map(
                    (value, index) =>
                      `${String(centre(index))},${String(VALUE_HEIGHT - ((value - valueLow) / valueRange) * (VALUE_HEIGHT - 12) - 6)}`,
                  )
                  .join(' ')}
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <p className={styles.none}>
              {formatPrice(values[0] ?? 0)} to {formatPrice(values.at(-1) ?? 0)}. Price rises are a
              stated guess from ownership and recent scoring, not a fitted forecast.
            </p>
          </>
        )}
      </figure>

      <div className={styles.ledger}>
        <h4 className={styles.ledgerHead}>
          {transfers.length === 0
            ? 'No transfers'
            : `${String(transfers.length)} ${transfers.length === 1 ? 'week' : 'weeks'} with transfers`}
        </h4>
        {transfers.length === 0 ? (
          <p className={styles.none}>
            The plan holds this fifteen the whole way. Nothing it could buy is worth what it costs.
          </p>
        ) : (
          <ul className={styles.moves}>
            {transfers.map((week) => (
              <li key={week.gameweek}>
                <button
                  type="button"
                  className={styles.move}
                  data-on={selected === week.gameweek ? 'true' : undefined}
                  onClick={() => {
                    onSelect(selected === week.gameweek ? null : week.gameweek);
                  }}
                >
                  <span className={styles.moveWeek}>GW{week.gameweek}</span>
                  <span className={styles.moveNames}>
                    {week.transfersOut.join(', ')} → {week.transfersIn.join(', ')}
                  </span>
                  {week.hit > 0 && <span className={styles.moveHit}>−{week.hit}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className={styles.caveat}>
        The band is one standard deviation of the eleven&rsquo;s own recent returns, added across
        gameweeks. It treats them as independent, which understates the real spread: two players at
        one club share a clean sheet and share a heavy defeat.
      </p>
    </section>
  );
}
