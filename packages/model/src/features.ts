import { tenureAt, type HistoricPlayerGameweek, type Match } from '@fpl/core';
import { duelsFor, describeSlot, slotOf, type Slot } from './duel.js';
import type { Panel } from './panel.js';

/**
 * The design matrix.
 *
 * Two rules govern every builder here, and both are enforced rather than
 * documented. The first is that a feature may only read what was knowable
 * before the match kicked off: a player's own rows strictly before this one,
 * his club's matches strictly before this one, and the things published in
 * advance such as the price, the venue, and the fixture. The second is that a
 * measure the source does not carry stays missing rather than becoming zero,
 * because a tree splitting on "expected goals is 0" in a season that never
 * recorded expected goals is splitting on the calendar.
 */

export interface FeatureRow {
  /** Identity, carried through so a prediction can be attributed. */
  playerCode: number;
  season: string;
  gameweek: number;
  /** Gameweeks counted continuously across seasons, for a forward only split. */
  period: number;
  kickoff: Date | null;
  name: string;
  position: string | null;
  teamCode: number | null;
  opponentCode: number | null;
  wasHome: boolean | null;
  /** Feature values, in the order `FEATURE_NAMES` gives. */
  values: Float64Array;
  /** What actually happened, for the targets. */
  actual: HistoricPlayerGameweek;
}

const WINDOWS = [3, 6, 12] as const;

/** Measures a player accumulates, each rolled over every window. */
const ROLLING_MEASURES = [
  'minutes',
  'totalPoints',
  'goals',
  'assists',
  'bps',
  'bonus',
  'cleanSheets',
  'goalsConceded',
  'saves',
  'expectedGoals',
  'expectedAssists',
  'threat',
  'creativity',
] as const;

type RollingMeasure = (typeof ROLLING_MEASURES)[number];

export const FEATURE_NAMES: string[] = [
  ...ROLLING_MEASURES.flatMap((measure) => WINDOWS.map((window) => `${measure}_mean_${window}`)),
  'minutes_share_6',
  'started_share_6',
  'points_per_90_6',
  'goals_per_90_12',
  'assists_per_90_12',
  'expected_goals_per_90_12',
  'expected_assists_per_90_12',
  'threat_per_90_12',
  'creativity_per_90_12',
  // The shot quality proxies. Expected goals over threat separates a player
  // taking a few good chances from one taking many poor ones, which expected
  // goals alone cannot, and threat exists in every stored season while expected
  // goals only exists from 2022/23.
  'shot_quality',
  'creation_quality',
  // The three the shot origin inference rests on, kept as their own names so a
  // model can be fitted with and without them and the difference measured.
  'shot_volume_per_90',
  'implied_shot_quality',
  'implied_shot_distance',
  'appearances',
  'price',
  'price_change',
  'selected_by',
  'is_home',
  'gameweek',
  'rest_days',
  'team_matches_14_days',
  // The club, measured from its own matches rather than from the player's rows.
  'team_goals_for_6',
  'team_goals_against_6',
  'team_clean_sheets_6',
  'team_points_6',
  'opponent_goals_for_6',
  'opponent_goals_against_6',
  'opponent_clean_sheets_6',
  'opponent_points_6',
  'strength_gap',
  // The manager, which is the largest discontinuity a club's form can have.
  'manager_days',
  'manager_new',
  'manager_matches',
  'manager_points_per_match',
  // The shape, and who it puts him against. Missing before the teamsheets do.
  'slot_lateral',
  'slot_advancement',
  'duel_defence_share',
  'duel_midfield_share',
  'duel_attack_share',
  'formation_stability',
];

export interface BuildOptions {
  /** Rows before this many of a player's own appearances are dropped. */
  minimumHistory?: number;
  /** Only build rows for these seasons, for a bounded run. */
  seasons?: readonly string[];
}

interface PlayerState {
  /** Past rows, oldest first. Only rows strictly before the one being built. */
  past: HistoricPlayerGameweek[];
}

