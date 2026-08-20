import { tenureAt, type HistoricPlayerGameweek, type Match } from '@fpl/core';
import { estimateStrength, type StrengthModel } from '@fpl/analytics';
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
  // Position, one column per class. A pooled model cannot tell a keeper from a
  // striker without it, and was inferring position from correlated features
  // such as the save rate and the price, which costs it depth it needs
  // elsewhere.
  'is_goalkeeper',
  'is_defender',
  'is_midfielder',
  'is_forward',
  // A player FPL reclassified is the case where his history describes a
  // different job from the one he is about to do: a winger listed as a
  // midfielder last season and a forward this one has a goal rate that means
  // something different in each. The flag is what lets a model discount the
  // rows before the change.
  'position_changed',
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
  // Attack and defence as ratios to the division average, weighted across
  // seasons and shrunk towards it for a club with a short record. Six matches of
  // form is a club's mood; this is its level, which is what a clean sheet turns
  // on.
  'team_attack',
  'team_defence',
  'opponent_attack',
  'opponent_defence',
  'expected_goals_for',
  'expected_goals_against',
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
  return row[measure] ?? NA;
}

/**
 * Club matches before an instant, newest last. Everything about a club's recent
 * form is read from the official record rather than from the player's own rows,
 * because a player who was injured for six weeks has no rows for matches his
 * club played, and his club's form is exactly what he is returning into.
 */
/** Narrows a value the filter above has already proved is present. */
function nonNull<T>(value: T | null): T {
  return value as T;
}

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
        kickoff: nonNull(match.kickoff),
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

  const shapes = buildShapeIndex(panel);
  const strength = buildStrengthIndex(panel.matches);

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
          values: valuesFor(
            row,
            state.past,
            teamCode,
            opponentCode,
            panel,
            historyFor,
            shapes,
            strength,
          ),
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
  shapes: ShapeIndex,
  strength: StrengthIndex,
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
  values.push(row.position === 'GKP' ? 1 : 0);
  values.push(row.position === 'DEF' ? 1 : 0);
  values.push(row.position === 'MID' ? 1 : 0);
  values.push(row.position === 'FWD' ? 1 : 0);
  const earlier = past[Math.max(0, past.length - 12)]?.position ?? null;
  values.push(earlier === null || row.position === null ? NA : earlier === row.position ? 0 : 1);

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

  // Order is the contract: these values are read back by position against
  // FEATURE_NAMES, so a block pushed out of order relabels every feature after
  // it. That happened once, and it presented as a club's manager record being
  // the best predictor of how many goals it conceded.
  values.push(...strengthValues(row, teamCode, opponentCode, strength));

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

  values.push(...shapeValues(row, past, teamCode, opponentCode, panel, shapes));

  // A mismatch here is silent and total, so it is checked rather than trusted.
  if (values.length !== FEATURE_NAMES.length) {
    throw new Error(
      `feature count ${String(values.length)} does not match the ${String(FEATURE_NAMES.length)} names declared`,
    );
  }
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
 * The two clubs' levels, and the goals that level implies for this fixture.
 *
 * The last two are the ones the clean sheet and conceding components need: a
 * club's expected goals against in this match, which is the opponent's attack
 * times this club's defence times the division's own rate, with home advantage
 * split either side. That is the same arithmetic the match forecast uses, so a
 * projection and a forecast cannot disagree about the same fixture.
 */
function strengthValues(
  row: HistoricPlayerGameweek,
  teamCode: number | null,
  opponentCode: number | null,
  strength: StrengthIndex,
): number[] {
  if (teamCode === null || opponentCode === null || row.kickoff === null) {
    return [NA, NA, NA, NA, NA, NA];
  }
  const model = strength.at(row.kickoff);
  if (model === null) return [NA, NA, NA, NA, NA, NA];

  const own = model.teams.get(teamCode);
  const other = model.teams.get(opponentCode);
  if (own === undefined || other === undefined) return [NA, NA, NA, NA, NA, NA];

  const home = row.wasHome === true;
  const advantage = Math.sqrt(model.homeAdvantage);
  const scale = home ? advantage : 1 / advantage;
  const goalsFor = model.baseline * own.attack * other.defence * scale;
  const goalsAgainst = (model.baseline * other.attack * own.defence) / scale;

  return [own.attack, own.defence, other.attack, other.defence, goalsFor, goalsAgainst];
}

