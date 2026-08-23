'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  INITIAL_BUDGET,
  POSITIONS,
  SQUAD_QUOTA,
  SQUAD_SIZE,
  formatPrice,
  type Availability,
  type PlayerId,
  type Position,
  type TeamId,
} from '@fpl/core';
import {
  autoPick,
  bestStartingEleven,
  canAdd,
  formationLabel,
  squadCost,
  suggestTransfers,
  validateSquad,
  type SquadPlayer,
} from '@fpl/analytics';
import { shirtUrl } from '@fpl/assets/urls';
import { classes } from '@/lib/classes';
import { MiniPitch, type MiniPlayer } from './mini-pitch';
import {
  StrategyCodeError,
  decodeStrategy,
  encodeStrategy,
  type Chip,
  type LockMode,
  type Objective,
  type Strategy,
} from '@fpl/planner';
import { send } from '@/lib/planner/client';
import type { SolvedStrategy } from '@/lib/planner/protocol';
import type { PlannerPool } from '@/lib/planner/projections';
import { HorizonForecast, type ForecastWeek } from './horizon-forecast';
import { MetricTip } from './metric-tip';
import { PersonPhoto } from './person-photo';
import styles from './squad-builder.module.css';

/**
 * The squad on a printed pitch: the tactics plan from a matchday programme,
 * drawn in ink on flat green and seen from behind a goal, with each player a
 * club shirt pinned above a paper name tag. The tag is where the numbers go,
 * because a figure printed on grass is a figure nobody can read.
 *
 * Every tag carries what a choice is actually made on: the price, the projection
 * the model produced, the two inputs behind it that a manager can argue with
 * (recent scoring rate and how reliably he starts), his ownership, and the next
 * three fixtures by difficulty. Nothing on it is decoration.
 *
 * Every rule is enforced by the same engine the server uses (@fpl/analytics), so
 * the builder cannot disagree with the platform about whether a squad is legal.
 */

export interface BuilderPlayer extends SquadPlayer {
  code: number;
  totalPoints: number;
  form: number;
  ownership: number;
  minutes: number;
  availability: Availability;
  news: string;
  /** Projected points per gameweek, computed on the server. */
  projected: number;
  /** Why the projection landed where it did, in words. */
  why: string[];
  /** Share of recent gameweeks the player finished, as a percentage. */
  starterReliability: number;
  /** Points per ninety over the form window: the rate behind the projection. */
  pointsPer90: number;
  /** The next three fixtures, as the ticker on the tag prints them. */
  next: { gameweek: number; opponent: number; home: boolean; difficulty: number }[];
  /** Gameweeks in that runway with no fixture at all. */
  blanks: number[];
}

export interface BuilderTeam {
  id: TeamId;
  code: number;
  name: string;
  shortName: string;
}

type SortKey = 'projected' | 'points' | 'price' | 'form' | 'ownership' | 'value';

/** Every chip, since the search can now decide the week for all four. */
const ALL_CHIPS: { chip: Chip; label: string }[] = [
  { chip: 'wildcard', label: 'Wildcard' },
  { chip: 'free_hit', label: 'Free hit' },
  { chip: 'bench_boost', label: 'Bench boost' },
  { chip: 'triple_captain', label: 'Triple captain' },
];

const SORTS: { key: SortKey; label: string; metric: string }[] = [
  { key: 'projected', label: 'Projected', metric: 'projection' },
  { key: 'points', label: 'Points', metric: 'points' },
  { key: 'form', label: 'Form', metric: 'form' },
  { key: 'value', label: 'Value', metric: 'ppm' },
  { key: 'price', label: 'Price', metric: 'price' },
  { key: 'ownership', label: 'Owned', metric: 'ownership' },
];

const STORAGE_KEY = 'fpl-lake.squad.v1';

const positionLabel: Record<Position, string> = {
  GKP: 'Goalkeepers',
  DEF: 'Defenders',
  MID: 'Midfielders',
  FWD: 'Forwards',
};

const sortValue = (row: BuilderPlayer, key: SortKey): number => {
  switch (key) {
    case 'projected':
      return row.projected;
    case 'points':
      return row.totalPoints;
    case 'form':
      return row.form;
    case 'price':
      return row.price;
    case 'ownership':
      return row.ownership;
    case 'value':
      return row.totalPoints / Math.max(row.price / 10, 0.1);
  }
};

/**
 * The horizons a manager actually plans over. A squad that is best for one
 * gameweek is rarely the squad that is best for ten, because a run of easy
 * fixtures and a blank gameweek only exist over a horizon.
 */
const GOALS = [
  { key: 'week', label: 'This week', weeks: 1, note: 'One gameweek. Form and the fixture decide.' },
  {
    key: 'month',
    label: 'A month',
    weeks: 4,
    note: 'Four gameweeks. A fixture run starts to tell.',
  },
  { key: 'two', label: 'Two months', weeks: 8, note: 'Eight gameweeks. Blanks and doubles land.' },
  { key: 'half', label: 'Half a season', weeks: 19, note: 'Nineteen. The whole first half.' },
  { key: 'season', label: 'The season', weeks: 38, note: 'Everything left to play.' },
];

/** The pool is posted once per tab and kept in the worker under this. */
const POOL_GENERATION = 2;

