import {
  INITIAL_BUDGET,
  MAX_PLAYERS_PER_CLUB,
  POSITIONS,
  SQUAD_QUOTA,
  SQUAD_SIZE,
  STARTING_XI_SIZE,
  XI_MAX,
  XI_MIN,
  type PlayerId,
  type Position,
  type TeamId,
  type Tenths,
} from '@fpl/core';

/**
 * Squad legality and selection, as pure functions over a list of players. The
 * rules themselves live in packages/core and are mirrors of the published ones;
 * this module only applies them, so a UI never re-implements a limit and then
 * disagrees with the engine about whether a squad is legal.
 */

/**
 * The least a player has to be for these rules to apply to them. A full domain
 * Player satisfies it, and so does the compact row a browser can afford to
 * ship for all 590 players, which is why the engine takes this and not Player:
 * the same code then runs on the server and in the builder.
 */
export interface SquadPlayer {
  id: PlayerId;
  teamId: TeamId;
  position: Position;
  /** Tenths of a million. */
  price: number;
  webName: string;
}

export interface SquadIssue {
  /** Machine readable, so a UI can attach the message to the right control. */
  code:
    | 'over_budget'
    | 'squad_incomplete'
    | 'quota_short'
    | 'quota_exceeded'
    | 'club_limit'
    | 'duplicate'
    | 'unknown_player'
    | 'xi_size'
    | 'xi_formation';
  message: string;
  /** The position or club the issue concerns, where it concerns one. */
  position?: Position;
  teamId?: TeamId;
}

export interface SquadCost {
  spent: Tenths;
  remaining: Tenths;
  budget: Tenths;
}

export interface SquadState {
  /** Player ids, in no particular order. Duplicates are an issue, not an error. */
  picks: readonly PlayerId[];
  budget?: Tenths;
}

const byId = <P extends SquadPlayer>(players: readonly P[]): Map<PlayerId, P> =>
  new Map(players.map((player) => [player.id, player]));

export function squadCost(state: SquadState, players: readonly SquadPlayer[]): SquadCost {
  const index = byId(players);
  const budget = state.budget ?? INITIAL_BUDGET;
  const spent = state.picks.reduce<number>((total, id) => total + (index.get(id)?.price ?? 0), 0);

  return { spent, remaining: budget - spent, budget };
}

export function countByPosition(
  picks: readonly PlayerId[],
  players: readonly SquadPlayer[],
): Record<Position, number> {
  const index = byId(players);
  const counts: Record<Position, number> = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const id of picks) {
    const player = index.get(id);
    if (player !== undefined) counts[player.position] += 1;
  }
  return counts;
}