/**
 * Where the shape puts him, and who that puts him against, from before kickoff.
 *
 * The first version of this read the teamsheet of the match being predicted,
 * which leaks: a slot exists only for a player who started, so "has a slot" is
 * "started", which is what the minutes component is trying to predict. It duly
 * scored 0.885 and named the shape flag as its most important feature, which is
 * the shape of a model that has been told the answer.
 *
 * So every value here comes from before this match: the slot he occupied the
 * last time a teamsheet named him, the shape his club named most recently, and
 * the shape the opponent named most recently. Those are all knowable on the
 * Friday, which is when a manager is picking a squad.
 */
function shapeValues(
  row: HistoricPlayerGameweek,
  past: readonly HistoricPlayerGameweek[],
  teamCode: number | null,
  opponentCode: number | null,
  panel: Panel,
  shapes: ShapeIndex,
): number[] {
  const missing = [NA, NA, NA, NA, NA, NA];
  if (teamCode === null || opponentCode === null || row.kickoff === null) return missing;

  const opponentShape = shapes.lastFormation(opponentCode, row.kickoff);
  const slot = shapes.lastSlot(row.playerCode, row.kickoff);
  if (slot === null || opponentShape === null) {
    return [NA, NA, NA, NA, NA, shapes.stability(teamCode, row.kickoff)];
  }

  const duels = duelsFor(slot, opponentShape.rows);
  const share = (band: string): number =>
    duels
      .filter((duel) => describeSlot(duel.slot).endsWith(band))
      .reduce((total, duel) => total + duel.weight, 0);

  void past;
  return [
    lateralOfSlot(slot),
    advancementOfSlot(slot),
    share('defence'),
    share('midfield'),
    share('attack'),
    shapes.stability(teamCode, row.kickoff),
  ];
}

interface FormationRecord {
  kickoff: number;
  label: string | null;
  rows: number[][];
}

interface SlotRecord {
  kickoff: number;
  slot: Slot;
}

/**
 * Club strength as it stood before each gameweek.
 *
 * `estimateStrength` reads every completed match it is given, so handing it the
 * whole archive would let a model know how a club finished the season it is
 * being asked to predict. It is therefore recomputed once per gameweek from the
 * matches played before that gameweek opened, which is 38 fits a season rather
 * than one per row, and is the difference between a legitimate feature and a
 * time machine.
 */
export interface StrengthIndex {
  at: (kickoff: Date) => StrengthModel | null;
}

export function buildStrengthIndex(matches: readonly Match[]): StrengthIndex {
  const played = matches
    .filter(
      (match) => match.kickoff !== null && match.homeScore !== null && match.awayScore !== null,
    )
    .sort((a, b) => (a.kickoff?.getTime() ?? 0) - (b.kickoff?.getTime() ?? 0));

  const cache = new Map<string, StrengthModel | null>();
  const WEEK = 7 * 86_400_000;

  return {
    at: (kickoff) => {
      // One model per week rather than per match: a club's estimated level does
      // not move within a round, and 38 fits a season is affordable where one
      // per row is not.
      const bucket = Math.floor(kickoff.getTime() / WEEK);
      const key = String(bucket);
      const cached = cache.get(key);
      if (cached !== undefined) return cached;

      const before = played.filter((match) => (match.kickoff?.getTime() ?? 0) < bucket * WEEK);
      const model = before.length < 40 ? null : estimateStrength(before);
      cache.set(key, model);
      return model;
    },
  };
}

export interface ShapeIndex {
  /** The shape a club last named before an instant. */
  lastFormation: (teamCode: number, at: Date) => FormationRecord | null;
  /** The slot a player last occupied before an instant. */
  lastSlot: (playerCode: number, at: Date) => Slot | null;
  /** Share of a club's last six shapes that matched its most recent one. */
  stability: (teamCode: number, at: Date) => number;
}

