import {
  GROUND_MATCH_METRES,
  STADIUM_ENTITY_IDS,
  distanceMetres,
  groundImageSchema,
  groundSchema,
  type Ground,
  type GroundImage,
} from '@fpl/core';
import { HttpClient, type HttpClientOptions } from '../http.js';
import { DATASETS, type Source, type SourceBatch, type SourceContext } from '../source.js';

/**
 * Stadium photographs from Wikimedia Commons, resolved through Wikidata.
 *
 * The join is not by name. A search finds candidate articles, each candidate's
 * Wikidata item is read for its coordinates, and a candidate is accepted only
 * if it sits within a short walk of the coordinates the Premier League
 * publishes for that ground. That is what lets "American Express Stadium"
 * resolve to the article titled "Falmer Stadium", and what stops a search for
 * a generically named ground resolving to a stadium in another country.
 *
 * No key, no account. Wikimedia asks only for a descriptive user agent, which
 * is set below and is the one condition of their API etiquette policy.
 */

export const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';
export const WIKIDATA_ENTITY = 'https://www.wikidata.org/wiki/Special:EntityData';
export const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';

export function wikimediaHttp(options?: Partial<HttpClientOptions>): HttpClient {
  return new HttpClient({
    baseUrl: 'https://en.wikipedia.org',
    timeoutMs: 20_000,
    retries: 3,
    // Wikimedia's etiquette guidance is serial requests from one client, which
    // this satisfies with room to spare.
    minRequestIntervalMs: 400,
    userAgent: 'fpl-platform/0.0.0 (https://github.com/Great-GrayT/FPL)',
    name: 'wikimedia',
    ...options,
  });
}

interface SearchResponse {
  query?: { search?: { title?: string }[] };
}

interface EntityResponse {
  entities?: Record<
    string,
    {
      claims?: Record<string, { mainsnak?: { datavalue?: { value?: unknown } } }[]>;
    }
  >;
}

interface ImageInfoResponse {
  query?: {
    pages?: Record<
      string,
      {
        imageinfo?: {
          thumburl?: string;
          thumbwidth?: number;
          thumbheight?: number;
          descriptionurl?: string;
          extmetadata?: Record<string, { value?: string }>;
        }[];
      }
    >;
  };
}

/** Commons stores its metadata as HTML fragments. A credit line is not HTML. */
const stripMarkup = (value: string): string =>
  value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

interface Coordinate {
  latitude: number;
  longitude: number;
}

function coordinateOf(
  entity: EntityResponse['entities'] extends undefined
    ? never
    : NonNullable<EntityResponse['entities']>[string],
): Coordinate | null {
  const value = entity.claims?.['P625']?.[0]?.mainsnak?.datavalue?.value;
  if (typeof value !== 'object' || value === null) return null;
  const record = value as { latitude?: unknown; longitude?: unknown };
  if (typeof record.latitude !== 'number' || typeof record.longitude !== 'number') return null;
  return { latitude: record.latitude, longitude: record.longitude };
}

/** Whether the article is about a stadium, for the coordinate-less fallback. */
function isStadium(entity: NonNullable<EntityResponse['entities']>[string]): boolean {
  return (entity.claims?.['P31'] ?? []).some((claim) => {
    const value = claim.mainsnak?.datavalue?.value;
    if (typeof value !== 'object' || value === null) return false;
    const id = (value as { id?: unknown }).id;
    return typeof id === 'string' && STADIUM_ENTITY_IDS.includes(id);
  });
}

function imageFileOf(entity: NonNullable<EntityResponse['entities']>[string]): string | null {
  const value = entity.claims?.['P18']?.[0]?.mainsnak?.datavalue?.value;
  return typeof value === 'string' && value !== '' ? value : null;
}

export interface WikimediaGroundOptions {
  /** How wide a thumbnail to ask Commons for. */
  thumbnailWidth?: number;
  /** Candidate articles to check per ground. */
  candidates?: number;
  /** Metres a candidate may sit from the ground and still be it. */
  toleranceMetres?: number;
}

/**
 * One photograph per ground, with its licence and credit. Requires the grounds
 * dataset, since the coordinates that verify each match come from it.
 */
