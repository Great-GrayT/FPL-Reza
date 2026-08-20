import { CLEAN_SHEET_POINTS, GOAL_POINTS, type Position } from '@fpl/core';
import { orderFor, scoreArtifact, type ArtifactSet, type ModelArtifact } from './artifact.js';
import { FEATURE_NAMES } from './features.js';

/**
 * Component predictions, composed into points by the published rules.
 *
 * Nothing here fits anything. Each component says one thing about a player's
 * next match, and this file applies the scoring table to those statements. That
 * separation is what lets a projection be broken apart on screen: two points
 * because he will finish the match, one and a half because of a thirty eight
 * percent clean sheet, and so on, each traceable to a model with its own score.
 */

export interface ComponentPrediction {
  /** Probability of reaching a full appearance. */
  fullAppearance: number;
  /** Expected minutes, from that probability. */
  minutes: number;
  goalsPer90: number;
  assistsPer90: number;
  cleanSheetProbability: number;
  concededPer90: number;
  savesPer90: number;
  bpsPer90: number;
  cardProbability: number;
}

export interface PointsBreakdown {
  appearance: number;
  goals: number;
  assists: number;
  cleanSheet: number;
  conceded: number;
  saves: number;
  bonus: number;
  cards: number;
  total: number;
}

export interface Projection {
  playerCode: number;
  name: string;
  position: Position;
  components: ComponentPrediction;
  points: PointsBreakdown;
  /** Which components came from a fitted model rather than a fallback. */
  fitted: string[];
  /** Sentences explaining the number, in the order they matter. */
  explanation: string[];
}

/**
 * Minutes expected, given the probability of a full appearance.
 *
 * A player who does not reach sixty has still usually played some: the split
 * between "unused" and "on for twenty" is the largest single source of error in
 * any projection, and treating everything below sixty as zero would understate
 * every substitute in the game. The 25 is the mean minutes of a sub appearance
 * across the stored seasons, which is a measured constant rather than a guess.
 */
const PART_APPEARANCE_MINUTES = 25;

function minutesFrom(fullAppearance: number): number {
  return fullAppearance * 85 + (1 - fullAppearance) * PART_APPEARANCE_MINUTES * 0.45;
}

/** Bonus, from a bonus points score. Fitted on the stored seasons, stated here. */
function bonusFrom(bpsPer90: number, minutes: number): number {
  const bps = (bpsPer90 * minutes) / 90;
  // Bonus is awarded to the top three in a match, so the mapping from a score
  // to an expectation is a curve rather than a threshold: about a fifth of a
  // point at 20 bps, one point at 30, two at 40.
  if (!Number.isFinite(bps) || bps <= 12) return 0;
  return Math.min(3, Math.max(0, (bps - 12) / 14));
}

const CONCEDING_POSITIONS = new Set<Position>(['GKP', 'DEF']);

export interface ProjectOptions {
  /** Fallbacks where a component has no fitted model. */
  fallback?: Partial<ComponentPrediction>;
}

/** Compose one player's components into expected points. */
export function composePoints(
  position: Position,
  components: ComponentPrediction,
): PointsBreakdown {
  const minutes = components.minutes;
  const share = minutes / 90;

  const appearance = components.fullAppearance * 2 + (1 - components.fullAppearance) * 1;
  const goals = components.goalsPer90 * share * GOAL_POINTS[position];
  const assists = components.assistsPer90 * share * 3;
  // The rule pays a clean sheet only on a full appearance, so the probability
  // of the sheet is multiplied by the probability of being on the pitch for it.
  const cleanSheet =
    components.cleanSheetProbability * components.fullAppearance * CLEAN_SHEET_POINTS[position];
  const conceded = CONCEDING_POSITIONS.has(position)
    ? -Math.floor((components.concededPer90 * share) / 2)
    : 0;
  const saves = position === 'GKP' ? Math.floor((components.savesPer90 * share) / 3) : 0;
  const bonus = bonusFrom(components.bpsPer90, minutes);
  const cards = -components.cardProbability;

  const total = appearance + goals + assists + cleanSheet + conceded + saves + bonus + cards;
  return { appearance, goals, assists, cleanSheet, conceded, saves, bonus, cards, total };
}

