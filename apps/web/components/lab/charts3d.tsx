'use client';

/**
 * Three dimensional charts, drawn by hand on a canvas.
 *
 * A third axis earns its place only when the question is genuinely about three
 * measures at once: a cloud whose shape depends on all three, or a response
 * surface where the whole point is how two inputs interact. Everywhere else two
 * dimensions and a colour read better, and the Lab uses those instead.
 *
 * There is no WebGL and no library here. A projection, a depth sort, and a
 * painter's algorithm are enough for a few thousand marks, and they keep the
 * page free of a rendering dependency that would dwarf the data it draws.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './charts.module.css';
import { formatNumber, seriesColour } from './charts';

interface View {
  /** Rotation about the vertical axis, in radians. */
  yaw: number;
  /** Tilt towards the viewer, in radians. */
  pitch: number;
  zoom: number;
}

const DEFAULT_VIEW: View = { yaw: -0.6, pitch: 0.42, zoom: 1 };

function resolveToken(token: string): string {
  const variable = /var\((--[a-z0-9-]+)\)/.exec(token);
  if (variable === null) return token;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(variable[1] ?? '')
    .trim();
  return value === '' ? '#24559a' : value;
}

interface Projected {
  x: number;
  y: number;
  depth: number;
}

/** One projection, shared by both charts, so a cloud and a surface line up. */
function project(
  point: { x: number; y: number; z: number },
  view: View,
  width: number,
  height: number,
): Projected {
  const cosYaw = Math.cos(view.yaw);
  const sinYaw = Math.sin(view.yaw);
  const cosPitch = Math.cos(view.pitch);
  const sinPitch = Math.sin(view.pitch);

  // Centre the unit cube on the origin before rotating, so rotation happens
  // about the middle of the data rather than about a corner.
  const x = point.x - 0.5;
  const y = point.y - 0.5;
  const z = point.z - 0.5;

  const rx = x * cosYaw - y * sinYaw;
  const ry = x * sinYaw + y * cosYaw;
  const depth = ry * cosPitch - z * sinPitch;
  const screenY = ry * sinPitch + z * cosPitch;

  // A gentle perspective divide: enough for the eye to read depth, not enough
  // to distort a comparison between the near and far side of the cloud.
  const scale = (Math.min(width, height) * 0.62 * view.zoom) / (1 + depth * 0.18);
  return { x: width / 2 + rx * scale, y: height / 2 - screenY * scale, depth };
}

function useRotation(): {
  view: View;
  setView: (view: View) => void;
  handlers: {
    onPointerDown: (event: React.PointerEvent<HTMLCanvasElement>) => void;
    onPointerMove: (event: React.PointerEvent<HTMLCanvasElement>) => void;
    onPointerUp: (event: React.PointerEvent<HTMLCanvasElement>) => void;
    onKeyDown: (event: React.KeyboardEvent<HTMLCanvasElement>) => void;
    onWheel: (event: React.WheelEvent<HTMLCanvasElement>) => void;
  };
} {
  const [view, setView] = useState<View>(DEFAULT_VIEW);
  const dragging = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    dragging.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const start = dragging.current;
    if (start === null) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    dragging.current = { x: event.clientX, y: event.clientY };
    setView((current) => ({
      yaw: current.yaw + dx * 0.008,
      // The tilt is clamped short of vertical: past it the cube turns inside
      // out and a reader loses which way is up.
      pitch: Math.max(-1.35, Math.min(1.35, current.pitch + dy * 0.006)),
      zoom: current.zoom,
    }));
  }, []);

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    dragging.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLCanvasElement>) => {
    const step = event.shiftKey ? 0.25 : 0.08;
    if (event.key === 'ArrowLeft') setView((current) => ({ ...current, yaw: current.yaw - step }));
    else if (event.key === 'ArrowRight')
      setView((current) => ({ ...current, yaw: current.yaw + step }));
    else if (event.key === 'ArrowUp')
      setView((current) => ({ ...current, pitch: Math.min(1.35, current.pitch + step) }));
    else if (event.key === 'ArrowDown')
      setView((current) => ({ ...current, pitch: Math.max(-1.35, current.pitch - step) }));
    else if (event.key === '+' || event.key === '=')
      setView((current) => ({ ...current, zoom: Math.min(2.5, current.zoom * 1.12) }));
    else if (event.key === '-')
      setView((current) => ({ ...current, zoom: Math.max(0.4, current.zoom / 1.12) }));
    else if (event.key === '0') setView(DEFAULT_VIEW);
    else return;
    event.preventDefault();
  }, []);

  const onWheel = useCallback((event: React.WheelEvent<HTMLCanvasElement>) => {
    if (!event.ctrlKey && Math.abs(event.deltaY) < 2) return;
    setView((current) => ({
      ...current,
      zoom: Math.max(0.4, Math.min(2.5, current.zoom * (event.deltaY > 0 ? 0.94 : 1.06))),
    }));
  }, []);

  return {
    view,
    setView,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onKeyDown, onWheel },
  };
}

