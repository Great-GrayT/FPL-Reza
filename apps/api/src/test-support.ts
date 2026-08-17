import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { asSeason, createLogger } from '@fpl/core';
import type { Config } from '@fpl/config';
import { FileStore } from '@fpl/store';
import { HttpClient } from '@fpl/ingest';
import { DATASETS } from '@fpl/ingest';
import { FileAssetStore } from '@fpl/assets';
import { assetRootFor, type Deps } from './deps.js';

/**
 * Shared by every route test: a FileStore rooted in a fresh temp directory,
 * so tests never touch the real data lake or the network.
 */

export const TEST_SEASON = asSeason('2026/27');

export interface TestDeps {
  deps: Deps;
  cleanup: () => Promise<void>;
}

export async function createTestDeps(fetchImpl?: typeof fetch): Promise<TestDeps> {
  const root = await mkdtemp(path.join(tmpdir(), 'fpl-api-test-'));
  const config: Config = {
    season: TEST_SEASON,
    dataDir: root,
    logLevel: 'silent',
    fpl: {
      baseUrl: 'http://example.invalid',
      timeoutMs: 1000,
      retries: 0,
      minRequestIntervalMs: 0,
      userAgent: 'fpl-api-test',
    },
  };
  const logger = createLogger({ level: 'silent' });
  const store = new FileStore({ root });
  const http = new HttpClient({
    baseUrl: config.fpl.baseUrl,
    timeoutMs: config.fpl.timeoutMs,
    retries: config.fpl.retries,
    minRequestIntervalMs: config.fpl.minRequestIntervalMs,
    userAgent: config.fpl.userAgent,
    logger,
    fetchImpl:
      fetchImpl ??
      ((): Promise<Response> => {
        throw new Error('unexpected network call in test');
      }),
  });

  const assets = new FileAssetStore({ root: assetRootFor(root) });

  return {
    deps: { store, assets, config, logger, http },
    cleanup: (): Promise<void> => rm(root, { recursive: true, force: true }),
  };
}

export const teamRows = [
  {
    id: 1,
    code: 1,
    name: 'Arsenal',
    shortName: 'ARS',
    strength: 4,
    strengthOverallHome: 1200,
    strengthOverallAway: 1200,
    strengthAttackHome: 1300,
    strengthAttackAway: 1250,
    strengthDefenceHome: 1300,
    strengthDefenceAway: 1250,
  },
  {
    id: 2,
    code: 2,
    name: 'Chelsea',
    shortName: 'CHE',
    strength: 3,
    strengthOverallHome: 1200,
    strengthOverallAway: 1200,
    strengthAttackHome: 1200,
    strengthAttackAway: 1150,
    strengthDefenceHome: 1200,
    strengthDefenceAway: 1150,
  },
];

export const playerRows = [
  {
    id: 1,
    code: 101,
    firstName: 'Erling',
    secondName: 'Haaland',
    webName: 'Haaland',
    teamId: 1,
    position: 'FWD',
    price: 150,
    startPrice: 140,
    totalPoints: 120,
    minutes: 900,
    goals: 20,
    assists: 5,
    cleanSheets: 0,
    goalsConceded: 10,
    yellowCards: 1,
    redCards: 0,
    saves: 0,
    bonus: 10,
    bps: 500,
    form: 8.5,
    pointsPerGame: 6.0,
    selectedByPercent: 45.5,
    expectedGoals: 18.2,
    expectedAssists: 4.1,
    expectedGoalInvolvements: 22.3,
    expectedGoalsConceded: 8.0,
    availability: 'available',
    chanceOfPlayingNextRound: null,
    news: '',
  },
  {
    id: 2,
    code: 102,
    firstName: 'Bukayo',
    secondName: 'Saka',
    webName: 'Saka',
    teamId: 1,
    position: 'MID',
    price: 100,
    startPrice: 95,
    totalPoints: 110,
    minutes: 850,
    goals: 10,
    assists: 12,
    cleanSheets: 5,
    goalsConceded: 20,
    yellowCards: 2,
    redCards: 0,
    saves: 0,
    bonus: 15,
    bps: 480,
    form: 7.2,
    pointsPerGame: 5.5,
    selectedByPercent: 30.1,
    expectedGoals: 8.4,
    expectedAssists: 9.6,
    expectedGoalInvolvements: 18.0,
    expectedGoalsConceded: 15.0,
    availability: 'doubtful',
    chanceOfPlayingNextRound: 75,
    news: 'knock',
  },
  {
    id: 3,
    code: 103,
    firstName: 'Declan',
    secondName: 'Rice',
    webName: 'Rice',
    teamId: 2,
    position: 'MID',
    price: 65,
    startPrice: 60,
    totalPoints: 90,
    minutes: 920,
    goals: 3,
    assists: 4,
    cleanSheets: 6,
    goalsConceded: 18,
    yellowCards: 3,
    redCards: 0,
    saves: 0,
    bonus: 8,
    bps: 420,
    form: 5.1,
    pointsPerGame: 4.5,
    selectedByPercent: 20.0,
    expectedGoals: 2.0,
    expectedAssists: 3.5,
    expectedGoalInvolvements: 5.5,
    expectedGoalsConceded: 16.0,
    availability: 'available',
    chanceOfPlayingNextRound: null,
    news: '',
  },
];

