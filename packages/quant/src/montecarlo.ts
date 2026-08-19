/**
 * Simulation. Everything here is seeded and returns a distribution rather than
 * a point estimate, because the useful answer to "how many points will he
 * score" is a spread with a shape, and the mean of that spread is the least
 * interesting number in it.
 */
import { at, quantileSorted, sorted, mean, standardDeviation } from './internal.js';
import { createRng, type Rng } from './rng.js';

export interface Fan {
  /** Mean of the draws. */
  mean: number;
  sd: number;
  p5: number;
  p25: number;
  median: number;
  p75: number;
  p95: number;
  min: number;
  max: number;
  draws: number;
}

export function summariseDraws(values: ArrayLike<number>): Fan {
  const ascending = sorted(values);
  const n = ascending.length;
  if (n === 0) {
    const nan = Number.NaN;
    return {
      mean: nan,
      sd: nan,
      p5: nan,
      p25: nan,
      median: nan,
      p75: nan,
      p95: nan,
      min: nan,
      max: nan,
      draws: 0,
    };
  }
  return {
    mean: mean(ascending),
    sd: standardDeviation(ascending),
    p5: quantileSorted(ascending, 0.05),
    p25: quantileSorted(ascending, 0.25),
    median: quantileSorted(ascending, 0.5),
    p75: quantileSorted(ascending, 0.75),
    p95: quantileSorted(ascending, 0.95),
    min: at(ascending, 0),
    max: at(ascending, n - 1),
    draws: n,
  };
}

export interface MatchSimulation {
  homeWin: number;
  draw: number;
  awayWin: number;
  homeCleanSheet: number;
  awayCleanSheet: number;
  bothScore: number;
  overTwoFive: number;
  homeGoals: Fan;
  awayGoals: Fan;
  /** The most likely exact scores, most likely first. */
  scorelines: { home: number; away: number; probability: number }[];
  draws: number;
  seed: number;
}

/**
 * Two independent Poisson processes. The independence is the model's known
 * error, and it always understates draws, because a side two down actually
 * attacks. It is stated wherever a forecast is shown rather than hidden.
 */
export function simulateMatch(
  lambdaHome: number,
  lambdaAway: number,
  options: { draws?: number; seed?: number } = {},
): MatchSimulation {
  const draws = options.draws ?? 10000;
  const seed = options.seed ?? 1;
  const rng = createRng(seed);

  const home = new Float64Array(draws);
  const away = new Float64Array(draws);
  const scores = new Map<string, number>();
  let homeWin = 0;
  let drawCount = 0;
  let homeCleanSheet = 0;
  let awayCleanSheet = 0;
  let bothScore = 0;
  let over = 0;

  for (let i = 0; i < draws; i += 1) {
    const h = rng.poisson(lambdaHome);
    const a = rng.poisson(lambdaAway);
    home[i] = h;
    away[i] = a;
    if (h > a) homeWin += 1;
    else if (h === a) drawCount += 1;
    if (a === 0) homeCleanSheet += 1;
    if (h === 0) awayCleanSheet += 1;
    if (h > 0 && a > 0) bothScore += 1;
    if (h + a > 2.5) over += 1;
    const key = `${h}-${a}`;
    scores.set(key, (scores.get(key) ?? 0) + 1);
  }

  const scorelines = [...scores.entries()]
    .map(([key, count]) => {
      const [h, a] = key.split('-');
      return { home: Number(h), away: Number(a), probability: count / draws };
    })
    .sort((left, right) => right.probability - left.probability)
    .slice(0, 8);

  return {
    homeWin: homeWin / draws,
    draw: drawCount / draws,
    awayWin: (draws - homeWin - drawCount) / draws,
    homeCleanSheet: homeCleanSheet / draws,
    awayCleanSheet: awayCleanSheet / draws,
    bothScore: bothScore / draws,
    overTwoFive: over / draws,
    homeGoals: summariseDraws(home),
    awayGoals: summariseDraws(away),
    scorelines,
    draws,
    seed,
  };
}

