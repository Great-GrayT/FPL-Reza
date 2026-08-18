import styles from './forecast-bar.module.css';

/**
 * Three outcome probabilities as one bar rather than three numbers, because
 * the question a reader is answering is proportional ("how much more likely?")
 * and a bar answers it without arithmetic. The numbers stay printed on it, so
 * nothing is lost to anyone who wants the actual figure.
 */
export function ForecastBar({
  home,
  draw,
  away,
  homeLabel,
  awayLabel,
}: {
  home: number;
  draw: number;
  away: number;
  homeLabel: string;
  awayLabel: string;
}) {
  const percent = (value: number): string => `${(value * 100).toFixed(0)}%`;

  return (
    <div className={styles.wrap}>
      <div
        className={styles.bar}
        role="img"
        aria-label={`${homeLabel} ${percent(home)}, draw ${percent(draw)}, ${awayLabel} ${percent(away)}`}
      >
        <span className={styles.home} style={{ width: `${String(home * 100)}%` }}>
          <span className="num">{percent(home)}</span>
        </span>
        <span className={styles.draw} style={{ width: `${String(draw * 100)}%` }}>
          <span className="num">{percent(draw)}</span>
        </span>
        <span className={styles.away} style={{ width: `${String(away * 100)}%` }}>
          <span className="num">{percent(away)}</span>
        </span>
      </div>
      <div className={styles.keys} aria-hidden>
        <span>{homeLabel}</span>
        <span>Draw</span>
        <span>{awayLabel}</span>
      </div>
    </div>
  );
}

/** One probability as a labelled meter, for a clean sheet or an over under. */
export function Likelihood({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.likelihood}>
      <span className={styles.likelihoodLabel}>{label}</span>
      <span className={styles.meter} aria-hidden>
        <span className={styles.meterFill} style={{ width: `${String(value * 100)}%` }} />
      </span>
      <span className={`num ${styles.likelihoodValue}`}>{(value * 100).toFixed(0)}%</span>
    </div>
  );
}
