import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Season } from '@fpl/core';
import type { Store } from '@fpl/store';
import {
  modelArtifactSchema,
  toArtifact,
  type ArtifactSet,
  type ModelArtifact,
} from './artifact.js';
import { buildFeatures, type FeatureRow } from './features.js';
import { loadPanel } from './panel.js';
import { DEFAULT_ABLATIONS, fitAll, type ComponentFit, type TrainOptions } from './train.js';
import type { ComponentName } from './targets.js';

/**
 * Training as a command rather than a script.
 *
 * The artifacts are committed, so a change to a model is a diff somebody can
 * read: the score moved, this feature group stopped earning its place, the
 * training window grew by a season. That is only true if the run that produced
 * them is a single reproducible command with its seed written into the output.
 */

export const MODEL_DIRECTORY = 'data/models';

export interface TrainRunOptions extends TrainOptions {
  /** Season the lake is filed under. */
  season: Season;
  /** Archive seasons to train on. */
  seasons: readonly string[];
  minimumHistory?: number;
  /** Where to write. Defaults to the committed model directory. */
  directory?: string;
  /** Report without writing, for a run that only wants to see the scores. */
  dryRun?: boolean;
}

export interface TrainReport {
  seasons: string[];
  panelRows: number;
  featureRows: number;
  features: number;
  fits: {
    component: ComponentName;
    rows: number;
    metric: string;
    score: number;
    standardError: number;
    nullScore: number;
    beatsNull: boolean;
    topFeatures: string[];
    ablations: { name: string; gain: number; earned: boolean }[];
  }[];
  written: string[];
  /** Components that failed to beat a shuffled target and were not written. */
  refused: ComponentName[];
  seed: number;
  elapsedMs: number;
}

/**
 * Fit every component and write the ones that earned it.
 *
 * A component that cannot beat its own shuffled target is not written. That is
 * the whole gate: shipping a model that scores worse than noise, and letting a
 * page print its output beside a number that says so, is how a projection ends
 * up being trusted for the wrong reason.
 */
export async function trainModels(store: Store, options: TrainRunOptions): Promise<TrainReport> {
  const started = Date.now();
  const panel = await loadPanel(store, { season: options.season, seasons: options.seasons });
  const built = buildFeatures(panel, {
    minimumHistory: options.minimumHistory ?? 3,
  });

  const fits = fitAll(built.rows, {
    ...options,
    ablations: options.ablations ?? DEFAULT_ABLATIONS,
    ablationComponents: options.ablationComponents ?? ['goalRate', 'assistRate', 'bpsRate'],
  });

  const directory = options.directory ?? MODEL_DIRECTORY;
  const written: string[] = [];
  const refused: ComponentName[] = [];

  if (!options.dryRun) await mkdir(directory, { recursive: true });

  for (const fit of fits) {
    if (!fit.beatsNull) {
      refused.push(fit.component);
      continue;
    }
    if (options.dryRun) continue;
    const artifact = toArtifact(fit, options.seasons);
    const file = path.join(directory, `${fit.component}.json`);
    await writeFile(file, `${JSON.stringify(artifact, null, 2)}\n`);
    written.push(file);
  }

  return {
    seasons: [...options.seasons],
    panelRows: panel.rows.length,
    featureRows: built.rows.length,
    features: built.featureNames.length,
    fits: fits.map((fit) => reportOf(fit)),
    written,
    refused,
    seed: options.seed ?? 1,
    elapsedMs: Date.now() - started,
  };
}

function reportOf(fit: ComponentFit): TrainReport['fits'][number] {
  return {
    component: fit.component,
    rows: fit.rows,
    metric: fit.metric,
    score: fit.score,
    standardError: fit.standardError,
    nullScore: fit.nullScore,
    beatsNull: fit.beatsNull,
    topFeatures: fit.importances.slice(0, 3).map((entry) => entry.name),
    ablations: fit.ablations.map((ablation) => ({
      name: ablation.name,
      gain: ablation.gain,
      earned: ablation.earned,
    })),
  };
}

/** Every artifact on disk, keyed by component. A missing one is not an error. */
export async function loadArtifacts(directory = MODEL_DIRECTORY): Promise<ArtifactSet> {
  const out: ArtifactSet = {};
  let files: string[];
  try {
    files = await readdir(directory);
  } catch {
    return out;
  }

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const parsed: unknown = JSON.parse(await readFile(path.join(directory, file), 'utf8'));
      const artifact = modelArtifactSchema.parse(parsed);
      out[artifact.component as ComponentName] = artifact;
    } catch {
      // A malformed artifact is skipped rather than failing every page that
      // wanted a different component.
    }
  }
  return out;
}

/** The feature rows for the seasons asked for, for projecting or evaluating. */
export async function buildPanelFeatures(
  store: Store,
  season: Season,
  seasons: readonly string[],
  options: { minimumHistory?: number } = {},
): Promise<{ rows: FeatureRow[]; featureNames: string[] }> {
  const panel = await loadPanel(store, { season, seasons });
  const built = buildFeatures(panel, {
    minimumHistory: options.minimumHistory ?? 3,
  });
  return { rows: built.rows, featureNames: built.featureNames };
}

export type { ModelArtifact };
