import type { Match, MatchDetail, Position } from '@fpl/core';

/**
 * Who a club actually picks, over its recent record rather than its last sheet.
 *
 * The predicted eleven used to be the last eleven the club named, and that is
 * wrong for a reason anyone who watches football knows: the last eleven is
 * frequently a cup side. One rotated Tuesday and the site predicted that team
 * for a month, because a single sheet has no way to tell "this is the team" from
 * "this was Tuesday".
 *
 * A record fixes it. Over the last several matches **in the competition being
 * predicted**, how often did each player start, how recently, and how settled is
 * the club's selection overall. That is a statement about a habit, and a habit
 * is what a team sheet is: managers pick the same eleven until something makes
 * them change.
 *
 * Pure and free of I/O, so the reasoning can be tested against a record written
 * by hand rather than only observed on a page.
 */

export interface SelectionMatch {
  kickoff: Date | null;
  /** The competition this match was played in, as the calendar numbers them. */
  competitionId: number;
  /** Player codes that started. */
  started: number[];
  /** Player codes on the bench, which is a weaker signal than a start. */
  benched: number[];
  formation: string | null;
  /** The provider's role label per player code, where it named one. */
  roles: Map<number, string>;
  /**
   * How the teamsheet spelled each name.
   *
   * Carried because a player who has left the club is exactly the player the
   * prediction needs to name: FPL drops him from its list the moment he goes,
   * so without this the page printed "Lerma for player 43".
   */
  names: Map<number, string>;
}

export interface PlayerSelection {
  starts: number;
  benched: number;
  /** Starts as a share of the matches read. */
  startShare: number;
  /**
   * Starts weighted towards the recent ones. This, not the raw share, is what
   * orders the eleven: a player who started the last three and missed the three
   * before is in the team, and one with the reverse record is not.
   */
  weight: number;
  /** The role he was most often named in, which is what places him on a pitch. */
  role: string | null;
  /** The teamsheet's own spelling, for a player FPL no longer lists. */
  name: string | null;
  lastStarted: Date | null;
}

export interface SelectionRecord {
  /** Matches actually read, after filtering to the competition. */
  matches: number;
  players: Map<number, PlayerSelection>;
  /** The shape the club named most often, not the one it named last. */
  formation: string | null;
  /**
   * How settled selection is: the share of starting places filled by the same
   * players from match to match, 0 to 1. A club that names one eleven scores 1,
   * a club that changes everything scores near 0.
   *
   * Null below two matches, because stability is a comparison between
   * consecutive elevens and one eleven affords none. Reporting 0 there said
   * "this club rotates heavily" on the strength of no evidence at all, which is
   * a claim about a club rather than an admission about the record.
   */
  stability: number | null;
}

/**
 * How much a match counts, by how many matches ago it was.
 *
 * A half life of three matches: the last match counts fully, four matches back
 * counts about a third. Stated rather than fitted, and chosen so that a run of
 * three starts outweighs a run of three older ones without erasing them.
 */
const HALF_LIFE_MATCHES = 3;

const decay = (index: number): number => 0.5 ** (index / HALF_LIFE_MATCHES);

/**
 * A club's selection record over its recent matches in one competition.
 *
 * Matches are filtered to the competition being predicted, because a league
 * eleven and a cup eleven are different teams and mixing them is precisely the
 * bug this replaces. Newest first is the caller's job; this sorts anyway, since
 * an out of order list would silently invert the recency weighting.
 */
export function selectionRecord(
  matches: readonly SelectionMatch[],
  competitionId: number,
  window = 6,
): SelectionRecord {
  const relevant = [...matches]
    .filter((match) => match.competitionId === competitionId)
    .sort((a, b) => (b.kickoff?.getTime() ?? 0) - (a.kickoff?.getTime() ?? 0))
    .slice(0, window);

  const players = new Map<number, Building>();
  const formations = new Map<string, number>();
  let weightTotal = 0;

  relevant.forEach((match, index) => {
    const weight = decay(index);
    weightTotal += weight;
    if (match.formation !== null) {
      formations.set(match.formation, (formations.get(match.formation) ?? 0) + weight);
    }

    const roleOf = match.roles;
    for (const code of match.started) {
      const entry = players.get(code) ?? blank();
      entry.starts += 1;
      entry.weight += weight;
      const role = roleOf.get(code);
      if (role !== undefined) {
        entry.roleCounts.set(role, (entry.roleCounts.get(role) ?? 0) + weight);
      }
      // The newest spelling wins, and it is the only name anyone has for a
      // player FPL has already dropped from its list.
      entry.name ??= match.names.get(code) ?? null;
      if (entry.lastStarted === null && match.kickoff !== null) entry.lastStarted = match.kickoff;
      players.set(code, entry);
    }

    for (const code of match.benched) {
      const entry = players.get(code) ?? blank();
      entry.benched += 1;
      players.set(code, entry);
    }
  });

  // How much of one match's eleven survives into the next, averaged over the
  // window. It is the number that says whether this club is predictable at all,
  // and it is printed rather than folded into the answer.
  let shared = 0;
  let pairs = 0;
  for (let index = 1; index < relevant.length; index += 1) {
    const previous = new Set(relevant[index - 1]?.started ?? []);
    const current = relevant[index]?.started ?? [];
    if (previous.size === 0 || current.length === 0) continue;
    shared += current.filter((code) => previous.has(code)).length / current.length;
    pairs += 1;
  }

  const out = new Map<number, PlayerSelection>();
  for (const [code, entry] of players) {
    out.set(code, {
      starts: entry.starts,
      benched: entry.benched,
      startShare: relevant.length === 0 ? 0 : entry.starts / relevant.length,
      weight: weightTotal === 0 ? 0 : entry.weight / weightTotal,
      role: modal(entry.roleCounts),
      name: entry.name,
      lastStarted: entry.lastStarted,
    });
  }

  return {
    matches: relevant.length,
    players: out,
    formation: modal(formations),
    stability: pairs === 0 ? null : shared / pairs,
  };
}

