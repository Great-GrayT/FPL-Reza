'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { shirtUrl } from '@fpl/assets/urls';
import { formatPrice, type Position } from '@fpl/core';
import {
  StrategyCodeError,
  decodeStrategy,
  encodeStrategy,
  rebaseStrategy,
  type Chip,
  type Plan,
  type PlannerPlayer,
  type Strategy,
  type WeekPlan,
} from '@fpl/planner';
import { classes } from '@/lib/classes';
import { CompareLineups, codeForCandidate, type Candidate } from './compare-lineups';
import { Frontier, RiskShare } from './frontier';
import { StrategyScatter } from './strategy-scatter';
import {
  Captaincy,
  CumulativeSeries,
  Exposure,
  Panel,
  PointsSeries,
  Spend,
  ValueSeries,
  type WeekRow,
} from './planner-panels';
import { MiniPitch, type MiniPlayer } from './mini-pitch';
import { send, usePlannerRun } from '@/lib/planner/client';
import type { PlannerPool } from '@/lib/planner/projections';
import type { StrategyDot, StrategySpace } from '@/lib/planner/protocol';
import styles from './planner.module.css';

/**
 * The plan, explained.
 *
 * This page decides nothing. It used to: it picked its own fifteen with the
 * greedy opening picker and planned from that, while `/builder` searched for a
 * better fifteen and planned from that instead, so two pages answered one
 * question differently and the planner's squad was the very baseline the
 * builder printed as the number it had beaten. There is now one search, on the
 * builder, and this page explains what it produced.
 *
 * What arrives here is a strategy code: the question, not the answer. It is
 * re-solved on today's data, which is what lets the page say the data has moved
 * rather than quietly showing a stale squad.
 *
 * FPL time is 38 discrete slabs, and a plan is a decision per slab, so the
 * calendar is not a widget beside the plan: it is the plan. Each column is one
 * gameweek, its height is what that week is worth, its marks are what the plan
 * does that week, and pressing it scrubs the pitch below to that week's squad.
 */

export interface PlannerClub {
  code: number;
  name: string;
  shortName: string;
}

