import { Command, InvalidArgumentError, Option } from 'commander';
import { seasonForDate, type Config } from '@fpl/config';
import {
  NotFoundError,
  POSITIONS,
  asPlayerId,
  asSeason,
  asTeamId,
  formatPrice,
  playerGameweekSchema,
  playerSchema,
  teamSchema,
  type Logger,
  type Player,
  type PlayerGameweek,
  type Position,
  type Season,
  type Team,
} from '@fpl/core';
import {
  DATASETS,
  FplClient,
  bootstrapSource,
  fixturesSource,
  footballDataOddsSource,
  playerHistorySource,
  readLatestRules,
  refreshFixtures,
  refreshRules,
  summariseFixtureChange,
  rulesSource,
  runSync,
  archiveHistorySource,
  ARCHIVE_FIRST_SEASON,
  playerSeasonsSource,
  providerIdsSource,
  internationalsSource,
  SofascoreClient,
  sofascoreHttp,
  sofascoreSpatialSource,
  plHttp,
  plMatchesSource,
  openMeteoHttp,
  weatherSource,
  wikimediaHttp,
  groundImagesSource,
  type HttpClient,
  type RulesDocument,
  type SyncReport,
  type Source,
} from '@fpl/ingest';
import type { Format, Store } from '@fpl/store';
import {
  ASSET_KINDS,
  FileAssetStore,
  syncAssets,
  type AssetKind,
  type AssetStore,
} from '@fpl/assets';
import { writeJson, writeLine, writeProgress, writeTable, type Streams } from './output.js';

/**
 * Dependencies are injected rather than constructed in bin.ts, so tests can
 * drive the whole command tree against a seeded FileStore and a fake
 * HttpClient without ever touching the network or the real data directory.
 */
export interface CliDeps {
  config: Config;
  store: Store;
  logger: Logger;
  http: HttpClient;
  /** Blob side of the lake. Defaults to an `assets` directory under dataDir. */
  assets?: AssetStore;
  now?: () => Date;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

export function buildProgram(deps: CliDeps): Command {
  const streams: Streams = {
    stdout: deps.stdout ?? process.stdout,
    stderr: deps.stderr ?? process.stderr,
  };
  const now = deps.now ?? ((): Date => new Date());

  const program = new Command();
  program
    .name('fpl')
    .description('Command line access to the FPL data platform')
    // Throw instead of calling process.exit, so a test driving the program
    // in process never takes the whole test runner down with it.
    .exitOverride();

  registerSync(program, deps, streams, now);
  registerAssets(program, deps, streams);
  registerFixtures(program, deps, streams, now);
  registerHistory(program, deps, streams, now);
  registerOfficial(program, deps, streams, now);
  registerRules(program, deps, streams, now);
  registerPlayers(program, deps, streams);
  registerDatasets(program, deps, streams);
  registerShow(program, deps, streams);

  return program;
}

function parseIntOption(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new InvalidArgumentError(`expected an integer, got "${value}"`);
  }
  return parsed;
}

/** One row per source: what it wrote, how much, how long, and why not. */
function writeSyncTable(streams: Streams, report: SyncReport): void {
  writeTable(streams, {
    columns: ['source', 'datasets', 'rows', 'duration (ms)', 'error'],
    rows: report.runs.map((run) => [
      run.source,
      [...new Set(run.written.map((written) => written.dataset))].join(', ') || '-',
      String(run.rows),
      String(run.durationMs),
      run.error ?? '-',
    ]),
  });
}

function resolveSeason(raw: string | undefined, config: Config): Season {
  return raw === undefined ? config.season : asSeason(raw);
}

interface SyncOptionsRaw {
  season?: string;
  sources?: string;
  format?: string;
  limit?: number;
  skipUnplayed?: boolean;
  continueOnError?: boolean;
  json?: boolean;
  spatialMaxEvents?: number;
  spatialSinceGameweek?: number;
  spatialUntilGameweek?: number;
  spatialBackfillSeason?: string;
}

