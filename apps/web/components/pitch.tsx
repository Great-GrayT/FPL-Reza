import styles from './pitch.module.css';

/**
 * The pitch every spatial component draws on, in the domain's own coordinates:
 * 0 to 100 on both axes, always from the perspective of the side attacking
 * towards x = 100. Hand rolled rather than charted, because a pitch is not a
 * chart shape and a charting library would only be asked to hide its axes.
 *
 * Drawn at the real ratio of a Premier League pitch, 105 by 68 metres, so a
 * heat cell is square on the ground rather than square on the screen.
 */

export const PITCH_LENGTH = 105;
export const PITCH_WIDTH = 68;

const toX = (x: number): number => (x / 100) * PITCH_LENGTH;
const toY = (y: number): number => (y / 100) * PITCH_WIDTH;

export type PitchOrientation = 'horizontal' | 'vertical';

/**
 * The pitch, drawn along the direction of play or up it.
 *
 * Vertical is a rotation of the same drawing rather than a second one: every
 * child is authored in the domain's own coordinates and the whole group turns
 * once, so a heat cell, a marker, and the six yard box cannot disagree about
 * which way the player is attacking. Attacking is upward when it is turned,
 * which is the orientation a narrow column and a phone both want.
 */
export function PitchMarkings({
  children,
  orientation = 'horizontal',
}: {
  children?: React.ReactNode;
  orientation?: PitchOrientation;
}) {
  const vertical = orientation === 'vertical';
  const viewBox = vertical
    ? `-2 -2 ${String(PITCH_WIDTH + 4)} ${String(PITCH_LENGTH + 4)}`
    : `-2 -2 ${String(PITCH_LENGTH + 4)} ${String(PITCH_WIDTH + 4)}`;

  return (
    <svg className={styles.pitch} viewBox={viewBox} role="presentation">
      {/* (x, y) in pitch coordinates becomes (y, length - x) on screen, so the
          goal being attacked is at the top and the left touchline stays left. */}
      <g transform={vertical ? `translate(0 ${String(PITCH_LENGTH)}) rotate(-90)` : undefined}>
        <rect
          x={0}
          y={0}
          width={PITCH_LENGTH}
          height={PITCH_WIDTH}
          className={styles.turf}
          rx={0.5}
        />
        {children}
        <g className={styles.lines}>
          <rect x={0} y={0} width={PITCH_LENGTH} height={PITCH_WIDTH} />
          <line x1={PITCH_LENGTH / 2} y1={0} x2={PITCH_LENGTH / 2} y2={PITCH_WIDTH} />
          <circle cx={PITCH_LENGTH / 2} cy={PITCH_WIDTH / 2} r={9.15} />
          <circle cx={PITCH_LENGTH / 2} cy={PITCH_WIDTH / 2} r={0.6} className={styles.spot} />

          {/* Penalty and six yard areas, both ends. */}
          <rect x={0} y={(PITCH_WIDTH - 40.3) / 2} width={16.5} height={40.3} />
          <rect x={0} y={(PITCH_WIDTH - 18.3) / 2} width={5.5} height={18.3} />
          <circle cx={11} cy={PITCH_WIDTH / 2} r={0.6} className={styles.spot} />

          <rect x={PITCH_LENGTH - 16.5} y={(PITCH_WIDTH - 40.3) / 2} width={16.5} height={40.3} />
          <rect x={PITCH_LENGTH - 5.5} y={(PITCH_WIDTH - 18.3) / 2} width={5.5} height={18.3} />
          <circle cx={PITCH_LENGTH - 11} cy={PITCH_WIDTH / 2} r={0.6} className={styles.spot} />
        </g>
      </g>
    </svg>
  );
}

export interface HeatCell {
  col: number;
  row: number;
  value: number;
}

/**
 * A heat grid over the pitch. Intensity is the share of the busiest cell, not
 * an absolute count, because the question a reader is asking is where this
 * player spent their time relative to their own match, not how their touch
 * count compares to a striker's.
 *
 * Cells below a floor are not drawn at all. A faint wash over the whole pitch
 * says "everywhere", which is the one thing a heatmap must never say by
 * accident.
 */
export function HeatGrid({
  cols,
  rows,
  counts,
  floor = 0.06,
}: {
  cols: number;
  rows: number;
  counts: readonly number[];
  floor?: number;
}) {
  const peak = counts.reduce((max, value) => Math.max(max, value), 0);
  if (peak <= 0) return null;

  const cellWidth = PITCH_LENGTH / cols;
  const cellHeight = PITCH_WIDTH / rows;

  return (
    <g className={styles.heat}>
      {counts.map((value, index) => {
        const intensity = value / peak;
        if (intensity < floor) return null;
        const col = index % cols;
        const row = Math.floor(index / cols);
        return (
          <rect
            key={index}
            x={col * cellWidth}
            y={row * cellHeight}
            width={cellWidth}
            height={cellHeight}
            fill={`var(--heat-${String(Math.min(5, Math.max(1, Math.ceil(intensity * 5))))})`}
            opacity={0.25 + intensity * 0.6}
          />
        );
      })}
    </g>
  );
}

/** A single marked position, for an average position or a shot. */
export function PitchMarker({
  x,
  y,
  label,
  tone = 'ink',
  radius = 2.2,
}: {
  x: number;
  y: number;
  label?: string;
  tone?: 'ink' | 'flare' | 'bonus';
  radius?: number;
}) {
  return (
    <g
      className={
        styles[`marker${tone[0]?.toUpperCase() ?? ''}${tone.slice(1)}`] ?? styles.markerInk
      }
    >
      <circle cx={toX(x)} cy={toY(y)} r={radius} />
      {label !== undefined && (
        <text x={toX(x)} y={toY(y) + radius * 0.4} textAnchor="middle" fontSize={radius * 1.1}>
          {label}
        </text>
      )}
    </g>
  );
}

export { toX as pitchX, toY as pitchY };
