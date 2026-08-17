import type { Team, TeamId } from '@fpl/core';

/**
 * Odds providers use their own club names, so joining their rows to the domain
 * needs a resolver. Matching is done on a normalised form first, with an alias
 * table only for the names that normalisation cannot reconcile.
 */

const normalise = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Provider name to FPL short name, for the pairs normalisation cannot bridge. */
export const TEAM_ALIASES: Readonly<Record<string, string>> = {
  manunited: 'MUN',
  manutd: 'MUN',
  mancity: 'MCI',
  nottmforest: 'NFO',
  nottinghamforest: 'NFO',
  wolves: 'WOL',
  spurs: 'TOT',
  tottenham: 'TOT',
  newcastle: 'NEW',
  leeds: 'LEE',
  brighton: 'BHA',
  westham: 'WHU',
  sheffieldunited: 'SHU',
  westbrom: 'WBA',
  leicester: 'LEI',
  bournemouth: 'BOU',
  crystalpalace: 'CRY',
  astonvilla: 'AVL',
};

/**
 * Builds a lookup over a season's teams. Unknown names resolve to undefined
 * rather than throwing, because a provider file can contain fixtures from a
 * division the domain does not model.
 */
export function buildTeamResolver(teams: readonly Team[]): (name: string) => TeamId | undefined {
  const byNormalisedName = new Map<string, TeamId>();
  const byShortName = new Map<string, TeamId>();

  for (const team of teams) {
    byNormalisedName.set(normalise(team.name), team.id);
    byNormalisedName.set(normalise(team.shortName), team.id);
    byShortName.set(team.shortName.toUpperCase(), team.id);
  }

  return (name: string): TeamId | undefined => {
    const key = normalise(name);
    const direct = byNormalisedName.get(key);
    if (direct !== undefined) return direct;

    const alias = TEAM_ALIASES[key];
    if (alias !== undefined) return byShortName.get(alias);

    // Last resort: a provider name that is a prefix of the club's full name,
    // which covers "Wolverhampton" against "Wolverhampton Wanderers".
    for (const [candidate, id] of byNormalisedName) {
      if (candidate.startsWith(key) && key.length >= 4) return id;
    }
    return undefined;
  };
}
