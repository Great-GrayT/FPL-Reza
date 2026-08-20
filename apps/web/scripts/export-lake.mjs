/**
 * Copies the parts of the lake the Lab reads into `public/lake/`, so the
 * browser can fetch them directly.
 *
 * Nothing is transcoded that is already Parquet: the store writes it, hyparquet
 * reads it in the browser, and a season of gameweek history is 260 KB in that
 * format against roughly 2.5 MB as JSON. The current season's small datasets
 * (teams, players, fixtures, gameweeks) travel as one JSON file, because they
 * are a few hundred rows and a second request would cost more than they weigh.
 *
 * Run by `prebuild`, so a build always ships a lake matching the committed one.
 */
import { createRequire } from 'node:module';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';

const require = createRequire(import.meta.url);

const HISTORY = 'player-gameweeks-history';
const CONTEXT_DATASETS = ['teams', 'players', 'fixtures', 'gameweeks'];

function findRepoRoot() {
  let directory = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(path.join(directory, 'data'))) return directory;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error('no data directory found above the working directory');
}

function seasonFromEnv(root) {
  const configured = process.env.FPL_SEASON;
  if (configured !== undefined && configured !== '') return configured.replace('/', '-');
  const seasons = require('node:fs')
    .readdirSync(path.join(root, 'data'))
    .filter((name) => /^\d{4}-\d{2}$/.test(name))
    .sort();
  const latest = seasons[seasons.length - 1];
  if (latest === undefined) throw new Error('no season directory in data/');
  return latest;
}

/** The newest snapshot file in a partition directory, by its capture stamp. */
async function newestFile(directory) {
  const entries = await readdir(directory).catch(() => []);
  const files = entries
    .filter((name) => name.endsWith('.parquet') || name.endsWith('.jsonl'))
    .sort();
  const newest = files[files.length - 1];
  return newest === undefined ? null : path.join(directory, newest);
}

async function readJsonl(file) {
  const text = await readFile(file, 'utf8');
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}

async function main() {
  const root = findRepoRoot();
  const season = seasonFromEnv(root);
  const lake = path.join(root, 'data', season);
  const out = path.join(process.cwd(), 'public', 'lake');

  await rm(out, { recursive: true, force: true });
  await mkdir(path.join(out, 'history'), { recursive: true });

  const manifest = {
    season: season.replace('-', '/'),
    generatedAt: new Date().toISOString(),
    history: [],
    matches: [],
    context: 'context.json',
    playerSeasons: null,
    bytes: 0,
  };

  // Per season gameweek history: copied verbatim, one file per season.
  const historyRoot = path.join(lake, HISTORY);
  for (const partition of (await readdir(historyRoot).catch(() => [])).sort()) {
    if (partition.startsWith('_')) continue;
    const source = await newestFile(path.join(historyRoot, partition));
    if (source === null) continue;
    const target = path.join(out, 'history', `${partition}.parquet`);
    await cp(source, target);
    const size = (await stat(target)).size;
    manifest.history.push({ season: partition, file: `history/${partition}.parquet`, bytes: size });
    manifest.bytes += size;
  }

  // The official record, one file per season for the same reason: a reader
  // looking at one season should not pay for thirty five.
  const matchRoot = path.join(lake, 'matches');
  await mkdir(path.join(out, 'matches'), { recursive: true });
  for (const partition of (await readdir(matchRoot).catch(() => [])).sort()) {
    if (partition.startsWith('_')) continue;
    const source = await newestFile(path.join(matchRoot, partition));
    if (source === null) continue;
    const target = path.join(out, 'matches', `${partition}.parquet`);
    await cp(source, target);
    const size = (await stat(target)).size;
    manifest.matches.push({ season: partition, file: `matches/${partition}.parquet`, bytes: size });
    manifest.bytes += size;
  }

  const seasonsSource = await newestFile(path.join(lake, 'player-seasons', '_all'));
  if (seasonsSource !== null) {
    const extension = path.extname(seasonsSource);
    const target = path.join(out, `player-seasons${extension}`);
    await cp(seasonsSource, target);
    const size = (await stat(target)).size;
    manifest.playerSeasons = { file: `player-seasons${extension}`, bytes: size };
    manifest.bytes += size;
  }

  const context = {};
  for (const dataset of CONTEXT_DATASETS) {
    const source = await newestFile(path.join(lake, dataset, '_all'));
    if (source === null) {
      context[dataset] = [];
      continue;
    }
    context[dataset] = source.endsWith('.jsonl') ? await readJsonl(source) : [];
  }
  const contextPath = path.join(out, 'context.json');
  await writeFile(contextPath, JSON.stringify(context));
  const contextSize = (await stat(contextPath)).size;
  manifest.bytes += contextSize;

  await writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const megabytes = (manifest.bytes / (1024 * 1024)).toFixed(2);
  console.info(
    `[lake] exported ${manifest.history.length} history seasons, ${manifest.matches.length} match seasons, ${megabytes} MB to public/lake`,
  );
}

await main();
