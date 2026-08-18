import {
  poissonPmf,
  scorelineProbabilities,
  type Match,
  type ScorelineProbabilities,
} from '@fpl/core';

/**
 * A club's attacking and defensive strength, estimated from results alone.
 *
 * This is the standard independent Poisson model, and it is stated rather than
 * fitted: a club's attack is how many it scores relative to the division, its
 * defence is how many it concedes relative to the division, and home advantage
 * is one league wide multiplier. No optimiser, no regularisation beyond the
 * shrinkage below, and no parameters tuned against an outcome the model is
 * later scored on.
 *
 * The honest limits, which the interface prints rather than hides: it knows
 * only results, so a squad gutted in one transfer window looks like the squad
 * that finished last season, and a promoted club has no Premier League record
 * at all and is given the division's worst rather than an invented one.
 */

export interface TeamStrength {
  teamCode: number;
  /** Goals scored per match relative to the league average. 1 is average. */
  attack: number;
  /** Goals conceded per match relative to the league average. 1 is average. */
  defence: number;
  matches: number;
  goalsFor: number;
  goalsAgainst: number;
  /** True where the club has too few matches to be estimated on its own. */
  shrunk: boolean;
}

export interface StrengthModel {
  /** League average goals per team per match, the scale everything sits on. */
  baseline: number;
  /** Home goals divided by away goals across the sample. */
  homeAdvantage: number;
  teams: Map<number, TeamStrength>;
  matches: number;
  seasons: string[];
}

/**
 * Matches under this count are blended towards the division average, because a
 * club that has played twice has a record, not a strength. Ten is roughly a
 * quarter season, which is the point at which a rate stops swinging on one
 * result.
 */
export const SHRINKAGE_MATCHES = 10;

/** More recent seasons carry more weight, halving every `HALF_LIFE` seasons. */
export const HALF_LIFE_SEASONS = 1.5;

export interface StrengthOptions {
  /** Newest season in the sample. Weights decay backwards from it. */
  latestSeason?: string;
  halfLifeSeasons?: number;
  shrinkageMatches?: number;
}

const seasonStart = (season: string): number => Number(season.slice(0, 4));

/**
 * Estimates every club's attack and defence from completed matches. Weighted
 * by season so last season counts roughly twice what the season before does,
 * which is what stops a title win three years ago outvoting a relegation
 * fight last spring.
 */
export function estimateStrength(
  matches: readonly Match[],
  options: StrengthOptions = {},
): StrengthModel {
  const played = matches.filter(
    (match) => match.homeScore !== null && match.awayScore !== null && match.status === 'completed',
  );

  const seasons = [...new Set(played.map((match) => match.season))].sort((a, b) =>
    b.localeCompare(a),
  );
  const latest = options.latestSeason ?? seasons[0] ?? '';
  const halfLife = options.halfLifeSeasons ?? HALF_LIFE_SEASONS;
  const shrinkage = options.shrinkageMatches ?? SHRINKAGE_MATCHES;
  const latestStart = latest === '' ? 0 : seasonStart(latest);

  const weightOf = (season: string): number =>
    latestStart === 0 ? 1 : Math.pow(0.5, (latestStart - seasonStart(season)) / halfLife);

  let weightedGoals = 0;
  let weightedMatches = 0;
  let homeGoals = 0;
  let awayGoals = 0;

  interface Accumulator {
    scored: number;
    conceded: number;
    weight: number;
    rawMatches: number;
    rawFor: number;
    rawAgainst: number;
  }
  const byTeam = new Map<number, Accumulator>();
  const bump = (code: number): Accumulator => {
    const existing = byTeam.get(code);
    if (existing !== undefined) return existing;
    const fresh: Accumulator = {
      scored: 0,
      conceded: 0,
      weight: 0,
      rawMatches: 0,
      rawFor: 0,
      rawAgainst: 0,
    };
    byTeam.set(code, fresh);
    return fresh;
  };

  for (const match of played) {
    const home = match.homeScore ?? 0;
    const away = match.awayScore ?? 0;
    const weight = weightOf(match.season);

    weightedGoals += (home + away) * weight;
    weightedMatches += 2 * weight;
    homeGoals += home * weight;
    awayGoals += away * weight;

    const homeTeam = bump(match.homeTeamCode);
    homeTeam.scored += home * weight;
    homeTeam.conceded += away * weight;
    homeTeam.weight += weight;
    homeTeam.rawMatches += 1;
    homeTeam.rawFor += home;
    homeTeam.rawAgainst += away;

    const awayTeam = bump(match.awayTeamCode);
    awayTeam.scored += away * weight;
    awayTeam.conceded += home * weight;
    awayTeam.weight += weight;
    awayTeam.rawMatches += 1;
    awayTeam.rawFor += away;
    awayTeam.rawAgainst += home;
  }

  const baseline = weightedMatches === 0 ? 1.35 : weightedGoals / weightedMatches;
  const homeAdvantage = awayGoals === 0 ? 1.25 : homeGoals / awayGoals;

  const teams = new Map<number, TeamStrength>();
  for (const [teamCode, accumulator] of byTeam) {
    const scoredRate =
      accumulator.weight === 0 ? baseline : accumulator.scored / accumulator.weight;
    const concededRate =
      accumulator.weight === 0 ? baseline : accumulator.conceded / accumulator.weight;

    // Blend towards the division average in proportion to how little is known.
    const trust = Math.min(1, accumulator.rawMatches / shrinkage);
    const attack = (trust * scoredRate + (1 - trust) * baseline) / baseline;
    const defence = (trust * concededRate + (1 - trust) * baseline) / baseline;

    teams.set(teamCode, {
      teamCode,
      attack,
      defence,
      matches: accumulator.rawMatches,
      goalsFor: accumulator.rawFor,
      goalsAgainst: accumulator.rawAgainst,
      shrunk: trust < 1,
    });
  }

  return { baseline, homeAdvantage, teams, matches: played.length, seasons };
}

