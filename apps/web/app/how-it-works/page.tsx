import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Metadata } from 'next';
import { DocContents } from '@/components/doc-contents';
import { renderDoc } from '@/lib/markdown';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'How it works | FPL Lake',
  description:
    'The whole platform end to end: the public sources it reads, the domain it models, the algorithms it computes, and how a page gets built',
};

const DOC_PATH = path.join('docs', 'ARCHITECTURE.md');

/**
 * The page renders the repository's own architecture document, so the site and
 * the docs cannot drift: there is one file, and it is the one shipped here.
 * Next runs with cwd at the app directory locally and at the repo root on
 * Vercel, so the root is walked to rather than assumed.
 */
function readDoc(): string {
  let directory = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path.join(directory, DOC_PATH);
    if (existsSync(candidate)) return readFileSync(candidate, 'utf8');
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(`${DOC_PATH} not found from ${process.cwd()}`);
}

export default function HowItWorksPage() {
  const doc = renderDoc(readDoc());
  const sections = doc.headings.filter((heading) => heading.level === 2).length;

  return (
    <div className={`shell ${styles.page}`}>
      <header className={styles.head}>
        <p className="eyebrow">The build, explained</p>
        <h1 className={styles.title}>{doc.title}</h1>
        <p className={styles.standfirst}>
          Every number on this site starts as a public JSON payload and ends as a snapshot in a
          committed file. This is the whole route it takes.
        </p>
        <dl className={styles.stamp}>
          <div>
            <dt>Source</dt>
            <dd className="num">{DOC_PATH.replace(/\\/g, '/')}</dd>
          </div>
          <div>
            <dt>Revised</dt>
            <dd className="num">{doc.updated}</dd>
          </div>
          <div>
            <dt>Sections</dt>
            <dd className="num">{sections}</dd>
          </div>
        </dl>
      </header>

      <div className={styles.body}>
        <DocContents headings={doc.headings} />
        {/* The HTML comes from renderDoc, which escapes the document before it
            emits a single tag; the input is a file in this repository. */}
        <article className={styles.doc} dangerouslySetInnerHTML={{ __html: doc.html }} />
      </div>
    </div>
  );
}
