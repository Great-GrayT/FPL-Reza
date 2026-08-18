import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const config: NextConfig = {
  reactStrictMode: true,

  // Player photos are hotlinked rather than committed: the full set is 119MB,
  // which does not belong in git, and this is the same CDN the official site
  // serves them from. Vercel optimises and caches them at the edge.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'resources.premierleague.com', pathname: '/premierleague/**' },
      { protocol: 'https', hostname: 'fantasy.premierleague.com', pathname: '/dist/img/**' },
      // Stadium photographs are Creative Commons files on Wikimedia Commons.
      // Every use renders its credit and licence, which the licences require.
      { protocol: 'https', hostname: 'upload.wikimedia.org', pathname: '/wikipedia/**' },
    ],
  },

  // The lake is read at build time by server components, so its files must
  // travel with the deployment rather than being tree shaken out.
  // Parquet is listed as well as JSONL: the official match record and the
  // archived gameweek history are both stored as Parquet, and tracing only
  // .jsonl shipped a build that could read neither.
  outputFileTracingIncludes: {
    '/**': ['../../data/**/*.jsonl', '../../data/**/*.parquet', '../../data/**/_manifest.json'],
  },
  outputFileTracingRoot: repoRoot,
};

export default config;
