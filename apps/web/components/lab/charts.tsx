'use client';

/**
 * The Lab's chart primitives.
 *
 * SVG for anything under a few thousand marks, canvas above it: a 38 cell
 * ribbon is right in SVG and a scatter of a quarter of a million points is not,
 * and the threshold is a constant here rather than a judgement made per chart.
 *
 * Every chart takes its colours from the tokens in globals.css, never a literal,
 * and every chart with two or more series ships a legend.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import styles from './charts.module.css';

export const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];
export const SERIES_OTHER = 'var(--series-other)';
const CANVAS_THRESHOLD = 5000;

export function seriesColour(index: number): string {
  return SERIES[index] ?? SERIES_OTHER;
}

function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min];
  const span = max - min;
  const rough = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalised = rough / magnitude;
  const step = (normalised >= 5 ? 10 : normalised >= 2 ? 5 : normalised >= 1 ? 2 : 1) * magnitude;
  const first = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let value = first; value <= max + step / 1000; value += step)
    ticks.push(Number(value.toPrecision(12)));
  return ticks;
}

export function formatNumber(value: number, places = 2): string {
  if (!Number.isFinite(value)) return 'n/a';
  const magnitude = Math.abs(value);
  if (magnitude >= 10000) return value.toFixed(0);
  if (magnitude >= 100) return value.toFixed(Math.min(1, places));
  if (magnitude === 0) return '0';
  if (magnitude < 0.001) return value.toExponential(1);
  return value.toFixed(places);
}

interface Extent {
  min: number;
  max: number;
}

function extentOf(values: number[], pad = 0.04): Extent {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return { min: 0, max: 1 };
  let min = Math.min(...finite);
  let max = Math.max(...finite);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min;
  return { min: min - span * pad, max: max + span * pad };
}

export interface Point {
  x: number;
  y: number;
}

export interface Series {
  name: string;
  points: Point[];
  /** Drawn as a dashed line: a smoothed or fitted overlay. */
  dashed?: boolean;
}

interface FrameProps {
  width?: number;
  height?: number;
  xLabel?: string;
  yLabel?: string;
  /** Reference line at y, for a zero or a mean. */
  zero?: boolean;
}

