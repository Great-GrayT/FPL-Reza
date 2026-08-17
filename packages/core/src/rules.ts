import type { Position } from './position.js';
import type { Tenths } from './money.js';

/**
 * Squad and transfer legality. Values follow the official rules published at
 * https://fantasy.premierleague.com/en/help/rules and were last reconciled
 * against them on 2026-08-16.
 */

export const SQUAD_SIZE = 15;
export const STARTING_XI_SIZE = 11;
export const BENCH_SIZE = SQUAD_SIZE - STARTING_XI_SIZE;
export const INITIAL_BUDGET: Tenths = 1000;
export const MAX_PLAYERS_PER_CLUB = 3;

/** Points deducted per transfer beyond the free allowance. */
export const TRANSFER_HIT_POINTS = 4;
export const FREE_TRANSFERS_PER_GAMEWEEK = 1;
/** Unused free transfers roll over, but never bank beyond this. */
export const FREE_TRANSFERS_MAX = 5;
/** Hard cap per gameweek outside a Wildcard or Free Hit. */
export const MAX_TRANSFERS_PER_GAMEWEEK = 20;

export const GAMEWEEKS_PER_SEASON = 38;

/** Exact squad composition. Not a range: all 15 slots are position bound. */
export const SQUAD_QUOTA: Readonly<Record<Position, number>> = {
  GKP: 2,
  DEF: 5,
  MID: 5,
  FWD: 3,
};

/**
 * Formation bounds for the starting XI: exactly 1 keeper, at least 3
 * defenders, at least 1 forward. The rules impose no midfield minimum.
 */
export const XI_MIN: Readonly<Record<Position, number>> = {
  GKP: 1,
  DEF: 3,
  MID: 0,
  FWD: 1,
};

export const XI_MAX: Readonly<Record<Position, number>> = {
  GKP: 1,
  DEF: 5,
  MID: 5,
  FWD: 3,
};

export const CHIPS = ['bench_boost', 'free_hit', 'triple_captain', 'wildcard'] as const;
export type Chip = (typeof CHIPS)[number];

/** Every chip is issued twice per season, one per half. */
export const CHIP_USES_PER_SEASON = 2;

/** Chips from the first half must be played by the Gameweek 19 deadline. */
export const CHIP_HALVES_SPLIT_GAMEWEEK = 19;

export const CAPTAIN_MULTIPLIER = 2;
export const TRIPLE_CAPTAIN_MULTIPLIER = 3;

/** Only one chip may be active in any single gameweek. */
export const MAX_CHIPS_PER_GAMEWEEK = 1;

/** Free Hit cannot be played in consecutive gameweeks. */
export const FREE_HIT_MIN_GAP_GAMEWEEKS = 2;

/** Classic league scoring phases, inclusive on both ends. */
export const SCORING_PHASES = [
  { name: 'Overall', from: 1, to: 38 },
  { name: 'August', from: 1, to: 2 },
  { name: 'September', from: 3, to: 5 },
  { name: 'October', from: 6, to: 9 },
  { name: 'November', from: 10, to: 12 },
  { name: 'December', from: 13, to: 18 },
  { name: 'January', from: 19, to: 23 },
  { name: 'February', from: 24, to: 27 },
  { name: 'March', from: 28, to: 30 },
  { name: 'April', from: 31, to: 33 },
  { name: 'May', from: 34, to: 38 },
] as const;

/**
 * A price rise is only half realised on sale, rounded down to the nearest
 * 0.1m. A price fall is passed on in full. Both inputs are tenths.
 */
export function sellingPrice(purchasePrice: Tenths, currentPrice: Tenths): Tenths {
  if (currentPrice <= purchasePrice) return currentPrice;
  return purchasePrice + Math.floor((currentPrice - purchasePrice) / 2);
}
