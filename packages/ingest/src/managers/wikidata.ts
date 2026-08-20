import {
  groundImageSchema,
  groundSchema,
  managerSpellSchema,
  matchSchema,
  teamSchema,
  type Ground,
  type GroundImage,
  type ManagerSpell,
  type Match,
  type Team,
} from '@fpl/core';
import type { HttpClient } from '../http.js';
import { DATASETS, type Source, type SourceBatch, type SourceContext } from '../source.js';

/**
 * Manager spells, with dates, from Wikidata.
 *
 * This source exists because neither football provider can answer "who is the
 * manager". Probed on 2026-08-20, the Premier League staff endpoint returned
 * two people carrying the role "Manager" for Chelsea, both active, both with an
 * Opta id and no start date; asked for 2023/24 it returned one row, a matchday
 * stand in who took a single fixture. The fixture detail payload carries no
 * manager at all.
 *
 * A Wikidata club item carries dated `head coach` statements (P286) with start
 * (P580) and end (P582) qualifiers. Chelsea's carries sixteen, and the open
 * ended one is Xabi Alonso. Dates are what make this usable: the manager of a
 * match is the spell covering its kickoff, which is a lookup rather than a
 * guess, and it reaches as far back as the archive does.
 *
 * The read goes through the entity API, which is the same one the ground
 * photographs already use. No SPARQL endpoint is involved, and none is wanted:
 * it answered a probe with 502 and it is the part of Wikimedia that rations
 * anonymous traffic hardest.
 */

const ENTITY_DATA = 'https://www.wikidata.org/wiki/Special:EntityData';
const SEARCH_API = 'https://www.wikidata.org/w/api.php';

const HEAD_COACH = 'P286';
const START_TIME = 'P580';
const END_TIME = 'P582';
const INSTANCE_OF = 'P31';
const HOME_VENUE = 'P115';
const COUNTRY_OF_CITIZENSHIP = 'P27';

/**
 * Entity ids that mean "this item is a football club", not a stadium or a town.
 *
 * The list is a list because Wikidata carries several: Arsenal is typed
 * Q476028 and Chelsea only Q103229495, so accepting one and not the other
 * silently drops a club. Each was observed on a real item rather than assumed.
 */
const CLUB_ENTITY_IDS = [
  'Q476028', // association football club
  'Q103229495', // football club
  'Q15944511', // association football team
  'Q17505183', // sports club
];

interface Snak {
  datavalue?: { value?: unknown };
}

interface Claim {
  mainsnak?: Snak;
  qualifiers?: Record<string, Snak[]>;
}

interface Entity {
  labels?: Record<string, { value?: string }>;
  claims?: Record<string, Claim[]>;
}

interface EntityResponse {
  entities?: Record<string, Entity>;
}

interface SearchResponse {
  search?: { id?: string; label?: string; description?: string }[];
}

/**
 * A club's name matches a lot of items that are not the club: its academy, its
 * women's team, its history article, a rivalry, and individual matches. The
 * women's and academy sides are the dangerous ones, because they share the
 * ground, so a venue check accepts them: probed on 2026-08-20, "Chelsea F.C."
 * resolved to the Development Squad on venue alone.
 */
const NOT_THE_CLUB =
  /\b(women|ladies|w\.?f\.?c|academy|reserves?|development|youth|under[- ]?\d+|u\d{2}|history|rivalry|supporters|season|match|list|statistics)\b/i;

function isSeniorClub(label: string | undefined, description: string | undefined): boolean {
  return !NOT_THE_CLUB.test(`${label ?? ''} ${description ?? ''}`);
}

function idOf(snak: Snak | undefined): string | null {
  const value = snak?.datavalue?.value;
  if (typeof value !== 'object' || value === null) return null;
  const id = (value as { id?: unknown }).id;
  return typeof id === 'string' ? id : null;
}

interface WikidataTime {
  time: string;
  precision: 'day' | 'month' | 'year';
}

/**
 * Wikidata times look like `+2024-07-01T00:00:00Z` with a precision code: 11 is
 * a day, 10 a month, 9 a year. A month or year precision date is kept and
 * labelled rather than dropped, because "appointed in July 2019" still places a
 * match in August 2019 under the right manager.
 */
function timeOf(snaks: Snak[] | undefined): WikidataTime | null {
  const value = snaks?.[0]?.datavalue?.value;
  if (typeof value !== 'object' || value === null) return null;
  const record = value as { time?: unknown; precision?: unknown };
  if (typeof record.time !== 'string') return null;
  const precision = typeof record.precision === 'number' ? record.precision : 11;
  const iso = record.time.replace(/^\+/, '');
  // A month or year precision date arrives with zeroed parts, which Date reads
  // as invalid, so they are pulled up to the first of the period.
  const normalised = iso.replace('-00-00T', '-01-01T').replace(/-00T/, '-01T');
  if (Number.isNaN(new Date(normalised).getTime())) return null;
  return {
    time: normalised,
    precision: precision >= 11 ? 'day' : precision === 10 ? 'month' : 'year',
  };
}

