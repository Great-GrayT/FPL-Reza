'use client';

import { useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import styles from './player-time-series.module.css';

export interface SeriesPoint {
  gameweek: number;
  points: number;
  minutes: number;
  expectedInvolvement: number;
  bps: number;
  price: number;
}

type MetricKey = 'points' | 'minutes' | 'expectedInvolvement' | 'bps' | 'price';

interface Metric {
  key: MetricKey;
  label: string;
  /** How the value reads to a person, not how it is stored. */
  format: (value: number) => string;
  /** Price is a running level, everything else is a per gameweek quantity. */
  shape: 'area' | 'line';
}

const DEFAULT_METRIC: Metric = {
  key: 'points',
  label: 'Points',
  format: (v) => String(v),
  shape: 'area',
};

const METRICS: readonly Metric[] = [
  DEFAULT_METRIC,
  { key: 'minutes', label: 'Minutes', format: (v) => `${String(v)}'`, shape: 'area' },
  {
    key: 'expectedInvolvement',
    label: 'xG + xA',
    format: (v) => v.toFixed(2),
    shape: 'area',
  },
  { key: 'bps', label: 'BPS', format: (v) => String(v), shape: 'area' },
  { key: 'price', label: 'Price', format: (v) => `${(v / 10).toFixed(1)}m`, shape: 'line' },
];

export function PlayerTimeSeries({
  data,
  highlight = null,
}: {
  data: readonly SeriesPoint[];
  /** Gameweek the rest of the page is narrowed to, marked rather than isolated. */
  highlight?: number | null;
}) {
  const [active, setActive] = useState<MetricKey>('points');
  const [cumulative, setCumulative] = useState(false);

  const metric = METRICS.find((entry) => entry.key === active) ?? DEFAULT_METRIC;
  // Cumulative is meaningless for price, which is a level rather than a count.
  const canAccumulate = metric.shape === 'area';
  const showCumulative = cumulative && canAccumulate;

  let running = 0;
  const series = data.map((point) => {
    running += point[metric.key];
    return {
      gameweek: point.gameweek,
      value: showCumulative ? running : point[metric.key],
    };
  });

  if (series.length === 0) {
    return (
      <p className={styles.empty}>
        No gameweek rows stored yet. Run a sync that includes player history to fill this in.
      </p>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.controls}>
        <div className={styles.tabs} role="tablist" aria-label="Metric">
          {METRICS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              role="tab"
              aria-selected={entry.key === active}
              className={entry.key === active ? styles.tabOn : styles.tab}
              onClick={() => {
                setActive(entry.key);
              }}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <label className={canAccumulate ? styles.toggle : styles.toggleOff}>
          <input
            type="checkbox"
            checked={showCumulative}
            disabled={!canAccumulate}
            onChange={(event) => {
              setCumulative(event.target.checked);
            }}
          />
          Running total
        </label>
      </div>

      <div className={styles.chart}>
        <ResponsiveContainer width="100%" height={280}>
          {metric.shape === 'area' ? (
            <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
              <defs>
                <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--pitch)" stopOpacity={0.55} />
                  <stop offset="100%" stopColor="var(--pitch)" stopOpacity={0.04} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--rule)" vertical={false} />
              <XAxis
                dataKey="gameweek"
                tick={{ fontSize: 11, fill: 'var(--ink-soft)' }}
                tickLine={false}
                axisLine={{ stroke: 'var(--rule)' }}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'var(--ink-soft)' }}
                tickLine={false}
                axisLine={false}
                width={48}
              />
              <Tooltip
                cursor={{ stroke: 'var(--flare)', strokeWidth: 1 }}
                contentStyle={{
                  background: 'var(--paper)',
                  border: '1px solid var(--rule-strong)',
                  borderRadius: 2,
                  fontSize: 12,
                }}
                labelFormatter={(value) => `Gameweek ${String(value)}`}
                formatter={(value: number) => [metric.format(value), metric.label]}
              />
              {highlight !== null && (
                <ReferenceLine
                  x={highlight}
                  stroke="var(--flare)"
                  strokeWidth={1.5}
                  label={{
                    value: `GW${String(highlight)}`,
                    position: 'top',
                    fill: 'var(--flare-ink)',
                    fontSize: 11,
                  }}
                />
              )}
              <Area
                type="monotone"
                dataKey="value"
                stroke="var(--pitch)"
                strokeWidth={2}
                fill="url(#fill)"
              />
            </AreaChart>
          ) : (
            <LineChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid stroke="var(--rule)" vertical={false} />
              <XAxis
                dataKey="gameweek"
                tick={{ fontSize: 11, fill: 'var(--ink-soft)' }}
                tickLine={false}
                axisLine={{ stroke: 'var(--rule)' }}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'var(--ink-soft)' }}
                tickLine={false}
                axisLine={false}
                width={48}
                domain={['dataMin - 2', 'dataMax + 2']}
                tickFormatter={(value: number) => (value / 10).toFixed(1)}
              />
              <Tooltip
                cursor={{ stroke: 'var(--flare)', strokeWidth: 1 }}
                contentStyle={{
                  background: 'var(--paper)',
                  border: '1px solid var(--rule-strong)',
                  borderRadius: 2,
                  fontSize: 12,
                }}
                labelFormatter={(value) => `Gameweek ${String(value)}`}
                formatter={(value: number) => [metric.format(value), metric.label]}
              />
              {highlight !== null && (
                <ReferenceLine x={highlight} stroke="var(--flare)" strokeWidth={1.5} />
              )}
              <Line
                type="stepAfter"
                dataKey="value"
                stroke="var(--flare-ink)"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
