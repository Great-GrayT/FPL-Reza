import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { loadConfig } from '@fpl/config';
import { playerSchema, silentLogger, teamSchema, type Player, type Team } from '@fpl/core';
import { FileStore } from '@fpl/store';
import { HttpClient } from '@fpl/ingest';
import { buildProgram, type CliDeps } from './program.js';

const SEASON = '2026/27';

/** Collects everything a command writes so assertions can read it back. */
function collector(): { stream: Writable; text: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback): void {
      chunks.push(String(chunk));
      callback();
    },
  });
  return { stream, text: (): string => chunks.join('') };
}

const team = (id: number, name: string, shortName: string): Team =>
  teamSchema.parse({
    id,
    code: id,
    name,
    shortName,
    strength: 3,
    strengthOverallHome: 1200,
    strengthOverallAway: 1200,
    strengthAttackHome: 1200,
    strengthAttackAway: 1200,
    strengthDefenceHome: 1200,
    strengthDefenceAway: 1200,
  });

const player = (
  id: number,
  webName: string,
  teamId: number,
  position: string,
  price: number,
  totalPoints: number,
  minutes: number,
): Player =>
  playerSchema.parse({
    id,
    code: 1000 + id,
    firstName: 'Test',
    secondName: webName,
    webName,
    teamId,
    position,
    price,
    startPrice: price,
    totalPoints,
    minutes,
    goals: 0,
    assists: 0,
    cleanSheets: 0,
    goalsConceded: 0,
    yellowCards: 0,
    redCards: 0,
    saves: 0,
    bonus: 0,
    bps: 0,
    form: 5,
    pointsPerGame: 4,
    selectedByPercent: 10,
    expectedGoals: 0,
    expectedAssists: 0,
    expectedGoalInvolvements: 0,
    expectedGoalsConceded: 0,
    availability: 'available',
    chanceOfPlayingNextRound: null,
    news: '',
  });

/** Never reached by the commands under test; present only to satisfy the deps. */
const offlineHttp = (): HttpClient =>
  new HttpClient({
    baseUrl: 'https://example.test/api',
    timeoutMs: 1000,
    retries: 0,
    minRequestIntervalMs: 0,
    userAgent: 'test',
    sleep: (): Promise<void> => Promise.resolve(),
    fetchImpl: (): Promise<Response> => {
      throw new Error('the network must not be touched in these tests');
    },
  });

describe('cli program', () => {
  let root: string;
  let store: FileStore;

  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'fpl-cli-'));
    store = new FileStore({ root });
    const season = loadConfig({ FPL_DATA_DIR: root, FPL_SEASON: SEASON }).season;

    await store.write({ season, dataset: 'teams' }, [
      team(1, 'Arsenal', 'ARS'),
      team(2, 'Chelsea', 'CHE'),
    ]);
    await store.write({ season, dataset: 'players' }, [
      player(1, 'Saka', 1, 'MID', 101, 180, 2400),
      player(2, 'Palmer', 2, 'MID', 105, 210, 2600),
      player(3, 'Saliba', 1, 'DEF', 62, 140, 3000),
    ]);
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function run(): { program: ReturnType<typeof buildProgram>; out: () => string } {
    const out = collector();
    const err = collector();
    const deps: CliDeps = {
      config: loadConfig({ FPL_DATA_DIR: root, FPL_SEASON: SEASON }),
      store,
      logger: silentLogger,
      http: offlineHttp(),
      now: (): Date => new Date('2026-08-16T00:00:00Z'),
      stdout: out.stream,
      stderr: err.stream,
    };
    return { program: buildProgram(deps), out: out.text };
  }

  it('lists players sorted by points, best first', async () => {
    const { program, out } = run();
    await program.parseAsync(['players'], { from: 'user' });

    const text = out();
    assert.ok(text.includes('Palmer'));
    assert.ok(text.includes('Saka'));
    // Palmer has more points, so must appear before Saka.
    assert.ok(text.indexOf('Palmer') < text.indexOf('Saka'));
  });

  it('resolves the team short name rather than printing the raw id', async () => {
    const { program, out } = run();
    await program.parseAsync(['players', '--limit', '1'], { from: 'user' });
    assert.ok(out().includes('CHE'));
  });

  it('formats the price in millions', async () => {
    const { program, out } = run();
    await program.parseAsync(['players', '--position', 'DEF'], { from: 'user' });
    assert.ok(out().includes('6.2m'));
  });

  it('filters by position', async () => {
    const { program, out } = run();
    await program.parseAsync(['players', '--position', 'DEF', '--json'], { from: 'user' });

    const rows = JSON.parse(out()) as Player[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.webName, 'Saliba');
  });

  it('filters by team and by maximum price', async () => {
    const { program, out } = run();
    await program.parseAsync(['players', '--team', '1', '--max-price', '80', '--json'], {
      from: 'user',
    });

    const rows = JSON.parse(out()) as Player[];
    assert.deepEqual(
      rows.map((row) => row.webName),
      ['Saliba'],
    );
  });

  it('sorts by name alphabetically rather than best first', async () => {
    const { program, out } = run();
    await program.parseAsync(['players', '--sort', 'webName', '--json'], { from: 'user' });

    const rows = JSON.parse(out()) as Player[];
    assert.deepEqual(
      rows.map((row) => row.webName),
      ['Palmer', 'Saka', 'Saliba'],
    );
  });

  it('rejects a position outside the allowed set', async () => {
    const { program } = run();
    await assert.rejects(() =>
      program.parseAsync(['players', '--position', 'STRIKER'], { from: 'user' }),
    );
  });

  it('rejects a non integer numeric flag', async () => {
    const { program } = run();
    await assert.rejects(() =>
      program.parseAsync(['players', '--limit', 'many'], { from: 'user' }),
    );
  });

  it('lists the datasets written for the season', async () => {
    const { program, out } = run();
    await program.parseAsync(['datasets', '--json'], { from: 'user' });

    const rows = JSON.parse(out()) as { dataset: string; rows: number | null }[];
    assert.deepEqual(rows.map((row) => row.dataset).sort(), ['players', 'teams']);
    assert.equal(rows.find((row) => row.dataset === 'players')?.rows, 3);
  });

  it('shows one player with their stored detail', async () => {
    const { program, out } = run();
    await program.parseAsync(['show', 'player', '2', '--json'], { from: 'user' });
    assert.ok(out().includes('Palmer'));
  });

  it('reports an unknown sync source instead of running anything', async () => {
    const { program } = run();
    await assert.rejects(
      () => program.parseAsync(['sync', '--sources', 'not-a-source'], { from: 'user' }),
      /unknown source/,
    );
  });

  it('fails clearly when the rules were never scraped', async () => {
    const { program } = run();
    await assert.rejects(
      () => program.parseAsync(['rules', 'deadlines'], { from: 'user' }),
      /rules document/,
    );
  });
});
