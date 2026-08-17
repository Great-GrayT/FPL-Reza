import type { Fixture, FixtureId, Player, PlayerId, Team, TeamId } from '@fpl/core';
import { buildTeamResolver } from '../../odds/team-names.js';

/**
 * Joining a provider's rows to the domain is the whole risk of this pipeline: a
 * wrong join silently attributes one player's match to another. Every resolver
 * here returns undefined rather than a best guess, and the caller counts what
 * failed instead of writing a row it cannot stand behind.
 */

/**
 * Lowercase, strip diacritics, drop everything that is not alphanumeric. The
 * provider writes "Daniel Munoz" where FPL writes "Muñoz", and either side may
 * carry a hyphen or an apostrophe the other does not.
 */
export const normaliseName = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** Two candidates under one key means the key cannot identify anybody. */
const AMBIGUOUS = Symbol('ambiguous');

type Slot<T> = T | typeof AMBIGUOUS;

function index<T>(map: Map<string, Slot<T>>, key: string, value: T): void {
  if (key === '') return;
  const existing = map.get(key);
  if (existing === undefined) {
    map.set(key, value);
    return;
  }
  if (existing !== value) map.set(key, AMBIGUOUS);
}

function lookup<T>(map: Map<string, Slot<T>>, key: string): T | undefined {
  const found = map.get(key);
  return found === undefined || found === AMBIGUOUS ? undefined : found;
}

/**
 * Sofascore prints a club's full registered name ("Manchester City", "Spurs" as
 * "Tottenham Hotspur"), where the odds provider the shared resolver was built
 * for abbreviates instead ("Man City"). The shared table is therefore layered
 * rather than replaced: it still owns the abbreviating direction, and only the
 * names it cannot bridge are handled here.
 */
const SOFASCORE_TEAM_ALIASES: Readonly<Record<string, string>> = {
  manchestercity: 'MCI',
  manchesterunited: 'MUN',
  tottenhamhotspur: 'TOT',
  wolverhamptonwanderers: 'WOL',
  westhamunited: 'WHU',
  brightonandhovealbion: 'BHA',
};

export function buildProviderTeamResolver(
  teams: readonly Team[],
): (name: string) => TeamId | undefined {
  const shared = buildTeamResolver(teams);
  const byShortName = new Map(teams.map((team) => [team.shortName.toUpperCase(), team.id]));
  const domainNames = teams.map((team) => [normaliseName(team.name), team.id] as const);

  return (name: string): TeamId | undefined => {
    const direct = shared(name);
    if (direct !== undefined) return direct;

    const key = normaliseName(name);
    const alias = SOFASCORE_TEAM_ALIASES[key];
    if (alias !== undefined) return byShortName.get(alias);

    // The mirror of the shared resolver's prefix rule: here the domain holds the
    // shorter name ("Newcastle") and the provider the longer ("Newcastle
    // United"). Two matches means the prefix identifies nobody.
    let match: TeamId | undefined;
    let matches = 0;
    for (const [candidate, id] of domainNames) {
      if (candidate.length >= 4 && key.startsWith(candidate)) {
        match = id;
        matches += 1;
      }
    }
    return matches === 1 ? match : undefined;
  };
}

export interface SofascoreEventIdentity {
  homeTeamName: string;
  awayTeamName: string;
  kickoff: Date;
}

export interface FixtureResolverOptions {
  /**
   * How far a provider kickoff may sit from the domain's own. Minutes is the
   * normal disagreement; hours of slack covers a rescheduled match whose new
   * time one side has not picked up yet.
   */
  toleranceMs?: number;
}

const DEFAULT_KICKOFF_TOLERANCE_MS = 4 * 60 * 60 * 1000;

/**
 * Resolves a provider event onto a domain fixture by resolved team pair plus a
 * kickoff within tolerance. The pair alone is nearly unique within a league
 * season, so the kickoff check is what keeps a cup tie between the same two
 * clubs from matching the league fixture.
 */
export function buildFixtureResolver(
  fixtures: readonly Fixture[],
  teams: readonly Team[],
  options: FixtureResolverOptions = {},
): (event: SofascoreEventIdentity) => FixtureId | undefined {
  const tolerance = options.toleranceMs ?? DEFAULT_KICKOFF_TOLERANCE_MS;
  const resolveTeam = buildProviderTeamResolver(teams);

  const byPair = new Map<string, Fixture[]>();
  for (const fixture of fixtures) {
    if (fixture.kickoff === null) continue;
    const key = `${fixture.homeTeam}v${fixture.awayTeam}`;
    const bucket = byPair.get(key);
    if (bucket === undefined) byPair.set(key, [fixture]);
    else bucket.push(fixture);
  }

  return (event: SofascoreEventIdentity): FixtureId | undefined => {
    const home = resolveTeam(event.homeTeamName);
    const away = resolveTeam(event.awayTeamName);
    if (home === undefined || away === undefined) return undefined;

    const candidates = byPair.get(`${home}v${away}`) ?? [];
    let best: Fixture | undefined;
    let bestGap = Number.POSITIVE_INFINITY;
    let tied = false;

    for (const fixture of candidates) {
      const gap = Math.abs((fixture.kickoff?.getTime() ?? 0) - event.kickoff.getTime());
      if (gap > tolerance) continue;
      if (gap < bestGap) {
        best = fixture;
        bestGap = gap;
        tied = false;
      } else if (gap === bestGap) {
        tied = true;
      }
    }

    return tied || best === undefined ? undefined : best.id;
  };
}

