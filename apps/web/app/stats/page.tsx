import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Lab } from '@/components/lab/lab';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'The Lab | FPL Lake',
  description:
    'A quantitative workspace over ten seasons of Fantasy Premier League gameweeks and thirty five seasons of results: screen, fit, simulate, and backtest in the browser',
};

interface Manifest {
  season: string;
  generatedAt: string;
  history: { season: string; bytes: number }[];
  matches: { season: string; bytes: number }[];
  bytes: number;
}

/**
 * The page is a shell. Everything on it is computed in the reader's own browser
 * from the parquet files the build exported, because the host cannot run a
 * query engine and a sandbox needs arbitrary queries.
 */
async function readManifest(): Promise<Manifest | null> {
  try {
    const file = path.join(process.cwd(), 'public', 'lake', 'manifest.json');
    return JSON.parse(await readFile(file, 'utf8')) as Manifest;
  } catch {
    return null;
  }
}

export default async function StatsPage(): Promise<React.ReactElement> {
  const manifest = await readManifest();
  const megabytes = manifest === null ? 0 : manifest.bytes / (1024 * 1024);

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <p className="eyebrow">The Lab</p>
        <h1 className={styles.title}>Test it yourself</h1>
        <p className={styles.standfirst}>
          Ten seasons of gameweeks, 253,900 rows, and thirty five seasons of results, loaded into
          your browser and left there. Write a filter, build a factor, fit a model, simulate a
          match, or replay a strategy against the seasons it would have been run in. Nothing here is
          precomputed: every number on screen is calculated on this machine, from files you can
          download.
        </p>
        {manifest === null ? null : (
          <p className={styles.meta}>
            <span className="num">{megabytes.toFixed(1)} MB</span> of parquet, fetched a season at a
            time · lake built <span className="num">{manifest.generatedAt.slice(0, 10)}</span> ·{' '}
            <Link href="/glossary">what every metric means</Link> ·{' '}
            <Link href="/how-it-works">how the platform works</Link>
          </p>
        )}
      </header>

      <Suspense fallback={<p className={styles.loading}>Opening the workspace…</p>}>
        <Lab generatedAt={manifest?.generatedAt ?? ''} />
      </Suspense>
    </div>
  );
}