function registerSync(program: Command, deps: CliDeps, streams: Streams, now: () => Date): void {
  program
    .command('sync')
    .description('Fetch data from the FPL API and write snapshots to the store')
    .option('--season <season>', 'season to sync, e.g. 2025/26')
    .option(
      '--sources <names>',
      'comma separated source names to run (default: all but spatial-sofascore)',
    )
    .addOption(
      new Option('--format <format>', 'snapshot storage format').choices(['jsonl', 'parquet']),
    )
    .option('--limit <n>', 'cap the number of players fetched for history', parseIntOption)
    .option('--skip-unplayed', 'skip players with no minutes played')
    .option('--continue-on-error', 'keep going after a source fails')
    .option(
      '--spatial-max-events <n>',
      'cap the matches the spatial source pulls (opt in via --sources)',
      parseIntOption,
    )
    .option(
      '--spatial-since-gameweek <n>',
      'skip matches before this gameweek in the spatial source',
      parseIntOption,
    )
    .option(
      '--spatial-until-gameweek <n>',
      'skip matches after this gameweek in the spatial source',
      parseIntOption,
    )
    .option(
      '--spatial-backfill-season <season>',
      'backfill a completed season, resolving fixtures from the official record, e.g. 2025/26',
    )
    .option('--json', 'print machine readable JSON instead of a table')
    .action(async (options: SyncOptionsRaw) => {
      const season = resolveSeason(options.season, deps.config);
      const client = new FplClient(deps.http);

      const available: Source[] = [
        bootstrapSource(client),
        fixturesSource(client),
        playerHistorySource(client, {
          ...(options.skipUnplayed === true ? { skipUnplayed: true } : {}),
          ...(options.limit === undefined ? {} : { limit: options.limit }),
        }),
        // Unconditional write, unlike `rules refresh` which diffs first; fine
        // for a batch sync where every dataset gets a fresh snapshot anyway.
        rulesSource(deps.http),
        // Requires the teams dataset, so runSync orders it after bootstrap.
        footballDataOddsSource(deps.http),
        // Its own HttpClient: the provider needs browser headers and a browser
        // TLS cipher order, and a slower request interval than the FPL API.
        sofascoreSpatialSource(new SofascoreClient(sofascoreHttp()), {
          ...(options.spatialMaxEvents === undefined
            ? {}
            : { maxEvents: options.spatialMaxEvents }),
          ...(options.spatialSinceGameweek === undefined
            ? {}
            : { sinceGameweek: options.spatialSinceGameweek }),
          ...(options.spatialUntilGameweek === undefined
            ? {}
            : { untilGameweek: options.spatialUntilGameweek }),
          ...(options.spatialBackfillSeason === undefined
            ? {}
            : { backfillSeason: asSeason(options.spatialBackfillSeason) }),
        }),
      ];

      const sources = selectSources(available, options.sources);

      const report = await runSync(
        sources,
        { season, store: deps.store, logger: deps.logger, capturedAt: now() },
        {
          ...(options.format === undefined ? {} : { format: options.format as Format }),
          continueOnError: options.continueOnError === true,
        },
      );

      if (options.json === true) {
        writeJson(streams, report);
      } else {
        writeSyncTable(streams, report);
      }

      if (report.failed > 0) process.exitCode = 1;
    });
}

interface AssetSyncOptionsRaw {
  season?: string;
  kinds?: string;
  force?: boolean;
  json?: boolean;
}

function assetStoreFor(deps: CliDeps): AssetStore {
  return deps.assets ?? new FileAssetStore({ root: `${deps.config.dataDir}/assets` });
}

