'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import styles from './season-trend.module.css';

export interface TrendPoint {
  season: string;
  value: number;
}

/**
 * How the value reads, named rather than passed as a function: a server
 * component cannot hand a function to a client one, and naming the unit is
 * clearer at the call site than a formatter closure would be.
 */
export type TrendUnit = 'percent' | 'decimal';

const FORMAT: Record<TrendUnit, (value: number) => string> = {
  percent: (value) => `${value.toFixed(0)}%`,
  decimal: (value) => value.toFixed(2),
};

/**
 * One measure across every season on record.
 *
 * The y axis does not start at zero, deliberately: the interesting range of a
 * home win share is 35 to 50 per cent, and anchoring at zero would flatten a
 * real, well documented decline into a straight line. The axis is labelled and
 * the mean is drawn, so the scale is stated rather than implied.
 */
export function SeasonTrend({
  data,
  label,
  unit,
  tone = 'pitch',
}: {
  data: readonly TrendPoint[];
  label: string;
  unit: TrendUnit;
  tone?: 'pitch' | 'flare';
}) {
  const format = FORMAT[unit];
  if (data.length === 0) {
    return <p className={styles.empty}>Nothing on record to chart.</p>;
  }

  const values = data.map((point) => point.value);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const stroke = tone === 'flare' ? 'var(--flare-ink)' : 'var(--pitch)';
  const gradientId = `trend-${tone}`;

  return (
    <div className={styles.wrap}>
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={[...data]} margin={{ top: 12, right: 8, bottom: 0, left: -8 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.45} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0.03} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--rule)" vertical={false} />
          <XAxis
            dataKey="season"
            tick={{ fontSize: 10, fill: 'var(--ink-soft)' }}
            tickLine={false}
            axisLine={{ stroke: 'var(--rule)' }}
            interval="preserveStartEnd"
            minTickGap={28}
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'var(--ink-soft)' }}
            tickLine={false}
            axisLine={false}
            width={48}
            domain={['dataMin - 2', 'dataMax + 2']}
            tickFormatter={format}
          />
          <ReferenceLine
            y={mean}
            stroke="var(--rule-strong)"
            strokeDasharray="4 4"
            label={{
              value: `mean ${format(mean)}`,
              position: 'insideTopRight',
              fill: 'var(--ink-soft)',
              fontSize: 10,
            }}
          />
          <Tooltip
            cursor={{ stroke: 'var(--flare)', strokeWidth: 1 }}
            contentStyle={{
              background: 'var(--paper)',
              border: '1px solid var(--rule-strong)',
              borderRadius: 2,
              fontSize: 12,
            }}
            labelFormatter={(value) => `Season ${String(value)}`}
            formatter={(value: number) => [format(value), label]}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={stroke}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