interface TeamMatch {
  kickoff: Date;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  cleanSheet: number;
}

const NA = Number.NaN;

/**
 * Expected goals per unit of threat, put on the scale of expected goals per
 * shot. The constant is a calibration rather than a fit: it is the value that
 * maps the panel's median shooter onto a typical shot of about a tenth of a
 * goal, which is what makes the number afterwards readable as a shot rather
 * than as an index. It is exported so the calibration is inspectable and can be
 * re-derived when the panel grows.
 */
export const THREAT_TO_SHOT_QUALITY = 9.5;

export function impliedShotQuality(expectedGoalsPerThreat: number): number {
  if (!Number.isFinite(expectedGoalsPerThreat) || expectedGoalsPerThreat <= 0) return Number.NaN;
  return Math.min(0.9, expectedGoalsPerThreat * THREAT_TO_SHOT_QUALITY);
}

/**
 * The distance a shot of that quality implies, in metres.
 *
 * Expected goals falls off roughly exponentially with distance, so the inverse
 * is a logarithm. The constant is chosen so a chance worth 0.35 sits at about
 * eight metres and one worth 0.05 at about twenty two, which is where those
 * chances are actually taken. This is a stated transform of a proxy, not a
 * measurement: it says a player shoots from further out than another, and it
 * does not say where he stood.
 */
export function impliedShotDistance(quality: number): number {
  if (!Number.isFinite(quality) || quality <= 0) return Number.NaN;
  return Math.min(35, Math.max(4, -Math.log(quality) / 0.136));
}

function mean(values: number[]): number {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return NA;
  return finite.reduce((total, value) => total + value, 0) / finite.length;
}

function tail<T>(values: readonly T[], count: number): T[] {
  return values.slice(Math.max(0, values.length - count));
}

/** Per 90, or missing where no minutes were played: a rate over zero is not zero. */
function per90(total: number, minutes: number): number {
  return minutes > 0 ? (total * 90) / minutes : NA;
}

function measureOf(row: HistoricPlayerGameweek, measure: RollingMeasure): number {
  const value = row[measure];
  return value === null || value === undefined ? NA : value;
}

/**
 * Club matches before an instant, newest last. Everything about a club's recent
 * form is read from the official record rather than from the player's own rows,
 * because a player who was injured for six weeks has no rows for matches his
 * club played, and his club's form is exactly what he is returning into.
 */
function clubHistory(matches: readonly Match[], teamCode: number): TeamMatch[] {
  return matches
    .filter(
      (match) =>
        match.homeScore !== null &&
        match.awayScore !== null &&
        match.kickoff !== null &&
        (match.homeTeamCode === teamCode || match.awayTeamCode === teamCode),
    )
    .map((match) => {
      const home = match.homeTeamCode === teamCode;
      const goalsFor = (home ? match.homeScore : match.awayScore) ?? 0;
      const goalsAgainst = (home ? match.awayScore : match.homeScore) ?? 0;
      return {
        kickoff: match.kickoff as Date,
        goalsFor,
        goalsAgainst,
        points: goalsFor > goalsAgainst ? 3 : goalsFor === goalsAgainst ? 1 : 0,
        cleanSheet: goalsAgainst === 0 ? 1 : 0,
      };
    })
    .sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime());
}

function before(history: readonly TeamMatch[], at: Date | null, count: number): TeamMatch[] {
  if (at === null) return [];
  const time = at.getTime();
  return tail(
    history.filter((entry) => entry.kickoff.getTime() < time),
    count,
  );
}

export interface BuildResult {
  rows: FeatureRow[];
  /** Rows dropped for having too little history to describe. */
  dropped: number;
  featureNames: string[];
}

/**
 * Build one feature row per player gameweek, in period order.
 *
 * The pass is per player: his rows are walked oldest first and the window
 * statistics are read off the rows already walked, which makes "before this
 * match" structural rather than a filter somebody has to remember to apply.
 */