export interface MatchForecast {
  homeTeamCode: number;
  awayTeamCode: number;
  homeExpectedGoals: number;
  awayExpectedGoals: number;
  homeWin: number;
  draw: number;
  awayWin: number;
  homeCleanSheet: number;
  awayCleanSheet: number;
  bothToScore: number;
  overTwoPointFive: number;
  /** The five likeliest scorelines, likeliest first. */
  likelyScores: { home: number; away: number; probability: number }[];
  scoreline: ScorelineProbabilities;
  /** True where either club's strength was blended towards the average. */
  provisional: boolean;
}

/**
 * A forecast for one fixture from the strength model. The two goal
 * expectations are the whole of it; every probability below is read off an
 * independent Poisson grid built from them, which is the same grid
 * `fitGoalExpectations` inverts when a bookmaker's prices are available.
 *
 * Independence is the known simplification. Real scorelines correlate (a team
 * two down attacks), so draws are slightly underpriced and heavy wins slightly
 * overpriced. It is stated here rather than corrected by a fudge factor.
 */
export function forecastMatch(
  model: StrengthModel,
  homeTeamCode: number,
  awayTeamCode: number,
): MatchForecast {
  const average: TeamStrength = {
    teamCode: 0,
    attack: 1,
    defence: 1,
    matches: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    shrunk: true,
  };
  const home = model.teams.get(homeTeamCode) ?? average;
  const away = model.teams.get(awayTeamCode) ?? average;

  // Home advantage is split either side of the fixture rather than applied
  // wholly to the home side, so the total stays on the league's scale.
  const tilt = Math.sqrt(model.homeAdvantage);
  const homeExpectedGoals = model.baseline * home.attack * away.defence * tilt;
  const awayExpectedGoals = (model.baseline * away.attack * home.defence) / tilt;

  const scoreline = scorelineProbabilities(homeExpectedGoals, awayExpectedGoals);

  const likely: { home: number; away: number; probability: number }[] = [];
  for (let h = 0; h <= 6; h += 1) {
    for (let a = 0; a <= 6; a += 1) {
      likely.push({
        home: h,
        away: a,
        probability: poissonPmf(h, homeExpectedGoals) * poissonPmf(a, awayExpectedGoals),
      });
    }
  }
  likely.sort((a, b) => b.probability - a.probability);

  return {
    homeTeamCode,
    awayTeamCode,
    homeExpectedGoals,
    awayExpectedGoals,
    homeWin: scoreline.home,
    draw: scoreline.draw,
    awayWin: scoreline.away,
    homeCleanSheet: scoreline.homeCleanSheet,
    awayCleanSheet: scoreline.awayCleanSheet,
    bothToScore: scoreline.bothTeamsToScore,
    overTwoPointFive: scoreline.over25,
    likelyScores: likely.slice(0, 5),
    scoreline,
    provisional: home.shrunk || away.shrunk,
  };
}

/** The model's own account of itself, printed beside every number it produces. */
export function explainForecast(model: StrengthModel, forecast: MatchForecast): string[] {
  const home = model.teams.get(forecast.homeTeamCode);
  const away = model.teams.get(forecast.awayTeamCode);
  const lines = [
    `Goal expectations come from ${String(model.matches)} completed matches across ${String(model.seasons.length)} seasons, weighted so a season counts about half of the one after it.`,
    `The division averages ${model.baseline.toFixed(2)} goals per team per match, and home sides score ${model.homeAdvantage.toFixed(2)} times what away sides do.`,
  ];
  if (home !== undefined && away !== undefined) {
    lines.push(
      `Attack and defence are ratios to that average: ${home.attack.toFixed(2)} and ${home.defence.toFixed(2)} at home, ${away.attack.toFixed(2)} and ${away.defence.toFixed(2)} away.`,
    );
  }
  if (forecast.provisional) {
    lines.push(
      'At least one club has fewer than ten matches on record, so its strength is blended towards the division average and these numbers will move quickly.',
    );
  }
  lines.push(
    'Scorelines are drawn from two independent Poisson distributions, which slightly understates draws, because in a real match the sides respond to the score.',
  );
  return lines;
}