interface Bounds {
  min: number;
  max: number;
}

function boundsOf(values: number[]): Bounds {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return { min: 0, max: 1 };
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  return min === max ? { min: min - 1, max: max + 1 } : { min, max };
}

function drawCage(
  context: CanvasRenderingContext2D,
  view: View,
  width: number,
  height: number,
  labels: { x: string; y: string; z: string },
  ranges: { x: Bounds; y: Bounds; z: Bounds },
): void {
  const corners: [number, number, number][] = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
  ];
  const edges: [number, number][] = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];
  const points = corners.map(([x, y, z]) => project({ x, y, z }, view, width, height));

  context.strokeStyle = resolveToken('var(--rule)');
  context.lineWidth = 1;
  for (const [a, b] of edges) {
    const from = points[a];
    const to = points[b];
    if (from === undefined || to === undefined) continue;
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  }

  context.fillStyle = resolveToken('var(--ink-soft)');
  context.font = '11px ui-monospace, monospace';
  const label = (index: number, text: string): void => {
    const point = points[index];
    if (point === undefined) return;
    context.fillText(text, point.x + 4, point.y - 4);
  };
  label(1, `${labels.x} →`);
  label(3, `${labels.y} →`);
  label(4, `${labels.z} ↑`);

  context.fillText(
    formatNumber(ranges.x.min, 1),
    (points[0]?.x ?? 0) - 6,
    (points[0]?.y ?? 0) + 14,
  );
  context.fillText(
    formatNumber(ranges.x.max, 1),
    (points[1]?.x ?? 0) - 6,
    (points[1]?.y ?? 0) + 14,
  );
  context.fillText(formatNumber(ranges.z.max, 1), (points[4]?.x ?? 0) - 34, points[4]?.y ?? 0);
}

export interface Point3D {
  x: number;
  y: number;
  z: number;
  g: string | null;
  label?: string;
}

/**
 * A rotatable point cloud. Depth is carried three ways at once, because one is
 * never enough on a flat screen: near points are larger, more opaque, and drawn
 * last, so the front of the cloud reads as the front.
 */