interface Building {
  starts: number;
  benched: number;
  weight: number;
  roleCounts: Map<string, number>;
  name: string | null;
  lastStarted: Date | null;
}

const blank = (): Building => ({
  starts: 0,
  benched: 0,
  weight: 0,
  roleCounts: new Map(),
  name: null,
  lastStarted: null,
});

function modal<T>(counts: Map<T, number>): T | null {
  let best: T | null = null;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

export interface ElevenOptions {
  isAvailable: (code: number) => boolean;
  positionOf: (code: number) => Position;
  /** Every player the club currently has, which is what a replacement comes from. */
  pool: readonly number[];
  /** Minutes this season, the fallback ordering where there is no record. */
  minutesOf?: (code: number) => number;
  /**
   * How likely the club is to rotate, 0 to 1, from its fixture congestion. It
   * does not reorder the eleven, because who is rested is not something this
   * knows; it is reported so the page can say the eleven is less certain.
   */
  rotationRisk?: number;
}

export interface LikelyStarters {
  starters: number[];
  bench: number[];
  formation: string | null;
  /**
   * Players the record expected who cannot play, and who takes each place.
   *
   * `in` is null where nobody of that position was promoted, which happens
   * whenever the shape shifts: a midfielder out and a forward in is a real
   * change and pairing them would be a fiction, but so is saying nothing.
   */
  changes: { out: number; in: number | null }[];
  /**
   * How much to trust this eleven, 0 to 1: how settled the club's selection has
   * been, softened by how much football it is about to play.
   *
   * Null where the record cannot say: no matches at all, or one match, which
   * offers nothing to compare. Zero would be a claim; null is the truth.
   */
  confidence: number | null;
}

/**
 * The eleven a club is likely to name.
 *
 * Ordered by the recency weighted start record, filled to a legal shape, with
 * anyone unavailable replaced by the next player of his position. Every
 * replacement is reported rather than quietly made, because a reader who
 * disagrees needs to see which name the model swapped and why.
 */
export function likelyStarters(record: SelectionRecord, options: ElevenOptions): LikelyStarters {
  const minutesOf = options.minutesOf ?? (() => 0);

  const score = (code: number): number => {
    const entry = record.players.get(code);
    if (entry === undefined) return minutesOf(code) / 100_000;
    // A bench appearance is a weak signal that he is in the picture at all, so
    // it breaks ties between players with no starts rather than competing with
    // one who has them.
    return entry.weight + entry.benched * 0.001 + minutesOf(code) / 100_000;
  };

  const ranked = [...options.pool]
    .filter((code) => options.isAvailable(code))
    .sort((a, b) => score(b) - score(a));

  // The record picks the eleven; the shape only fills what the record cannot.
  //
  // Enforcing the shape's own counts looked right and was wrong: a 4-3-3's
  // front three is usually one FPL forward and two FPL midfielders, because
  // FPL calls a winger a midfielder, so a quota drawn from the label drops
  // exactly the players a front three is made of. The label decides nothing
  // about who starts. It decides only how to fill an eleven that the record
  // cannot complete, which is a promoted club in August, where every score is
  // zero and the sort is a no-op: without it that club got the first ten codes
  // in the pool, which can be seven defenders and no forward.
  const taken = new Set<number>();
  const starters: number[] = [];

  const take = (code: number): void => {
    if (taken.has(code) || starters.length >= 11) return;
    taken.add(code);
    starters.push(code);
  };

  // Exactly one keeper: a rotated cup week can put two in the window, and a
  // sheet with two keepers is not a sheet.
  const keeper = ranked.find((code) => options.positionOf(code) === 'GKP');
  if (keeper !== undefined) take(keeper);

  for (const code of ranked) {
    if (starters.length >= 11) break;
    if (options.positionOf(code) === 'GKP') continue;
    // Only players the record actually saw start. A zero weight means the
    // record says nothing about him, and the shape below handles that case.
    if ((record.players.get(code)?.weight ?? 0) <= 0) continue;
    take(code);
  }

  if (starters.length < 11) {
    const quota = quotaFor(record.formation);
    const fill = (position: Position, count: number): void => {
      let placed = starters.filter((code) => options.positionOf(code) === position).length;
      for (const code of ranked) {
        if (placed >= count || starters.length >= 11) break;
        if (taken.has(code) || options.positionOf(code) !== position) continue;
        take(code);
        placed += 1;
      }
    };
    fill('DEF', quota.DEF);
    fill('MID', quota.MID);
    fill('FWD', quota.FWD);
    // A thin squad can still leave the shape short, and an eleven is eleven.
    for (const code of ranked) {
      if (starters.length >= 11) break;
      take(code);
    }
  }

  // Who the record expected but cannot play, paired with whoever took his
  // place **at his position**. Pairing by array index printed a reserve keeper
  // replacing an injured striker, which is a sentence the page states as fact.
  const expected = [...record.players.entries()]
    .sort(([, a], [, b]) => b.weight - a.weight)
    .slice(0, 11)
    .map(([code]) => code);
  const missing = expected.filter((code) => !options.isAvailable(code));
  const promoted = starters.filter((code) => !expected.includes(code));
  const used = new Set<number>();
  const changes = missing.map((out) => {
    const replacement = promoted.find(
      (code) => !used.has(code) && options.positionOf(code) === options.positionOf(out),
    );
    if (replacement === undefined) return { out, in: null };
    used.add(replacement);
    return { out, in: replacement };
  });

  const bench = ranked.filter((code) => !starters.includes(code)).slice(0, 9);

  // A congested club is a less predictable club, so the same record buys less
  // confidence when a squad is playing twice a week.
  const rotation = Math.min(1, Math.max(0, options.rotationRisk ?? 0));
  const confidence = record.stability === null ? null : record.stability * (1 - rotation * 0.4);

  return {
    starters,
    bench,
    formation: record.formation,
    changes,
    confidence: confidence === null ? null : Math.round(confidence * 100) / 100,
  };
}

/**
 * How many of each line a printed formation calls for.
 *
 * A label such as 3-4-2-1 is bands, not FPL positions: its ten outfielders are
 * three defenders, six midfielders across two bands, and one forward. Reading
 * each band as its own position drew a defender at centre forward in every
 * 3-4-2-1, which is the third most common shape in the stored record.
 */
export function quotaFor(formation: string | null): { DEF: number; MID: number; FWD: number } {
  const parts = (formation ?? '')
    .split('-')
    .map((part) => Number(part.trim()))
    .filter((part) => Number.isInteger(part) && part > 0);

  const total = parts.reduce((sum, part) => sum + part, 0);
  if (parts.length < 2 || total !== 10) return { DEF: 4, MID: 4, FWD: 2 };

  return {
    DEF: parts[0] ?? 4,
    MID: parts.slice(1, -1).reduce((sum, part) => sum + part, 0),
    FWD: parts.at(-1) ?? 2,
  };
}

/** Every stored teamsheet for a club, as the selection record reads them. */
export function selectionHistory(
  teamCode: number,
  matches: readonly Match[],
  details: ReadonlyMap<number, MatchDetail>,
  options: {
    competitionOf?: (match: Match) => number;
    /** Only matches before this instant, which is the fixture being predicted. */
    before?: Date | null;
    /** How far back to look. A record older than this is a different squad. */
    withinDays?: number;
  } = {},
): SelectionMatch[] {
  const competitionOf = options.competitionOf ?? ((): number => 1);
  const before = options.before ?? null;
  // A promoted club's last six Premier League matches can be two seasons old and
  // mostly played by people who have since left, and the page presents them as
  // "their last six league matches". A year is the bound: beyond it, the record
  // is about a different squad.
  const withinDays = options.withinDays ?? 400;
  const floor = before === null ? null : new Date(before.getTime() - withinDays * 86_400_000);

  const out: SelectionMatch[] = [];
  for (const match of matches) {
    if (match.homeTeamCode !== teamCode && match.awayTeamCode !== teamCode) continue;
    if (match.status !== 'completed') continue;
    // Predicting a fixture from matches played after it is not a prediction.
    if (before !== null && (match.kickoff === null || match.kickoff >= before)) continue;
    if (floor !== null && match.kickoff !== null && match.kickoff < floor) continue;
    const detail = details.get(match.matchId);
    if (detail === undefined) continue;
    const sheet = detail.sheets.find((entry) => entry.teamCode === teamCode);
    if (sheet === undefined) continue;

    const roles = new Map<number, string>();
    const names = new Map<number, string>();
    const started: number[] = [];
    for (const person of sheet.lineup) {
      if (person.playerCode === null) continue;
      started.push(person.playerCode);
      names.set(person.playerCode, person.name);
      if (person.positionInfo !== null) roles.set(person.playerCode, person.positionInfo);
    }
    const benched = sheet.substitutes.flatMap((person) =>
      person.playerCode === null ? [] : [person.playerCode],
    );

    out.push({
      kickoff: match.kickoff,
      competitionId: competitionOf(match),
      started,
      benched,
      formation: sheet.formation,
      roles,
      names,
    });
  }
  return out;
}