export function groundImagesSource(http: HttpClient, options: WikimediaGroundOptions = {}): Source {
  const thumbnailWidth = options.thumbnailWidth ?? 960;
  const candidateCount = options.candidates ?? 4;
  const tolerance = options.toleranceMetres ?? GROUND_MATCH_METRES;

  return {
    name: 'grounds-wikimedia',
    datasets: [DATASETS.groundImages],
    requires: [DATASETS.grounds],

    async *run(context: SourceContext): AsyncIterable<SourceBatch> {
      const grounds = await context.store.read<Ground>(
        { season: context.season, dataset: DATASETS.grounds },
        groundSchema,
      );

      const rows: GroundImage[] = [];
      let unmatched = 0;
      let noPhoto = 0;

      for (const ground of grounds) {
        // Three of the newest grounds carry no coordinates in the official
        // record. Rather than skip them, the join falls back to checking the
        // article is a stadium, and stores which rule was used so the weaker
        // one is visible rather than indistinguishable from the strong one.
        const here: Coordinate | null =
          ground.latitude === null || ground.longitude === null
            ? null
            : { latitude: ground.latitude, longitude: ground.longitude };

        // Two queries: the ground with its city, which disambiguates the many
        // grounds sharing a name, and the ground alone, which finds the ones
        // the provider names after a sponsor the article does not use.
        const queries = [
          [ground.name, ground.city].filter((part) => part !== null).join(' '),
          ground.name,
        ];

        const titles: string[] = [];
        for (const query of new Set(queries)) {
          const search = (await http.getJson(
            `${WIKIPEDIA_API}?action=query&list=search&srsearch=${encodeURIComponent(query)}` +
              `&srlimit=${String(candidateCount)}&format=json&origin=*`,
          )) as SearchResponse;
          for (const entry of search.query?.search ?? []) {
            if (entry.title !== undefined && !titles.includes(entry.title))
              titles.push(entry.title);
          }
        }

        // Every qualifying candidate is collected and the closest wins, rather
        // than the first the search happened to rank highest. Searching for
        // "Selhurst Park" returns the suburb of Selhurst above the ground, and
        // both sit inside the tolerance, so first-past-the-post picked a
        // photograph of a residential street.
        const candidates: {
          title: string;
          wikidataId: string;
          file: string;
          metres: number | null;
        }[] = [];

        for (const title of titles) {
          const summary = (await http.getJson(
            `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`,
          )) as { wikibase_item?: string };
          const wikidataId = summary.wikibase_item;
          if (wikidataId === undefined) continue;

          const payload = (await http.getJson(
            `${WIKIDATA_ENTITY}/${wikidataId}.json`,
          )) as EntityResponse;
          const entity = payload.entities?.[wikidataId];
          if (entity === undefined) continue;

          let metres: number | null = null;
          if (here === null) {
            if (!isStadium(entity)) continue;
          } else {
            const coordinate = coordinateOf(entity);
            if (coordinate === null) continue;
            metres = distanceMetres(here, coordinate);
            // Coordinates are the whole join where they exist. A candidate that
            // is not physically this ground is rejected however well its name
            // reads: searching "Selhurst Park" ranks the suburb of Selhurst
            // above the ground, and both sit inside any usable tolerance.
            if (metres > tolerance) continue;
          }

          const file = imageFileOf(entity);
          if (file === null) {
            noPhoto += 1;
            continue;
          }
          candidates.push({ title, wikidataId, file, metres });
        }

        candidates.sort(
          (a, b) => (a.metres ?? Number.MAX_SAFE_INTEGER) - (b.metres ?? Number.MAX_SAFE_INTEGER),
        );

        // Resolving is a loop rather than a single pick, because a file whose
        // credit cannot be read is unpublishable and the next closest article
        // may carry one that can.
        let resolved: {
          title: string;
          wikidataId: string;
          file: string;
          metres: number | null;
          image: NonNullable<
            NonNullable<NonNullable<ImageInfoResponse['query']>['pages']>[string]['imageinfo']
          >[number];
          url: string;
          sourceUrl: string;
          licence: string;
          artist: string;
        } | null = null;

        for (const candidate of candidates) {
          const info = (await http.getJson(
            `${COMMONS_API}?action=query&titles=${encodeURIComponent(`File:${candidate.file}`)}` +
              `&prop=imageinfo&iiprop=url%7Cextmetadata&iiurlwidth=${String(thumbnailWidth)}` +
              `&format=json&origin=*`,
          )) as ImageInfoResponse;

          const page = Object.values(info.query?.pages ?? {})[0];
          const image = page?.imageinfo?.[0];
          const meta = image?.extmetadata ?? {};
          const url = image?.thumburl;
          const sourceUrl = image?.descriptionurl;
          const licence = meta['LicenseShortName']?.value;
          const artist = meta['Artist']?.value ?? meta['Credit']?.value;

          // Attribution is a licence condition, not a nicety. A photograph
          // whose credit or licence cannot be read is not stored, because
          // storing it would mean publishing it without either.
          if (
            image === undefined ||
            url === undefined ||
            sourceUrl === undefined ||
            licence === undefined ||
            artist === undefined
          ) {
            context.logger.warn('photograph lacks attribution, trying the next candidate', {
              ground: ground.name,
              file: candidate.file,
            });
            continue;
          }

          resolved = { ...candidate, image, url, sourceUrl, licence, artist };
          break;
        }

        if (resolved === null) {
          unmatched += 1;
          context.logger.warn('no photograph resolved for ground', {
            ground: ground.name,
            city: ground.city ?? '',
            candidates: titles.join(', '),
          });
          continue;
        }

        rows.push(
          groundImageSchema.parse({
            groundId: ground.groundId,
            wikidataId: resolved.wikidataId,
            title: resolved.title,
            // The API appends its own analytics parameters, which are not part
            // of the file's address and only make the URL harder to compare.
            imageUrl: resolved.url.split('?')[0],
            width: resolved.image.thumbwidth ?? null,
            height: resolved.image.thumbheight ?? null,
            sourceUrl: resolved.sourceUrl,
            licence: stripMarkup(resolved.licence),
            licenceUrl: resolved.image.extmetadata?.['LicenseUrl']?.value ?? null,
            credit: stripMarkup(resolved.artist),
            matchedBy: resolved.metres === null ? 'stadium_type' : 'coordinates',
            matchedWithinMetres: resolved.metres === null ? null : Math.round(resolved.metres),
          }),
        );
      }

      context.logger.info('ground photographs resolved', {
        grounds: grounds.length,
        rows: rows.length,
        unmatched,
        noPhoto,
      });

      if (rows.length > 0) {
        yield { dataset: DATASETS.groundImages, rows, format: 'jsonl' };
      }
    },
  };
}