export function Scatter3D({
  points,
  axes,
  groups,
  height = 420,
}: {
  points: Point3D[];
  axes: { x: string; y: string; z: string };
  groups?: string[];
  height?: number;
}): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { view, setView, handlers } = useRotation();

  const groupList = useMemo(() => {
    if (groups !== undefined) return groups.slice(0, 4);
    const seen = new Set<string>();
    for (const point of points) if (point.g !== null) seen.add(point.g);
    return [...seen].sort().slice(0, 4);
  }, [groups, points]);

  const ranges = useMemo(
    () => ({
      x: boundsOf(points.map((point) => point.x)),
      y: boundsOf(points.map((point) => point.y)),
      z: boundsOf(points.map((point) => point.z)),
    }),
    [points],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const parent = canvas.parentElement;
    const width = parent === null ? 680 : parent.clientWidth;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const context = canvas.getContext('2d');
    if (context === null) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    drawCage(context, view, width, height, axes, ranges);

    const normalise = (value: number, bounds: Bounds): number =>
      (value - bounds.min) / (bounds.max - bounds.min || 1);
    const colours = new Map<string, string>();
    groupList.forEach((group, index) => {
      colours.set(group, resolveToken(seriesColour(index)));
    });
    const fallback = resolveToken('var(--series-1)');

    const projected = points.map((point) => ({
      point,
      screen: project(
        {
          x: normalise(point.x, ranges.x),
          y: normalise(point.y, ranges.y),
          z: normalise(point.z, ranges.z),
        },
        view,
        width,
        height,
      ),
    }));
    // Painter's algorithm: the far side of the cloud is drawn first, so the
    // near side sits on top of it rather than being scribbled over.
    projected.sort((left, right) => right.screen.depth - left.screen.depth);

    for (const entry of projected) {
      const near = 1 - Math.min(1, Math.max(0, (entry.screen.depth + 0.9) / 1.8));
      context.globalAlpha = 0.25 + near * 0.55;
      context.fillStyle =
        entry.point.g === null
          ? fallback
          : (colours.get(entry.point.g) ?? resolveToken('var(--series-other)'));
      const radius = 1.2 + near * 2.2;
      context.beginPath();
      context.arc(entry.screen.x, entry.screen.y, radius, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
  }, [points, view, axes, ranges, groupList, height]);

  return (
    <figure className={styles.figure}>
      <div className={styles.canvasWrap}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          style={{ width: '100%', height, touchAction: 'none', cursor: 'grab' }}
          tabIndex={0}
          role="img"
          aria-label={`Three dimensional scatter of ${axes.z} against ${axes.x} and ${axes.y}, ${points.length} points. Drag or use the arrow keys to rotate.`}
          {...handlers}
        />
      </div>
      <figcaption className={styles.legend}>
        <span className={styles.axisNote}>
          {points.length.toLocaleString('en-GB')} points. Drag to rotate, arrow keys when focused, 0
          to reset.
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
        <button
          type="button"
          className={styles.viewButton}
          onClick={() => {
            setView(DEFAULT_VIEW);
          }}
        >
          Reset view
        </button>
        <button
          type="button"
          className={styles.viewButton}
          onClick={() => {
            setView({ yaw: 0, pitch: 0, zoom: 1 });
          }}
        >
          Face on
        </button>
        <button
          type="button"
          className={styles.viewButton}
          onClick={() => {
            setView({ yaw: -Math.PI / 2, pitch: 0.05, zoom: 1 });
          }}
        >
          From the side
        </button>
      </figcaption>
    </figure>
  );
}

export interface SurfaceCell {
  xi: number;
  yi: number;
  x: number;
  y: number;
  value: number | null;
  count: number;
}

/**
 * A response surface over two binned inputs. Shaded on a single hue, light to
 * dark, because height and colour are carrying the same magnitude and a second
 * hue would be decoration. A bin with no rows in it is left as a hole rather
 * than interpolated: the gap is a fact about the data.
 */
