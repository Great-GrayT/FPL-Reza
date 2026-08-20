'use client';

/**
 * The three dimensional panel: a rotatable cloud, a response surface, and the
 * player space itself reduced to its principal components and clustered.
 *
 * A third axis is used here and nowhere else in the Lab, on purpose. These are
 * the three questions that genuinely need it: how three measures sit together,
 * how a return varies over two inputs at once, and what shape the whole space
 * of players has.
 */
import { useState } from 'react';
import { useQuery } from '@/lib/quant/client';
import { LABEL_COLUMNS, NUMERIC_COLUMNS } from '@/lib/quant/schema';
import { formatNumber } from './charts';
import { Scatter3D, Surface3D, type SurfaceCell } from './charts3d';
import { Failure, Loading, NumberField, Section, Select, StatGrid, Verdict } from './controls';
import type { PanelProps } from './panels-explore';
import styles from './lab.module.css';

const NUMERIC_OPTIONS = NUMERIC_COLUMNS.map((column) => ({
  value: column.name,
  label: column.label,
}));
const LABEL_OPTIONS = LABEL_COLUMNS.map((column) => ({ value: column.name, label: column.label }));

interface Scatter3DResult {
  points: { x: number; y: number; z: number; g: string | null; label: string }[];
  stride: number;
  axes: { x: string; y: string; z: string };
  correlations: { xy: number; xz: number; yz: number };
}

interface SurfaceResult {
  cells: SurfaceCell[];
  bins: number;
  axes: { x: string; y: string; z: string };
}

interface ClusterResult {
  clustering: {
    assignments: number[];
    sizes: number[];
    inertia: number;
    silhouette: number;
    k: number;
    names: string[];
    centres: number[][];
  };
  points: { name: string; position: string; cluster: number; x: number; y: number; z: number }[];
  loadings: number[][];
  explained: number[];
  names: string[];
}

const CLUSTER_COLUMNS = [
  'totalPoints',
  'minutes',
  'bps',
  'goals',
  'assists',
  'expectedGoals',
  'expectedAssists',
  'price',
];