async function fetchEntity(http: HttpClient, id: string): Promise<Entity | null> {
  const payload = (await http.getJson(`${ENTITY_DATA}/${id}.json`)) as EntityResponse;
  return payload.entities?.[id] ?? null;
}

/** Several entities in one request, which is how the coach labels are read. */
async function fetchEntities(http: HttpClient, ids: string[]): Promise<Record<string, Entity>> {
  const out: Record<string, Entity> = {};
  for (let i = 0; i < ids.length; i += 40) {
    const batch = ids.slice(i, i + 40);
    const url =
      `${SEARCH_API}?action=wbgetentities&format=json&origin=*&props=labels|claims` +
      `&languages=en&ids=${batch.join('|')}`;
    const payload = (await http.getJson(url)) as EntityResponse;
    Object.assign(out, payload.entities ?? {});
  }
  return out;
}

function isClub(entity: Entity): boolean {
  return (entity.claims?.[INSTANCE_OF] ?? []).some((claim) => {
    const id = idOf(claim.mainsnak);
    return id !== null && CLUB_ENTITY_IDS.includes(id);
  });
}

export interface ClubMatch {
  entityId: string;
  label: string;
  /** How the club was accepted, so a suspect row can be audited later. */
  matchedBy: 'venue' | 'club-type';
}

/**
 * Resolve a club to its Wikidata item.
 *
 * A name search alone is not enough: "Arsenal" is also a district of London and
 * a football club in Tula. So a candidate is accepted only if it is an
 * association football club, and preferred when its home venue (P115) is the
 * ground entity the ground photographs already resolved for that club by
 * coordinates. That makes the join a cross check against something already
 * verified rather than a second name match.
 */
export async function resolveClub(
  http: HttpClient,
  name: string,
  groundEntityId: string | null,
  candidates = 8,
): Promise<ClubMatch | null> {
  const url =
    `${SEARCH_API}?action=wbsearchentities&format=json&origin=*&language=en&type=item` +
    `&limit=${String(candidates)}&search=${encodeURIComponent(name)}`;
  const payload = (await http.getJson(url)) as SearchResponse;
  const hits = (payload.search ?? []).filter(
    (entry): entry is { id: string; label?: string; description?: string } =>
      typeof entry.id === 'string' && isSeniorClub(entry.label, entry.description),
  );
  if (hits.length === 0) return null;

  const entities = await fetchEntities(
    http,
    hits.map((hit) => hit.id),
  );
  let fallback: ClubMatch | null = null;

  for (const hit of hits) {
    const entity = entities[hit.id];
    if (entity === undefined || !isClub(entity)) continue;
    const label = entity.labels?.['en']?.value ?? hit.label ?? name;

    if (groundEntityId !== null) {
      const venues = (entity.claims?.[HOME_VENUE] ?? []).map((claim) => idOf(claim.mainsnak));
      if (venues.includes(groundEntityId)) return { entityId: hit.id, label, matchedBy: 'venue' };
    }
    // Search ranks the senior club first for a full name, so the first item
    // that survives the filters is the fallback rather than an arbitrary one.
    fallback ??= { entityId: hit.id, label, matchedBy: 'club-type' };
  }
  return fallback;
}