export const gameweekRows = [
  {
    id: 1,
    name: 'Gameweek 1',
    deadline: '2026-08-15T17:30:00.000Z',
    finished: true,
    isCurrent: false,
    isNext: false,
    averageEntryScore: 55,
    highestScore: 130,
    mostCaptainedId: 1,
    chipPlays: {},
  },
  {
    id: 2,
    name: 'Gameweek 2',
    deadline: '2026-08-22T17:30:00.000Z',
    finished: false,
    isCurrent: true,
    isNext: false,
    averageEntryScore: 50,
    highestScore: null,
    mostCaptainedId: null,
    chipPlays: {},
  },
  {
    id: 3,
    name: 'Gameweek 3',
    deadline: '2026-08-29T17:30:00.000Z',
    finished: false,
    isCurrent: false,
    isNext: true,
    averageEntryScore: 0,
    highestScore: null,
    mostCaptainedId: null,
    chipPlays: {},
  },
];

export const fixtureRows = [
  {
    id: 1,
    gameweek: 1,
    kickoff: '2026-08-15T14:00:00.000Z',
    homeTeam: 1,
    awayTeam: 2,
    homeScore: 2,
    awayScore: 1,
    finished: true,
    started: true,
    homeDifficulty: 3,
    awayDifficulty: 3,
  },
  {
    id: 2,
    gameweek: 2,
    kickoff: '2026-08-22T14:00:00.000Z',
    homeTeam: 2,
    awayTeam: 1,
    homeScore: null,
    awayScore: null,
    finished: false,
    started: false,
    homeDifficulty: 4,
    awayDifficulty: 2,
  },
];

export const playerGameweekGw1Rows = [
  {
    playerId: 1,
    gameweek: 1,
    fixtureId: 1,
    opponentTeam: 2,
    wasHome: true,
    kickoff: '2026-08-15T14:00:00.000Z',
    minutes: 90,
    totalPoints: 12,
    goals: 2,
    assists: 0,
    cleanSheet: false,
    goalsConceded: 1,
    ownGoals: 0,
    penaltiesSaved: 0,
    penaltiesMissed: 0,
    yellowCards: 0,
    redCards: 0,
    saves: 0,
    bonus: 3,
    bps: 45,
    expectedGoals: 1.8,
    expectedAssists: 0.1,
    expectedGoalsConceded: 1.0,
    defensiveContribution: null,
    price: 150,
  },
  {
    playerId: 2,
    gameweek: 1,
    fixtureId: 1,
    opponentTeam: 2,
    wasHome: true,
    kickoff: '2026-08-15T14:00:00.000Z',
    minutes: 90,
    totalPoints: 8,
    goals: 1,
    assists: 1,
    cleanSheet: false,
    goalsConceded: 1,
    ownGoals: 0,
    penaltiesSaved: 0,
    penaltiesMissed: 0,
    yellowCards: 0,
    redCards: 0,
    saves: 0,
    bonus: 1,
    bps: 30,
    expectedGoals: 0.6,
    expectedAssists: 0.8,
    expectedGoalsConceded: 1.0,
    defensiveContribution: null,
    price: 100,
  },
];

/** Player 1's second gameweek, kept in its own partition to exercise multi-partition history reads. */
export const playerGameweekGw2Rows = [
  {
    playerId: 1,
    gameweek: 2,
    fixtureId: 2,
    opponentTeam: 2,
    wasHome: false,
    kickoff: '2026-08-22T14:00:00.000Z',
    minutes: 90,
    totalPoints: 6,
    goals: 1,
    assists: 0,
    cleanSheet: false,
    goalsConceded: 2,
    ownGoals: 0,
    penaltiesSaved: 0,
    penaltiesMissed: 0,
    yellowCards: 0,
    redCards: 0,
    saves: 0,
    bonus: 0,
    bps: 20,
    expectedGoals: 0.9,
    expectedAssists: 0.05,
    expectedGoalsConceded: 1.5,
    defensiveContribution: null,
    price: 150,
  },
];

/** Seeds teams, players, gameweeks, fixtures and one gameweek of player histories. */
export async function seedCore(deps: Deps): Promise<void> {
  const season = deps.config.season;
  await seedWithoutHistory(deps);
  await deps.store.write(
    { season, dataset: DATASETS.playerGameweeks, partition: 'gw1' },
    playerGameweekGw1Rows,
  );
}

/** Everything seedCore writes except the player-gameweeks dataset, which some tests need absent. */
export async function seedWithoutHistory(deps: Deps): Promise<void> {
  const season = deps.config.season;
  await deps.store.write({ season, dataset: DATASETS.teams }, teamRows);
  await deps.store.write({ season, dataset: DATASETS.players }, playerRows);
  await deps.store.write({ season, dataset: DATASETS.gameweeks }, gameweekRows);
  await deps.store.write({ season, dataset: DATASETS.fixtures }, fixtureRows);
}

/** Adds a second player-gameweeks partition on top of seedCore, for multi-partition history tests. */
export async function seedSecondGameweekPartition(deps: Deps): Promise<void> {
  await deps.store.write(
    { season: deps.config.season, dataset: DATASETS.playerGameweeks, partition: 'gw2' },
    playerGameweekGw2Rows,
  );
}