function registerAssets(program: Command, deps: CliDeps, streams: Streams): void {
  const assets = program
    .command('assets')
    .description('Download and inspect club and player images');

  assets
    .command('sync')
    .description('Download badges, shirts, and player photos from the Premier League CDN')
    .option('--season <season>', 'season whose teams and players are used, e.g. 2026/27')
    .option('--kinds <names>', `comma separated kinds (default: all of ${ASSET_KINDS.join(', ')})`)
    .option('--force', 'refetch assets the manifest already holds')
    .option('--json', 'print machine readable JSON instead of a table')
    .action(async (options: AssetSyncOptionsRaw) => {
      const season = resolveSeason(options.season, deps.config);
      const teams = await deps.store.read<Team>({ season, dataset: DATASETS.teams }, teamSchema);
      const players = await deps.store.read<Player>(
        { season, dataset: DATASETS.players },
        playerSchema,
      );

      const report = await syncAssets({
        fetcher: deps.http,
        store: assetStoreFor(deps),
        teams,
        players,
        logger: deps.logger,
        force: options.force === true,
        ...(options.kinds === undefined ? {} : { kinds: parseKinds(options.kinds) }),
      });

      if (options.json === true) {
        writeJson(streams, report);
        return;
      }

      writeTable(streams, {
        columns: ['attempted', 'downloaded', 'skipped', 'missing', 'MB', 'duration (ms)'],
        rows: [
          [
            String(report.attempted),
            String(report.downloaded),
            String(report.skipped),
            String(report.missing),
            (report.bytes / 1_000_000).toFixed(1),
            String(report.durationMs),
          ],
        ],
      });
      // Missing is expected for a newly promoted club or an unphotographed
      // player, so it is reported rather than treated as a failure.
      if (report.missingKeys.length > 0) {
        writeProgress(streams, `missing: ${report.missingKeys.join(', ')}`);
      }
    });

  assets
    .command('list')
    .description('List downloaded assets recorded in the asset manifest')
    .option('--kind <kind>', `one of ${ASSET_KINDS.join(', ')}`)
    .option('--json', 'print machine readable JSON instead of a table')
    .action(async (options: { kind?: string; json?: boolean }) => {
      const kind = options.kind === undefined ? undefined : parseKinds(options.kind)[0];
      const records = await assetStoreFor(deps).list(kind);

      if (options.json === true) {
        writeJson(streams, records);
        return;
      }

      writeTable(streams, {
        columns: ['kind', 'key', 'file', 'bytes', 'fetched'],
        rows: records.map((record) => [
          record.kind,
          record.key,
          record.file,
          String(record.bytes),
          record.fetchedAt.toISOString(),
        ]),
      });
    });
}

function parseKinds(raw: string): AssetKind[] {
  const wanted = raw
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');
  const unknown = wanted.filter((name) => !ASSET_KINDS.includes(name as AssetKind));
  if (unknown.length > 0) {
    throw new InvalidArgumentError(
      `unknown asset kind(s): ${unknown.join(', ')} (available: ${ASSET_KINDS.join(', ')})`,
    );
  }
  return wanted as AssetKind[];
}

/**
 * Sources a bare `sync` must not run. The spatial source costs one request per
 * player per match against a provider throttled to 500 ms, so a whole season of
 * it is hours of traffic: it is asked for by name or not at all.
 */
const OPT_IN_SOURCES = new Set(['spatial-sofascore']);

function selectSources(available: readonly Source[], raw: string | undefined): Source[] {
  if (raw === undefined) return available.filter((source) => !OPT_IN_SOURCES.has(source.name));
  const wanted = new Set(
    raw
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name !== ''),
  );
  const unknown = [...wanted].filter((name) => !available.some((source) => source.name === name));
  if (unknown.length > 0) {
    const names = available.map((source) => source.name).join(', ');
    throw new Error(`unknown source(s): ${unknown.join(', ')} (available: ${names})`);
  }
  return available.filter((source) => wanted.has(source.name));
}

function registerFixtures(
  program: Command,
  deps: CliDeps,
  streams: Streams,
  now: () => Date,
): void {
  const fixtures = program.command('fixtures').description('Inspect and refresh the fixture list');

  fixtures
    .command('refresh')
    .description('Refetch fixtures from the FPL API and report kickoff, gameweek, and score moves')
    .option('--season <season>', 'season to refresh, e.g. 2026/27')
    .option('--always', 'write a snapshot even when nothing moved')
    .option('--json', 'print machine readable JSON instead of a summary')
    .action(async (options: { season?: string; always?: boolean; json?: boolean }) => {
      const result = await refreshFixtures({
        http: deps.http,
        store: deps.store,
        season: resolveSeason(options.season, deps.config),
        logger: deps.logger,
        capturedAt: now(),
        always: options.always === true,
      });

      if (options.json === true) {
        writeJson(streams, result);
        return;
      }

      writeLine(
        streams,
        result.diff.changed
          ? `fixtures changed: ${String(result.diff.added)} added, ${String(result.diff.removed)} removed, ${String(result.diff.updated)} updated`
          : 'fixtures unchanged',
      );
      for (const change of result.diff.changes) {
        writeLine(streams, summariseFixtureChange(change));
      }
    });
}