export interface SeasonFixture {
  home: string;
  away: string;
  /** Set for a match already played, so a mid season simulation keeps its past. */
  homeScore?: number;
  awayScore?: number;
}

export interface TeamStrength {
  /** Goals scored relative to the division average, 1 being average. */
  attack: number;
  /** Goals conceded relative to the division average, below 1 being good. */
  defence: number;
}

export interface SeasonOutcome {
  team: string;
  /** Share of simulations finishing in each position, index 0 being first. */
  positionShare: number[];
  title: number;
  topFour: number;
  relegated: number;
  points: Fan;
  goalDifference: Fan;
  expectedPosition: number;
}

/**
 * A whole season, match by match, drawing every unplayed result. Position
 * distributions are the output: "third with 71 points" is one draw of many, and
 * a table of single numbers hides how little separates fourth from seventh.
 */
export function simulateSeason(
  fixtures: SeasonFixture[],
  strengths: Map<string, TeamStrength>,
  options: {
    draws?: number;
    seed?: number;
    /** Goals per team per match at the division average. */
    baseGoals?: number;
    /** Multiplier applied to the home side and its inverse to the away side. */
    homeAdvantage?: number;
    relegationPlaces?: number;
  } = {},
): SeasonOutcome[] {
  const draws = options.draws ?? 2000;
  const seed = options.seed ?? 1;
  const baseGoals = options.baseGoals ?? 1.4;
  const homeAdvantage = options.homeAdvantage ?? 1.15;
  const relegationPlaces = options.relegationPlaces ?? 3;
  const rng = createRng(seed);

  const teams = [...new Set(fixtures.flatMap((fixture) => [fixture.home, fixture.away]))].sort();
  const index = new Map(teams.map((team, i) => [team, i]));
  const size = teams.length;

  const positionCounts = teams.map(() => new Int32Array(size));
  const pointDraws = teams.map(() => new Float64Array(draws));
  const differenceDraws = teams.map(() => new Float64Array(draws));

  for (let draw = 0; draw < draws; draw += 1) {
    const points = new Float64Array(size);
    const scored = new Float64Array(size);
    const conceded = new Float64Array(size);

    for (const fixture of fixtures) {
      const h = index.get(fixture.home);
      const a = index.get(fixture.away);
      if (h === undefined || a === undefined) continue;
      const homeStrength = strengths.get(fixture.home) ?? { attack: 1, defence: 1 };
      const awayStrength = strengths.get(fixture.away) ?? { attack: 1, defence: 1 };

      let homeGoals: number;
      let awayGoals: number;
      if (fixture.homeScore !== undefined && fixture.awayScore !== undefined) {
        homeGoals = fixture.homeScore;
        awayGoals = fixture.awayScore;
      } else {
        // Home advantage is split either side of the fixture so the total stays
        // on the league's own scale rather than inflating every match.
        const lambdaHome =
          baseGoals * homeStrength.attack * awayStrength.defence * Math.sqrt(homeAdvantage);
        const lambdaAway =
          (baseGoals * awayStrength.attack * homeStrength.defence) / Math.sqrt(homeAdvantage);
        homeGoals = rng.poisson(lambdaHome);
        awayGoals = rng.poisson(lambdaAway);
      }

      scored[h] = (scored[h] ?? 0) + homeGoals;
      scored[a] = (scored[a] ?? 0) + awayGoals;
      conceded[h] = (conceded[h] ?? 0) + awayGoals;
      conceded[a] = (conceded[a] ?? 0) + homeGoals;
      if (homeGoals > awayGoals) points[h] = (points[h] ?? 0) + 3;
      else if (homeGoals < awayGoals) points[a] = (points[a] ?? 0) + 3;
      else {
        points[h] = (points[h] ?? 0) + 1;
        points[a] = (points[a] ?? 0) + 1;
      }
    }

    const order = Array.from({ length: size }, (_, i) => i).sort((left, right) => {
      const pointGap = (points[right] ?? 0) - (points[left] ?? 0);
      if (pointGap !== 0) return pointGap;
      const differenceGap =
        (scored[right] ?? 0) -
        (conceded[right] ?? 0) -
        ((scored[left] ?? 0) - (conceded[left] ?? 0));
      if (differenceGap !== 0) return differenceGap;
      return (scored[right] ?? 0) - (scored[left] ?? 0);
    });

    order.forEach((team, position) => {
      const counts = positionCounts[team];
      if (counts !== undefined) counts[position] = (counts[position] ?? 0) + 1;
      const teamPoints = pointDraws[team];
      if (teamPoints !== undefined) teamPoints[draw] = points[team] ?? 0;
      const difference = differenceDraws[team];
      if (difference !== undefined) difference[draw] = (scored[team] ?? 0) - (conceded[team] ?? 0);
    });
  }

  return teams
    .map((team, i) => {
      const counts = positionCounts[i] ?? new Int32Array(size);
      const share = Array.from(counts, (count) => count / draws);
      const expectedPosition = share.reduce(
        (total, value, position) => total + value * (position + 1),
        0,
      );
      return {
        team,
        positionShare: share,
        title: share[0] ?? 0,
        topFour: share.slice(0, 4).reduce((total, value) => total + value, 0),
        relegated: share.slice(size - relegationPlaces).reduce((total, value) => total + value, 0),
        points: summariseDraws(pointDraws[i] ?? new Float64Array(0)),
        goalDifference: summariseDraws(differenceDraws[i] ?? new Float64Array(0)),
        expectedPosition,
      };
    })
    .sort((left, right) => left.expectedPosition - right.expectedPosition);
}