const RISKS = [
  { value: -1, label: 'Chasing', note: 'Prefers the volatile squad: the one that can win a week.' },
  { value: 0, label: 'Neutral', note: 'Ranks on the mean projection alone.' },
  { value: 1, label: 'Protecting', note: 'Subtracts a standard deviation: the safe squad.' },
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
  /** The pitch itself, so the corner panel knows when it has left the screen. */
  const pitchRef = useRef<HTMLDivElement>(null);

  const byCode = useMemo(
    () => new Map(pool.players.map((player) => [player.code, player])),
    [pool.players],
  );
  const clubByCode = useMemo(() => new Map(clubs.map((club) => [club.code, club])), [clubs]);
  const deadlineOf = useMemo(
    () => new Map(deadlines.map((entry) => [entry.gameweek, entry.deadline])),
    [deadlines],
  );

  const params = useSearchParams();
  const fromUrl = params.get('code');
  const [pasted, setPasted] = useState('');
  const [running, setRunning] = useState<string | null>(fromUrl);
  const [selected, setSelected] = useState<number | null>(null);

  const code = running ?? fromUrl;

  /**
   * The code, read and moved onto today.
   *
   * A strategy set in gameweek 3 to run through gameweek 10 is still that
   * strategy in gameweek 5: same budget, same risk, same locks, two fewer
   * weeks. A window that has closed entirely is refused by name rather than
   * clipped to nothing.
   */
  const read = useMemo((): { strategy: Strategy; elapsed: number } | { error: string } | null => {
    if (code === null || code.trim() === '') return null;
    try {
      const rebased = rebaseStrategy(decodeStrategy(code), fromGameweek);
      return { strategy: rebased.strategy, elapsed: rebased.weeksElapsed };
    } catch (error: unknown) {
      return {
        error:
          error instanceof StrategyCodeError
            ? error.message
            : 'that code could not be read, so nothing was solved',
      };
    }
  }, [code, fromGameweek]);

  const strategy = read !== null && 'strategy' in read ? read.strategy : null;
  const codeError = read !== null && 'error' in read ? read.error : null;

  /** Missing from today's pool: a squad of fourteen is illegal, so it refuses. */
  const missing = useMemo(() => {
    if (strategy === null) return [];
    const known = new Set(pool.players.map((player) => player.code));
    return strategy.squad.filter((entry) => !known.has(entry));
  }, [strategy, pool.players]);

  const weeks = strategy === null ? 0 : strategy.endGameweek - strategy.startGameweek + 1;

  const solved = usePlannerRun(
    () =>
      strategy === null || missing.length > 0
        ? null
        : {
            kind: 'strategy' as const,
            poolGeneration: POOL_GENERATION,
            players: pool.players,
            matches: pool.matches,
            gameweeks: pool.gameweeks,
            budget: strategy.budget,
            horizon: Math.min(weeks, horizon),
            startGameweek: strategy.startGameweek,
            riskAversion: strategy.riskAversion,
            freeTransfers: strategy.freeTransfers,
            maxTransfersPerWeek: strategy.maxTransfersPerWeek,
            chips: strategy.chips,
            locks: strategy.locks,
            bans: strategy.bans,
            objective: strategy.objective,
            seed: strategy.seed,
          },
    (reply) => reply.strategy ?? null,
    [code, weeks, horizon, missing.length],
  );

  const planned = { running: solved.running, error: solved.error, data: solved.data?.plan ?? null };

  /**
   * The space of strategies around this one.
   *
   * Solved once per configuration rather than per render: it is a second of
   * work in the worker, and the cloud only changes when the question does.
   *
   * The cloud is deliberately unconstrained by the reader's own locks and
   * bans. Those express a view about which squad *they* will hold, and a view
   * is not a law of the space: barring a player should move their dot, not
   * delete the strategies that hold him. Keeping the space whole is what makes
   * the cost of a constraint visible, since the dots above and to the left of
   * their own are exactly the squads their view rules out.
   */
  const [space, setSpace] = useState<StrategySpace | null>(null);
  const [spaceChips, setSpaceChips] = useState<Chip[]>([]);
  const [spaceRunning, setSpaceRunning] = useState(false);
  const [chosen, setChosen] = useState<StrategyDot | null>(null);

  const spaceKey =
    strategy === null
      ? null
      : [strategy.budget, Math.min(weeks, horizon), spaceChips.join('.')].join('|');

  useEffect(() => {
    if (strategy === null || spaceKey === null) return;
    let cancelled = false;
    setSpaceRunning(true);
    send({
      kind: 'space',
      poolGeneration: POOL_GENERATION,
      players: pool.players,
      matches: pool.matches,
      gameweeks: pool.gameweeks,
      budget: strategy.budget,
      horizon: Math.min(weeks, horizon),
      // Empty on purpose: see the note above. The reader's constraints move
      // their own dot, not the space it sits in.
      keep: [],
      ban: [],
      chips: spaceChips,
      seed: strategy.seed,
    })
      .then((reply) => {
        if (!cancelled) setSpace(reply.space ?? null);
      })
      .catch(() => {
        if (!cancelled) setSpace(null);
      })
      .finally(() => {
        if (!cancelled) setSpaceRunning(false);
      });
    return () => {
      cancelled = true;
    };
    // The key is the whole question the space answers; anything else that
    // changes here would be re-solving the same cloud.
  }, [spaceKey]);

  /** Explaining a dot is explaining its fifteen, so it becomes the strategy. */
  const chooseDot = useCallback(
    (dot: StrategyDot | null) => {
      setChosen(dot);
      setSelected(null);
      if (dot === null || strategy === null) return;
      setRunning(
        encodeStrategy({
          ...strategy,
          squad: dot.picks,
          // Held at the start rather than throughout: the reader asked to see
          // this fifteen, not to forbid the plan from improving it.
          locks: dot.picks.map((code) => ({ code, mode: 'start' as const })),
          fingerprint: '',
        }),
      );
    },
    [strategy],
  );

  /**
   * Line-ups a reader put beside the plan's own.
   *
   * They are solved one at a time through the worker rather than derived here,
   * because a squad's worth is the same search the rest of the page rests on
   * and a second implementation would be a second opinion.
   */
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);

  const addCandidate = useCallback(
    (squadPicks: number[], optimiseIt: boolean, label: string) => {
      if (strategy === null) return;
      setComparing(true);
      setCompareError(null);
      send({
        kind: 'compare',
        poolGeneration: POOL_GENERATION,
        players: pool.players,
        matches: pool.matches,
        gameweeks: pool.gameweeks,
        squad: squadPicks,
        budget: strategy.budget,
        horizon: Math.min(weeks, horizon),
        startGameweek: strategy.startGameweek,
        riskAversion: strategy.riskAversion,
        freeTransfers: strategy.freeTransfers,
        maxTransfersPerWeek: strategy.maxTransfersPerWeek,
        chips: strategy.chips,
        optimise: optimiseIt,
      })
        .then((reply) => {
          const result = reply.compared;
          if (result === undefined) throw new Error('that line-up could not be scored');
          setCandidates((current) => [
            ...current,
            {
              id: `${label}-${String(current.length)}-${String(Date.now())}`,
              label,
              picks: result.picks,
              optimised: optimiseIt,
              result,
              code: codeForCandidate(strategy, result.picks, result.fingerprint),
            },
          ]);
        })
        .catch((error: unknown) => {
          setCompareError(
            error instanceof Error ? error.message : 'that line-up could not be scored',
          );
        })
        .finally(() => {
          setComparing(false);
        });
    },
    [strategy, pool.players, pool.matches, pool.gameweeks, weeks, horizon],
  );

  const removeCandidate = useCallback((id: string) => {
    setCandidates((current) => current.filter((entry) => entry.id !== id));
  }, []);

  /** The strategy changed, so squads scored against the old one no longer apply. */
  useEffect(() => {
    setCandidates([]);
  }, [code]);

  /** The default question the builder asks, for a reader who arrives with none. */
  const explainDefault = useCallback(() => {
    setSelected(null);
    setRunning(
      encodeStrategy({
        version: 2,
        startGameweek: fromGameweek,
        endGameweek: fromGameweek + Math.min(8, horizon) - 1,
        budget: 1000,
        riskAversion: 0,
        freeTransfers: 1,
        maxTransfersPerWeek: 2,
        chips: [],
        squad: [],
        locks: [],
        bans: [],
        objective: 'mean',
        seed: 7,
        fingerprint: '',
      }),
    );
  }, [fromGameweek, horizon]);

  const runPasted = useCallback(() => {
    setSelected(null);
    setRunning(pasted.trim());
  }, [pasted]);

  const plan = planned.data;
  const week =
    plan === null
      ? null
      : (plan.weeks.find((entry) => entry.gameweek === selected) ?? plan.weeks[0] ?? null);

  /** The week on the pitch, reduced to what survives at thumbnail size. */
  const miniSquad: MiniPlayer[] = useMemo(() => {
    if (week === null) return [];
    return week.picks.flatMap((code) => {
      const player = byCode.get(code);
      if (player === undefined) return [];
      return [
        {
          code,
          position: player.position,
          teamCode: player.teamCode,
          name: player.name,
          starter: week.starters.includes(code),
          captain: week.captain === code,
        },
      ];
    });
  }, [week, byCode]);

  const weekRows: WeekRow[] = useMemo(
    () =>
      (plan?.weeks ?? []).map((entry, index) => ({
        ...entry,
        spread: solved.data?.spreads[index] ?? 0,
      })),
    [plan, solved.data],
  );

  const portfolio = solved.data?.portfolio ?? null;

  return (
    <div className={styles.terminal}>
      {/* One line of masthead. The page is an instrument panel, so what it is
          for is stated in the strategy panel rather than in three paragraphs
          above the fold. */}
      <header className={styles.rail}>
        <h1 className={styles.railTitle}>The plan</h1>
        <p className={styles.railNote}>
          Decided on the <a href="/builder">builder</a>, explained here.
        </p>
        <p className={`num ${styles.railCode}`}>
          {strategy === null
            ? 'no strategy loaded'
            : `GW ${String(strategy.startGameweek)}\u2013${String(strategy.endGameweek)}`}
        </p>
      </header>

      {solved.running && (
        <p className={styles.working} role="status">
          Solving.
        </p>
      )}
      {solved.error !== null && (
        <p className={styles.error} role="alert">
          {solved.error}
        </p>
      )}
      {codeError !== null && (
        <p className={styles.error} role="alert">
          {codeError}
        </p>
      )}
      {missing.length > 0 && (
        <p className={styles.error} role="alert">
          This code holds {missing.length} {missing.length === 1 ? 'player' : 'players'} who
          {missing.length === 1 ? ' is' : ' are'} not in today&apos;s pool, so it cannot be solved:
          planning from fourteen would present the search filling that hole as an improvement.
        </p>
      )}

      <div className={styles.grid}>
        {strategy === null ? (
          <Panel title="Nothing to explain yet" span={12}>
            <p className={styles.emptyNote}>
              This page explains a strategy rather than choosing one. Build a squad on the{' '}
              <a href="/builder">team builder</a> and press &ldquo;Explain this plan&rdquo;, paste a
              code here, or start from the default question.
            </p>
            <div className={styles.paste}>
              <label className={styles.legend} htmlFor="planner-code">
                Strategy code
              </label>
              <input
                id="planner-code"
                className={classes(styles.codeInput, 'num')}
                value={pasted}
                spellCheck={false}
                placeholder="FPL2-G3-EA-B1000-..."
                onChange={(event) => {
                  setPasted(event.target.value);
                }}
              />
              <button type="button" className={styles.choice} onClick={runPasted}>
                Explain it
              </button>
              <button type="button" className={styles.choice} onClick={explainDefault}>
                Best squad, next {Math.min(8, horizon)} gameweeks
              </button>
            </div>
          </Panel>
        ) : (
          <>
            <Panel title="Strategy" span={4} note={code === null ? undefined : 'from a code'}>
              <dl className={styles.question}>
                <div>
                  <dt>Window</dt>
                  <dd className="num">
                    GW {strategy.startGameweek}&ndash;{strategy.endGameweek}
                  </dd>
                </div>
                <div>
                  <dt>Budget</dt>
                  <dd className="num">{formatPrice(strategy.budget)}</dd>
                </div>
                <div>
                  <dt>Risk</dt>
                  <dd>
                    {RISKS.find((entry) => entry.value === Math.sign(strategy.riskAversion))
                      ?.label ?? 'Neutral'}
                  </dd>
                </div>
                <div>
                  <dt>Transfers/wk</dt>
                  <dd className="num">{strategy.maxTransfersPerWeek}</dd>
                </div>
                <div>
                  <dt>Chips</dt>
                  <dd>
                    {strategy.chips.length === 0
                      ? 'none'
                      : strategy.chips.map(chipLabel).join(', ')}
                  </dd>
                </div>
                <div>
                  <dt>Fixed</dt>
                  <dd className="num">
                    {strategy.locks.length === 0
                      ? 'none'
                      : `${String(strategy.locks.filter((lock) => lock.mode === 'start').length)}S ${String(strategy.locks.filter((lock) => lock.mode === 'always').length)}A`}
                  </dd>
                </div>
              </dl>
              {read !== null && 'elapsed' in read && read.elapsed > 0 && (
                <p className={styles.panelNote}>
                  Opened at gameweek {strategy.startGameweek - read.elapsed};{' '}
                  {read.elapsed === 1
                    ? 'one gameweek has'
                    : `${String(read.elapsed)} gameweeks have`}{' '}
                  been played, so it is solved over the {weeks} left of its window rather than
                  replanned to a later end.
                </p>
              )}
              {solved.data !== null &&
                strategy.fingerprint !== '' &&
                solved.data.fingerprint !== strategy.fingerprint && (
                  <p className={styles.panelNote}>
                    Prices or projections have moved since this code was minted, so this is the same
                    question answered again rather than the squad its author saw.
                  </p>
                )}
            </Panel>

            {plan !== null && (
              <Panel title="Verdict" span={8} note={`${String(plan.explored)} states`}>
                <dl className={styles.summary}>
                  <Figure
                    label="Expected"
                    value={plan.total.toFixed(1)}
                    note={`plus or minus ${(solved.data?.spread ?? 0).toFixed(1)}`}
                  />
                  <Figure
                    label="Over holding"
                    value={`${plan.excess >= 0 ? '+' : ''}${plan.excess.toFixed(1)}`}
                    note="against keeping the fifteen"
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
                    label="Searched"
                    value={(solved.data?.optimisation.evaluated ?? 0).toLocaleString('en-GB')}
                    note={`beat ${(solved.data?.optimisation.baseline ?? 0).toFixed(1)}`}
                  />
                </dl>
              </Panel>
            )}

            {plan !== null && (
              <Panel title="Gameweeks" span={12} note="press a column">
                <Calendar
                  plan={plan}
                  calendar={pool.calendar}
                  deadlineOf={deadlineOf}
                  selected={week?.gameweek ?? null}
                  onSelect={setSelected}
                />
              </Panel>
            )}

            {weekRows.length > 0 && (
              <>
                <Panel title="Expected points" span={6} note="band is one standard deviation">
                  <PointsSeries weeks={weekRows} />
                </Panel>
                <Panel title="Running total" span={6}>
                  <CumulativeSeries weeks={weekRows} />
                </Panel>
              </>
            )}

            {week !== null && (
              <Panel title={`Gameweek ${String(week.gameweek)}`} span={7}>
                <WeekView
                  week={week}
                  index={week.gameweek - fromGameweek}
                  byCode={byCode}
                  clubByCode={clubByCode}
                  pitchRef={pitchRef}
                  freeHand={
                    solved.data?.freeHand.find((entry) => entry.gameweek === week.gameweek)
                      ?.swaps ?? []
                  }
                />
              </Panel>
            )}

            {weekRows.length > 0 && (
              <>
                <Panel title="Captaincy" span={5}>
                  <Captaincy weeks={weekRows} byCode={byCode} fromGameweek={fromGameweek} />
                </Panel>
                <Panel title="Exposure" span={6}>
                  <Exposure weeks={weekRows} byCode={byCode} calendar={pool.calendar} />
                </Panel>
                <Panel title="Where the money is" span={6}>
                  <Spend picks={week?.picks ?? []} byCode={byCode} bank={week?.bank ?? 0} />
                </Panel>
                <Panel title="Team value" span={6}>
                  <ValueSeries weeks={weekRows} />
                </Panel>
              </>
            )}

            {space !== null && (
              <Panel
                title="The strategy space"
                span={7}
                note={`${String(space.dots.length)} legal fifteens`}
              >
                <StrategyScatter
                  space={space}
                  pinned={
                    portfolio === null
                      ? null
                      : {
                          label: 'The builder\u2019s strategy',
                          expected: portfolio.held.expected,
                          risk: portfolio.held.risk,
                        }
                  }
                  selected={chosen}
                  chips={spaceChips}
                  running={spaceRunning}
                  onChip={(chip, on) => {
                    setSpaceChips((current) =>
                      on ? [...current, chip] : current.filter((entry) => entry !== chip),
                    );
                  }}
                  onSelect={chooseDot}
                />
              </Panel>
            )}

            {portfolio !== null && (
              <>
                <Panel title="Risk and return" span={5} note="the frontier this squad sits on">
                  <Frontier
                    portfolio={portfolio}
                    added={candidates.map((candidate) => ({
                      id: candidate.id,
                      label: candidate.label,
                      expected: candidate.result.expected,
                      risk: candidate.result.risk,
                    }))}
                  />
                </Panel>
                <Panel title="Where the risk sits" span={4}>
                  <RiskShare portfolio={portfolio} />
                </Panel>
                <Panel title="Compare line-ups" span={12} note="each one carries its own code">
                  <CompareLineups
                    pool={pool}
                    strategy={strategy}
                    candidates={candidates}
                    onAdd={addCandidate}
                    onRemove={removeCandidate}
                    running={comparing}
                    error={compareError}
                  />
                </Panel>
              </>
            )}

            <Panel title="What this does not know" span={12}>
              <ul className={styles.caveatList}>
                <li>
                  Projections are a stated heuristic over recent scoring, fixture difficulty, and
                  how reliably a player starts. They are not a forecast of one match.
                </li>
                <li>
                  Prices are held at today&apos;s. A rise the plan cannot see makes a later transfer
                  dearer than it looks here.
                </li>
                <li>
                  The band treats gameweeks, and the eleven inside one, as independent draws. Two
                  players at one club share a clean sheet, so the real spread is wider than the one
                  drawn.
                </li>
                <li>
                  An injury, a rotation, or a manager changing his mind resets everything after it,
                  which is why a plan is worth remaking each week rather than following to the
                  letter.
                </li>
              </ul>
            </Panel>
          </>
        )}
      </div>

      <MiniPitch players={miniSquad} watch={pitchRef} label="The eleven this gameweek" />
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
  pitchRef,
  freeHand,
}: {
  week: WeekPlan;
  index: number;
  byCode: Map<number, PlannerPlayer>;
  clubByCode: Map<number, PlannerClub>;
  pitchRef: RefObject<HTMLDivElement | null>;
  /** The best moves available this week with nothing in the way. */
  freeHand: readonly { out: number; in: number; gain: number; cost: number }[];
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

      <div className={styles.pitch} ref={pitchRef}>
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

      {/* Two answers to two different questions, printed side by side. What the
          plan does is constrained by the squad it arrived with, the transfers it
          banked, and what a hit costs. What was available is none of those: it
          is the best legal move from this squad in this gameweek, which is what
          a reader who disagrees with the plan actually wants to see. */}
      <div className={styles.ledger}>
        <h3 className={styles.ledgerHead}>What was available, with a free hand</h3>
        {freeHand.length === 0 ? (
          <p className={styles.ledgerNone}>
            Nothing in the pool improves this squad over the rest of the horizon, so holding is not
            the plan being cautious: it is the whole market having nothing to offer.
          </p>
        ) : (
          <>
            <ul className={styles.ledgerList}>
              {freeHand.map((swap) => {
                const out = byCode.get(swap.out);
                const incoming = byCode.get(swap.in);
                const taken =
                  week.transfersIn.includes(swap.in) && week.transfersOut.includes(swap.out);
                return (
                  <li
                    key={`${String(swap.out)}-${String(swap.in)}`}
                    className={styles.ledgerRow}
                    data-taken={taken ? 'true' : undefined}
                  >
                    <span className={styles.ledgerOut}>{out?.name ?? swap.out}</span>
                    <span className={styles.ledgerArrow} aria-hidden="true">
                      &rarr;
                    </span>
                    <span className={styles.ledgerIn}>{incoming?.name ?? swap.in}</span>
                    <span className={classes(styles.ledgerDelta, 'num')}>
                      {swap.gain > 0 ? '+' : ''}
                      {swap.gain.toFixed(1)} pts
                      {taken ? ' · taken' : ''}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className={styles.ledgerNote}>
              Measured over the rest of the horizon rather than this gameweek, since a player bought
              now is still owned in five weeks. Legal and affordable from this squad, but ignoring
              the free transfer and the four point hit: that is the gap between what is possible and
              what is worth doing.
            </p>
          </>
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

/**
 * Ink line-work on a pitch seen from behind a goal, which is the orientation the
 * eleven are laid out in: a keeper at the bottom and forwards at the top. The
 * line-work used to be drawn side on, with the goals left and right, which put
 * the penalty areas beside the squad rather than behind it. It is also the shape
 * a phone is, so the same drawing works on both.
 */
function PitchLines() {
  return (
    <svg
      className={styles.pitchLines}
      viewBox="0 0 680 1050"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <g fill="none" stroke="currentColor" strokeWidth="3">
        <rect x="8" y="8" width="664" height="1034" />
        <line x1="8" y1="525" x2="672" y2="525" />
        <circle cx="340" cy="525" r="91" />
        <rect x="139" y="8" width="402" height="165" />
        <rect x="248" y="8" width="184" height="55" />
        <rect x="139" y="877" width="402" height="165" />
        <rect x="248" y="987" width="184" height="55" />
      </g>
      <g fill="currentColor">
        <circle cx="340" cy="525" r="5" />
        <circle cx="340" cy="118" r="5" />
        <circle cx="340" cy="932" r="5" />
      </g>
    </svg>
  );
}
