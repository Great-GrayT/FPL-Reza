import type { MarketView } from '@/lib/market';
import { ForecastBar } from './forecast-bar';
import styles from './market-odds.module.css';

/**
 * What the betting market thought, set against what the model thinks.
 *
 * The model on this page is stated rather than fitted and knows only results,
 * so the most useful thing that can sit beside it is a number produced by
 * people with money at stake who also knew the team news. Where the two
 * disagree, the disagreement is the interesting part, and it is printed rather
 * than left for the reader to subtract.
 *
 * Everything here has the bookmaker's margin stripped before it is shown, and
 * the margin is printed anyway, because how much a book was charging is part of
 * how seriously to take its number. These are closing prices: the last each
 * book showed before kickoff, which is the sharpest number they publish and,
 * unavoidably, after the fact. Nothing here is a live price and nothing here is
 * a tip.
 */

const percent = (value: number): string => `${(value * 100).toFixed(0)}%`;
const signed = (value: number): string =>
  `${value > 0 ? '+' : '−'}${Math.abs(value * 100).toFixed(0)}`;

export function MarketOdds({
  market,
  homeLabel,
  awayLabel,
  model,
  outcome,
}: {
  market: MarketView;
  homeLabel: string;
  awayLabel: string;
  /** The model's own probabilities, so the two can be read against each other. */
  model: { home: number; draw: number; away: number; over: number };
  /**
   * Which outcome actually occurred, once the match is played.
   *
   * The market and the model are two opinions, and a page that prints both and
   * never says which was right is asking a reader to arbitrate with no
   * evidence. This is the evidence.
   */
  outcome?: 'home' | 'draw' | 'away';
}) {
  const { consensus } = market;
  if (consensus === null) return null;

  const gaps = [
    { key: 'home' as const, label: homeLabel, market: consensus.home, model: model.home },
    { key: 'draw' as const, label: 'Draw', market: consensus.draw, model: model.draw },
    { key: 'away' as const, label: awayLabel, market: consensus.away, model: model.away },
  ];
  const widest = [...gaps].sort(
    (a, b) => Math.abs(b.market - b.model) - Math.abs(a.market - a.model),
  )[0];

  return (
    <section className={styles.market} aria-labelledby="market">
      <h2 id="market" className={styles.head}>
        What the market thought
      </h2>
      <p className={styles.lede}>
        Closing prices from {market.count} {market.count === 1 ? 'bookmaker' : 'bookmakers'}, the
        last each showed before kickoff. Prices are not probabilities: three prices on one match
        imply more than certainty between them, and the excess is the margin. Every figure below has
        that margin stripped proportionally, and the margin is printed beside it.
      </p>

      <ForecastBar
        home={consensus.home}
        draw={consensus.draw}
        away={consensus.away}
        homeLabel={homeLabel}
        awayLabel={awayLabel}
      />

      <dl className={styles.gaps}>
        {gaps.map((gap) => (
          <div key={gap.label} data-happened={outcome === gap.key ? 'true' : undefined}>
            <dt>
              {gap.label}
              {outcome === gap.key && (
                <>
                  {' '}
                  <span className={styles.won}>happened</span>
                </>
              )}
            </dt>
            <dd>
              <span className={`num ${styles.value}`}>{percent(gap.market)}</span>
              <span className={styles.against}>
                model {percent(gap.model)},{' '}
                <span
                  className={`num ${styles.delta}`}
                  data-wide={Math.abs(gap.market - gap.model) >= 0.08 ? 'true' : undefined}
                >
                  {signed(gap.market - gap.model)}
                </span>
              </span>
            </dd>
          </div>
        ))}
        {consensus.over !== null && (
          <div>
            <dt>Over 2.5 goals</dt>
            <dd>
              <span className={`num ${styles.value}`}>{percent(consensus.over)}</span>
              <span className={styles.against}>
                model {percent(model.over)},{' '}
                <span className={`num ${styles.delta}`}>{signed(consensus.over - model.over)}</span>
              </span>
            </dd>
          </div>
        )}
      </dl>

      {widest !== undefined && Math.abs(widest.market - widest.model) >= 0.05 && (
        <p className={styles.verdict}>
          The two disagree most on <strong>{widest.label}</strong>: the market had it{' '}
          {percent(widest.market)} and the model {percent(widest.model)}. The market knew the team
          news and the model does not, which is the first thing to suspect when they part.
        </p>
      )}

      <details className={styles.books}>
        <summary>Book by book</summary>
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Bookmaker</th>
                <th scope="col">{homeLabel}</th>
                <th scope="col">Draw</th>
                <th scope="col">{awayLabel}</th>
                <th scope="col">Over 2.5</th>
                <th scope="col">Margin</th>
              </tr>
            </thead>
            <tbody>
              {market.books.map((book) => (
                <tr key={book.bookmaker}>
                  <th scope="row">{book.bookmaker}</th>
                  <td className="num">{percent(book.home)}</td>
                  <td className="num">{percent(book.draw)}</td>
                  <td className="num">{percent(book.away)}</td>
                  <td className="num">{book.over === undefined ? '—' : percent(book.over)}</td>
                  <td className="num">{(book.margin * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <p className={styles.source}>
        Source: closing odds published by football-data.co.uk, free for personal use, ingested by
        the <code>odds-football-data</code> source and stored one partition per season. Margins here
        ran {(market.marginLow * 100).toFixed(1)} to {(market.marginHigh * 100).toFixed(1)} percent.
        These are historical prices shown to explain a result, not an invitation to bet.
      </p>
    </section>
  );
}