export function SpacePanel({ state, update, scope, scopeKey }: PanelProps): React.ReactElement {
  const [bins, setBins] = useState(16);
  const [surfaceAggregation, setSurfaceAggregation] = useState<'mean' | 'median' | 'count'>('mean');

  const cloud = useQuery<Scatter3DResult>(
    {
      kind: 'scatter3d',
      scope,
      x: state.x,
      y: state.y,
      z: state.z,
      colour: state.colour,
      sample: 6000,
    },
    `${scopeKey}|scatter3d|${state.x}|${state.y}|${state.z}|${state.colour}`,
  );

  const surface = useQuery<SurfaceResult>(
    {
      kind: 'surface',
      scope,
      x: state.x,
      y: state.y,
      z: state.z,
      bins,
      aggregation: surfaceAggregation,
    },
    `${scopeKey}|surface|${state.x}|${state.y}|${state.z}|${bins}|${surfaceAggregation}`,
  );

  const clusters = useQuery<ClusterResult>(
    { kind: 'cluster', scope, columns: CLUSTER_COLUMNS, k: state.k, seed: state.seed },
    `${scopeKey}|cluster|${state.k}|${state.seed}`,
  );

  return (
    <>
      <Section
        title="Three measures at once"
        description="A rotatable cloud. Drag it, or focus it and use the arrow keys. Depth is carried by size, opacity, and draw order together, because one of those alone is never enough on a flat screen."
        aside={
          <div className={styles.inlineControls}>
            <Select
              label="X"
              value={state.x}
              options={NUMERIC_OPTIONS}
              onChange={(value) => {
                update({ x: value });
              }}
            />
            <Select
              label="Y"
              value={state.y}
              options={NUMERIC_OPTIONS}
              onChange={(value) => {
                update({ y: value });
              }}
            />
            <Select
              label="Z"
              value={state.z}
              options={NUMERIC_OPTIONS}
              onChange={(value) => {
                update({ z: value });
              }}
            />
            <Select
              label="Colour"
              value={state.colour}
              options={LABEL_OPTIONS}
              onChange={(value) => {
                update({ colour: value });
              }}
            />
          </div>
        }
      >
        {cloud.error !== null ? <Failure message={cloud.error} /> : null}
        {cloud.data === null ? (
          <Loading label="Projecting…" />
        ) : (
          <>
            <Scatter3D points={cloud.data.points} axes={cloud.data.axes} />
            <StatGrid
              stats={[
                {
                  label: `${state.x} vs ${state.y}`,
                  value: formatNumber(cloud.data.correlations.xy, 3),
                },
                {
                  label: `${state.x} vs ${state.z}`,
                  value: formatNumber(cloud.data.correlations.xz, 3),
                },
                {
                  label: `${state.y} vs ${state.z}`,
                  value: formatNumber(cloud.data.correlations.yz, 3),
                },
                { label: 'Drawn', value: cloud.data.points.length.toLocaleString('en-GB') },
                { label: 'Every nth row', value: String(cloud.data.stride) },
              ]}
            />
            <Verdict>
              Three rank correlations are printed beside the cloud on purpose: rotation shows you a
              shape, and a shape is easy to over read. If all three coefficients are small, what you
              are looking at is a ball.
            </Verdict>
          </>
        )}
      </Section>

      <Section
        title="A response surface"
        description="The two chosen inputs binned into a grid, and the third measure averaged in each cell. This is where an interaction shows itself: a surface that tilts differently at each end is two effects that depend on each other."
        aside={
          <div className={styles.inlineControls}>
            <NumberField
              label="Grid"
              value={bins}
              min={6}
              max={32}
              onChange={(value) => {
                setBins(Math.round(value));
              }}
              hint="Bins per axis"
            />
            <Select
              label="Height"
              value={surfaceAggregation}
              options={[
                { value: 'mean', label: 'Mean of Z' },
                { value: 'median', label: 'Median of Z' },
                { value: 'count', label: 'Rows in the bin' },
              ]}
              onChange={(value) => {
                setSurfaceAggregation(value as 'mean' | 'median' | 'count');
              }}
            />
          </div>
        }
      >
        {surface.error !== null ? <Failure message={surface.error} /> : null}
        {surface.data === null ? (
          <Loading label="Binning and shading…" />
        ) : (
          <>
            <Surface3D
              cells={surface.data.cells}
              bins={surface.data.bins}
              axes={surface.data.axes}
            />
            <Verdict tone="warn">
              A cell with no rows is left open rather than smoothed over. The corners of a surface
              are usually the thinnest part of the data, so read the middle and treat the edges as
              decoration.
            </Verdict>
          </>
        )}
      </Section>

      <Section
        title="The shape of the player space"
        description="Eight measures reduced to their three principal components, then clustered. Nobody chose these groups: they are what the measures themselves separate into."
        aside={
          <div className={styles.inlineControls}>
            <NumberField
              label="Clusters"
              value={state.k}
              min={2}
              max={8}
              onChange={(value) => {
                update({ k: Math.round(value) });
              }}
            />
            <NumberField
              label="Seed"
              value={state.seed}
              min={1}
              onChange={(value) => {
                update({ seed: Math.round(value) });
              }}
            />
          </div>
        }
      >
        {clusters.error !== null ? <Failure message={clusters.error} /> : null}
        {clusters.data === null ? (
          <Loading label="Clustering…" />
        ) : (
          <>
            <Scatter3D
              points={clusters.data.points.map((point) => ({
                x: point.x,
                y: point.y,
                z: point.z,
                g: `Cluster ${point.cluster + 1}`,
                label: point.name,
              }))}
              axes={{ x: 'component 1', y: 'component 2', z: 'component 3' }}
              groups={Array.from({ length: state.k }, (_, index) => `Cluster ${index + 1}`)}
            />
            <StatGrid
              stats={[
                {
                  label: 'Silhouette',
                  value: formatNumber(clusters.data.clustering.silhouette, 3),
                  tone: clusters.data.clustering.silhouette > 0.5 ? 'good' : 'warn',
                },
                {
                  label: 'First component',
                  value: `${formatNumber((clusters.data.explained[0] ?? 0) * 100, 0)}%`,
                },
                {
                  label: 'First three',
                  value: `${formatNumber(
                    ((clusters.data.explained[0] ?? 0) +
                      (clusters.data.explained[1] ?? 0) +
                      (clusters.data.explained[2] ?? 0)) *
                      100,
                    0,
                  )}%`,
                },
                { label: 'Rows', value: clusters.data.points.length.toLocaleString('en-GB') },
                {
                  label: 'Largest cluster',
                  value: String(Math.max(...clusters.data.clustering.sizes)),
                },
              ]}
            />
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Measure</th>
                    <th scope="col">Component 1</th>
                    <th scope="col">Component 2</th>
                    <th scope="col">Component 3</th>
                  </tr>
                </thead>
                <tbody>
                  {clusters.data.names.map((name, index) => (
                    <tr key={name}>
                      <th scope="row">{name}</th>
                      <td className="num">
                        {formatNumber(clusters.data?.loadings[0]?.[index] ?? Number.NaN, 2)}
                      </td>
                      <td className="num">
                        {formatNumber(clusters.data?.loadings[1]?.[index] ?? Number.NaN, 2)}
                      </td>
                      <td className="num">
                        {formatNumber(clusters.data?.loadings[2]?.[index] ?? Number.NaN, 2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Verdict tone={clusters.data.clustering.silhouette > 0.5 ? 'good' : 'warn'}>
              A silhouette of {formatNumber(clusters.data.clustering.silhouette, 3)}{' '}
              {clusters.data.clustering.silhouette > 0.5
                ? 'means the clusters are genuinely separated rather than slices of one cloud.'
                : 'is weak: these groups are cuts through a continuum, not natural kinds. Read the loadings, not the labels.'}{' '}
              The loadings are what the components mean: a measure with a large value on a component
              is what that axis is made of.
            </Verdict>
          </>
        )}
      </Section>
    </>
  );
}