/**
 * The forms of a domain player's name a provider might print. Strong forms
 * identify a player on their own; weak ones (a family name, an initial and a
 * family name) only do so within a club, and only when nobody else there shares
 * them.
 */
interface PlayerKeys {
  strong: string[];
  weak: string[];
  global: string[];
}

function keysOf(player: Player): PlayerKeys {
  const first = normaliseName(player.firstName);
  const initial = first.slice(0, 1);
  const parts = player.secondName.trim().split(/\s+/).filter(Boolean);
  const firstFamily = normaliseName(parts[0] ?? '');
  const lastFamily = normaliseName(parts[parts.length - 1] ?? '');

  return {
    // FPL keeps every family name ("Munoz Mejia", "Martinelli Silva") where the
    // provider prints one of them, and which one it keeps varies, so both
    // pairings are indexed rather than guessed at.
    strong: [
      normaliseName(`${player.firstName} ${player.secondName}`),
      normaliseName(player.webName),
      normaliseName(player.secondName),
      `${first}${firstFamily}`,
      `${first}${lastFamily}`,
    ],
    weak:
      initial === ''
        ? [firstFamily, lastFamily]
        : [firstFamily, lastFamily, `${initial}${firstFamily}`, `${initial}${lastFamily}`],
    global: [
      normaliseName(`${player.firstName} ${player.secondName}`),
      `${first}${firstFamily}`,
      `${first}${lastFamily}`,
    ],
  };
}

/** How the provider writes a name, reduced to the forms worth matching on. */
function providerKeys(name: string): { full: string; family: string; initialPlusFamily: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = normaliseName(parts[0] ?? '');
  const family = normaliseName(parts[parts.length - 1] ?? '');
  return {
    full: normaliseName(name),
    family,
    // "D. Munoz" and "Munoz" both have to reach the same player.
    initialPlusFamily: first === '' ? family : `${first.slice(0, 1)}${family}`,
  };
}

export type PlayerResolver = (name: string, teamId: TeamId) => PlayerId | undefined;

/**
 * Resolves a provider player name within a club. Matching runs from the most
 * specific form to the least, and stops rather than guessing when a form is
 * shared by two players at the same club: a wrong player id is worse than a
 * missing row, since nothing downstream can detect it.
 */
export function buildPlayerResolver(
  players: readonly Player[],
  /** Taken for symmetry with the fixture resolver; the club scope comes from the caller's resolved TeamId. */
  _teams: readonly Team[] = [],
): PlayerResolver {
  const scoped = new Map<string, Map<string, Slot<PlayerId>>>();
  const scopedLoose = new Map<string, Map<string, Slot<PlayerId>>>();
  const globalFull = new Map<string, Slot<PlayerId>>();

  const bucketFor = (store: Map<string, Map<string, Slot<PlayerId>>>, teamId: TeamId) => {
    const key = String(teamId);
    const existing = store.get(key);
    if (existing !== undefined) return existing;
    const created = new Map<string, Slot<PlayerId>>();
    store.set(key, created);
    return created;
  };

  for (const player of players) {
    const keys = keysOf(player);
    const exact = bucketFor(scoped, player.teamId);
    for (const key of keys.strong) index(exact, key, player.id);

    // Weak forms are kept in their own map so they are only consulted once
    // every strong form has missed.
    const loose = bucketFor(scopedLoose, player.teamId);
    for (const key of keys.weak) index(loose, key, player.id);

    for (const key of keys.global) index(globalFull, key, player.id);
  }

  return (name: string, teamId: TeamId): PlayerId | undefined => {
    const key = String(teamId);
    const exact = scoped.get(key);
    const loose = scopedLoose.get(key);
    const provider = providerKeys(name);

    if (exact !== undefined) {
      const direct = lookup(exact, provider.full);
      if (direct !== undefined) return direct;
    }
    if (loose !== undefined) {
      const byFamily = lookup(loose, provider.family);
      if (byFamily !== undefined) return byFamily;
      const byInitial = lookup(loose, provider.initialPlusFamily);
      if (byInitial !== undefined) return byInitial;
    }

    // Last resort, outside the club: a player who moved after this match is
    // filed under his new club in the FPL data, so the club scoped lookup can
    // never find him. Only an unambiguous full name across the league qualifies.
    return lookup(globalFull, provider.full);
  };
}