interface HistorySeasonsOptionsRaw {
  season?: string;
  limit?: number;
  json?: boolean;
}

interface HistoryInternationalsOptionsRaw {
  season?: string;
  limit?: number;
  onlyMissing?: boolean;
  json?: boolean;
}

interface HistoryArchiveOptionsRaw {
  season?: string;
  seasons?: string;
  format?: string;
  json?: boolean;
}

/**
 * Completed seasons, which change once a year rather than nightly. Both
 * commands are backfills: run them after a season rollover, not on a schedule.
 */
function registerHistory(program: Command, deps: CliDeps, streams: Streams, now: () => Date): void {
  const history = program.command('history').description('Backfill completed season history');

  history
    .command('seasons')
    .description("Fetch every player's past season totals from the FPL API")
    .option('--season <season>', 'season whose player list to walk, e.g. 2026/27')
    .option('--limit <n>', 'cap the players fetched, for a smoke run', parseIntOption)
    .option('--json', 'print machine readable JSON instead of a summary')
    .action(async (options: HistorySeasonsOptionsRaw) => {
      const season = resolveSeason(options.season, deps.config);
      const client = new FplClient(deps.http);

      const report = await runSync(
        [
          playerSeasonsSource(client, {
            ...(options.limit === undefined ? {} : { limit: options.limit }),
          }),
        ],
        { season, store: deps.store, logger: deps.logger, capturedAt: now() },
      );

      if (options.json === true) {
        writeJson(streams, report);
        return;
      }
      writeSyncTable(streams, report);
    });

  history
    .command('internationals')
    .description('Map players to the provider and read their national team records')
    .option('--season <season>', 'season whose player list to walk, e.g. 2026/27')
    .option('--limit <n>', 'cap the players processed, for a bounded run', parseIntOption)
    .option('--only-missing', 'skip players who already have records')
    .option('--json', 'print machine readable JSON instead of a summary')
    .action(async (options: HistoryInternationalsOptionsRaw) => {
      const season = resolveSeason(options.season, deps.config);
      // The provider fingerprints TLS, so it needs its own client, not deps.http.
      const http = sofascoreHttp();

      const report = await runSync(
        [
          providerIdsSource(http, {
            ...(options.limit === undefined ? {} : { limit: options.limit }),
          }),
          internationalsSource(http, {
            ...(options.limit === undefined ? {} : { limit: options.limit }),
            ...(options.onlyMissing === true ? { onlyMissing: true } : {}),
          }),
        ],
        { season, store: deps.store, logger: deps.logger, capturedAt: now() },
      );

      if (options.json === true) {
        writeJson(streams, report);
        return;
      }
      writeSyncTable(streams, report);
      if (report.failed > 0) process.exitCode = 1;
    });

  history
    .command('archive')
    .description('Backfill per gameweek history for completed seasons from the community archive')
    .option('--season <season>', 'season the snapshots are filed under, e.g. 2026/27')
    .option(
      '--seasons <labels>',
      'comma separated seasons to pull, e.g. 2023/24,2024/25 (default: every season the archive publishes)',
    )
    .addOption(
      new Option('--format <format>', 'snapshot storage format').choices(['jsonl', 'parquet']),
    )
    .option('--json', 'print machine readable JSON instead of a summary')
    .action(async (options: HistoryArchiveOptionsRaw) => {
      const season = resolveSeason(options.season, deps.config);
      const seasons = resolveArchiveSeasons(options.seasons, now());

      const report = await runSync(
        [archiveHistorySource(deps.http, { seasons })],
        { season, store: deps.store, logger: deps.logger, capturedAt: now() },
        // Parquet by default: a season is about 27,000 rows, and it stores in
        // roughly a twentieth of the JSONL bytes, which matters for a lake
        // that lives in git.
        { format: (options.format as Format | undefined) ?? 'parquet' },
      );

      if (options.json === true) {
        writeJson(streams, report);
        return;
      }
      writeSyncTable(streams, report);
    });
}

