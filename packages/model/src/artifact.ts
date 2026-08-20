import { z } from 'zod';
import type { ComponentFit } from './train.js';
import type { ComponentName } from './targets.js';

/**
 * A fitted model, on disk.
 *
 * The artifact carries the trees, the feature names in the order the trees
 * index them, and the evidence that the fit was worth shipping: the score, the
 * score of the same model against a shuffled target, the folds it was measured
 * on, and what each feature group was worth. That last part is the reason this
 * is a committed file rather than a cache. A model whose provenance lives only
 * in a training log is a model nobody can argue with.
 */

const treeNodeSchema = z.object({
  feature: z.number().int(),
  threshold: z.number(),
  left: z.number().int(),
  right: z.number().int(),
  value: z.number(),
  count: z.number().int().nonnegative(),
  gain: z.number(),
});

const treeSchema = z.object({
  nodes: z.array(treeNodeSchema),
});

const foldSchema = z.object({
  period: z.number().int(),
  score: z.number(),
  trainRows: z.number().int().nonnegative(),
  testRows: z.number().int().nonnegative(),
});

const ablationSchema = z.object({
  name: z.string(),
  features: z.array(z.string()),
  score: z.number(),
  baseline: z.number(),
  gain: z.number(),
  earned: z.boolean(),
});

export const modelArtifactSchema = z.object({
  component: z.string(),
  task: z.enum(['regression', 'classification']),
  description: z.string(),
  /** Feature names in the order the trees index them. Order is the contract. */
  featureNames: z.array(z.string()),
  /** Bin edges per feature, from training. Rebinning new data moves every split. */
  edges: z.array(z.array(z.number())),
  binCount: z.number().int().positive(),
  base: z.number(),
  learningRate: z.number(),
  trees: z.array(treeSchema),
  /** How it scored, and against what. */
  metric: z.string(),
  score: z.number(),
  standardError: z.number(),
  nullScore: z.number(),
  beatsNull: z.boolean(),
  folds: z.array(foldSchema),
  ablations: z.array(ablationSchema),
  importances: z.array(z.object({ name: z.string(), importance: z.number() })),
  rows: z.number().int().nonnegative(),
  seasons: z.array(z.string()),
  seed: z.number().int(),
  trainedAt: z.coerce.date(),
});

export type ModelArtifact = z.infer<typeof modelArtifactSchema>;

interface GbmShape {
  base: number;
  learningRate: number;
  edges: number[][];
  binCount: number;
  trees: {
    nodes: {
      feature: number;
      threshold: number;
      left: number;
      right: number;
      value: number;
      count: number;
      gain: number;
    }[];
  }[];
}

/** Turn a fitted component into the file that ships. */
export function toArtifact(fit: ComponentFit, seasons: readonly string[]): ModelArtifact {
  const gbm = fit.model as unknown as GbmShape;
  return modelArtifactSchema.parse({
    component: fit.component,
    task: fit.task,
    description: fit.description,
    featureNames: fit.featureNames,
    edges: gbm.edges,
    binCount: gbm.binCount,
    base: gbm.base,
    learningRate: gbm.learningRate,
    trees: gbm.trees.map((tree) => ({ nodes: tree.nodes })),
    metric: fit.metric,
    score: fit.score,
    standardError: fit.standardError,
    nullScore: fit.nullScore,
    beatsNull: fit.beatsNull,
    folds: fit.folds,
    ablations: fit.ablations,
    importances: fit.importances,
    rows: fit.rows,
    seasons: [...seasons],
    seed: fit.seed,
    trainedAt: new Date(),
  });
}

/**
 * Score a row against a stored artifact.
 *
 * The bin edges travel with the model rather than being recomputed, because
 * binning new data on its own quantiles moves every threshold the trees were
 * grown against, which quietly turns a fitted model into a different one.
 */
export function scoreArtifact(artifact: ModelArtifact, values: readonly number[]): number {
  let total = artifact.base;
  for (const tree of artifact.trees) {
    total += artifact.learningRate * walk(tree.nodes, artifact, values);
  }
  return artifact.task === 'classification' ? 1 / (1 + Math.exp(-total)) : total;
}

function walk(
  nodes: ModelArtifact['trees'][number]['nodes'],
  artifact: ModelArtifact,
  values: readonly number[],
): number {
  let id = 0;
  for (let step = 0; step < 128; step += 1) {
    const node = nodes[id];
    if (node === undefined) return 0;
    if (node.feature < 0) return node.value;
    const value = values[node.feature] ?? Number.NaN;
    const bin = binOf(value, artifact.edges[node.feature] ?? [], artifact.binCount);
    id = bin <= node.threshold ? node.left : node.right;
    if (id < 0) return node.value;
  }
  return 0;
}

/** A missing value gets its own bin, the same one training gave it. */
function binOf(value: number, edges: readonly number[], binCount: number): number {
  if (!Number.isFinite(value)) return binCount;
  let low = 0;
  let high = edges.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (value > (edges[mid] ?? Number.POSITIVE_INFINITY)) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Values in the order an artifact's trees expect, from a named row. */
export function orderFor(
  artifact: ModelArtifact,
  featureNames: readonly string[],
  values: Float64Array,
): number[] {
  const index = new Map(featureNames.map((name, position) => [name, position]));
  return artifact.featureNames.map((name) => {
    const position = index.get(name);
    return position === undefined ? Number.NaN : (values[position] ?? Number.NaN);
  });
}

export type ArtifactSet = Partial<Record<ComponentName, ModelArtifact>>;
