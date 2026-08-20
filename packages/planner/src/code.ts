import type { Chip } from './types.js';

/**
 * A strategy as a code.
 *
 * What a reader wants to keep, share, or come back to is not a squad: it is the
 * question they asked. Fifteen names are the answer to "best over eight
 * gameweeks, a hundred million, neutral risk, keeping these two", and the answer
 * moves every time a price changes while the question does not. So the code
 * carries the question, and pasting it solves the question again against
 * whatever the lake holds today.
 *
 * That has one consequence worth being honest about, and the pages that print
 * a code say it: a code cannot show you the exact squad someone else saw if the
 * data has moved underneath it. What it can do, which the alternative cannot, is
 * tell you the plan has gone stale and what moved. The fingerprint is what makes
 * that possible: it is a hash of the pool the strategy was solved against, so a
 * mismatch is detectable rather than silent.
 *
 * The format is deliberately legible. A reader who sees `FPL1-G3-H8-B1000-R0`
 * can tell it starts at gameweek 3 and runs eight weeks before pasting it
 * anywhere, and a support conversation about a wrong plan can proceed without
 * anyone decoding anything.
 */

export const STRATEGY_CODE_VERSION = 1;

export interface Strategy {
  version: number;
  /** The gameweek the horizon opens on. */
  startGameweek: number;
  /** Gameweeks planned, inclusive of the first. */
  horizon: number;
  /** Budget in tenths of a million. */
  budget: number;
  /** Risk appetite, in tenths, so -1.0 travels as -10. */
  riskAversion: number;
  freeTransfers: number;
  /** Chips the manager holds and is willing to spend inside the horizon. */
  chips: Chip[];
  /** Player codes the search must keep. */
  keep: number[];
  /** Seed, so the same code returns the same answer on the same data. */
  seed: number;
  /** Hash of the pool this was solved against, which is what detects drift. */
  fingerprint: string;
}

export class StrategyCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StrategyCodeError';
  }
}

const CHIP_LETTERS: Record<Chip, string> = {
  bench_boost: 'b',
  triple_captain: 't',
  wildcard: 'w',
  free_hit: 'f',
};

const CHIP_BY_LETTER = new Map<string, Chip>(
  Object.entries(CHIP_LETTERS).map(([chip, letter]) => [letter, chip as Chip]),
);

const base36 = (value: number): string => Math.round(value).toString(36).toUpperCase();

function parseBase36(text: string, segment: string): number {
  const value = Number.parseInt(text, 36);
  if (!Number.isFinite(value)) {
    throw new StrategyCodeError(`the ${segment} part of this code is not a number: "${text}"`);
  }
  return value;
}

/**
 * A checksum over the code's own text, so a mistyped character is refused
 * rather than silently solved as a different strategy. Two base 36 characters
 * catch a single typo with probability 1295 in 1296, which is the right trade
 * for something people read aloud.
 */
function checksum(body: string): string {
  let hash = 7;
  for (let index = 0; index < body.length; index += 1) {
    hash = (hash * 31 + body.charCodeAt(index)) % 1296;
  }
  return base36(hash).padStart(2, '0');
}

export function encodeStrategy(strategy: Strategy): string {
  const parts = [
    `FPL${String(strategy.version)}`,
    `G${base36(strategy.startGameweek)}`,
    `H${base36(strategy.horizon)}`,
    `B${base36(strategy.budget)}`,
    // Risk is the one signed field, and a minus sign inside a dash separated
    // code would split the segment, so a negative reads as M.
    `R${strategy.riskAversion < 0 ? 'M' : ''}${base36(Math.abs(strategy.riskAversion))}`,
    `T${base36(strategy.freeTransfers)}`,
    `S${base36(strategy.seed)}`,
  ];
  if (strategy.chips.length > 0) {
    parts.push(`C${strategy.chips.map((chip) => CHIP_LETTERS[chip]).join('')}`);
  }
  if (strategy.keep.length > 0) {
    // Sorted, so two readers who picked the same players in a different order
    // produce the same code and can tell they agree.
    parts.push(
      `K${[...strategy.keep]
        .sort((a, b) => a - b)
        .map(base36)
        .join('.')}`,
    );
  }
  parts.push(`L${strategy.fingerprint}`);

  // Upper case before the checksum, because decoding upper cases first and the
  // two have to hash the same text. The chip letters are the only lower case
  // thing that reaches here, and this is where that stops mattering.
  const body = parts.join('-').toUpperCase();
  return `${body}-X${checksum(body)}`;
}