interface OfficialOptionsRaw {
  season?: string;
  seasons?: number;
  detailSeasons?: number;
  maxDetail?: number;
  json?: boolean;
}

interface WeatherOptionsRaw {
  season?: string;
  windowDays?: number;
  maxRequests?: number;
  json?: boolean;
}

/**
 * The Premier League's own record, which FPL does not carry: referees,
 * managers, teamsheets, formations, grounds, and 35 seasons of results. Its
 * cost is entirely in the detail pass, one request per played match, so the
 * season counts are separate options rather than one.
 */
function registerOfficial(
  program: Command,
  deps: CliDeps,
  streams: Streams,
  now: () => Date,
): void {
  const official = program
    .command('official')
    .description('Ingest the Premier League official record and match conditions');

  official
    .command('matches')
    .description(
      'Results, teamsheets, officials, managers, and grounds from the Premier League API',
    )
    .option('--season <season>', 'season the snapshots are filed under, e.g. 2026/27')
    .option('--seasons <n>', 'how many seasons of results to pull, newest first', parseIntOption)
    .option(
      '--detail-seasons <n>',
      'how many seasons to pull teamsheets and timelines for, newest first',
      parseIntOption,
    )
    .option(
      '--max-detail <n>',
      'cap the per match detail requests, for a bounded run',
      parseIntOption,
    )
    .option('--json', 'print machine readable JSON instead of a summary')
    .action(async (options: OfficialOptionsRaw) => {
      const season = resolveSeason(options.season, deps.config);
      // The provider checks the calling origin and nothing else, so it needs
      // its own client rather than the FPL one.
      const http = plHttp({ logger: deps.logger });

      const report = await runSync(
        [
          plMatchesSource(http, {
            ...(options.seasons === undefined ? {} : { seasons: options.seasons }),
            ...(options.detailSeasons === undefined
              ? {}
              : { detailSeasons: options.detailSeasons }),
            ...(options.maxDetail === undefined ? {} : { maxDetail: options.maxDetail }),
          }),
        ],
        { season, store: deps.store, logger: deps.logger, capturedAt: now() },
      );

      if (options.json === true) {
        writeJson(streams, report);
        return;
      }
      writeSyncTable(streams, report);
      if (report.failed > 0) process.exitCode = 1;
    });

  official
    .command('grounds')
    .description('Find a licensed photograph of every ground on Wikimedia Commons')
    .option('--season <season>', 'season the snapshots are filed under, e.g. 2026/27')
    .option('--json', 'print machine readable JSON instead of a summary')
    .action(async (options: { season?: string; json?: boolean }) => {
      const season = resolveSeason(options.season, deps.config);
      const http = wikimediaHttp({ logger: deps.logger });

      const report = await runSync([groundImagesSource(http)], {
        season,
        store: deps.store,
        logger: deps.logger,
        capturedAt: now(),
      });

      if (options.json === true) {
        writeJson(streams, report);
        return;
      }
      writeSyncTable(streams, report);
      if (report.failed > 0) process.exitCode = 1;
    });

  official
    .command('weather')
    .description('Read conditions at kickoff for matches near today, from Open-Meteo')
    .option('--season <season>', 'season the snapshots are filed under, e.g. 2026/27')
    .option('--window-days <n>', 'how far either side of today to cover', parseIntOption)
    .option('--max-requests <n>', 'cap the requests, for a bounded run', parseIntOption)
    .option('--json', 'print machine readable JSON instead of a summary')
    .action(async (options: WeatherOptionsRaw) => {
      const season = resolveSeason(options.season, deps.config);
      const http = openMeteoHttp({ logger: deps.logger });

      const report = await runSync(
        [
          weatherSource(http, {
            ...(options.windowDays === undefined ? {} : { windowDays: options.windowDays }),
            ...(options.maxRequests === undefined ? {} : { maxRequests: options.maxRequests }),
          }),
        ],
        { season, store: deps.store, logger: deps.logger, capturedAt: now() },
      );

      if (options.json === true) {
        writeJson(streams, report);
        return;
      }
      writeSyncTable(streams, report);
      if (report.failed > 0) process.exitCode = 1;
    });
}