export function buildFeatures(panel: Panel, options: BuildOptions = {}): BuildResult {
  const minimumHistory = options.minimumHistory ?? 3;
  const wanted = options.seasons === undefined ? null : new Set(options.seasons);

  const byPlayer = new Map<number, HistoricPlayerGameweek[]>();
  for (const row of panel.rows) {
    const bucket = byPlayer.get(row.playerCode);
    if (bucket === undefined) byPlayer.set(row.playerCode, [row]);
    else bucket.push(row);
  }

  const clubCache = new Map<number, TeamMatch[]>();
  const historyFor = (teamCode: number): TeamMatch[] => {
    const cached = clubCache.get(teamCode);
    if (cached !== undefined) return cached;
    const built = clubHistory(panel.matches, teamCode);
    clubCache.set(teamCode, built);
    return built;
  };

  const seasonIndex = new Map<string, number>();
  for (const row of panel.rows) {
    if (!seasonIndex.has(row.season)) seasonIndex.set(row.season, seasonIndex.size);
  }
  const orderedSeasons = [...seasonIndex.keys()].sort();
  orderedSeasons.forEach((season, index) => {
    seasonIndex.set(season, index);
  });

  const out: FeatureRow[] = [];
  let dropped = 0;

  for (const rows of byPlayer.values()) {
    rows.sort((a, b) => {
      const seasonGap = (seasonIndex.get(a.season) ?? 0) - (seasonIndex.get(b.season) ?? 0);
      return seasonGap !== 0 ? seasonGap : a.gameweek - b.gameweek;
    });

    const state: PlayerState = { past: [] };

    for (const row of rows) {
      const built =
        state.past.length >= minimumHistory && (wanted === null || wanted.has(row.season));
      if (built) {
        const teamCode = panel.ownTeamCodeOf(row);
        const opponentCode =
          row.opponentTeam === null ? null : panel.teamCodeOf(row.season, row.opponentTeam);
        out.push({
          playerCode: row.playerCode,
          season: row.season,
          gameweek: row.gameweek,
          period: (seasonIndex.get(row.season) ?? 0) * 38 + row.gameweek,
          kickoff: row.kickoff,
          name: row.name,
          position: row.position,
          teamCode,
          opponentCode,
          wasHome: row.wasHome,
          values: valuesFor(row, state.past, teamCode, opponentCode, panel, historyFor),
          actual: row,
        });
      } else if (wanted === null || wanted.has(row.season)) {
        dropped += 1;
      }
      state.past.push(row);
    }
  }

  out.sort((a, b) => a.period - b.period);
  return { rows: out, dropped, featureNames: FEATURE_NAMES };
}