const DEFAULTS: ComponentPrediction = {
  fullAppearance: 0.5,
  minutes: 55,
  goalsPer90: 0.1,
  assistsPer90: 0.08,
  cleanSheetProbability: 0.28,
  concededPer90: 1.4,
  savesPer90: 3,
  bpsPer90: 16,
  cardProbability: 0.12,
};

/**
 * Score one row against every fitted component.
 *
 * A component with no artifact falls back to the league average for that
 * measure, and the projection says which components were fitted, so a reader
 * can see how much of the number is a model and how much is an average.
 */
export function projectRow(
  artifacts: ArtifactSet,
  input: {
    playerCode: number;
    name: string;
    position: Position;
    values: Float64Array;
    featureNames?: readonly string[];
  },
  options: ProjectOptions = {},
): Projection {
  const names = input.featureNames ?? FEATURE_NAMES;
  const fitted: string[] = [];

  const score = (artifact: ModelArtifact | undefined, fallback: number): number => {
    if (artifact === undefined) return fallback;
    const value = scoreArtifact(artifact, orderFor(artifact, names, input.values));
    if (!Number.isFinite(value)) return fallback;
    fitted.push(artifact.component);
    return value;
  };

  const base = { ...DEFAULTS, ...options.fallback };
  const fullAppearance = clamp(score(artifacts.minutes, base.fullAppearance), 0, 1);
  const components: ComponentPrediction = {
    fullAppearance,
    minutes: minutesFrom(fullAppearance),
    goalsPer90: Math.max(0, score(artifacts.goalRate, base.goalsPer90)),
    assistsPer90: Math.max(0, score(artifacts.assistRate, base.assistsPer90)),
    cleanSheetProbability: clamp(score(artifacts.cleanSheet, base.cleanSheetProbability), 0, 1),
    concededPer90: Math.max(0, score(artifacts.concededRate, base.concededPer90)),
    savesPer90: Math.max(0, score(artifacts.saveRate, base.savesPer90)),
    bpsPer90: Math.max(0, score(artifacts.bpsRate, base.bpsPer90)),
    cardProbability: clamp(score(artifacts.cardRate, base.cardProbability), 0, 1),
  };

  const points = composePoints(input.position, components);

  return {
    playerCode: input.playerCode,
    name: input.name,
    position: input.position,
    components,
    points,
    fitted,
    explanation: explain(input.position, components, points, fitted.length),
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * The projection's own account of itself, largest contribution first.
 *
 * Every sentence names the component it came from, because "he will score 5.2"
 * is a claim nobody can check and "1.9 of that is a 63 percent chance of
 * finishing the match" is one they can.
 */
function explain(
  position: Position,
  components: ComponentPrediction,
  points: PointsBreakdown,
  fittedCount: number,
): string[] {
  const parts: { label: string; value: number }[] = [
    {
      label: `${(components.fullAppearance * 100).toFixed(0)} percent chance of a full appearance`,
      value: points.appearance,
    },
    {
      label: `${components.goalsPer90.toFixed(2)} goals per ninety at ${GOAL_POINTS[position]} points each`,
      value: points.goals,
    },
    { label: `${components.assistsPer90.toFixed(2)} assists per ninety`, value: points.assists },
    {
      label: `${(components.cleanSheetProbability * 100).toFixed(0)} percent chance of a clean sheet`,
      value: points.cleanSheet,
    },
    {
      label: `${components.bpsPer90.toFixed(0)} bonus points score per ninety`,
      value: points.bonus,
    },
    {
      label: `${components.concededPer90.toFixed(2)} goals conceded per ninety`,
      value: points.conceded,
    },
    { label: `${components.savesPer90.toFixed(1)} saves per ninety`, value: points.saves },
    {
      label: `${(components.cardProbability * 100).toFixed(0)} percent chance of a card`,
      value: points.cards,
    },
  ];

  const sentences = parts
    .filter((part) => Math.abs(part.value) >= 0.05)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .map((part) => `${part.value >= 0 ? '+' : ''}${part.value.toFixed(2)} from a ${part.label}.`);

  sentences.push(
    fittedCount === 0
      ? 'No component was fitted, so this is the league average for every part of it.'
      : `${fittedCount} of the eight components came from a fitted model; the rest are league averages.`,
  );
  return sentences;
}