/**
 * Every season the archive publishes, oldest first, ending with the one before
 * the current season: the live season is not in the archive, it is in the lake.
 */
export function resolveArchiveSeasons(raw: string | undefined, now: Date): string[] {
  if (raw !== undefined) {
    return raw
      .split(',')
      .map((label) => label.trim())
      .filter((label) => label !== '')
      .map((label) => asSeason(label));
  }

  const first = Number(ARCHIVE_FIRST_SEASON.slice(0, 4));
  // A season that starts in July belongs to the new campaign, so the last
  // completed one is the year before whichever season today falls in.
  const currentStart = Number(seasonForDate(now).slice(0, 4));
  const seasons: string[] = [];
  for (let year = first; year < currentStart; year += 1) {
    seasons.push(asSeason(`${String(year)}/${String((year + 1) % 100).padStart(2, '0')}`));
  }
  return seasons;
}

function registerRules(program: Command, deps: CliDeps, streams: Streams, now: () => Date): void {
  const rules = program.command('rules').description('Manage the scraped FPL rules snapshot');

  rules
    .command('refresh')
    .description('Refresh the rules snapshot from the FPL rules page and report what changed')
    .option('--season <season>', 'season to refresh, e.g. 2025/26')
    .option('--json', 'print machine readable JSON instead of a summary')
    .action(async (options: { season?: string; json?: boolean }) => {
      const season = resolveSeason(options.season, deps.config);

      // Same operation a future frontend update button will call, so the
      // human summary here doubles as the contract for what that button shows.
      const result = await refreshRules({
        http: deps.http,
        store: deps.store,
        season,
        logger: deps.logger,
        capturedAt: now(),
      });

      if (options.json === true) {
        writeJson(streams, result);
        return;
      }

      if (!result.usable) {
        // Reporting "changed" here would be a lie: nothing was stored, because
        // the page served no rules to parse.
        writeLine(
          streams,
          'rules page served nothing parsable, no snapshot written (the published page is rendered client side)',
        );
        return;
      }

      writeLine(streams, result.diff.changed ? 'rules changed' : 'rules unchanged');
      for (const change of result.diff.changes) {
        writeLine(
          streams,
          `${change.kind} ${change.path}: ${change.before ?? '(none)'} -> ${change.after ?? '(none)'}`,
        );
      }
    });

  rules
    .command('deadlines')
    .description('Show upcoming gameweek deadlines from the stored rules document')
    .option('--next <n>', 'number of upcoming deadlines to show', parseIntOption, 5)
    .option('--json', 'print machine readable JSON instead of a table')
    .action(async (options: { next: number; json?: boolean }) => {
      const season = deps.config.season;
      const document = await readRulesDocument(deps.store, season);
      const nowAt = now().getTime();

      // flatMap narrows the nullable deadline once, so the sort and the
      // render below both see a plain Date.
      const upcoming = document.deadlines
        .flatMap((entry) =>
          entry.deadline === null ? [] : [{ ...entry, deadline: entry.deadline }],
        )
        .filter((entry) => entry.deadline.getTime() >= nowAt)
        .sort((a, b) => a.deadline.getTime() - b.deadline.getTime())
        .slice(0, options.next);

      if (options.json === true) {
        writeJson(streams, upcoming);
        return;
      }

      writeTable(streams, {
        columns: ['gameweek', 'deadline', 'label'],
        rows: upcoming.map((entry) => [
          String(entry.gameweek),
          entry.deadline.toISOString(),
          entry.label,
        ]),
      });
    });
}

async function readRulesDocument(store: Store, season: Season): Promise<RulesDocument> {
  const document = await readLatestRules(store, season);
  if (document === undefined) {
    throw new NotFoundError(`rules document for season ${season}`);
  }
  return document;
}

