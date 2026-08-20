'use client';

import { useMemo, useState } from 'react';
import { shirtUrl } from '@fpl/assets/urls';
import { formatPrice, type Position } from '@fpl/core';
import type { Chip, Plan, PlannerPlayer, WeekPlan } from '@fpl/planner';
import { classes } from '@/lib/classes';
import { usePlannerRun } from '@/lib/planner/client';
import type { PlannerPool } from '@/lib/planner/projections';
import styles from './planner.module.css';

/**
 * The season planner.
 *
 * FPL time is 38 discrete slabs, and a plan is a decision per slab, so the
 * calendar is not a widget beside the plan: it is the plan. Each column is one
 * gameweek, its height is what that week is worth, its marks are what the plan
 * does that week, and pressing it scrubs the pitch below to that week's squad.
 *
 * The search itself runs in a worker and under every rule the game enforces, so
 * nothing it suggests is a squad the reader could not actually enter.
 */

export interface PlannerClub {
  code: number;
  name: string;
  shortName: string;
}

interface Goal {
  key: string;
  label: string;
  weeks: number;
  note: string;
}

/**
 * The goals a manager actually has. These are not arbitrary horizons: a week is
 * a captaincy decision, a month is a transfer decision, a half season is a chip
 * decision, and a season is a strategy.
 */
const GOALS: Goal[] = [
  { key: 'week', label: 'This week', weeks: 1, note: 'One gameweek. The captain is the decision.' },
  { key: 'month', label: 'A month', weeks: 4, note: 'Four gameweeks. Transfers start to pay off.' },
  { key: 'two', label: 'Two months', weeks: 8, note: 'Eight gameweeks. A hit can be recovered.' },
  { key: 'half', label: 'Half a season', weeks: 19, note: 'Nineteen. Chips are worth planning.' },
  {
    key: 'season',
    label: 'The season',
    weeks: 38,
    note: 'Everything left, blanks and doubles too.',
  },
];

const RISKS = [
  { value: -1, label: 'Chasing', note: 'Prefers the volatile squad: the one that can win a week.' },
  { value: 0, label: 'Neutral', note: 'Ranks on the mean projection alone.' },
  { value: 1, label: 'Protecting', note: 'Subtracts a standard deviation: the safe squad.' },
];

const ALL_CHIPS: { chip: Chip; label: string }[] = [
  { chip: 'bench_boost', label: 'Bench boost' },
  { chip: 'triple_captain', label: 'Triple captain' },
];

const POSITIONS: Position[] = ['GKP', 'DEF', 'MID', 'FWD'];

const POSITION_LABEL: Record<Position, string> = {
  GKP: 'Goalkeeper',
  DEF: 'Defenders',
  MID: 'Midfielders',
  FWD: 'Forwards',
};

const POOL_GENERATION = 1;