/** A line chart with a crosshair. Two or more series always carry a legend. */
export function LineChart({
  series,
  width = 680,
  height = 260,
  xLabel,
  yLabel,
  zero = false,
  xTickFormat,
}: FrameProps & { series: Series[]; xTickFormat?: (value: number) => string }): React.ReactElement {
  const id = useId();
  const [hover, setHover] = useState<{
    x: number;
    points: { name: string; value: number; colour: string }[];
  } | null>(null);

  const padding = { top: 12, right: 16, bottom: 30, left: 46 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const allX = series.flatMap((entry) => entry.points.map((point) => point.x));
  const allY = series.flatMap((entry) => entry.points.map((point) => point.y));
  const x = extentOf(allX, 0.01);
  const y = extentOf(allY);

  const toX = (value: number): number =>
    padding.left + ((value - x.min) / (x.max - x.min)) * plotWidth;
  const toY = (value: number): number =>
    padding.top + plotHeight - ((value - y.min) / (y.max - y.min)) * plotHeight;

  const path = (points: Point[]): string =>
    points
      .filter((point) => Number.isFinite(point.y))
      .map(
        (point, index) =>
          `${index === 0 ? 'M' : 'L'}${toX(point.x).toFixed(1)},${toY(point.y).toFixed(1)}`,
      )
      .join(' ');

  const onMove = (event: React.MouseEvent<SVGSVGElement>): void => {
    const target = event.currentTarget;
    const box = target.getBoundingClientRect();
    const ratio = (event.clientX - box.left) / box.width;
    const value = x.min + ratio * (x.max - x.min);
    const readings = series
      .map((entry, index) => {
        const closest = entry.points.reduce<Point | null>(
          (best, point) =>
            best === null || Math.abs(point.x - value) < Math.abs(best.x - value) ? point : best,
          null,
        );
        return closest === null
          ? null
          : { name: entry.name, value: closest.y, colour: seriesColour(index), at: closest.x };
      })
      .filter(
        (entry): entry is { name: string; value: number; colour: string; at: number } =>
          entry !== null,
      );
    const at = readings[0]?.at ?? value;
    setHover({ x: at, points: readings });
  };

  return (
    <figure className={styles.figure}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className={styles.svg}
        role="img"
        aria-labelledby={`${id}-title`}
        onMouseMove={onMove}
        onMouseLeave={() => {
          setHover(null);
        }}
      >
        <title id={`${id}-title`}>{series.map((entry) => entry.name).join(', ')}</title>
        {niceTicks(y.min, y.max).map((tick) => (
          <g key={tick}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={toY(tick)}
              y2={toY(tick)}
              className={styles.grid}
            />
            <text x={padding.left - 6} y={toY(tick) + 3} className={styles.tick} textAnchor="end">
              {formatNumber(tick, 2)}
            </text>
          </g>
        ))}
        {niceTicks(x.min, x.max, 6).map((tick) => (
          <text
            key={tick}
            x={toX(tick)}
            y={height - 10}
            className={styles.tick}
            textAnchor="middle"
          >
            {xTickFormat === undefined ? formatNumber(tick, 0) : xTickFormat(tick)}
          </text>
        ))}
        {zero && y.min < 0 && y.max > 0 ? (
          <line
            x1={padding.left}
            x2={width - padding.right}
            y1={toY(0)}
            y2={toY(0)}
            className={styles.zero}
          />
        ) : null}
        {series.map((entry, index) => (
          <path
            key={entry.name}
            d={path(entry.points)}
            fill="none"
            stroke={seriesColour(index)}
            strokeWidth={2}
            strokeDasharray={entry.dashed === true ? '4 3' : undefined}
          />
        ))}
        {hover === null ? null : (
          <line
            x1={toX(hover.x)}
            x2={toX(hover.x)}
            y1={padding.top}
            y2={padding.top + plotHeight}
            className={styles.crosshair}
          />
        )}
        {yLabel === undefined ? null : (
          <text x={padding.left} y={10} className={styles.axisLabel}>
            {yLabel}
          </text>
        )}
        {xLabel === undefined ? null : (
          <text
            x={width - padding.right}
            y={height - 10}
            className={styles.axisLabel}
            textAnchor="end"
          >
            {xLabel}
          </text>
        )}
      </svg>
      {hover === null ? null : (
        <div className={styles.readout}>
          <span className={`${styles.readoutKey} num`}>{formatNumber(hover.x, 0)}</span>
          {hover.points.map((point) => (
            <span key={point.name} className={styles.readoutItem}>
              <span
                className={styles.swatch}
                style={{ background: point.colour }}
                aria-hidden="true"
              />
              {point.name} <span className="num">{formatNumber(point.value, 3)}</span>
            </span>
          ))}
        </div>
      )}
      {series.length > 1 ? (
        <figcaption className={styles.legend}>
          {series.map((entry, index) => (
            <span key={entry.name} className={styles.legendItem}>
              <span
                className={styles.swatch}
                style={{ background: seriesColour(index) }}
                aria-hidden="true"
              />
              {entry.name}
            </span>
          ))}
        </figcaption>
      ) : null}
    </figure>
  );
}

export interface Bar {
  label: string;
  value: number;
  /** Optional second value drawn as a ghost behind, for an expected against actual. */
  reference?: number;
  emphasis?: boolean;
}

/** Horizontal bars, which read better than vertical ones for named things. */
export function BarChart({
  bars,
  width = 680,
  unit,
  height,
}: {
  bars: Bar[];
  width?: number;
  unit?: string;
  height?: number;
}): React.ReactElement {
  const rowHeight = 22;
  const chartHeight = height ?? Math.max(60, bars.length * rowHeight + 16);
  const labelWidth = 150;
  const values = bars.flatMap((bar) => [bar.value, bar.reference ?? bar.value]);
  const max = Math.max(0, ...values.filter((value) => Number.isFinite(value)));
  const min = Math.min(0, ...values.filter((value) => Number.isFinite(value)));
  const span = max - min || 1;
  const plotWidth = width - labelWidth - 60;
  const originX = labelWidth + ((0 - min) / span) * plotWidth;

  return (
    <svg viewBox={`0 0 ${width} ${chartHeight}`} className={styles.svg} role="img">
      {bars.map((bar, index) => {
        const y = 8 + index * rowHeight;
        const value = Number.isFinite(bar.value) ? bar.value : 0;
        const length = (Math.abs(value) / span) * plotWidth;
        const x = value >= 0 ? originX : originX - length;
        return (
          <g key={bar.label}>
            <text x={labelWidth - 8} y={y + 12} className={styles.tick} textAnchor="end">
              {bar.label}
            </text>
            <rect
              x={x}
              y={y + 3}
              width={Math.max(1, length)}
              height={rowHeight - 9}
              rx={2}
              fill={bar.emphasis === true ? 'var(--flare)' : 'var(--series-1)'}
            />
            <text x={originX + plotWidth + 6} y={y + 12} className={`${styles.tick} num`}>
              {formatNumber(bar.value, 2)}
              {unit ?? ''}
            </text>
          </g>
        );
      })}
      <line x1={originX} x2={originX} y1={4} y2={chartHeight - 4} className={styles.zero} />
    </svg>
  );
}

/** A histogram, drawn from the bins the engine returned rather than raw values. */
export function Histogram({
  bins,
  density,
  width = 680,
  height = 240,
  xLabel,
}: {
  bins: { from: number; to: number; count: number }[];
  density?: { x: number; density: number }[];
  width?: number;
  height?: number;
  xLabel?: string;
}): React.ReactElement {
  const padding = { top: 10, right: 14, bottom: 28, left: 44 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxCount = Math.max(1, ...bins.map((bin) => bin.count));
  const from = bins[0]?.from ?? 0;
  const to = bins[bins.length - 1]?.to ?? 1;
  const toX = (value: number): number =>
    padding.left + ((value - from) / (to - from || 1)) * plotWidth;

  const total = bins.reduce((sum, bin) => sum + bin.count, 0);
  const binWidth = (bins[0]?.to ?? 1) - (bins[0]?.from ?? 0);
  const densityScale = total * binWidth;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={styles.svg} role="img">
      {niceTicks(0, maxCount, 4).map((tick) => (
        <g key={tick}>
          <line
            x1={padding.left}
            x2={width - padding.right}
            y1={padding.top + plotHeight - (tick / maxCount) * plotHeight}
            y2={padding.top + plotHeight - (tick / maxCount) * plotHeight}
            className={styles.grid}
          />
          <text
            x={padding.left - 6}
            y={padding.top + plotHeight - (tick / maxCount) * plotHeight + 3}
            className={styles.tick}
            textAnchor="end"
          >
            {formatNumber(tick, 0)}
          </text>
        </g>
      ))}
      {bins.map((bin) => {
        const x = toX(bin.from);
        const barWidth = Math.max(1, toX(bin.to) - x - 2);
        const barHeight = (bin.count / maxCount) * plotHeight;
        return (
          <rect
            key={`${bin.from}-${bin.to}`}
            x={x}
            y={padding.top + plotHeight - barHeight}
            width={barWidth}
            height={barHeight}
            rx={2}
            fill="var(--series-1)"
          />
        );
      })}
      {density === undefined || density.length === 0
        ? null
        : (() => {
            const path = density
              .filter((point) => point.x >= from && point.x <= to)
              .map((point, index) => {
                const y =
                  padding.top +
                  plotHeight -
                  ((point.density * densityScale) / maxCount) * plotHeight;
                return `${index === 0 ? 'M' : 'L'}${toX(point.x).toFixed(1)},${y.toFixed(1)}`;
              })
              .join(' ');
            return <path d={path} fill="none" stroke="var(--flare)" strokeWidth={2} />;
          })()}
      {niceTicks(from, to, 6).map((tick) => (
        <text key={tick} x={toX(tick)} y={height - 8} className={styles.tick} textAnchor="middle">
          {formatNumber(tick, 1)}
        </text>
      ))}
      {xLabel === undefined ? null : (
        <text x={width - padding.right} y={12} className={styles.axisLabel} textAnchor="end">
          {xLabel}
        </text>
      )}
    </svg>
  );
}

export interface ScatterPoint {
  x: number;
  y: number;
  g: string | null;
}

/**
 * Scatter on canvas. Above five thousand marks an SVG node per point stops
 * being a chart and starts being a memory problem, so this draws pixels and
 * keeps only the axes in the accessibility tree.
 */
export function Scatter({
  points,
  line,
  xLabel,
  yLabel,
  groups,
  height = 320,
}: {
  points: ScatterPoint[];
  line?: Point[];
  xLabel: string;
  yLabel: string;
  groups?: string[];
  height?: number;
}): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ width: 680, height });

  const groupList = useMemo(() => {
    if (groups !== undefined) return groups;
    const seen = new Set<string>();
    for (const point of points) if (point.g !== null) seen.add(point.g);
    return [...seen].sort().slice(0, 4);
  }, [groups, points]);

  const x = useMemo(() => extentOf(points.map((point) => point.x)), [points]);
  const y = useMemo(() => extentOf(points.map((point) => point.y)), [points]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const parent = canvas.parentElement;
    const width = parent === null ? 680 : parent.clientWidth;
    setSize({ width, height });

    const ratio = window.devicePixelRatio || 1;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const context = canvas.getContext('2d');
    if (context === null) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    const padding = { top: 10, right: 12, bottom: 26, left: 46 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const toX = (value: number): number =>
      padding.left + ((value - x.min) / (x.max - x.min)) * plotWidth;
    const toY = (value: number): number =>
      padding.top + plotHeight - ((value - y.min) / (y.max - y.min)) * plotHeight;

    const styleOf = (name: string | null): string => {
      if (name === null) return 'var(--series-1)';
      const index = groupList.indexOf(name);
      return index < 0 ? SERIES_OTHER : seriesColour(index);
    };
    const resolve = (token: string): string => {
      const variable = /var\((--[a-z0-9-]+)\)/.exec(token);
      if (variable === null) return token;
      return (
        getComputedStyle(document.documentElement)
          .getPropertyValue(variable[1] ?? '')
          .trim() || '#24559a'
      );
    };

    const colours = new Map<string, string>();
    for (const group of [...groupList, '__none'])
      colours.set(group, resolve(styleOf(group === '__none' ? null : group)));

    // Alpha rather than size is what keeps a dense cloud readable: overlapping
    // points accumulate into a shape instead of a solid block.
    context.globalAlpha = points.length > 40000 ? 0.15 : points.length > 8000 ? 0.3 : 0.55;
    for (const point of points) {
      context.fillStyle = colours.get(point.g ?? '__none') ?? '#24559a';
      context.fillRect(toX(point.x) - 1, toY(point.y) - 1, 2.2, 2.2);
    }
    context.globalAlpha = 1;

    if (line !== undefined && line.length > 1) {
      context.strokeStyle = resolve('var(--flare)');
      context.lineWidth = 2;
      context.beginPath();
      line.forEach((point, index) => {
        const px = toX(point.x);
        const py = toY(point.y);
        if (index === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      });
      context.stroke();
    }

    context.strokeStyle = resolve('var(--rule-strong)');
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(padding.left, padding.top);
    context.lineTo(padding.left, padding.top + plotHeight);
    context.lineTo(padding.left + plotWidth, padding.top + plotHeight);
    context.stroke();

    context.fillStyle = resolve('var(--ink-soft)');
    context.font = '11px ui-monospace, monospace';
    for (const tick of niceTicks(y.min, y.max, 4)) {
      context.fillText(formatNumber(tick, 1), 4, toY(tick) + 3);
    }
    for (const tick of niceTicks(x.min, x.max, 5)) {
      context.fillText(formatNumber(tick, 1), toX(tick) - 10, height - 8);
    }
  }, [points, line, x, y, groupList, height]);

  return (
    <figure className={styles.figure}>
      <div className={styles.canvasWrap}>
        <canvas ref={canvasRef} style={{ width: '100%', height }} className={styles.canvas} />
      </div>
      <figcaption className={styles.legend}>
        <span className={styles.axisNote}>
          {yLabel} against {xLabel}, {points.length.toLocaleString('en-GB')} points drawn
          {size.width === 0 ? '' : ''}
        </span>
        {groupList.map((group, index) => (
          <span key={group} className={styles.legendItem}>
            <span
              className={styles.swatch}
              style={{ background: seriesColour(index) }}
              aria-hidden="true"
            />
            {group}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/**
 * A matrix of cells on a diverging ramp: two hues either side of a neutral
 * middle, which is the only honest encoding for a correlation.
 */
export function Matrix({
  columns,
  values,
  counts,
}: {
  columns: string[];
  values: number[][];
  counts?: number[][];
}): React.ReactElement {
  const cell = 44;
  const labelWidth = 118;
  const width = labelWidth + columns.length * cell + 8;
  const height = 26 + columns.length * cell;

  const colourFor = (value: number): string => {
    if (!Number.isFinite(value)) return 'var(--paper-3)';
    const magnitude = Math.min(1, Math.abs(value));
    const hue = value >= 0 ? 'var(--diverge-high)' : 'var(--diverge-low)';
    return `color-mix(in srgb, ${hue} ${(magnitude * 100).toFixed(0)}%, var(--diverge-mid))`;
  };

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={styles.svg} role="img">
      {columns.map((column, index) => (
        <text
          key={`head-${column}`}
          x={labelWidth + index * cell + cell / 2}
          y={16}
          className={styles.tick}
          textAnchor="middle"
        >
          {column.slice(0, 6)}
        </text>
      ))}
      {columns.map((row, i) => (
        <g key={`row-${row}`}>
          <text
            x={labelWidth - 6}
            y={26 + i * cell + cell / 2 + 4}
            className={styles.tick}
            textAnchor="end"
          >
            {row}
          </text>
          {columns.map((column, j) => {
            const value = values[i]?.[j] ?? Number.NaN;
            return (
              <g key={`${row}-${column}`}>
                <rect
                  x={labelWidth + j * cell + 1}
                  y={26 + i * cell + 1}
                  width={cell - 2}
                  height={cell - 2}
                  rx={2}
                  fill={colourFor(value)}
                >
                  <title>
                    {row} against {column}: {formatNumber(value, 3)}
                    {counts === undefined ? '' : ` over ${counts[i]?.[j] ?? 0} rows`}
                  </title>
                </rect>
                <text
                  x={labelWidth + j * cell + cell / 2}
                  y={26 + i * cell + cell / 2 + 4}
                  className={`${styles.cellValue} num`}
                  textAnchor="middle"
                >
                  {Number.isFinite(value) ? value.toFixed(2).replace('0.', '.') : 'n/a'}
                </text>
              </g>
            );
          })}
        </g>
      ))}
    </svg>
  );
}

export interface FanPoint {
  label: string;
  p5: number;
  p25: number;
  median: number;
  p75: number;
  p95: number;
  mean: number;
}

/** A quantile fan: the shape of a simulated distribution, not its mean alone. */
export function Fan({
  points,
  width = 680,
  height = 260,
}: {
  points: FanPoint[];
  width?: number;
  height?: number;
}): React.ReactElement {
  const padding = { top: 12, right: 16, bottom: 30, left: 46 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const values = points.flatMap((point) => [point.p5, point.p95]);
  const y = extentOf(values);
  const slot = plotWidth / Math.max(1, points.length);
  const toY = (value: number): number =>
    padding.top + plotHeight - ((value - y.min) / (y.max - y.min)) * plotHeight;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={styles.svg} role="img">
      {niceTicks(y.min, y.max, 4).map((tick) => (
        <g key={tick}>
          <line
            x1={padding.left}
            x2={width - padding.right}
            y1={toY(tick)}
            y2={toY(tick)}
            className={styles.grid}
          />
          <text x={padding.left - 6} y={toY(tick) + 3} className={styles.tick} textAnchor="end">
            {formatNumber(tick, 1)}
          </text>
        </g>
      ))}
      {points.map((point, index) => {
        const centre = padding.left + slot * index + slot / 2;
        const wide = Math.min(30, slot * 0.55);
        return (
          <g key={point.label}>
            <line
              x1={centre}
              x2={centre}
              y1={toY(point.p5)}
              y2={toY(point.p95)}
              className={styles.whisker}
            />
            <rect
              x={centre - wide / 2}
              y={toY(point.p75)}
              width={wide}
              height={Math.max(2, toY(point.p25) - toY(point.p75))}
              rx={2}
              fill="var(--series-1)"
              opacity={0.85}
            />
            <line
              x1={centre - wide / 2}
              x2={centre + wide / 2}
              y1={toY(point.median)}
              y2={toY(point.median)}
              stroke="var(--paper)"
              strokeWidth={2}
            />
            <circle cx={centre} cy={toY(point.mean)} r={3} fill="var(--flare)" />
            <text x={centre} y={height - 10} className={styles.tick} textAnchor="middle">
              {point.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * The coverage grid: seasons down, gameweeks across, shaded by how many rows
 * the current scope holds in each cell. It is the Lab's honesty device, and it
 * is on screen at all times: a claim made from a filter that empties half the
 * archive should look like one.
 */
export function Coverage({
  cells,
  seasons,
  onSelect,
}: {
  cells: { season: string; gameweek: number; count: number }[];
  seasons: string[];
  onSelect?: (season: string, gameweek: number) => void;
}): React.ReactElement {
  const max = Math.max(1, ...cells.map((cell) => cell.count));
  const bySeason = new Map<string, Map<number, number>>();
  for (const cell of cells) {
    const row = bySeason.get(cell.season) ?? new Map<number, number>();
    row.set(cell.gameweek, cell.count);
    bySeason.set(cell.season, row);
  }

  return (
    <div className={styles.coverage}>
      {seasons.map((season) => {
        const row = bySeason.get(season) ?? new Map<number, number>();
        return (
          <div key={season} className={styles.coverageRow}>
            <span className={styles.coverageLabel}>{season}</span>
            <div className={styles.coverageCells}>
              {Array.from({ length: 38 }, (_, index) => {
                const gameweek = index + 1;
                const count = row.get(gameweek) ?? 0;
                const level = count === 0 ? 0 : Math.ceil((count / max) * 4);
                return (
                  <button
                    key={gameweek}
                    type="button"
                    className={styles.coverageCell}
                    data-level={level}
                    onClick={
                      onSelect === undefined
                        ? undefined
                        : () => {
                            onSelect(season, gameweek);
                          }
                    }
                    title={`${season} gameweek ${gameweek}: ${count.toLocaleString('en-GB')} rows`}
                    aria-label={`${season} gameweek ${gameweek}, ${count} rows in scope`}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export { CANVAS_THRESHOLD };