export interface PlayerProfile {
  name: string;
  position: 'GKP' | 'DEF' | 'MID' | 'FWD';
  /** Probability of playing at all, and of reaching sixty minutes given that. */
  startProbability: number;
  sixtyGivenStart?: number;
  /** Expected goals and assists in a full match. */
  expectedGoals: number;
  expectedAssists: number;
  /** Probability the club keeps a clean sheet. */
  cleanSheetProbability: number;
  /** Expected goals conceded, for the two goal penalty on defenders and keepers. */
  expectedConceded?: number;
  /** Expected saves per match, keepers only. */
  expectedSaves?: number;
  /** Expected defensive contribution points, from the CBIT and CBIRT thresholds. */
  defensiveContributionProbability?: number;
  /** Expected bonus points, which are modelled as a mean rather than simulated. */
  expectedBonus?: number;
}

const GOAL_POINTS: Record<PlayerProfile['position'], number> = { GKP: 10, DEF: 6, MID: 5, FWD: 4 };
const CLEAN_SHEET_POINTS: Record<PlayerProfile['position'], number> = {
  GKP: 4,
  DEF: 4,
  MID: 1,
  FWD: 0,
};

export interface PlayerSimulation {
  name: string;
  fan: Fan;
  /** Probability of at least this many points, for the thresholds a manager cares about. */
  atLeast: { threshold: number; probability: number }[];
  blankRisk: number;
  seed: number;
}

/**
 * One player's gameweek as a compound draw: minutes first, then goals and
 * assists as Poisson counts, then the clean sheet, saves, and concessions the
 * position is paid for. It is a model of FPL's scoring rules, not a fit.
 */
export function simulatePlayerPoints(
  profile: PlayerProfile,
  options: { draws?: number; seed?: number; thresholds?: number[] } = {},
): PlayerSimulation {
  const draws = options.draws ?? 10000;
  const seed = options.seed ?? 1;
  const thresholds = options.thresholds ?? [2, 6, 10, 15];
  const results = drawPlayerPoints(profile, draws, seed);

  let blanks = 0;
  for (let i = 0; i < draws; i += 1) if ((results[i] ?? 0) <= 2) blanks += 1;

  return {
    name: profile.name,
    fan: summariseDraws(results),
    atLeast: thresholds.map((threshold) => {
      let count = 0;
      for (let i = 0; i < draws; i += 1) if ((results[i] ?? 0) >= threshold) count += 1;
      return { threshold, probability: count / draws };
    }),
    blankRisk: draws === 0 ? Number.NaN : blanks / draws,
    seed,
  };
}