export function Planner({
  pool,
  clubs,
  deadlines,
  fromGameweek,
  horizon,
}: {
  pool: PlannerPool;
  clubs: PlannerClub[];
  deadlines: { gameweek: number; deadline: string }[];
  fromGameweek: number;
  horizon: number;
}) {
  const [goalKey, setGoalKey] = useState('month');
  const [risk, setRisk] = useState(0);
  const [chips, setChips] = useState<Chip[]>([]);
  const [maxTransfers, setMaxTransfers] = useState(2);
  const [selected, setSelected] = useState<number | null>(null);

  const goal = GOALS.find((entry) => entry.key === goalKey) ?? GOALS[1];
  const weeks = Math.min(goal?.weeks ?? 4, horizon);

  const byCode = useMemo(
    () => new Map(pool.players.map((player) => [player.code, player])),
    [pool.players],
  );
  const clubByCode = useMemo(() => new Map(clubs.map((club) => [club.code, club])), [clubs]);
  const deadlineOf = useMemo(
    () => new Map(deadlines.map((entry) => [entry.gameweek, entry.deadline])),
    [deadlines],
  );

  // The opening fifteen: chosen once, over a fixed window, so switching goals
  // replans from the same squad rather than quietly changing the starting point.
  const opening = usePlannerRun(
    () => ({
      kind: 'auto' as const,
      poolGeneration: POOL_GENERATION,
      players: pool.players,
      budget: 1000,
      horizon: Math.min(8, horizon),
    }),
    (reply) => reply.squad ?? null,
    [pool.players, horizon],
  );

  const squad = useMemo(() => opening.data?.picks ?? [], [opening.data]);
  const bank = opening.data?.bank ?? 0;

  const planned = usePlannerRun(
    () =>
      squad.length === 15
        ? {
            kind: 'plan' as const,
            poolGeneration: POOL_GENERATION,
            squad,
            bank,
            freeTransfers: 1,
            startGameweek: fromGameweek,
            horizon: weeks,
            riskAversion: risk,
            chips,
            maxTransfersPerWeek: maxTransfers,
            // A long horizon is a wider search, so the beam narrows to keep the
            // whole plan inside a second rather than a minute.
            beamWidth: weeks > 12 ? 6 : 12,
          }
        : null,
    (reply) => reply.plan ?? null,
    [squad.join(','), bank, weeks, risk, chips.join(','), maxTransfers, fromGameweek],
  );

  const plan = planned.data;
  const week =
    plan === null
      ? null
      : (plan.weeks.find((entry) => entry.gameweek === selected) ?? plan.weeks[0] ?? null);

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <p className={styles.eyebrow}>
          From gameweek {fromGameweek} · {horizon} left
        </p>
        <h1 className={styles.title}>Season planner</h1>
        <p className={styles.standfirst}>
          Say how far ahead you are playing, and the search returns a squad for every gameweek in
          between: who comes in, who goes out, what a hit costs, who wears the armband, and where a
          chip earns more than holding it. Every squad it suggests is legal, because an illegal one
          is never scored.
        </p>
      </header>

      <section className={styles.controls} aria-label="What you are planning for">
        <fieldset className={styles.field}>
          <legend className={styles.legend}>Goal</legend>
          <div className={styles.choices}>
            {GOALS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                className={styles.choice}
                data-on={entry.key === goalKey ? 'true' : undefined}
                onClick={() => {
                  setGoalKey(entry.key);
                  setSelected(null);
                }}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <p className={styles.note}>
            {goal?.note} {weeks < (goal?.weeks ?? 0) && `Only ${String(weeks)} gameweeks are left.`}
          </p>
        </fieldset>

        <fieldset className={styles.field}>
          <legend className={styles.legend}>Risk</legend>
          <div className={styles.choices}>
            {RISKS.map((entry) => (
              <button
                key={entry.label}
                type="button"
                className={styles.choice}
                data-on={entry.value === risk ? 'true' : undefined}
                onClick={() => {
                  setRisk(entry.value);
                }}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <p className={styles.note}>{RISKS.find((entry) => entry.value === risk)?.note}</p>
        </fieldset>

        <fieldset className={styles.field}>
          <legend className={styles.legend}>Chips held</legend>
          <div className={styles.choices}>
            {ALL_CHIPS.map((entry) => (
              <button
                key={entry.chip}
                type="button"
                className={styles.choice}
                data-on={chips.includes(entry.chip) ? 'true' : undefined}
                onClick={() => {
                  setChips((current) =>
                    current.includes(entry.chip)
                      ? current.filter((chip) => chip !== entry.chip)
                      : [...current, entry.chip],
                  );
                }}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <p className={styles.note}>
            A chip is played only where it beats holding it to the end of the horizon.
          </p>
        </fieldset>

        <fieldset className={styles.field}>
          <legend className={styles.legend}>Transfers a week</legend>
          <div className={styles.choices}>
            {[1, 2].map((count) => (
              <button
                key={count}
                type="button"
                className={styles.choice}
                data-on={count === maxTransfers ? 'true' : undefined}
                onClick={() => {
                  setMaxTransfers(count);
                }}
              >
                {count}
              </button>
            ))}
          </div>
          <p className={styles.note}>Anything past the free one costs four points.</p>
        </fieldset>
      </section>

      {plan !== null && (
        <dl className={styles.summary} aria-label="What the plan is worth">
          <Figure label="Expected" value={plan.total.toFixed(1)} note="points, after every hit" />
          <Figure
            label="Over holding"
            value={`${plan.excess >= 0 ? '+' : ''}${plan.excess.toFixed(1)}`}
            note="against keeping the same fifteen"
            emphasis={plan.excess > 0}
          />
          <Figure
            label="Transfers"
            value={String(plan.transfers)}
            note={`${String(plan.hits)} points of hits`}
          />
          <Figure
            label="Chips"
            value={plan.chipsPlayed.length === 0 ? 'held' : String(plan.chipsPlayed.length)}
            note={
              plan.chipsPlayed.length === 0
                ? 'none earned its place'
                : plan.chipsPlayed.map(chipLabel).join(', ')
            }
          />
          <Figure
            label="Explored"
            value={plan.explored.toLocaleString('en-GB')}
            note="squads searched"
          />
        </dl>
      )}

      {planned.running && (
        <p className={styles.working} role="status">
          Searching.
        </p>
      )}
      {planned.error !== null && (
        <p className={styles.error} role="alert">
          {planned.error}
        </p>
      )}

      {plan !== null && (
        <Calendar
          plan={plan}
          calendar={pool.calendar}
          deadlineOf={deadlineOf}
          selected={week?.gameweek ?? null}
          onSelect={setSelected}
        />
      )}

      {week !== null && (
        <WeekView
          week={week}
          index={week.gameweek - fromGameweek}
          byCode={byCode}
          clubByCode={clubByCode}
        />
      )}

      <section className={styles.caveat} aria-label="What this does not know">
        <h2 className={styles.caveatHead}>What the plan does not know</h2>
        <ul className={styles.caveatList}>
          <li>
            Projections are a stated heuristic over recent scoring, fixture difficulty, and how
            reliably a player starts. They are not a forecast of one match.
          </li>
          <li>
            Prices are held at today&apos;s. A rise the plan cannot see makes a later transfer
            dearer than it looks here.
          </li>
          <li>
            An injury, a rotation, or a manager changing his mind resets everything after it, which
            is why a plan is worth remaking each week rather than following to the letter.
          </li>
        </ul>
      </section>
    </div>
  );
}

function chipLabel(chip: Chip): string {
  if (chip === 'bench_boost') return 'bench boost';
  if (chip === 'triple_captain') return 'triple captain';
  return chip.replace('_', ' ');
}

function Figure({
  label,
  value,
  note,
  emphasis = false,
}: {
  label: string;
  value: string;
  note: string;
  emphasis?: boolean;
}) {
  return (
    <div className={styles.figure} data-emphasis={emphasis ? 'true' : undefined}>
      <dt className={styles.figureLabel}>{label}</dt>
      <dd className={classes(styles.figureValue, 'num')}>{value}</dd>
      <dd className={styles.figureNote}>{note}</dd>
    </div>
  );
}

/**
 * The calendar.
 *
 * One column per gameweek, bar height the points that week is worth, and the
 * marks below it what the plan does: transfers made, a hit taken, a chip
 * stamped, and whether clubs blank or double. It is the navigation as well as
 * the chart, the same object the gameweek ribbon is on a player page.
 */
function Calendar({
  plan,
  calendar,
  deadlineOf,
  selected,
  onSelect,
}: {
  plan: Plan;
  calendar: PlannerPool['calendar'];
  deadlineOf: Map<number, string>;
  selected: number | null;
  onSelect: (gameweek: number) => void;
}) {
  const peak = Math.max(...plan.weeks.map((week) => week.expectedPoints), 1);
  const marksOf = new Map(calendar.map((entry) => [entry.gameweek, entry]));

  return (
    <section className={styles.calendar} aria-label="The plan, gameweek by gameweek">
      <ol className={styles.rail}>
        {plan.weeks.map((week) => {
          const marks = marksOf.get(week.gameweek);
          const height = Math.max(4, (week.expectedPoints / peak) * 100);
          return (
            <li key={week.gameweek} className={styles.cell}>
              <button
                type="button"
                className={styles.cellButton}
                data-on={week.gameweek === selected ? 'true' : undefined}
                onClick={() => {
                  onSelect(week.gameweek);
                }}
                aria-pressed={week.gameweek === selected}
              >
                <span className={styles.barTrack}>
                  <span className={styles.bar} style={{ blockSize: `${String(height)}%` }} />
                </span>
                <span className={classes(styles.barValue, 'num')}>
                  {week.expectedPoints.toFixed(0)}
                </span>
                <span className={classes(styles.cellWeek, 'num')}>{week.gameweek}</span>
                <span className={styles.cellMarks}>
                  {week.transfers > 0 && (
                    <span
                      className={styles.markTransfer}
                      title={`${String(week.transfers)} transfers`}
                    >
                      {week.transfers}
                    </span>
                  )}
                  {week.hit > 0 && (
                    <span className={styles.markHit} title={`${String(week.hit)} point hit`}>
                      {week.hit}
                    </span>
                  )}
                  {week.chip !== null && (
                    <span className={styles.markChip} title={chipLabel(week.chip)}>
                      {week.chip === 'bench_boost' ? 'BB' : 'TC'}
                    </span>
                  )}
                  {marks !== undefined && marks.doubles.length > 0 && (
                    <span
                      className={styles.markDouble}
                      title={`${String(marks.doubles.length)} clubs play twice`}
                    >
                      D
                    </span>
                  )}
                  {marks !== undefined && marks.blanks.length > 0 && (
                    <span
                      className={styles.markBlank}
                      title={`${String(marks.blanks.length)} clubs have no fixture`}
                    >
                      B
                    </span>
                  )}
                </span>
                <span className={styles.cellDate}>{shortDate(deadlineOf.get(week.gameweek))}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className={styles.railKey}>
        Each bar is that week&apos;s expected points, and pressing one shows the squad below.{' '}
        <b>D</b> marks a gameweek where clubs play twice, <b>B</b> where clubs have no fixture at
        all, and a red figure is a points hit.
      </p>
    </section>
  );
}

function shortDate(iso: string | undefined): string {
  if (iso === undefined) return '';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** One gameweek: the eleven on the pitch, the bench beside it, the ledger below. */
function WeekView({
  week,
  index,
  byCode,
  clubByCode,
}: {
  week: WeekPlan;
  index: number;
  byCode: Map<number, PlannerPlayer>;
  clubByCode: Map<number, PlannerClub>;
}) {
  const resolve = (codes: readonly number[]): PlannerPlayer[] =>
    codes.flatMap((code) => {
      const player = byCode.get(code);
      return player === undefined ? [] : [player];
    });

  const starters = resolve(week.starters);
  const bench = resolve(week.bench);

  return (
    <section className={styles.week} aria-label={`Gameweek ${String(week.gameweek)}`}>
      <h2 className={styles.weekHead}>
        <span className={styles.weekStamp}>GW {week.gameweek}</span>
        <span className={styles.weekFigure}>
          <b className="num">{week.expectedPoints.toFixed(1)}</b> expected
        </span>
        <span className={styles.weekFigure}>
          <b className="num">{formatPrice(week.bank)}</b> banked
        </span>
        <span className={styles.weekFigure}>
          <b className="num">{week.freeTransfers}</b> free transfers
        </span>
      </h2>

      <div className={styles.pitch}>
        <PitchLines />
        {POSITIONS.map((position) => {
          const line = starters.filter((player) => player.position === position);
          if (line.length === 0) return null;
          return (
            <ul key={position} className={styles.line} aria-label={POSITION_LABEL[position]}>
              {line.map((player) => (
                <Token
                  key={player.code}
                  player={player}
                  club={clubByCode.get(player.teamCode)}
                  week={index}
                  captain={player.code === week.captain}
                  vice={player.code === week.viceCaptain}
                  incoming={week.transfersIn.includes(player.code)}
                />
              ))}
            </ul>
          );
        })}
      </div>

      <ul className={styles.tokenKey}>
        <li>
          Each tag reads <b>price</b>, then the <b>projection</b> for this gameweek, then its
          <b> spread</b>.
        </li>
      </ul>

      <div className={styles.benchRail}>
        <h3 className={styles.benchHead}>Bench</h3>
        <ul className={styles.benchList}>
          {bench.map((player) => (
            <Token
              key={player.code}
              player={player}
              club={clubByCode.get(player.teamCode)}
              week={index}
              captain={false}
              vice={false}
              incoming={week.transfersIn.includes(player.code)}
              muted
            />
          ))}
        </ul>
      </div>

      <div className={styles.ledger}>
        <h3 className={styles.ledgerHead}>What changes this week</h3>
        {week.transfers === 0 ? (
          <p className={styles.ledgerNone}>
            No transfer. Nothing available gains more than it would cost.
          </p>
        ) : (
          <ul className={styles.ledgerList}>
            {week.transfersOut.map((code, position) => {
              const out = byCode.get(code);
              const inCode = week.transfersIn[position];
              const incoming = inCode === undefined ? undefined : byCode.get(inCode);
              return (
                <li key={code} className={styles.ledgerRow}>
                  <span className={styles.ledgerOut}>{out?.name ?? code}</span>
                  <span className={styles.ledgerArrow} aria-hidden="true">
                    &rarr;
                  </span>
                  <span className={styles.ledgerIn}>{incoming?.name ?? inCode}</span>
                  <span className={classes(styles.ledgerDelta, 'num')}>
                    {incoming !== undefined && out !== undefined
                      ? `${formatPrice(incoming.price)} for ${formatPrice(out.price)}`
                      : ''}
                  </span>
                </li>
              );
            })}
            {week.hit > 0 && (
              <li className={styles.ledgerHit}>
                Costs {week.hit} points, and the plan still takes it.
              </li>
            )}
          </ul>
        )}
      </div>
    </section>
  );
}

function Token({
  player,
  club,
  week,
  captain,
  vice,
  incoming,
  muted = false,
}: {
  player: PlannerPlayer;
  club: PlannerClub | undefined;
  week: number;
  captain: boolean;
  vice: boolean;
  incoming: boolean;
  muted?: boolean;
}) {
  const projection = player.projections[week] ?? 0;
  const spread = player.spreads?.[week] ?? 0;

  return (
    <li className={styles.token} data-muted={muted ? 'true' : undefined}>
      <span className={styles.shirt}>
        {club === undefined ? (
          <span className={styles.shirtBlank} aria-hidden="true" />
        ) : (
          // A plain img: the CDN serves one fixed size, and next/image would
          // proxy fifteen of them a week for nothing.
          <img
            className={styles.shirtImage}
            src={shirtUrl(club.code, { keeper: player.position === 'GKP' })}
            alt=""
            width={54}
            height={68}
            loading="lazy"
          />
        )}
        {captain && (
          <abbr className={styles.captain} title="Captain: points doubled">
            C
          </abbr>
        )}
        {vice && !captain && (
          <abbr className={styles.vice} title="Vice captain">
            V
          </abbr>
        )}
        {incoming && <span className={styles.incoming}>In</span>}
      </span>
      <span className={styles.tag}>
        <span className={styles.tokenName}>{player.name}</span>
        <span className={styles.tokenClub}>{club?.shortName ?? '???'}</span>
        <span className={classes(styles.tokenMetrics, 'num')}>
          <span title="Price">{formatPrice(player.price)}</span>
          <strong title="Projected points this gameweek">{projection.toFixed(1)}</strong>
          <span title="Spread of that projection">&plusmn;{spread.toFixed(1)}</span>
        </span>
      </span>
    </li>
  );
}

/** Ink line-work at the real 105 by 68 ratio, the rectangle the whole site draws. */
function PitchLines() {
  return (
    <svg
      className={styles.pitchLines}
      viewBox="0 0 1050 680"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <g fill="none" stroke="currentColor" strokeWidth="3">
        <rect x="8" y="8" width="1034" height="664" />
        <line x1="525" y1="8" x2="525" y2="672" />
        <circle cx="525" cy="340" r="91" />
        <rect x="8" y="139" width="165" height="402" />
        <rect x="8" y="248" width="55" height="184" />
        <rect x="877" y="139" width="165" height="402" />
        <rect x="987" y="248" width="55" height="184" />
      </g>
      <g fill="currentColor">
        <circle cx="525" cy="340" r="5" />
        <circle cx="118" cy="340" r="5" />
        <circle cx="932" cy="340" r="5" />
      </g>
    </svg>
  );
}