/**
 * Every teamsheet in the lake, indexed by club and by player, in time order.
 *
 * Built once for a run rather than searched per row: a linear scan of six
 * seasons of matches for each of eighty thousand rows is a quarter of a billion
 * comparisons, which is the difference between a minute and an afternoon.
 */
export function buildShapeIndex(panel: Panel): ShapeIndex {
  const formations = new Map<number, FormationRecord[]>();
  const slots = new Map<number, SlotRecord[]>();

  for (const match of panel.matches) {
    if (match.kickoff === null) continue;
    const detail = panel.detailOf(match.matchId);
    if (detail === null) continue;
    const kickoff = match.kickoff.getTime();

    for (const sheet of detail.sheets) {
      const record: FormationRecord = {
        kickoff,
        label: sheet.formation,
        rows: sheet.formationRows.map((formationRow) => [...formationRow]),
      };
      const bucket = formations.get(sheet.teamCode);
      if (bucket === undefined) formations.set(sheet.teamCode, [record]);
      else bucket.push(record);

      for (const entry of sheet.lineup) {
        if (entry.playerCode === null) continue;
        const slot = slotOf(sheet.formationRows, entry.personId);
        if (slot === null) continue;
        const playerBucket = slots.get(entry.playerCode);
        if (playerBucket === undefined) slots.set(entry.playerCode, [{ kickoff, slot }]);
        else playerBucket.push({ kickoff, slot });
      }
    }
  }

  for (const bucket of formations.values()) bucket.sort((a, b) => a.kickoff - b.kickoff);
  for (const bucket of slots.values()) bucket.sort((a, b) => a.kickoff - b.kickoff);

  const latestBefore = <T extends { kickoff: number }>(
    bucket: T[] | undefined,
    at: number,
  ): T | null => {
    if (bucket === undefined || bucket.length === 0) return null;
    let low = 0;
    let high = bucket.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if ((bucket[mid]?.kickoff ?? 0) < at) low = mid + 1;
      else high = mid;
    }
    return low === 0 ? null : (bucket[low - 1] ?? null);
  };

  return {
    lastFormation: (teamCode, at) => latestBefore(formations.get(teamCode), at.getTime()),
    lastSlot: (playerCode, at) => latestBefore(slots.get(playerCode), at.getTime())?.slot ?? null,
    stability: (teamCode, at) => {
      const bucket = formations.get(teamCode);
      if (bucket === undefined) return NA;
      const time = at.getTime();
      const recent = bucket.filter((entry) => entry.kickoff < time).slice(-6);
      const latest = recent[recent.length - 1];
      if (latest === undefined || recent.length < 2) return NA;
      return recent.filter((entry) => entry.label === latest.label).length / recent.length;
    },
  };
}

function lateralOfSlot(slot: Slot): number {
  return slot.rowSize <= 1 ? 0.5 : (slot.index + 0.5) / slot.rowSize;
}

function advancementOfSlot(slot: Slot): number {
  const outfield = slot.rows - 1;
  if (outfield <= 1) return slot.row === 0 ? 0 : 1;
  return slot.row === 0 ? 0 : (slot.row - 1) / (outfield - 1);
}

/**
 * The features that describe a club's match rather than a player's part in it.
 *
 * A clean sheet is a property of a club match, not of a footballer: eleven
 * players carry the same target, so fitting it per player multiplies the rows
 * without adding information and lets one match sit in a training fold and a
 * test fold at the same time through two different players. The components that
 * predict club events are therefore fitted on one row per club match, using
 * only these features.
 */
export const CLUB_FEATURE_NAMES: string[] = FEATURE_NAMES.filter(
  (name) =>
    name.startsWith('team_') ||
    name.startsWith('opponent_') ||
    name.startsWith('manager_') ||
    name.startsWith('expected_goals_') ||
    name === 'strength_gap' ||
    name === 'is_home' ||
    name === 'gameweek' ||
    name === 'rest_days' ||
    name === 'formation_stability',
);
