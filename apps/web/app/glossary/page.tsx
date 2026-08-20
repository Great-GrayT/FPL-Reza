import type { Metadata } from 'next';
import { GLOSSARY } from '@fpl/analytics';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'What the numbers mean | FPL Lake',
  description:
    'Every metric on this site: what it measures, how it is computed, where it comes from, and what it hides.',
};

/**
 * The dictionary, printed. Each entry states the exact operation rather than a
 * paraphrase, because the point of the page is that a manager can check the
 * arithmetic and disagree with it.
 */
export default function GlossaryPage() {
  return (
    <div className={`shell ${styles.page}`}>
      <header className={styles.masthead}>
        <p className={styles.eyebrow}>{GLOSSARY.length} entries</p>
        <h1 className={styles.title}>What the numbers mean</h1>
        <p className={styles.standfirst}>
          Every measure this site shows, with the operation that produces it and the source it comes
          from. Where a metric misleads, that is stated too: a number you cannot argue with is a
          number you should not trust.
        </p>
      </header>

      <dl className={styles.entries}>
        {GLOSSARY.map((entry) => (
          <div key={entry.id} id={entry.id} className={styles.entry}>
            <dt className={styles.term}>{entry.term}</dt>
            <dd className={styles.body}>
              <p className={styles.short}>{entry.short}</p>
              {entry.formula !== undefined && (
                <p className={styles.formula}>
                  <span className={styles.tag}>How</span>
                  {entry.formula}
                </p>
              )}
              <p className={styles.source}>
                <span className={styles.tag}>Source</span>
                {entry.source}
              </p>
              {entry.caveat !== undefined && (
                <p className={styles.caveat}>
                  <span className={styles.tag}>Watch</span>
                  {entry.caveat}
                </p>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