export function decodeStrategy(code: string): Strategy {
  const cleaned = code.trim().toUpperCase().replace(/\s+/g, '');
  if (cleaned === '') throw new StrategyCodeError('there is no code here to read');

  const parts = cleaned.split('-');
  const check = parts.at(-1);
  if (check?.startsWith('X') !== true) {
    throw new StrategyCodeError('this code is missing its check characters, so it is incomplete');
  }
  const body = parts.slice(0, -1).join('-');
  if (checksum(body) !== check.slice(1)) {
    throw new StrategyCodeError('this code does not check out, so a character is wrong or missing');
  }

  const head = parts[0];
  if (head?.startsWith('FPL') !== true) {
    throw new StrategyCodeError('this is not a strategy code: it does not start with FPL');
  }
  const version = parseBase36(head.slice(3), 'version');
  if (version !== STRATEGY_CODE_VERSION) {
    throw new StrategyCodeError(
      `this code is version ${String(version)} and this site reads version ${String(STRATEGY_CODE_VERSION)}`,
    );
  }

  const found = new Map<string, string>();
  for (const part of parts.slice(1, -1)) {
    const key = part.slice(0, 1);
    if (found.has(key)) {
      throw new StrategyCodeError(`this code carries "${key}" twice, so it cannot be read`);
    }
    found.set(key, part.slice(1));
  }

  const required = (key: string, name: string): string => {
    const value = found.get(key);
    if (value === undefined || value === '') {
      throw new StrategyCodeError(`this code is missing its ${name}`);
    }
    return value;
  };

  const risk = required('R', 'risk');
  const chips = found.get('C') ?? '';
  const keep = found.get('K') ?? '';

  const strategy: Strategy = {
    version,
    startGameweek: parseBase36(required('G', 'first gameweek'), 'first gameweek'),
    horizon: parseBase36(required('H', 'horizon'), 'horizon'),
    budget: parseBase36(required('B', 'budget'), 'budget'),
    riskAversion: risk.startsWith('M')
      ? -parseBase36(risk.slice(1), 'risk')
      : parseBase36(risk, 'risk'),
    freeTransfers: parseBase36(required('T', 'free transfers'), 'free transfers'),
    seed: parseBase36(required('S', 'seed'), 'seed'),
    // Chip letters are ASCII by construction, so splitting by code unit is
    // exactly right here and a segmenter would be ceremony.
    chips: chips.split('').map((letter) => {
      const chip = CHIP_BY_LETTER.get(letter.toLowerCase());
      if (chip === undefined) {
        throw new StrategyCodeError(`this code names a chip nothing here recognises: "${letter}"`);
      }
      return chip;
    }),
    keep: keep === '' ? [] : keep.split('.').map((entry) => parseBase36(entry, 'a kept player')),
    fingerprint: required('L', 'data fingerprint'),
  };

  if (strategy.horizon < 1)
    throw new StrategyCodeError('a horizon has to be at least one gameweek');
  if (strategy.budget < 0) throw new StrategyCodeError('a budget cannot be negative');
  return strategy;
}

/**
 * A fingerprint of the data a strategy was solved against.
 *
 * Prices and projections are what a strategy is solved on, so those are what it
 * hashes: change a price and the fingerprint changes, which is exactly when a
 * stored plan stops being the answer to its own question. The player set is in
 * there too, since a squad naming someone who has left the league is not a plan
 * either.
 *
 * It is a fingerprint, not a signature. It detects drift; it does not prove
 * anything about who produced the code.
 */
export function poolFingerprint(
  players: readonly { code: number; price: number; projections: readonly number[] }[],
): string {
  let hash = 2166136261;
  const mix = (value: number): void => {
    hash ^= Math.round(value) | 0;
    hash = Math.imul(hash, 16777619);
  };

  mix(players.length);
  for (const player of players) {
    mix(player.code);
    mix(player.price);
    // Projections are rounded into the hash rather than taken raw, so a
    // rebuild that shifts a number in the third decimal does not report a
    // change a reader would not recognise as one.
    for (const value of player.projections) mix(value * 10);
  }
  return base36(hash >>> 0);
}