/** One draw of one player's gameweek, straight off the scoring rules. */
function drawOnce(profile: PlayerProfile, rng: Rng): number {
  const played = rng.next() < profile.startProbability;
  if (!played) return 0;

  const fullMatch = rng.next() < (profile.sixtyGivenStart ?? 0.85);
  let points = fullMatch ? 2 : 1;
  // A substitute's share of a full match is the share of the scoring chances he
  // was on the pitch for, which is what scales the rates below.
  const share = fullMatch ? 1 : 0.35;

  const goals = rng.poisson(profile.expectedGoals * share);
  const assists = rng.poisson(profile.expectedAssists * share);
  points += goals * GOAL_POINTS[profile.position] + assists * 3;

  if (fullMatch && rng.next() < profile.cleanSheetProbability) {
    points += CLEAN_SHEET_POINTS[profile.position];
  } else if (profile.position === 'GKP' || profile.position === 'DEF') {
    const conceded = rng.poisson((profile.expectedConceded ?? 1.4) * share);
    points -= Math.floor(conceded / 2);
  }

  if (profile.position === 'GKP') {
    const saves = rng.poisson((profile.expectedSaves ?? 3) * share);
    points += Math.floor(saves / 3);
  }

  if (rng.next() < (profile.defensiveContributionProbability ?? 0) * share) points += 2;
  return points + (profile.expectedBonus ?? 0);
}

function drawPlayerPoints(profile: PlayerProfile, draws: number, seed: number): Float64Array {
  const rng = createRng(seed);
  const results = new Float64Array(draws);
  for (let i = 0; i < draws; i += 1) results[i] = drawOnce(profile, rng);
  return results;
}

export interface CaptainChoice {
  name: string;
  /** Mean of doubled points, which is what the armband is worth. */
  expected: number;
  /** Probability this pick beats every other candidate in the same simulation. */
  winProbability: number;
  /** Probability of a doubled return below 8, the regret case. */
  regretRisk: number;
  fan: Fan;
}

/**
 * Captaincy compared across candidates in the same simulated week, so the
 * comparison is paired rather than run separately for each player.
 */
export function captaincyEv(
  candidates: PlayerProfile[],
  options: { draws?: number; seed?: number } = {},
): CaptainChoice[] {
  const draws = options.draws ?? 5000;
  const seed = options.seed ?? 1;
  // Each candidate gets its own stream, so adding a fourth name does not
  // change the draws the first three were compared on.
  const perPlayer = candidates.map((profile, index) =>
    drawPlayerPoints(profile, draws, seed + index * 7919),
  );

  const wins = candidates.map(() => 0);
  for (let i = 0; i < draws; i += 1) {
    let best = Number.NEGATIVE_INFINITY;
    let bestIndex = 0;
    perPlayer.forEach((values, index) => {
      const value = values[i] ?? 0;
      if (value > best) {
        best = value;
        bestIndex = index;
      }
    });
    wins[bestIndex] = (wins[bestIndex] ?? 0) + 1;
  }

  return candidates
    .map((profile, index) => {
      const values = perPlayer[index] ?? new Float64Array(0);
      const doubled = Float64Array.from(values, (value) => value * 2);
      let regret = 0;
      for (const value of doubled) if (value < 8) regret += 1;
      return {
        name: profile.name,
        expected: mean(doubled),
        winProbability: (wins[index] ?? 0) / draws,
        regretRisk: doubled.length === 0 ? Number.NaN : regret / doubled.length,
        fan: summariseDraws(doubled),
      };
    })
    .sort((left, right) => right.expected - left.expected);
}