export function Surface3D({
  cells,
  bins,
  axes,
  height = 440,
}: {
  cells: SurfaceCell[];
  bins: number;
  axes: { x: string; y: string; z: string };
  height?: number;
}): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { view, setView, handlers } = useRotation();

  const grid = useMemo(() => {
    const lookup = new Map<string, SurfaceCell>();
    for (const cell of cells) lookup.set(`${cell.xi}:${cell.yi}`, cell);
    return lookup;
  }, [cells]);

  const ranges = useMemo(() => {
    const values = cells
      .map((cell) => cell.value)
      .filter((value): value is number => value !== null);
    return {
      x: boundsOf(cells.map((cell) => cell.x)),
      y: boundsOf(cells.map((cell) => cell.y)),
      z: boundsOf(values),
    };
  }, [cells]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const parent = canvas.parentElement;
    const width = parent === null ? 680 : parent.clientWidth;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const context = canvas.getContext('2d');
    if (context === null) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    drawCage(context, view, width, height, axes, ranges);

    const ramp = [
      resolveToken('var(--ramp-1)'),
      resolveToken('var(--ramp-2)'),
      resolveToken('var(--ramp-3)'),
      resolveToken('var(--ramp-4)'),
      resolveToken('var(--ramp-5)'),
    ];
    const stroke = resolveToken('var(--rule)');
    const normalise = (value: number, bounds: Bounds): number =>
      (value - bounds.min) / (bounds.max - bounds.min || 1);

    interface Quad {
      corners: Projected[];
      depth: number;
      shade: number;
    }
    const quads: Quad[] = [];

    for (let xi = 0; xi < bins - 1; xi += 1) {
      for (let yi = 0; yi < bins - 1; yi += 1) {
        const raw = [
          grid.get(`${xi}:${yi}`),
          grid.get(`${xi + 1}:${yi}`),
          grid.get(`${xi + 1}:${yi + 1}`),
          grid.get(`${xi}:${yi + 1}`),
        ];
        // Every corner has to be measured. A quad drawn over a hole is an
        // interpolation the data does not support.
        const square = raw.filter((cell): cell is SurfaceCell => cell?.value != null);
        if (square.length < 4) continue;

        const corners = square.map((source, index) => {
          const cx = index === 1 || index === 2 ? xi + 1 : xi;
          const cy = index === 2 || index === 3 ? yi + 1 : yi;
          return project(
            {
              x: cx / (bins - 1),
              y: cy / (bins - 1),
              z: normalise(source.value ?? 0, ranges.z),
            },
            view,
            width,
            height,
          );
        });

        const heights = square.map((cell) => normalise(cell.value ?? 0, ranges.z));
        const shade = heights.reduce((total, value) => total + value, 0) / heights.length;
        const depth = corners.reduce((total, corner) => total + corner.depth, 0) / corners.length;
        quads.push({ corners, depth, shade });
      }
    }

    quads.sort((left, right) => right.depth - left.depth);
    for (const quad of quads) {
      const index = Math.min(
        ramp.length - 1,
        Math.max(0, Math.round(quad.shade * (ramp.length - 1))),
      );
      context.fillStyle = ramp[index] ?? ramp[0] ?? '#2e5e3a';
      context.strokeStyle = stroke;
      context.lineWidth = 0.5;
      context.beginPath();
      quad.corners.forEach((corner, position) => {
        if (position === 0) context.moveTo(corner.x, corner.y);
        else context.lineTo(corner.x, corner.y);
      });
      context.closePath();
      context.fill();
      context.stroke();
    }
  }, [grid, bins, view, axes, ranges, height]);

  const filled = cells.filter((cell) => cell.value !== null).length;

  return (
    <figure className={styles.figure}>
      <div className={styles.canvasWrap}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          style={{ width: '100%', height, touchAction: 'none', cursor: 'grab' }}
          tabIndex={0}
          role="img"
          aria-label={`Response surface of ${axes.z} over ${axes.x} and ${axes.y}, ${filled} filled bins of ${bins * bins}. Drag or use the arrow keys to rotate.`}
          {...handlers}
        />
      </div>
      <figcaption className={styles.legend}>
        <span className={styles.axisNote}>
          {axes.z} over {axes.x} and {axes.y}. {filled} of {bins * bins} bins hold rows; the rest
          are left open rather than interpolated.
        </span>
        <span className={styles.rampLegend} aria-hidden="true">
          <span style={{ background: 'var(--ramp-1)' }} />
          <span style={{ background: 'var(--ramp-2)' }} />
          <span style={{ background: 'var(--ramp-3)' }} />
          <span style={{ background: 'var(--ramp-4)' }} />
          <span style={{ background: 'var(--ramp-5)' }} />
        </span>
        <span className={styles.axisNote}>
          low {formatNumber(ranges.z.min, 2)} to high {formatNumber(ranges.z.max, 2)}
        </span>
        <button
          type="button"
          className={styles.viewButton}
          onClick={() => {
            setView(DEFAULT_VIEW);
          }}
        >
          Reset view
        </button>
      </figcaption>
    </figure>
  );
}