export function countByClub(
  picks: readonly PlayerId[],
  players: readonly SquadPlayer[],
): Map<TeamId, number> {
  const index = byId(players);
  const counts = new Map<TeamId, number>();
  for (const id of picks) {
    const player = index.get(id);
    if (player === undefined) continue;
    counts.set(player.teamId, (counts.get(player.teamId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Every way a squad can be illegal, reported together rather than one at a
 * time: a builder that surfaces only the first problem makes the user fix
 * fifteen problems in fifteen round trips.
 */
export function validateSquad(
  state: SquadState,
  players: readonly SquadPlayer[],
  teamName: (teamId: TeamId) => string = (teamId) => `club ${String(teamId)}`,
): SquadIssue[] {
  const index = byId(players);
  const issues: SquadIssue[] = [];

  const seen = new Set<PlayerId>();
  for (const id of state.picks) {
    if (!index.has(id)) {
      issues.push({ code: 'unknown_player', message: `Player ${String(id)} is not in the game.` });
      continue;
    }
    if (seen.has(id)) {
      const name = index.get(id)?.webName ?? String(id);
      issues.push({ code: 'duplicate', message: `${name} is picked twice.` });
    }
    seen.add(id);
  }

  const cost = squadCost(state, players);
  if (cost.remaining < 0) {
    issues.push({
      code: 'over_budget',
      message: `Over budget by ${(Math.abs(cost.remaining) / 10).toFixed(1)}m.`,
    });
  }

  if (state.picks.length !== SQUAD_SIZE) {
    issues.push({
      code: 'squad_incomplete',
      message: `${String(state.picks.length)} of ${String(SQUAD_SIZE)} players picked.`,
    });
  }

  const counts = countByPosition(state.picks, players);
  for (const position of POSITIONS) {
    const quota = SQUAD_QUOTA[position];
    const have = counts[position];
    if (have > quota) {
      issues.push({
        code: 'quota_exceeded',
        position,
        message: `${String(have)} ${position} picked, and the squad holds ${String(quota)}.`,
      });
    } else if (have < quota) {
      issues.push({
        code: 'quota_short',
        position,
        message: `${String(quota - have)} more ${position} to pick.`,
      });
    }
  }

  for (const [teamId, count] of countByClub(state.picks, players)) {
    if (count > MAX_PLAYERS_PER_CLUB) {
      issues.push({
        code: 'club_limit',
        teamId,
        message: `${String(count)} players from ${teamName(teamId)}, and the limit is ${String(MAX_PLAYERS_PER_CLUB)}.`,
      });
    }
  }

  return issues;
}

export const isLegalSquad = (state: SquadState, players: readonly SquadPlayer[]): boolean =>
  validateSquad(state, players).length === 0;

/**
 * Whether one more player can join, and if not, why. This is what a drop target
 * asks before it accepts: refusing at the point of the gesture is kinder than
 * accepting and then complaining.
 */
export function canAdd<P extends SquadPlayer>(
  state: SquadState,
  candidate: P,
  players: readonly P[],
): { ok: true } | { ok: false; reason: string } {
  if (state.picks.includes(candidate.id)) {
    return { ok: false, reason: `${candidate.webName} is already in the squad.` };
  }

  const counts = countByPosition(state.picks, players);
  if (counts[candidate.position] >= SQUAD_QUOTA[candidate.position]) {
    return {
      ok: false,
      reason: `All ${String(SQUAD_QUOTA[candidate.position])} ${candidate.position} slots are filled.`,
    };
  }

  const fromClub = countByClub(state.picks, players).get(candidate.teamId) ?? 0;
  if (fromClub >= MAX_PLAYERS_PER_CLUB) {
    return {
      ok: false,
      reason: `Three players per club is the limit, and this club already has three.`,
    };
  }

  const cost = squadCost(state, players);
  if (candidate.price > cost.remaining) {
    return {
      ok: false,
      reason: `${candidate.webName} costs ${(candidate.price / 10).toFixed(1)}m and ${(cost.remaining / 10).toFixed(1)}m is left.`,
    };
  }

  return { ok: true };
}

/**
 * A points projection per player, supplied by the caller. The engine never
 * invents one: whoever owns the model owns it, and the selection logic stays
 * honest about ranking whatever it is handed.
 */
export type Projection<P extends SquadPlayer = SquadPlayer> = (player: P) => number;

export interface StartingEleven {
  starters: PlayerId[];
  /** Bench order: the first name on it comes on first. */
  bench: PlayerId[];
  formation: Record<Position, number>;
  projectedPoints: number;
  captain: PlayerId | null;
  viceCaptain: PlayerId | null;
}

/**
 * The best legal eleven from a squad under a projection, by exhaustive search
 * over the legal formations rather than a greedy pick. There are only a handful
 * (1 keeper, 3 to 5 defenders, 0 to 5 midfielders, 1 to 3 forwards, summing to
 * 11), so the exact answer is cheap and a heuristic would be a needless
 * approximation.
 */
export function bestStartingEleven<P extends SquadPlayer>(
  picks: readonly PlayerId[],
  players: readonly P[],
  projection: Projection<P>,
): StartingEleven {
  const index = byId(players);
  const squad = picks.flatMap((id) => {
    const player = index.get(id);
    return player === undefined ? [] : [player];
  });

  // Highest projection first, per position: within a formation the choice is
  // always the top n of that position.
  const ranked: Record<Position, P[]> = { GKP: [], DEF: [], MID: [], FWD: [] };
  for (const player of squad) ranked[player.position].push(player);
  for (const position of POSITIONS) {
    ranked[position].sort((a, b) => projection(b) - projection(a));
  }

  let best: StartingEleven | null = null;

  for (let def = XI_MIN.DEF; def <= XI_MAX.DEF; def += 1) {
    for (let mid = XI_MIN.MID; mid <= XI_MAX.MID; mid += 1) {
      for (let fwd = XI_MIN.FWD; fwd <= XI_MAX.FWD; fwd += 1) {
        const formation: Record<Position, number> = { GKP: 1, DEF: def, MID: mid, FWD: fwd };
        if (1 + def + mid + fwd !== STARTING_XI_SIZE) continue;
        if (POSITIONS.some((position) => ranked[position].length < formation[position])) continue;

        const starters = POSITIONS.flatMap((position) =>
          ranked[position].slice(0, formation[position]),
        );
        const projectedPoints = starters.reduce((total, player) => total + projection(player), 0);
        if (best !== null && projectedPoints <= best.projectedPoints) continue;

        const starterIds = new Set(starters.map((player) => player.id));
        // Bench order follows the projection too, except that the spare keeper
        // can only ever replace the keeper, so it sits at the front where FPL
        // puts it rather than competing with outfielders for position.
        const benched = squad.filter((player) => !starterIds.has(player.id));
        const bench = [
          ...benched.filter((player) => player.position === 'GKP'),
          ...benched
            .filter((player) => player.position !== 'GKP')
            .sort((a, b) => projection(b) - projection(a)),
        ];

        const byProjection = [...starters].sort((a, b) => projection(b) - projection(a));

        best = {
          starters: starters.map((player) => player.id),
          bench: bench.map((player) => player.id),
          formation,
          projectedPoints,
          captain: byProjection[0]?.id ?? null,
          viceCaptain: byProjection[1]?.id ?? null,
        };
      }
    }
  }

  return (
    best ?? {
      starters: [],
      bench: picks.slice(),
      formation: { GKP: 0, DEF: 0, MID: 0, FWD: 0 },
      projectedPoints: 0,
      captain: null,
      viceCaptain: null,
    }
  );
}

export const formationLabel = (formation: Record<Position, number>): string =>
  `${String(formation.DEF)}-${String(formation.MID)}-${String(formation.FWD)}`;

export interface AutoPickOptions {
  budget?: Tenths;
  /** Players who must be in the squad, whatever the ranking says. */
  keep?: readonly PlayerId[];
  /** Players never to pick, for example anyone already ruled out by injury. */
  exclude?: readonly PlayerId[];
  /**
   * Share of the budget to hold back for the starting eleven. FPL squads need
   * four bench players who may never play, so spending evenly across fifteen
   * slots produces a weak eleven and an expensive bench.
   */
  benchBudgetShare?: number;
}

const DEFAULT_BENCH_SHARE = 0.13;

/**
 * A complete legal squad under the budget, by value first and then by a cheap
 * fill. This is a starting point for a human to edit, not an optimiser: it
 * takes the projection it is handed, spends most of the money on the eleven it
 * expects to start, and fills the bench with the cheapest legal bodies, which is
 * what an experienced manager does by hand.
 */
export function autoPick<P extends SquadPlayer>(
  players: readonly P[],
  projection: Projection<P>,
  options: AutoPickOptions = {},
): PlayerId[] {
  const budget = options.budget ?? INITIAL_BUDGET;
  const excluded = new Set(options.exclude ?? []);
  const keep = options.keep ?? [];

  const available = players.filter((player) => !excluded.has(player.id));
  const index = byId(available);

  const picks: PlayerId[] = [];
  const state = (): SquadState => ({ picks, budget });

  for (const id of keep) {
    const player = index.get(id);
    if (player !== undefined && canAdd(state(), player, available).ok) picks.push(id);
  }

  // Reserve the bench first, cheapest legal bodies, so the eleven is not left
  // buying a 4.0m striker with the last of the money.
  const benchReserve = Math.round(budget * (options.benchBudgetShare ?? DEFAULT_BENCH_SHARE));
  const benchQuota: Record<Position, number> = { GKP: 1, DEF: 1, MID: 1, FWD: 1 };
  const cheapest = [...available].sort((a, b) => a.price - b.price);

  const bench: PlayerId[] = [];
  for (const player of cheapest) {
    if (bench.length >= 4) break;
    if (benchQuota[player.position] <= 0) continue;
    const trial: SquadState = { picks: [...picks, ...bench], budget };
    if (!canAdd(trial, player, available).ok) continue;
    bench.push(player.id);
    benchQuota[player.position] -= 1;
  }

  const benchCost = bench.reduce((total, id) => total + (index.get(id)?.price ?? 0), 0);
  const elevenBudget = budget - Math.max(benchCost, benchReserve);

  // Value per million against the projection, so the ranking answers "what does
  // another tenth of a million buy" rather than "who scores most".
  const byValue = [...available].sort(
    (a, b) => projection(b) / Math.max(b.price, 1) - projection(a) / Math.max(a.price, 1),
  );

  for (const player of byValue) {
    if (picks.length + bench.length >= SQUAD_SIZE) break;
    const trial: SquadState = { picks: [...picks, ...bench], budget: elevenBudget };
    if (!canAdd(trial, player, available).ok) continue;
    // The bench holds one of each position, so the eleven takes the rest.
    if (
      countByPosition([...picks, ...bench], available)[player.position] >=
      SQUAD_QUOTA[player.position]
    ) {
      continue;
    }
    picks.push(player.id);
  }

  const squad = [...picks, ...bench];

  // Any slot the value pass could not fill within its budget is filled with the
  // cheapest legal option, because an incomplete squad cannot be entered.
  for (const player of cheapest) {
    if (squad.length >= SQUAD_SIZE) break;
    if (!canAdd({ picks: squad, budget }, player, available).ok) continue;
    squad.push(player.id);
  }

  return squad;
}

export interface TransferSuggestion {
  out: PlayerId;
  in: PlayerId;
  /** Projected points gained per gameweek by making the swap. */
  gain: number;
  /** Positive means the swap frees money. */
  freed: Tenths;
}

/**
 * Swaps that raise the projection without breaking a rule, best first. Same
 * position only, since FPL transfers are position bound, and every candidate is
 * checked against the club limit and the money actually available.
 */
export function suggestTransfers<P extends SquadPlayer>(
  state: SquadState,
  players: readonly P[],
  projection: Projection<P>,
  limit = 5,
): TransferSuggestion[] {
  const index = byId(players);
  const budget = state.budget ?? INITIAL_BUDGET;
  const cost = squadCost(state, players);
  const held = new Set(state.picks);

  const suggestions: TransferSuggestion[] = [];

  for (const outId of state.picks) {
    const out = index.get(outId);
    if (out === undefined) continue;

    const remainingWithout = cost.remaining + out.price;
    const without = state.picks.filter((id) => id !== outId);

    for (const candidate of players) {
      if (held.has(candidate.id)) continue;
      if (candidate.position !== out.position) continue;
      if (candidate.price > remainingWithout) continue;

      const check = canAdd({ picks: without, budget }, candidate, players);
      if (!check.ok) continue;

      const gain = projection(candidate) - projection(out);
      if (gain <= 0) continue;

      suggestions.push({
        out: outId,
        in: candidate.id,
        gain,
        freed: out.price - candidate.price,
      });
    }
  }

  return suggestions.sort((a, b) => b.gain - a.gain).slice(0, limit);
}