const SORTABLE_FIELDS = [
  'totalPoints',
  'form',
  'price',
  'minutes',
  'pointsPerGame',
  'webName',
] as const;
type SortableField = (typeof SORTABLE_FIELDS)[number];

interface PlayersOptionsRaw {
  position?: Position;
  team?: number;
  maxPrice?: number;
  minMinutes?: number;
  sort: SortableField;
  limit?: number;
  json?: boolean;
}

function registerPlayers(program: Command, deps: CliDeps, streams: Streams): void {
  program
    .command('players')
    .description('List players from the stored dataset with filters and sorting')
    .addOption(new Option('--position <position>', 'filter by position').choices(POSITIONS))
    .option('--team <id>', 'filter by team id', parseIntOption)
    .option('--max-price <tenths>', 'maximum price in tenths of a million', parseIntOption)
    .option('--min-minutes <n>', 'minimum minutes played', parseIntOption)
    .addOption(
      new Option('--sort <field>', 'field to sort by')
        .choices(SORTABLE_FIELDS)
        .default('totalPoints'),
    )
    .option('--limit <n>', 'limit the number of rows returned', parseIntOption)
    .option('--json', 'print machine readable JSON instead of a table')
    .action(async (options: PlayersOptionsRaw) => {
      const season = deps.config.season;
      const players = await deps.store.read<Player>(
        { season, dataset: DATASETS.players },
        playerSchema,
      );
      const teams = await readTeams(deps.store, season);

      let filtered = players;
      if (options.position !== undefined) {
        filtered = filtered.filter((player) => player.position === options.position);
      }
      if (options.team !== undefined) {
        const teamId = asTeamId(options.team);
        filtered = filtered.filter((player) => player.teamId === teamId);
      }
      if (options.maxPrice !== undefined) {
        const maxPrice = options.maxPrice;
        filtered = filtered.filter((player) => player.price <= maxPrice);
      }
      if (options.minMinutes !== undefined) {
        const minMinutes = options.minMinutes;
        filtered = filtered.filter((player) => player.minutes >= minMinutes);
      }

      const sorted = sortPlayers(filtered, options.sort);
      const limited = options.limit === undefined ? sorted : sorted.slice(0, options.limit);

      if (options.json === true) {
        writeJson(streams, limited);
        return;
      }

      writeTable(streams, {
        columns: ['name', 'team', 'position', 'price', 'points', 'form'],
        rows: limited.map((player) => [
          player.webName,
          teams.get(player.teamId)?.shortName ?? String(player.teamId),
          player.position,
          formatPrice(player.price),
          String(player.totalPoints),
          player.form.toFixed(1),
        ]),
      });
    });
}

function sortPlayers(players: readonly Player[], field: SortableField): Player[] {
  // Rank fields (points, form, price, minutes) read best first; the name
  // field reads alphabetically, since best name has no meaning.
  const direction = field === 'webName' ? 1 : -1;
  return [...players].sort((a, b) => {
    const left = a[field];
    const right = b[field];
    if (typeof left === 'string' && typeof right === 'string') {
      return direction * left.localeCompare(right);
    }
    return direction * ((left as number) - (right as number));
  });
}

async function readTeams(store: Store, season: Season): Promise<Map<Team['id'], Team>> {
  try {
    const teams = await store.read<Team>({ season, dataset: DATASETS.teams }, teamSchema);
    return new Map(teams.map((team) => [team.id, team]));
  } catch (error) {
    if (error instanceof NotFoundError) return new Map();
    throw error;
  }
}

interface DatasetSummary {
  dataset: string;
  capturedAt: Date | null;
  rows: number | null;
  format: Format | null;
}

function registerDatasets(program: Command, deps: CliDeps, streams: Streams): void {
  program
    .command('datasets')
    .description('List datasets stored for the season with their latest snapshot')
    .option('--json', 'print machine readable JSON instead of a table')
    .action(async (options: { json?: boolean }) => {
      const season = deps.config.season;
      const names = await deps.store.datasets(season);
      const summaries = await Promise.all(
        names.map((dataset) => summariseDataset(deps.store, season, dataset)),
      );

      if (options.json === true) {
        writeJson(streams, summaries);
        return;
      }

      writeTable(streams, {
        columns: ['dataset', 'latest snapshot', 'rows', 'format'],
        rows: summaries.map((summary) => [
          summary.dataset,
          summary.capturedAt?.toISOString() ?? '-',
          summary.rows === null ? '-' : String(summary.rows),
          summary.format ?? '-',
        ]),
      });
    });
}