function valuesFor(
  row: HistoricPlayerGameweek,
  past: readonly HistoricPlayerGameweek[],
  teamCode: number | null,
  opponentCode: number | null,
  panel: Panel,
  historyFor: (teamCode: number) => TeamMatch[],
): Float64Array {
  const values: number[] = [];

  for (const measure of ROLLING_MEASURES) {
    for (const window of WINDOWS) {
      values.push(mean(tail(past, window).map((entry) => measureOf(entry, measure))));
    }
  }

  const lastSix = tail(past, 6);
  const lastTwelve = tail(past, 12);
  const minutesSix = lastSix.reduce((total, entry) => total + entry.minutes, 0);
  const minutesTwelve = lastTwelve.reduce((total, entry) => total + entry.minutes, 0);

  values.push(lastSix.length === 0 ? NA : minutesSix / (lastSix.length * 90));
  values.push(
    lastSix.length === 0
      ? NA
      : lastSix.filter((entry) => entry.minutes >= 60).length / lastSix.length,
  );
  values.push(
    per90(
      lastSix.reduce((total, entry) => total + entry.totalPoints, 0),
      minutesSix,
    ),
  );
  values.push(
    per90(
      lastTwelve.reduce((total, entry) => total + entry.goals, 0),
      minutesTwelve,
    ),
  );
  values.push(
    per90(
      lastTwelve.reduce((total, entry) => total + entry.assists, 0),
      minutesTwelve,
    ),
  );
  values.push(per90(sumOf(lastTwelve, 'expectedGoals'), minutesTwelve));
  values.push(per90(sumOf(lastTwelve, 'expectedAssists'), minutesTwelve));
  values.push(per90(sumOf(lastTwelve, 'threat'), minutesTwelve));
  values.push(per90(sumOf(lastTwelve, 'creativity'), minutesTwelve));

  // Threat is FPL's own index of shot volume weighted by location, so expected
  // goals divided by it is a proxy for the quality of an average shot, and
  // therefore for where he takes them. It is missing before 2022/23, when
  // expected goals is, which is stated rather than filled.
  const threatTotal = sumOf(lastTwelve, 'threat');
  const creativityTotal = sumOf(lastTwelve, 'creativity');
  values.push(threatTotal > 0 ? sumOf(lastTwelve, 'expectedGoals') / threatTotal : NA);
  values.push(creativityTotal > 0 ? sumOf(lastTwelve, 'expectedAssists') / creativityTotal : NA);

  // Shot volume, quality, and the distance that quality implies. Threat is
  // built from shots and their locations, so it stands in for volume; expected
  // goals over threat is quality per unit of volume; and the distance is a
  // stated monotone transform of that quality, not a fitted one.
  const volumePer90 = per90(threatTotal, minutesTwelve);
  values.push(volumePer90);
  const impliedQuality =
    threatTotal > 0 && Number.isFinite(sumOf(lastTwelve, 'expectedGoals'))
      ? impliedShotQuality(sumOf(lastTwelve, 'expectedGoals') / threatTotal)
      : NA;
  values.push(impliedQuality);
  values.push(Number.isFinite(impliedQuality) ? impliedShotDistance(impliedQuality) : NA);

  values.push(past.length);
  values.push(row.price ?? NA);
  const previousPrice = past[past.length - 1]?.price ?? null;
  values.push(row.price === null || previousPrice === null ? NA : row.price - previousPrice);
  values.push(row.selectedBy ?? NA);
  values.push(row.wasHome === null ? NA : row.wasHome ? 1 : 0);
  values.push(row.gameweek);

  const clubMatches = teamCode === null ? [] : historyFor(teamCode);
  const recent = before(clubMatches, row.kickoff, 6);
  const lastMatch = recent[recent.length - 1];
  values.push(
    row.kickoff === null || lastMatch === undefined
      ? NA
      : (row.kickoff.getTime() - lastMatch.kickoff.getTime()) / 86_400_000,
  );
  values.push(
    row.kickoff === null
      ? NA
      : clubMatches.filter((entry) => {
          if (row.kickoff === null) return false;
          const gap = row.kickoff.getTime() - entry.kickoff.getTime();
          return gap > 0 && gap <= 14 * 86_400_000;
        }).length,
  );

  values.push(mean(recent.map((entry) => entry.goalsFor)));
  values.push(mean(recent.map((entry) => entry.goalsAgainst)));
  values.push(mean(recent.map((entry) => entry.cleanSheet)));
  values.push(mean(recent.map((entry) => entry.points)));

  const opponentRecent =
    opponentCode === null ? [] : before(historyFor(opponentCode), row.kickoff, 6);
  values.push(mean(opponentRecent.map((entry) => entry.goalsFor)));
  values.push(mean(opponentRecent.map((entry) => entry.goalsAgainst)));
  values.push(mean(opponentRecent.map((entry) => entry.cleanSheet)));
  values.push(mean(opponentRecent.map((entry) => entry.points)));
  // A club's recent points against its opponent's: positive means the stronger
  // side, on the only evidence available before kickoff.
  values.push(
    recent.length === 0 || opponentRecent.length === 0
      ? NA
      : mean(recent.map((entry) => entry.points)) -
          mean(opponentRecent.map((entry) => entry.points)),
  );

  const tenure =
    teamCode === null || row.kickoff === null
      ? null
      : tenureAt(panel.spells, teamCode, row.kickoff);
  values.push(tenure?.days ?? NA);
  values.push(tenure === null ? NA : tenure.newlyAppointed ? 1 : 0);
  const underManager =
    tenure === null || row.kickoff === null
      ? []
      : clubMatches.filter(
          (entry) =>
            entry.kickoff.getTime() >= tenure.spell.from.getTime() &&
            entry.kickoff.getTime() < (row.kickoff?.getTime() ?? 0),
        );
  values.push(tenure === null ? NA : underManager.length);
  values.push(underManager.length === 0 ? NA : mean(underManager.map((entry) => entry.points)));

  values.push(...shapeValues(row, teamCode, opponentCode, panel));

  return Float64Array.from(values);
}