export function SquadBuilder({
  players,
  teams,
  gameweek,
  lockedGameweek,
  deadline,
  horizon,
  pool,
}: {
  players: readonly BuilderPlayer[];
  teams: readonly BuilderTeam[];
  gameweek: number;
  /** The gameweek in progress, past its deadline: never part of a search. */
  lockedGameweek: number | null;
  /**
   * Already formatted, on the server. Formatting an instant here instead would
   * hydrate differently from the HTML it replaces: Node and the browser ship
   * different ICU builds and print "Fri, 21 Aug" against "Fri 21 Aug", which
   * fails hydration and makes React rebuild the whole page.
   */
  deadline: string | null;
  horizon: number;
  pool: PlannerPool;
}) {
  const [picks, setPicks] = useState<PlayerId[]>([]);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState<Position | 'ALL'>('ALL');
  const [club, setClub] = useState<'ALL' | number>('ALL');
  /**
   * The dearest and cheapest players in the pool, which is where the price
   * filter's ends belong. Hardcoding 150 put the top of the slider below
   * Haaland at 155, so the highest setting still hid the most expensive player
   * in the game: a filter's upper bound has to be unreachable, or it is a
   * filter nobody knows is filtering.
   */
  const priceRange = useMemo(() => {
    const prices = players.map((player) => player.price);
    return {
      floor: prices.length === 0 ? 38 : Math.min(...prices),
      ceiling: prices.length === 0 ? 155 : Math.max(...prices),
    };
  }, [players]);
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  const priceCap = maxPrice ?? priceRange.ceiling;
  const [sort, setSort] = useState<SortKey>('projected');
  /**
   * The rest of the filters.
   *
   * A list of six hundred names is not a list anybody reads: it is a list they
   * scroll past. Every filter here answers a question a manager actually asks
   * while picking, and each one is a floor rather than a range, because "at
   * least this much" is how the questions are phrased ("who starts", "who is
   * fit", "who is under ten percent owned").
   */
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [minMinutes, setMinMinutes] = useState(0);
  const [minStarts, setMinStarts] = useState(0);
  const [maxOwnership, setMaxOwnership] = useState(100);
  const [minPoints, setMinPoints] = useState(0);
  const [minPer90, setMinPer90] = useState(0);
  const [hasFixture, setHasFixture] = useState(false);
  const [maxDifficulty, setMaxDifficulty] = useState(5);
  /** The player picked up, by pointer or by keyboard. */
  const [holding, setHolding] = useState<PlayerId | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const [goalKey, setGoalKey] = useState('two');
  /**
   * Which players are fixed, and for how long.
   *
   * Two different questions, and a single checkbox answered neither: "I own
   * him today, is he worth keeping?" fixes a player in the opening fifteen and
   * lets the plan sell him later, while "I am keeping him" fixes him for the
   * whole period. A player with no entry here is free.
   */
  const [locks, setLocks] = useState<Record<number, LockMode>>({});

  /**
   * Players the search may not pick.
   *
   * The mirror of a lock, and needed for the same reason: a manager's view is
   * not only "keep him", it is also "not him, whatever the numbers say". The
   * same two modes, because the same two questions apply: out of the opening
   * fifteen, or out for the whole horizon.
   */
  const [bans, setBans] = useState<Record<number, LockMode>>({});

  /**
   * The whole question the search is asked, in one place.
   *
   * This page decides; the plan page explains. Every setting therefore lives
   * here and travels in the code, so a strategy is reproducible from the code
   * alone and the explanation cannot be of a different question from the one
   * that was asked.
   */
  const [budget, setBudget] = useState(INITIAL_BUDGET);
  const [freeTransfers, setFreeTransfers] = useState(1);
  const [maxTransfers, setMaxTransfers] = useState(2);
  const [risk, setRisk] = useState(0);
  const [objective, setObjective] = useState<Objective>('mean');
  const [chips, setChips] = useState<Chip[]>([]);
  /** The pitch itself, so the corner panel knows when it has left the screen. */
  const pitchRef = useRef<HTMLDivElement>(null);
  const [searching, setSearching] = useState(false);
  const [found, setFound] = useState<
    (SolvedStrategy & { seconds: number; weeks: number; code: string; stale: boolean }) | null
  >(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [pasted, setPasted] = useState('');
  const [week, setWeek] = useState<number | null>(null);
  const liveRegion = useRef<HTMLParagraphElement>(null);

  const byId = useMemo(() => new Map(players.map((player) => [player.id, player])), [players]);
  const teamById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const teamName = useCallback(
    (id: TeamId): string => teamById.get(id)?.name ?? `club ${String(id)}`,
    [teamById],
  );

  // A squad in progress survives a refresh: this is a page people leave open
  // for an hour while they argue with themselves about a midfielder.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored !== null) {
        const parsed: unknown = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const ids = parsed.filter((id): id is number => typeof id === 'number');
          setPicks(ids.filter((id) => byId.has(id as PlayerId)) as PlayerId[]);
        }
      }
    } catch {
      // A corrupt or blocked store is not worth a broken page.
    }
    setRestored(true);
  }, [byId]);

  useEffect(() => {
    if (!restored) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(picks));
    } catch {
      // Private browsing refuses writes; the squad still works in memory.
    }
  }, [picks, restored]);

  const state = useMemo(() => ({ picks, budget: INITIAL_BUDGET }), [picks]);
  const cost = useMemo(() => squadCost(state, players), [state, players]);
  const issues = useMemo(() => validateSquad(state, players, teamName), [state, players, teamName]);

  const projection = useCallback(
    (player: SquadPlayer): number => byId.get(player.id)?.projected ?? 0,
    [byId],
  );

  const eleven = useMemo(
    () => bestStartingEleven(picks, players, projection),
    [picks, players, projection],
  );

  const transfers = useMemo(
    () => (picks.length === SQUAD_SIZE ? suggestTransfers(state, players, projection, 4) : []),
    [picks.length, state, players, projection],
  );

  const say = useCallback((text: string) => {
    setMessage(text);
  }, []);

  const add = useCallback(
    (id: PlayerId) => {
      const candidate = byId.get(id);
      if (candidate === undefined) return;
      const check = canAdd({ picks, budget: INITIAL_BUDGET }, candidate, players);
      if (!check.ok) {
        say(check.reason);
        return;
      }
      setPicks((current) => [...current, id]);
      say(`${candidate.webName} added. ${formatPrice(cost.remaining - candidate.price)} left.`);
      setHolding(null);
    },
    [byId, picks, players, cost.remaining, say],
  );

  const remove = useCallback(
    (id: PlayerId) => {
      const player = byId.get(id);
      setPicks((current) => current.filter((entry) => entry !== id));
      if (player !== undefined) say(`${player.webName} removed.`);
    },
    [byId, say],
  );

  const filled = useMemo(() => {
    const bySlot: Record<Position, BuilderPlayer[]> = { GKP: [], DEF: [], MID: [], FWD: [] };
    for (const id of picks) {
      const player = byId.get(id);
      if (player !== undefined) bySlot[player.position].push(player);
    }
    return bySlot;
  }, [picks, byId]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return players
      .filter((player) => {
        if (position !== 'ALL' && player.position !== position) return false;
        if (club !== 'ALL' && player.teamId !== club) return false;
        if (player.price > priceCap) return false;
        if (onlyAvailable && player.availability !== 'available') return false;
        if (player.minutes < minMinutes) return false;
        if (player.starterReliability < minStarts) return false;
        if (player.ownership > maxOwnership) return false;
        if (player.totalPoints < minPoints) return false;
        if (player.pointsPer90 < minPer90) return false;
        // A player whose club blanks in the next three has no fixture to be
        // picked for, which is a different objection from being out of form.
        if (hasFixture && player.next.length === 0) return false;
        if (
          maxDifficulty < 5 &&
          player.next.length > 0 &&
          Math.min(...player.next.map((fixture) => fixture.difficulty)) > maxDifficulty
        ) {
          return false;
        }
        if (needle === '') return true;
        const clubName = teamById.get(player.teamId)?.name.toLowerCase() ?? '';
        return player.webName.toLowerCase().includes(needle) || clubName.includes(needle);
      })
      .sort((a, b) =>
        sort === 'price' ? a.price - b.price : sortValue(b, sort) - sortValue(a, sort),
      )
      .slice(0, 120);
  }, [
    players,
    position,
    club,
    priceCap,
    query,
    sort,
    teamById,
    onlyAvailable,
    minMinutes,
    minStarts,
    maxOwnership,
    minPoints,
    minPer90,
    hasFixture,
    maxDifficulty,
  ]);

  const filtersOn =
    onlyAvailable ||
    minMinutes > 0 ||
    minStarts > 0 ||
    maxOwnership < 100 ||
    minPoints > 0 ||
    minPer90 > 0 ||
    hasFixture ||
    maxDifficulty < 5 ||
    priceCap < priceRange.ceiling;

  const clearFilters = useCallback(() => {
    setOnlyAvailable(false);
    setMinMinutes(0);
    setMinStarts(0);
    setMaxOwnership(100);
    setMinPoints(0);
    setMinPer90(0);
    setHasFixture(false);
    setMaxDifficulty(5);
    setMaxPrice(null);
  }, []);

  const autoFill = useCallback(() => {
    const complete = autoPick(players, projection, { keep: picks, budget: INITIAL_BUDGET });
    setPicks(complete);
    say(`Squad completed to ${String(complete.length)} players, keeping your picks.`);
  }, [players, projection, picks, say]);

  const clear = useCallback(() => {
    setPicks([]);
    setFound(null);
    say('Squad cleared.');
  }, [say]);

  const goal = GOALS.find((entry) => entry.key === goalKey) ?? GOALS[2];
  const weeks = Math.min(goal?.weeks ?? 8, pool.gameweeks.length);
  const idByCode = useMemo(
    () => new Map(players.map((player) => [player.code, player.id])),
    [players],
  );
  const codeById = useMemo(
    () => new Map(players.map((player) => [player.id, player.code])),
    [players],
  );

  /**
   * Solve a strategy: the best fifteen over the horizon, and the plan that
   * carries it there.
   *
   * The reader's own picks are kept only when they ask, because the whole point
   * of the search is that the best fifteen is rarely the one a ranking would
   * have assembled, and locking a slot is a claim they should make deliberately.
   */
  const solve = useCallback(
    (strategy: Strategy) => {
      setSearching(true);
      setSearchError(null);
      say('Searching for the best squad.');

      send({
        kind: 'strategy',
        poolGeneration: POOL_GENERATION,
        players: pool.players,
        matches: pool.matches,
        gameweeks: pool.gameweeks,
        budget: strategy.budget,
        horizon: strategy.endGameweek - strategy.startGameweek + 1,
        startGameweek: strategy.startGameweek,
        riskAversion: strategy.riskAversion,
        freeTransfers: strategy.freeTransfers,
        maxTransfersPerWeek: strategy.maxTransfersPerWeek,
        chips: strategy.chips,
        locks: strategy.locks,
        bans: strategy.bans,
        seed: strategy.seed,
      })
        .then((reply) => {
          const result = reply.strategy;
          if (result === undefined) throw new Error('the search returned nothing');

          // The code is minted from the fingerprint the worker actually solved
          // against, not the one the reader pasted, so a code copied from this
          // page always describes the data that produced it. A pasted code
          // whose fingerprint no longer matches is reported rather than hidden.
          const solvedFor: Strategy = { ...strategy, fingerprint: result.fingerprint };
          setFound({
            ...result,
            seconds: reply.elapsed / 1000,
            weeks: strategy.endGameweek - strategy.startGameweek + 1,
            code: encodeStrategy(solvedFor),
            stale: strategy.fingerprint !== '' && strategy.fingerprint !== result.fingerprint,
          });
          setWeek(null);
          setPicks(
            result.optimisation.picks.flatMap((code) => {
              const id = idByCode.get(code);
              return id === undefined ? [] : [id];
            }),
          );
          say(
            `Search finished. ${result.optimisation.points.toFixed(1)} points over ${String(strategy.endGameweek - strategy.startGameweek + 1)} gameweeks, ${(result.optimisation.points - result.optimisation.baseline).toFixed(1)} more than the ranking.`,
          );
        })
        .catch((error: unknown) => {
          setSearchError(error instanceof Error ? error.message : 'the search failed');
        })
        .finally(() => {
          setSearching(false);
        });
    },
    [pool.players, pool.matches, pool.gameweeks, idByCode, say],
  );

  /** The locks as the search takes them, only for players actually in the squad. */
  const lockList = useMemo(
    () =>
      picks.flatMap((id) => {
        const mode = locks[Number(id)];
        const code = codeById.get(id);
        return mode === undefined || code === undefined ? [] : [{ code, mode }];
      }),
    [picks, locks, codeById],
  );

  const banList = useMemo(
    () =>
      Object.entries(bans).flatMap(([id, mode]) => {
        const code = codeById.get(Number(id) as PlayerId);
        return code === undefined ? [] : [{ code, mode }];
      }),
    [bans, codeById],
  );

  const cycleBan = useCallback((id: PlayerId) => {
    setBans((current) => {
      const mode = current[Number(id)];
      const next = Object.fromEntries(
        Object.entries(current).filter(([key]) => key !== String(id)),
      ) as Record<number, LockMode>;
      if (mode === undefined) next[Number(id)] = 'start';
      else if (mode === 'start') next[Number(id)] = 'always';
      return next;
    });
  }, []);

  const lockCounts = useMemo(
    () => ({
      start: lockList.filter((lock) => lock.mode === 'start').length,
      always: lockList.filter((lock) => lock.mode === 'always').length,
    }),
    [lockList],
  );

  /** Cycle one player: free, then held at the start, then held throughout. */
  const cycleLock = useCallback((id: PlayerId) => {
    setLocks((current) => {
      const mode = current[Number(id)];
      const next = Object.fromEntries(
        Object.entries(current).filter(([key]) => key !== String(id)),
      ) as Record<number, LockMode>;
      if (mode === undefined) next[Number(id)] = 'start';
      else if (mode === 'start') next[Number(id)] = 'always';
      return next;
    });
  }, []);

  /** Set every player currently in the squad at once. */
  const lockAll = useCallback(
    (mode: LockMode | null) => {
      setLocks(() => {
        if (mode === null) return {};
        const next: Record<number, LockMode> = {};
        for (const id of picks) next[Number(id)] = mode;
        return next;
      });
    },
    [picks],
  );

  const optimise = useCallback(() => {
    solve({
      version: 2,
      startGameweek: gameweek,
      endGameweek: gameweek + weeks - 1,
      budget,
      riskAversion: risk,
      objective,
      freeTransfers,
      maxTransfersPerWeek: maxTransfers,
      chips,
      squad: [],
      locks: lockList,
      bans: banList,
      seed: 7,
      fingerprint: '',
    });
  }, [
    solve,
    gameweek,
    weeks,
    lockList,
    budget,
    risk,
    objective,
    freeTransfers,
    maxTransfers,
    chips,
  ]);

  /**
   * The plan as the forecast reads it: one row per gameweek, with the names the
   * transfers move and whether the squad blanks or doubles that week. Blank and
   * double are asked of this squad rather than of the league, because a blank
   * nobody in the fifteen is playing through is not this squad's blank.
   */
  const nameByCode = useMemo(
    () => new Map(pool.players.map((player) => [player.code, player.name])),
    [pool.players],
  );
  const forecastWeeks: ForecastWeek[] = useMemo(() => {
    if (found === null) return [];
    const calendar = new Map(pool.calendar.map((entry) => [entry.gameweek, entry]));
    const clubOf = new Map(pool.players.map((player) => [player.code, player.teamCode]));
    const named = (codes: readonly number[]): string[] =>
      codes.map((code) => nameByCode.get(code) ?? `player ${String(code)}`);

    return found.plan.weeks.map((entry, index) => {
      const clubs = new Set(entry.picks.map((code) => clubOf.get(code) ?? 0));
      const marks = calendar.get(entry.gameweek);
      return {
        gameweek: entry.gameweek,
        expectedPoints: entry.expectedPoints,
        spread: found.spreads[index] ?? 0,
        squadValue: entry.squadValue,
        bank: entry.bank,
        transfersIn: named(entry.transfersIn),
        transfersOut: named(entry.transfersOut),
        hit: entry.hit,
        chip: entry.chip,
        captain: entry.captain === null ? null : (nameByCode.get(entry.captain) ?? null),
        blank: (marks?.blanks ?? []).some((code) => clubs.has(code)),
        double: (marks?.doubles ?? []).some((code) => clubs.has(code)),
      } satisfies ForecastWeek;
    });
  }, [found, pool.calendar, pool.players, nameByCode]);

  /**
   * Scrubbing to a gameweek puts that week's fifteen on the pitch. It sets the
   * squad rather than only the drawing, so the budget, the legality check, and
   * the eleven all describe the week being looked at instead of one of them
   * describing a different week.
   */
  const selectWeek = useCallback(
    (gameweek: number | null) => {
      setWeek(gameweek);
      if (gameweek === null || found === null) return;
      const entry = found.plan.weeks.find((row) => row.gameweek === gameweek);
      if (entry === undefined) return;
      setPicks(
        entry.picks.flatMap((code) => {
          const id = idByCode.get(code);
          return id === undefined ? [] : [id];
        }),
      );
      say(`Gameweek ${String(gameweek)} on the pitch.`);
    },
    [found, idByCode, say],
  );

  /** Read a code someone pasted and run it, or say exactly what is wrong with it. */
  const runPasted = useCallback(() => {
    try {
      const strategy = decodeStrategy(pasted);
      const span = strategy.endGameweek - strategy.startGameweek + 1;
      setGoalKey(
        GOALS.find((entry) => entry.weeks === span)?.key ?? GOALS[GOALS.length - 1]?.key ?? 'two',
      );
      // A code carries its constraints, so pasting one adopts them: the reader
      // sees which players the answer was told to hold.
      setLocks(
        Object.fromEntries(
          strategy.locks.flatMap((lock) => {
            const id = idByCode.get(lock.code);
            return id === undefined ? [] : [[Number(id), lock.mode] as const];
          }),
        ),
      );
      // A code is the whole question, so pasting one adopts the whole
      // configuration: anything less would solve a different strategy under
      // someone else's code.
      setBudget(strategy.budget);
      setRisk(strategy.riskAversion);
      setObjective(strategy.objective);
      setFreeTransfers(strategy.freeTransfers);
      setMaxTransfers(strategy.maxTransfersPerWeek);
      setChips(strategy.chips);
      solve(strategy);
    } catch (error: unknown) {
      setSearchError(
        error instanceof StrategyCodeError
          ? error.message
          : 'that code could not be read, so nothing was changed',
      );
    }
  }, [pasted, solve, idByCode]);

  const spentShare = Math.min(100, (cost.spent / cost.budget) * 100);
  const starters = new Set(eleven.starters);

  /** The eleven as the corner panel draws it: position, club, captain. */
  const miniSquad: MiniPlayer[] = picks.flatMap((id) => {
    const player = byId.get(id);
    if (player === undefined) return [];
    return [
      {
        code: player.code,
        position: player.position,
        teamCode: teamById.get(player.teamId)?.code ?? 0,
        name: player.webName,
        starter: starters.has(player.id),
        captain: player.id === eleven.captain,
      },
    ];
  });

  return (
    <div className={`shell ${styles.page}`}>
      <header className={styles.masthead}>
        <p className={styles.eyebrow}>
          Gameweek {gameweek}
          {deadline !== null && <> · deadline {deadline}</>}
          {/* A squad chosen now cannot play in a week whose deadline has gone,
              so the page says which week it is actually building for. */}
          {lockedGameweek !== null && <> · GW {lockedGameweek} is locked</>}
        </p>
        <h1 className={styles.title}>Team sheet</h1>
        <p className={styles.standfirst}>
          Fifteen players, {formatPrice(INITIAL_BUDGET)}, no more than three from one club. Press a
          name to add them, or drag it onto a slot. Press a name in the squad to take them out.
          Every column is defined: follow the mark beside it.
        </p>
      </header>

      <div className={styles.layout}>
        <section className={styles.sheet} aria-labelledby="sheet">
          <h2 id="sheet" className="visually-hidden">
            Your squad
          </h2>

          <div className={styles.meters}>
            <div className={styles.budget}>
              <div className={styles.budgetHead}>
                <MetricTip id="budget">Budget</MetricTip>
                <p className="num">
                  <strong className={cost.remaining < 0 ? styles.over : undefined}>
                    {formatPrice(cost.remaining)}
                  </strong>{' '}
                  <span className={styles.of}>left of {formatPrice(cost.budget)}</span>
                </p>
              </div>
              <div
                className={styles.gauge}
                role="meter"
                aria-valuemin={0}
                aria-valuemax={cost.budget / 10}
                aria-valuenow={cost.spent / 10}
                aria-label="Budget spent"
              >
                <span
                  className={styles.gaugeFill}
                  data-over={cost.remaining < 0 ? 'true' : undefined}
                  style={{ inlineSize: `${String(spentShare)}%` }}
                />
              </div>
            </div>

            <dl className={styles.quotas}>
              {POSITIONS.map((slot) => (
                <div
                  key={slot}
                  className={styles.quota}
                  data-full={filled[slot].length === SQUAD_QUOTA[slot] ? 'true' : undefined}
                >
                  <dt>{slot}</dt>
                  <dd className="num">
                    {filled[slot].length}/{SQUAD_QUOTA[slot]}
                  </dd>
                </div>
              ))}
              <div className={styles.quota}>
                <dt>Squad</dt>
                <dd className="num">
                  {picks.length}/{SQUAD_SIZE}
                </dd>
              </div>
            </dl>
          </div>

          {holding !== null && (
            <p className={styles.holding}>
              Dragging <strong>{byId.get(holding)?.webName}</strong>. Drop them on a slot, or{' '}
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => {
                  setHolding(null);
                }}
              >
                cancel
              </button>
              .
            </p>
          )}

          <div className={styles.pitch} ref={pitchRef}>
            <PitchLines />
            {POSITIONS.map((slot) => (
              <section key={slot} className={styles.line} aria-labelledby={`line-${slot}`}>
                <h3 id={`line-${slot}`} className={styles.lineHead}>
                  <span className={styles.stamp}>{slot}</span>
                  {positionLabel[slot]}
                  <span className={classes(styles.lineCount, 'num')}>
                    {filled[slot].length}/{SQUAD_QUOTA[slot]}
                  </span>
                </h3>

                <ul className={styles.slots}>
                  {Array.from({ length: SQUAD_QUOTA[slot] }, (_, index) => {
                    const player = filled[slot][index];
                    return (
                      <Slot
                        key={`${slot}-${String(index)}`}
                        slot={slot}
                        player={player}
                        isStarter={player !== undefined && starters.has(player.id)}
                        isCaptain={player?.id === eleven.captain}
                        club={player === undefined ? undefined : teamById.get(player.teamId)}
                        holding={holding}
                        lock={player === undefined ? undefined : locks[Number(player.id)]}
                        onDropPlayer={add}
                        onRemove={remove}
                        onCycleLock={cycleLock}
                      />
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>

          <ul className={styles.tokenKey}>
            <li>
              Each tag reads <b>price</b>, the <b>projection</b>, <b>points per ninety</b>, the{' '}
              <b>share of recent gameweeks finished</b>, and <b>ownership</b>.
            </li>
            <li>
              The three bars are the next three fixtures, coloured by difficulty. Fewer than three
              means a blank gameweek.
            </li>
          </ul>

          <section className={styles.readout} aria-labelledby="readout">
            <h3 id="readout" className={styles.readoutHead}>
              Where this squad stands
            </h3>

            {issues.length === 0 ? (
              <p className={styles.legal}>
                Legal squad. Best eleven is {formationLabel(eleven.formation)} for{' '}
                <strong className="num">{eleven.projectedPoints.toFixed(1)}</strong>{' '}
                <MetricTip id="projection">projected points</MetricTip> next gameweek, captaining{' '}
                <strong>{byId.get(eleven.captain ?? (0 as PlayerId))?.webName ?? 'nobody'}</strong>.
              </p>
            ) : (
              <ul className={styles.issues}>
                {issues.map((issue, index) => (
                  <li key={`${issue.code}-${String(index)}`}>{issue.message}</li>
                ))}
              </ul>
            )}

            {transfers.length > 0 && (
              <div className={styles.transfers}>
                <h4 className={styles.transfersHead}>Swaps that raise the projection</h4>
                <ul>
                  {transfers.map((swap) => {
                    const out = byId.get(swap.out);
                    const incoming = byId.get(swap.in);
                    if (out === undefined || incoming === undefined) return null;
                    return (
                      <li key={`${String(swap.out)}-${String(swap.in)}`}>
                        <button
                          type="button"
                          className={styles.swap}
                          onClick={() => {
                            setPicks((current) => [
                              ...current.filter((id) => id !== swap.out),
                              swap.in,
                            ]);
                            say(`${out.webName} out, ${incoming.webName} in.`);
                          }}
                        >
                          <span>
                            {out.webName} → {incoming.webName}
                          </span>
                          <span className="num">
                            +{swap.gain.toFixed(1)} pts
                            {swap.freed !== 0 && (
                              <>
                                {' '}
                                · {swap.freed > 0 ? 'frees' : 'costs'}{' '}
                                {formatPrice(Math.abs(swap.freed))}
                              </>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <div className={styles.actions}>
              <button type="button" className={styles.secondary} onClick={autoFill}>
                Complete by ranking
              </button>
              <button type="button" className={styles.secondary} onClick={clear}>
                Clear
              </button>
            </div>
          </section>

          <section className={styles.solver} aria-labelledby="solver">
            <h3 id="solver" className={styles.readoutHead}>
              Search for the best squad
            </h3>
            <p className={styles.solverIntro}>
              Fifteen players out of {players.length} is a number of squads with thirty digits in
              it, so this does not try them all. It starts from the ranking, takes the best transfer
              it can find, then the best pair once no single transfer helps, and repeats until
              nothing improves. Then it disturbs the squad and climbs again, forty times over. Every
              squad it scores is legal, and it is scored by solving its own best eleven in every
              gameweek of the period.
            </p>

            <fieldset className={styles.solverField}>
              <legend className={styles.solverLegend}>Best over</legend>
              {/* Buttons rather than radios, so aria-pressed is what carries the
                  selection to a screen reader. */}
              <div className={styles.solverChoices}>
                {GOALS.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    className={styles.solverChoice}
                    aria-pressed={entry.key === goalKey}
                    data-on={entry.key === goalKey ? 'true' : undefined}
                    onClick={() => {
                      setGoalKey(entry.key);
                    }}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
              <p className={styles.solverNote}>
                {goal?.note}{' '}
                {weeks < (goal?.weeks ?? 0) && `Only ${String(weeks)} gameweeks are left.`}
              </p>
            </fieldset>

            {/* Everything the search is asked, in one place. This page owns
                the question and the plan page explains the answer, so a
                setting that lived on the other page would be a second question
                nobody encoded. All of it travels in the code. */}
            <fieldset className={styles.config}>
              <legend className={styles.solverLabel}>Money and transfers</legend>
              <div className={styles.configGrid}>
                <label className={styles.field}>
                  <span>Budget {formatPrice(budget)}</span>
                  <input
                    type="range"
                    min={800}
                    max={1200}
                    step={1}
                    value={budget}
                    onChange={(event) => {
                      setBudget(Number(event.target.value));
                    }}
                  />
                </label>

                <label className={styles.field}>
                  <span>Free transfers held</span>
                  <select
                    value={freeTransfers}
                    onChange={(event) => {
                      setFreeTransfers(Number(event.target.value));
                    }}
                  >
                    {[1, 2, 3, 4, 5].map((count) => (
                      <option key={count} value={count}>
                        {count}
                      </option>
                    ))}
                  </select>
                </label>

                <label className={styles.field}>
                  <span>Transfers a week</span>
                  <select
                    value={maxTransfers}
                    onChange={(event) => {
                      setMaxTransfers(Number(event.target.value));
                    }}
                  >
                    {[1, 2, 3].map((count) => (
                      <option key={count} value={count}>
                        {count}
                        {count > 1 ? ' (hits allowed)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </fieldset>

            <fieldset className={styles.config}>
              <legend className={styles.solverLabel}>Risk</legend>
              <div className={styles.lockButtons} role="group">
                <button
                  type="button"
                  className={objective === 'sharpe' ? styles.goalOn : styles.goal}
                  onClick={() => {
                    setObjective('sharpe');
                  }}
                >
                  Find the optimum
                </button>
                <button
                  type="button"
                  className={objective === 'mean' ? styles.goalOn : styles.goal}
                  onClick={() => {
                    setObjective('mean');
                  }}
                >
                  I will set it
                </button>
              </div>
              {objective === 'mean' ? (
                <label className={styles.field}>
                  <span>
                    Appetite {(risk / 10).toFixed(1)}{' '}
                    {risk < 0 ? '(chasing)' : risk > 0 ? '(protecting)' : '(neutral)'}
                  </span>
                  <input
                    type="range"
                    min={-20}
                    max={20}
                    step={1}
                    value={risk}
                    onChange={(event) => {
                      setRisk(Number(event.target.value));
                    }}
                  />
                </label>
              ) : (
                <p className={styles.solverNote}>
                  The search solves the tangency portfolio: the squad with the best return per unit
                  of risk, measured from the steadiest legal fifteen rather than from a riskless
                  asset, because no squad is riskless. The appetite becomes an output, and the plan
                  page prints the one it found.
                </p>
              )}
            </fieldset>

            <fieldset className={styles.config}>
              <legend className={styles.solverLabel}>Chips available</legend>
              <div className={styles.lockButtons} role="group">
                {ALL_CHIPS.map((entry) => (
                  <button
                    key={entry.chip}
                    type="button"
                    className={chips.includes(entry.chip) ? styles.goalOn : styles.goal}
                    aria-pressed={chips.includes(entry.chip)}
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
              <p className={styles.solverNote}>
                A chip you hold is a chip the search may play, and it decides the week: the wildcard
                and the free hit are searched as a rebuild of the squad that gameweek, up to eight
                transfers, and the free hit hands the old squad back the week after. Nothing is
                played unless it beats holding it to the end of the horizon.
              </p>
            </fieldset>

            {/* Fixing players is the question the search exists to answer for
                a manager who already owns a team: not "which fifteen is best"
                but "which fifteen is best given these". The two modes are two
                different questions and a single checkbox answered neither. */}
            <fieldset className={styles.locks}>
              <legend className={styles.solverLabel}>Players I am fixing</legend>
              <div className={styles.lockButtons} role="group">
                <button
                  type="button"
                  className={
                    lockCounts.start + lockCounts.always === 0 ? styles.goalOn : styles.goal
                  }
                  onClick={() => {
                    lockAll(null);
                  }}
                  disabled={picks.length === 0}
                >
                  None
                </button>
                <button
                  type="button"
                  className={
                    lockCounts.start === picks.length && picks.length > 0
                      ? styles.goalOn
                      : styles.goal
                  }
                  onClick={() => {
                    lockAll('start');
                  }}
                  disabled={picks.length === 0}
                >
                  At the start
                </button>
                <button
                  type="button"
                  className={
                    lockCounts.always === picks.length && picks.length > 0
                      ? styles.goalOn
                      : styles.goal
                  }
                  onClick={() => {
                    lockAll('always');
                  }}
                  disabled={picks.length === 0}
                >
                  Whole period
                </button>
              </div>
              <p className={styles.solverNote}>
                {picks.length === 0
                  ? 'Pick players first, then fix the ones you are keeping. Press the pin on a shirt to fix one on its own.'
                  : lockCounts.start + lockCounts.always === 0
                    ? 'Nothing is fixed, so the search is free to replace all fifteen. Press the pin on a shirt to fix one.'
                    : `${String(lockCounts.start)} held in the opening squad, ${String(lockCounts.always)} held all period. A fixed player is a constraint, never a bonus: the search reports what it beat either way.`}
              </p>
            </fieldset>

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.primary}
                onClick={optimise}
                disabled={searching}
                aria-busy={searching}
              >
                {searching ? 'Searching' : found === null ? 'Find the best squad' : 'Search again'}
              </button>
            </div>

            {searchError !== null && (
              <p className={styles.searchError} role="alert">
                {searchError}
              </p>
            )}

            {/* A code carries the question, not the answer, so pasting one runs
                the search again on today's data rather than restoring a squad
                that may no longer be affordable. */}
            <div className={styles.codeIn}>
              <label className={styles.codeLabel} htmlFor="strategy-code">
                Or run someone else&rsquo;s strategy
              </label>
              <div className={styles.codeRow}>
                <input
                  id="strategy-code"
                  className={`num ${styles.codeInput}`}
                  value={pasted}
                  placeholder="FPL1-G1-H8-…"
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(event) => {
                    setPasted(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') runPasted();
                  }}
                />
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={searching || pasted.trim() === ''}
                  onClick={runPasted}
                >
                  Run it
                </button>
              </div>
              <p className={styles.solverNote}>
                A code is the question, not the answer: the horizon, the budget, the risk, and any
                players held. Running one solves it again on today&rsquo;s prices, and says so if
                they have moved since.
              </p>
            </div>

            {found !== null && (
              <div className={styles.verdict}>
                <p className={styles.ledger}>
                  <span className={styles.was}>
                    <span className={styles.wasLabel}>By ranking</span>
                    <span className="num">{found.optimisation.baseline.toFixed(1)}</span>
                  </span>
                  <span aria-hidden="true" className={styles.arrow}>
                    →
                  </span>
                  <span className={styles.now}>
                    <span className={styles.wasLabel}>By search</span>
                    <span className="num">{found.optimisation.points.toFixed(1)}</span>
                  </span>
                  <span className={styles.gain}>
                    <span className="num">
                      +{(found.optimisation.points - found.optimisation.baseline).toFixed(1)}
                    </span>{' '}
                    pts over {found.weeks} {found.weeks === 1 ? 'gameweek' : 'gameweeks'}
                  </span>
                </p>
                <p className={styles.provenance}>
                  {found.optimisation.evaluated.toLocaleString('en-GB')} squads scored in{' '}
                  {found.seconds.toFixed(1)}s, {found.optimisation.improvements} of them better than
                  the last.{' '}
                  {found.optimisation.converged
                    ? 'It settled: no transfer and no pair of transfers improves this squad.'
                    : 'It stopped at the search limit rather than settling, so a better squad may exist.'}
                </p>

                {found.stale && (
                  <p className={styles.stale} role="status">
                    That code was solved against different data. Prices or fixtures have moved
                    since, so this is the same question answered again on today&rsquo;s numbers, not
                    the squad the code&rsquo;s author saw.
                  </p>
                )}

                <div className={styles.codeOut}>
                  <span className={styles.wasLabel}>This strategy&rsquo;s code</span>
                  <output className={`num ${styles.code}`}>{found.code}</output>
                  <button
                    type="button"
                    className={styles.secondary}
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(found.code)
                        .then(() => {
                          say('Code copied.');
                        })
                        .catch(() => {
                          say('Copying was refused. Select the code and copy it by hand.');
                        });
                    }}
                  >
                    Copy
                  </button>
                  {/* The code is the hand-off: this page decides, and the plan
                      page explains what was decided, from the same question. */}
                  <a className={styles.secondary} href={`/planner?code=${found.code}`}>
                    Explain this plan
                  </a>
                </div>
              </div>
            )}
          </section>

          {found !== null && (
            <HorizonForecast
              weeks={forecastWeeks}
              total={found.plan.total}
              spread={found.spread}
              holdTotal={found.plan.holdTotal}
              selected={week}
              onSelect={selectWeek}
            />
          )}
        </section>

        <section className={styles.panel} aria-labelledby="panel">
          <h2 id="panel" className={styles.panelHead}>
            Available players
          </h2>

          <div className={styles.filters}>
            <label className={styles.field}>
              <span>Search</span>
              <input
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
                placeholder="Name or club"
              />
            </label>

            <label className={styles.field}>
              <span>Position</span>
              <select
                value={position}
                onChange={(event) => {
                  setPosition(event.target.value as Position | 'ALL');
                }}
              >
                <option value="ALL">All</option>
                {POSITIONS.map((slot) => (
                  <option key={slot} value={slot}>
                    {slot}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.field}>
              <span>Club</span>
              <select
                value={String(club)}
                onChange={(event) => {
                  setClub(event.target.value === 'ALL' ? 'ALL' : Number(event.target.value));
                }}
              >
                <option value="ALL">All</option>
                {[...teams]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
              </select>
            </label>

            <label className={styles.field}>
              <span>
                Max <MetricTip id="price">price</MetricTip> {formatPrice(priceCap)}
                {priceCap >= priceRange.ceiling && ' (everyone)'}
              </span>
              <input
                type="range"
                min={priceRange.floor}
                max={priceRange.ceiling}
                step={1}
                value={priceCap}
                onChange={(event) => {
                  setMaxPrice(Number(event.target.value));
                }}
              />
            </label>
          </div>

          {/* The second rank of filters: fitness, minutes, reliability,
              ownership, output, and whether there is a fixture at all. Each is
              a floor, because that is how the question is asked while picking:
              "who starts", "who is fit", "who is under ten percent owned". */}
          <details className={styles.moreFilters}>
            <summary>
              More filters
              {filtersOn && <span className={styles.filterMark}> · on</span>}
            </summary>

            <div className={styles.filters}>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={onlyAvailable}
                  onChange={(event) => {
                    setOnlyAvailable(event.target.checked);
                  }}
                />
                <span>Fit only</span>
              </label>

              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={hasFixture}
                  onChange={(event) => {
                    setHasFixture(event.target.checked);
                  }}
                />
                <span>Has a fixture in the next three</span>
              </label>

              <label className={styles.field}>
                <span>Minutes at least {minMinutes}</span>
                <input
                  type="range"
                  min={0}
                  max={2500}
                  step={90}
                  value={minMinutes}
                  onChange={(event) => {
                    setMinMinutes(Number(event.target.value));
                  }}
                />
              </label>

              <label className={styles.field}>
                <span>Finishes at least {minStarts}%</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={minStarts}
                  onChange={(event) => {
                    setMinStarts(Number(event.target.value));
                  }}
                />
              </label>

              <label className={styles.field}>
                <span>Owned at most {maxOwnership}%</span>
                <input
                  type="range"
                  min={1}
                  max={100}
                  step={1}
                  value={maxOwnership}
                  onChange={(event) => {
                    setMaxOwnership(Number(event.target.value));
                  }}
                />
              </label>

              <label className={styles.field}>
                <span>Points at least {minPoints}</span>
                <input
                  type="range"
                  min={0}
                  max={250}
                  step={5}
                  value={minPoints}
                  onChange={(event) => {
                    setMinPoints(Number(event.target.value));
                  }}
                />
              </label>

              <label className={styles.field}>
                <span>Per ninety at least {minPer90.toFixed(1)}</span>
                <input
                  type="range"
                  min={0}
                  max={10}
                  step={0.5}
                  value={minPer90}
                  onChange={(event) => {
                    setMinPer90(Number(event.target.value));
                  }}
                />
              </label>

              <label className={styles.field}>
                <span>
                  Easiest of the next three at most {maxDifficulty}
                  {maxDifficulty === 5 && ' (any)'}
                </span>
                <input
                  type="range"
                  min={1}
                  max={5}
                  step={1}
                  value={maxDifficulty}
                  onChange={(event) => {
                    setMaxDifficulty(Number(event.target.value));
                  }}
                />
              </label>

              <button type="button" className={styles.secondary} onClick={clearFilters}>
                Clear filters
              </button>
            </div>
          </details>

          <div className={styles.sorts} role="group" aria-label="Sort by">
            {SORTS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={styles.sortButton}
                aria-pressed={sort === option.key}
                onClick={() => {
                  setSort(option.key);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>

          <p className={styles.count}>
            {visible.length} shown of {players.length}. Projection weighs the next {horizon}{' '}
            gameweeks.
          </p>

          <ul className={styles.list}>
            {visible.map((player) => {
              const club = teamById.get(player.teamId);
              const held = picks.includes(player.id);
              const check = canAdd({ picks, budget: INITIAL_BUDGET }, player, players);
              const blocked = !held && !check.ok;

              return (
                <li key={player.id}>
                  <div
                    className={styles.row}
                    data-held={held ? 'true' : undefined}
                    data-blocked={blocked ? 'true' : undefined}
                    draggable={!held}
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/plain', String(player.id));
                      event.dataTransfer.effectAllowed = 'copy';
                      setHolding(player.id);
                    }}
                    onDragEnd={() => {
                      setHolding(null);
                    }}
                  >
                    <button
                      type="button"
                      className={styles.rowMain}
                      onClick={() => {
                        if (held) remove(player.id);
                        else add(player.id);
                      }}
                      aria-describedby={`why-${String(player.id)}`}
                    >
                      <PersonPhoto
                        kind="player"
                        code={player.code}
                        name={player.webName}
                        size="sm"
                        className={styles.rowFace ?? ''}
                      />
                      <span className={styles.rowName}>
                        <span className={styles.rowClub}>{club?.shortName ?? '???'}</span>
                        {player.webName}
                        {player.availability !== 'available' && (
                          <span className={styles.flag}>
                            {player.availability === 'doubtful' ? 'doubt' : player.availability}
                          </span>
                        )}
                      </span>
                      <span className={classes(styles.rowStats, 'num')}>
                        <span title="Position">{player.position}</span>
                        <span title="Price">{formatPrice(player.price)}</span>
                        <strong title="Projected points, from the model">
                          {player.projected.toFixed(1)}
                        </strong>
                        <span title="Points per ninety over the form window">
                          {player.pointsPer90.toFixed(1)}
                        </span>
                        <span title="Share of recent gameweeks he finished">
                          {player.starterReliability}%
                        </span>
                        <span title="Owned by">{player.ownership.toFixed(0)}%</span>
                        <span className={styles.rowPoints} title="Points this season">
                          {player.totalPoints}
                        </span>
                        <span className={styles.rowTicker} aria-hidden="true">
                          {player.next.map((fixture) => (
                            <span
                              key={fixture.gameweek}
                              className={styles.tick}
                              data-difficulty={fixture.difficulty}
                            />
                          ))}
                        </span>
                      </span>
                    </button>
                    {/* "Not him" is a judgement made while reading the list, so
                        the control belongs on the row rather than in a settings
                        panel three sections away. Same three states as the pin
                        on a shirt, and the same two questions. */}
                    <button
                      type="button"
                      className={styles.ban}
                      data-ban={bans[Number(player.id)] ?? 'none'}
                      title={
                        bans[Number(player.id)] === undefined
                          ? 'The search may pick him. Press to keep him out of the opening squad.'
                          : bans[Number(player.id)] === 'start'
                            ? 'Kept out of the opening squad. Press to keep him out all period.'
                            : 'Kept out all period. Press to allow him again.'
                      }
                      onClick={() => {
                        cycleBan(player.id);
                        if (picks.includes(player.id)) remove(player.id);
                      }}
                    >
                      <span aria-hidden="true">
                        {bans[Number(player.id)] === 'always'
                          ? 'A'
                          : bans[Number(player.id)] === 'start'
                            ? 'S'
                            : '⊘'}
                      </span>
                      <span className="visually-hidden">
                        {bans[Number(player.id)] === undefined
                          ? `Bar ${player.webName} from the opening squad`
                          : bans[Number(player.id)] === 'start'
                            ? `${player.webName} is barred from the opening squad`
                            : `${player.webName} is barred for the whole period`}
                      </span>
                    </button>
                    <p id={`why-${String(player.id)}`} className={styles.why}>
                      {player.news === '' ? player.why.join('; ') : player.news}
                      {held && '. In your squad: press again to take them out.'}
                      {!check.ok && !held && (
                        <span className={styles.blockedReason}> {check.reason}</span>
                      )}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>

          {visible.length === 0 && (
            <p className={styles.empty}>
              No player matches those filters. Widen the price or clear the search.
            </p>
          )}
        </section>
      </div>

      <p aria-live="polite" role="status" className={styles.live} ref={liveRegion}>
        {message}
      </p>

      <section className={styles.legend} aria-labelledby="legend">
        <h2 id="legend" className={styles.legendHead}>
          The columns, defined
        </h2>
        <ul className={styles.legendList}>
          {SORTS.map((option) => (
            <li key={option.key}>
              <MetricTip id={option.metric}>{option.label}</MetricTip>
            </li>
          ))}
          <li>
            <MetricTip id="fdr" />
          </li>
          <li>
            <MetricTip id="selling-price" />
          </li>
        </ul>
      </section>

      {/* The reasoning below the pitch is long, and every line of it is about
          the squad above it. Once that has scrolled away the eleven stays in
          the corner, at the size a glance needs. */}
      <MiniPitch players={miniSquad} watch={pitchRef} label="Your eleven" />
    </div>
  );
}

const LOCK_TITLE: Record<LockMode, string> = {
  start: 'Held in the opening squad. Press to hold him all period.',
  always: 'Held all period, never sold. Press to let him go.',
};

function Slot({
  slot,
  player,
  club,
  isStarter,
  isCaptain,
  holding,
  lock,
  onDropPlayer,
  onRemove,
  onCycleLock,
}: {
  slot: Position;
  player: BuilderPlayer | undefined;
  club: BuilderTeam | undefined;
  isStarter: boolean;
  isCaptain: boolean;
  holding: PlayerId | null;
  /** Undefined where the search is free to sell him. */
  lock: LockMode | undefined;
  onDropPlayer: (id: PlayerId) => void;
  onRemove: (id: PlayerId) => void;
  onCycleLock: (id: PlayerId) => void;
}) {
  const [over, setOver] = useState(false);

  const accept = (raw: string): void => {
    const id = Number(raw);
    if (Number.isInteger(id) && id > 0) onDropPlayer(id as PlayerId);
  };

  return (
    <li
      className={styles.slot}
      data-filled={player !== undefined ? 'true' : undefined}
      data-over={over ? 'true' : undefined}
      data-starter={isStarter ? 'true' : undefined}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => {
        setOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        accept(event.dataTransfer.getData('text/plain'));
      }}
    >
      {player === undefined ? (
        <button
          type="button"
          className={styles.emptySlot}
          // Keyboard and touch route: pick a player up in the list, then choose
          // a slot. Drag and drop alone would exclude both.
          onClick={() => {
            if (holding !== null) onDropPlayer(holding);
          }}
        >
          <span className={styles.slotStamp}>{slot}</span>
          <span className={styles.slotHint}>{holding === null ? 'Empty' : 'Drop here'}</span>
        </button>
      ) : (
        <div className={styles.card}>
          <span className={styles.shirt}>
            {club === undefined ? (
              <span className={styles.shirtBlank} aria-hidden="true" />
            ) : (
              // A plain img: the CDN serves one fixed size, and next/image
              // would proxy 590 of them for nothing.
              <img
                className={styles.shirtImage}
                src={shirtUrl(club.code, { keeper: slot === 'GKP' })}
                alt=""
                width={54}
                height={68}
                loading="lazy"
              />
            )}
            {isCaptain && (
              <abbr className={styles.captain} title="Captain: the projection's top starter">
                C
              </abbr>
            )}
            {!isStarter && <span className={styles.benched}>Bench</span>}

            {/* A pin, because that is what fixing a player is. Three states on
                one control, each named in full for a screen reader, since the
                difference between holding a player at the start and holding him
                all period is the whole point of having it. */}
            <button
              type="button"
              className={styles.pin}
              data-lock={lock ?? 'none'}
              title={
                lock === undefined
                  ? 'Free to be sold. Press to hold him at the start.'
                  : LOCK_TITLE[lock]
              }
              onClick={() => {
                onCycleLock(player.id);
              }}
            >
              <span aria-hidden="true">
                {lock === 'always' ? 'A' : lock === 'start' ? 'S' : ''}
              </span>
              <span className="visually-hidden">
                {lock === undefined
                  ? `${player.webName} is free to be sold`
                  : lock === 'start'
                    ? `${player.webName} is held in the opening squad`
                    : `${player.webName} is held for the whole period`}
              </span>
            </button>
          </span>

          <span className={styles.tag}>
            <span className={styles.cardName}>{player.webName}</span>
            <span className={styles.cardClub}>
              {club?.shortName ?? '???'}
              {player.availability !== 'available' && (
                <abbr
                  className={styles.doubt}
                  title={player.news === '' ? player.availability : player.news}
                >
                  !
                </abbr>
              )}
            </span>

            <span className={classes(styles.metrics, 'num')}>
              <span title="Price">{formatPrice(player.price)}</span>
              <strong title="Projected points, from the model">
                {player.projected.toFixed(1)}
              </strong>
              <span title="Points per ninety over the form window">
                {player.pointsPer90.toFixed(1)}
              </span>
              <span title="Share of recent gameweeks he finished">
                {player.starterReliability}%
              </span>
              <span title="Owned by">{player.ownership.toFixed(0)}%</span>
            </span>

            <span className={styles.ticker} aria-hidden="true">
              {player.next.length === 0 ? (
                <span className={styles.tickBlank} title="No fixture in the next three">
                  &ndash;
                </span>
              ) : (
                player.next.map((fixture) => (
                  <span
                    key={fixture.gameweek}
                    className={styles.tick}
                    data-difficulty={fixture.difficulty}
                    title={`Gameweek ${String(fixture.gameweek)}, difficulty ${String(fixture.difficulty)}`}
                  />
                ))
              )}
            </span>
            <span className="visually-hidden">
              {`${player.next.length.toString()} of the next three gameweeks have a fixture`}
            </span>
          </span>

          <button
            type="button"
            className={styles.removeButton}
            onClick={() => {
              onRemove(player.id);
            }}
            aria-label={`Remove ${player.webName}`}
          >
            ×
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * The pitch itself, seen from behind a goal, which is the orientation the eleven
 * are laid out in: the keeper at the bottom and the forwards at the top. It was
 * drawn side on at first, goals left and right, which left the penalty areas
 * beside the squad rather than behind it and read as two different pitches on
 * one page. It is also the shape a phone is.
 *
 * Drawn rather than photographed, because every other surface on this site is
 * printed and a photograph of grass here would be the one thing that is not.
 * `components/pitch.tsx` still draws the side on rectangle, and should: a
 * heatmap is measured along the direction of play.
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