/**
 * A dataset fetched piecemeal (one snapshot per gameweek) has no unpartitioned
 * snapshot to find directly, so its totals are summed across the partitions the
 * manifest actually records. That covers partition names outside the gw<n>
 * convention, which a fixed scan would miss.
 */
async function summariseDataset(
  store: Store,
  season: Season,
  dataset: string,
): Promise<DatasetSummary> {
  const direct = await store.latest({ season, dataset });
  if (direct !== undefined) {
    return { dataset, capturedAt: direct.capturedAt, rows: direct.rows, format: direct.format };
  }

  let rows = 0;
  let capturedAt: Date | null = null;
  let format: Format | null = null;
  let found = false;

  for (const partition of await store.partitions({ season, dataset })) {
    const meta = await store.latest({ season, dataset, partition });
    if (meta === undefined) continue;
    found = true;
    rows += meta.rows;
    format = meta.format;
    if (capturedAt === null || meta.capturedAt.getTime() > capturedAt.getTime()) {
      capturedAt = meta.capturedAt;
    }
  }

  return found
    ? { dataset, capturedAt, rows, format }
    : { dataset, capturedAt: null, rows: null, format: null };
}

function registerShow(program: Command, deps: CliDeps, streams: Streams): void {
  const show = program.command('show').description('Show detail for a single stored entity');

  show
    .command('player <id>')
    .description('Show one player and their gameweek history if present')
    .option('--json', 'print machine readable JSON instead of a summary')
    .action(async (id: string, options: { json?: boolean }) => {
      const season = deps.config.season;
      const playerId = asPlayerId(parseIntOption(id));

      const players = await deps.store.read<Player>(
        { season, dataset: DATASETS.players },
        playerSchema,
      );
      const player = players.find((candidate) => candidate.id === playerId);
      if (player === undefined) {
        throw new NotFoundError(`player ${id}`);
      }

      const teams = await readTeams(deps.store, season);
      const team = teams.get(player.teamId);
      const history = await readPlayerHistory(deps.store, season, playerId);

      if (options.json === true) {
        writeJson(streams, { player, team: team ?? null, history });
        return;
      }

      writeLine(
        streams,
        `${player.webName} (${team?.shortName ?? String(player.teamId)}) ${player.position} ${formatPrice(player.price)}`,
      );
      writeLine(
        streams,
        `points: ${player.totalPoints}  form: ${player.form}  minutes: ${player.minutes}`,
      );

      writeTable(streams, {
        columns: ['gw', 'opponent', 'venue', 'minutes', 'points', 'bonus'],
        rows: history.map((entry) => [
          String(entry.gameweek),
          String(entry.opponentTeam),
          entry.wasHome ? 'home' : 'away',
          String(entry.minutes),
          String(entry.totalPoints),
          String(entry.bonus),
        ]),
      });
    });
}

/**
 * player-gameweeks is written one partition per gameweek (see sources.ts), so a
 * player's full history spans every partition the manifest records. A read that
 * misses means the player did not feature that gameweek, not an error.
 */
async function readPlayerHistory(
  store: Store,
  season: Season,
  playerId: Player['id'],
): Promise<PlayerGameweek[]> {
  const history: PlayerGameweek[] = [];

  const partitions = await store.partitions({ season, dataset: DATASETS.playerGameweeks });

  for (const partition of partitions) {
    let rows: PlayerGameweek[];
    try {
      rows = await store.read<PlayerGameweek>(
        { season, dataset: DATASETS.playerGameweeks, partition },
        playerGameweekSchema,
      );
    } catch (error) {
      if (error instanceof NotFoundError) continue;
      throw error;
    }
    for (const row of rows) {
      if (row.playerId === playerId) history.push(row);
    }
  }

  return history.sort((a, b) => a.gameweek - b.gameweek);
}