function sumOf(rows: readonly HistoricPlayerGameweek[], measure: RollingMeasure): number {
  let total = 0;
  let seen = false;
  for (const row of rows) {
    const value = measureOf(row, measure);
    if (!Number.isFinite(value)) continue;
    total += value;
    seen = true;
  }
  return seen ? total : NA;
}

/**
 * Where the shape puts him, and who that puts him against.
 *
 * Only available where a teamsheet is, which is the six most recent seasons.
 * Everything here is missing for the rest rather than guessed, and the model is
 * told which rows those are by the values themselves being missing.
 */
function shapeValues(
  row: HistoricPlayerGameweek,
  teamCode: number | null,
  opponentCode: number | null,
  panel: Panel,
): number[] {
  const missing = [NA, NA, NA, NA, NA, NA];
  if (teamCode === null || opponentCode === null || row.kickoff === null) return missing;

  const match = panel.matches.find(
    (candidate) =>
      candidate.kickoff !== null &&
      Math.abs(candidate.kickoff.getTime() - (row.kickoff?.getTime() ?? 0)) < 6 * 3_600_000 &&
      ((candidate.homeTeamCode === teamCode && candidate.awayTeamCode === opponentCode) ||
        (candidate.awayTeamCode === teamCode && candidate.homeTeamCode === opponentCode)),
  );
  if (match === undefined) return missing;

  const detail = panel.detailOf(match.matchId);
  if (detail === null) return missing;

  const own = detail.sheets.find((sheet) => sheet.teamCode === teamCode);
  const other = detail.sheets.find((sheet) => sheet.teamCode === opponentCode);
  if (own === undefined || other === undefined) return missing;

  // The formation rows hold the provider's person ids, not FPL codes: the two
  // number the same footballer differently, and matching a code against a
  // person id silently finds nobody. The lineup carries both, so it is the
  // bridge, and a player the sheet does not name has no slot rather than a
  // guessed one.
  const personId = own.lineup.find((entry) => entry.playerCode === row.playerCode)?.personId;
  if (personId === undefined) return missing;

  const slot = slotOf(own.formationRows, personId);
  if (slot === null) return missing;

  const duels = duelsFor(slot, other.formationRows);
  const share = (band: string): number =>
    duels
      .filter((duel) => describeSlot(duel.slot).endsWith(band))
      .reduce((total, duel) => total + duel.weight, 0);

  return [
    lateralOfSlot(slot),
    advancementOfSlot(slot),
    share('defence'),
    share('midfield'),
    share('attack'),
    // A club that named the same shape last time is a club whose next shape is
    // predictable, which is what makes the slot features worth anything.
    own.formation === null ? NA : 1,
  ];
}

function lateralOfSlot(slot: Slot): number {
  return slot.rowSize <= 1 ? 0.5 : (slot.index + 0.5) / slot.rowSize;
}

function advancementOfSlot(slot: Slot): number {
  const outfield = slot.rows - 1;
  if (outfield <= 1) return slot.row === 0 ? 0 : 1;
  return slot.row === 0 ? 0 : (slot.row - 1) / (outfield - 1);
}
