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
    ],
  },

  // The lake is read at build time by server components, so its files must
  // travel with the deployment rather than being tree shaken out.
  outputFileTracingIncludes: {
    '/**': ['../../data/**/*.jsonl', '../../data/**/_manifest.json'],
  },
  outputFileTracingRoot: repoRoot,
};

export default config;