/** Every dated head coach statement on a club item, oldest first. */
export async function readSpells(
  http: HttpClient,
  club: ClubMatch,
  team: Pick<Team, 'code' | 'name'>,
): Promise<ManagerSpell[]> {
  const entity = await fetchEntity(http, club.entityId);
  if (entity === null) return [];

  const claims = entity.claims?.[HEAD_COACH] ?? [];
  const raw = claims
    .map((claim) => {
      const managerEntityId = idOf(claim.mainsnak);
      const from = timeOf(claim.qualifiers?.[START_TIME]);
      if (managerEntityId === null || from === null) return null;
      return { managerEntityId, from, to: timeOf(claim.qualifiers?.[END_TIME]) };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  if (raw.length === 0) return [];

  // A statement carries the coach as an id. The names and nationalities come
  // back in one request rather than one per manager.
  const people = await fetchEntities(http, [...new Set(raw.map((entry) => entry.managerEntityId))]);

  return raw
    .map((entry) => {
      const person = people[entry.managerEntityId];
      const managerName = person?.labels?.['en']?.value;
      if (managerName === undefined) return null;
      const nationalityId = idOf(person?.claims?.[COUNTRY_OF_CITIZENSHIP]?.[0]?.mainsnak);
      return managerSpellSchema.parse({
        teamCode: team.code,
        teamName: team.name,
        clubEntityId: club.entityId,
        managerName,
        managerEntityId: entry.managerEntityId,
        // The country's own label needs another request per manager, which is
        // not worth it: the id is stable and a page can resolve it if it wants.
        nationality: nationalityId,
        from: new Date(entry.from.time),
        to: entry.to === null ? null : new Date(entry.to.time),
        precision: entry.from.precision,
      });
    })
    .filter((spell): spell is ManagerSpell => spell !== null)
    .sort((a, b) => a.from.getTime() - b.from.getTime());
}

export interface ManagerSpellOptions {
  /** Candidate items to check per club. */
  candidates?: number;
}

/**
 * One row per manager spell per club, for every club in the season's team list.
 *
 * Requires teams. Ground images are read where they exist, because their
 * Wikidata ids are what turn the club search from a name match into a cross
 * check, but their absence only weakens the check rather than stopping the run.
 */
export function managerSpellsSource(http: HttpClient, options: ManagerSpellOptions = {}): Source {
  return {
    name: 'managers-wikidata',
    datasets: [DATASETS.managerSpells],
    requires: [DATASETS.teams],

    async *run(context: SourceContext): AsyncIterable<SourceBatch> {
      // Every club in the record, not the twenty playing now. Built from the
      // current team list alone, this source left West Ham, Leicester, Burnley,
      // Southampton and Wolves with no manager at all, which is 38 percent of
      // the club matches in the training window carrying a missing feature
      // rather than a wrong one, and therefore invisible.
      const teams = await allClubs(context);

      const groundEntities = await readGroundEntities(context);
      // FPL names a club "Man Utd" and "Spurs", which a Wikidata search does
      // not find. The official record carries the full name for the same code.
      const fullNames = await readClubNames(context);
      const spells: ManagerSpell[] = [];
      let unresolved = 0;

      for (const team of teams) {
        const searchName = fullNames.get(team.code) ?? team.name;
        const club = await resolveClub(
          http,
          searchName,
          groundEntities.get(team.code) ?? null,
          options.candidates ?? 8,
        );
        if (club === null) {
          unresolved += 1;
          context.logger.warn('club not resolved', { team: team.name, searched: searchName });
          continue;
        }

        const found = await readSpells(http, club, team);
        if (found.length === 0) {
          context.logger.warn('club has no dated spells', {
            team: team.name,
            entity: club.entityId,
          });
        }
        spells.push(...found);
        context.logger.info('spells read', {
          team: team.name,
          entity: club.entityId,
          matchedBy: club.matchedBy,
          spells: found.length,
        });
      }

      if (unresolved > 0) context.logger.warn('clubs unresolved', { count: unresolved });
      if (spells.length === 0) return;

      yield { dataset: DATASETS.managerSpells, rows: spells, format: 'jsonl' };
    },
  };
}

/**
 * Every club the official record names, with its permanent code.
 *
 * A club that was relegated in 2018 still played the matches a model is fitted
 * on, and its manager is as much a fact about those matches as the current
 * champions' is about this week's.
 */
async function allClubs(context: SourceContext): Promise<Team[]> {
  const byCode = new Map<number, string>();

  const partitions = await context.store
    .partitions({ season: context.season, dataset: DATASETS.matches })
    .catch(() => [] as string[]);
  for (const partition of partitions) {
    const matches = await context.store
      .read<Match>({ season: context.season, dataset: DATASETS.matches, partition }, matchSchema)
      .catch(() => [] as Match[]);
    for (const match of matches) {
      byCode.set(match.homeTeamCode, match.homeTeamName);
      byCode.set(match.awayTeamCode, match.awayTeamName);
    }
  }

  if (byCode.size === 0) {
    // No official record: fall back to whoever is playing now, which is the
    // old behaviour and better than nothing.
    return context.store.read<Team>(
      { season: context.season, dataset: DATASETS.teams },
      teamSchema,
    );
  }

  return [...byCode.entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([code, name]) => ({ code, name }) as Team);
}

/**
 * The club's full name by code, from the official record. FPL publishes short
 * names built for a table cell, and a search for "Nott'm Forest" finds nothing.
 */
async function readClubNames(context: SourceContext): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  try {
    const partitions = await context.store.partitions({
      season: context.season,
      dataset: DATASETS.matches,
    });
    const newest = [...partitions].sort().pop();
    if (newest === undefined) return out;
    const matches = await context.store.read<Match>(
      { season: context.season, dataset: DATASETS.matches, partition: newest },
      matchSchema,
    );
    for (const match of matches) {
      out.set(match.homeTeamCode, match.homeTeamName);
      out.set(match.awayTeamCode, match.awayTeamName);
    }
  } catch {
    // A lake with no official record still runs, on FPL's own names.
  }
  return out;
}

/** Ground entity ids by club code, where the ground photographs resolved one. */
async function readGroundEntities(context: SourceContext): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  try {
    const grounds = await context.store.read<Ground>(
      { season: context.season, dataset: DATASETS.grounds },
      groundSchema,
    );
    const images = await context.store.read<GroundImage>(
      { season: context.season, dataset: DATASETS.groundImages },
      groundImageSchema,
    );
    const entityByGround = new Map(images.map((image) => [image.groundId, image.wikidataId]));
    for (const ground of grounds) {
      if (ground.teamCode === null) continue;
      const entity = entityByGround.get(ground.groundId);
      if (entity !== undefined) out.set(ground.teamCode, entity);
    }
  } catch {
    // A lake without ground photographs still resolves clubs, it just does so
    // on the club type alone. The stored row records which rule was used.
  }
  return out;
}
