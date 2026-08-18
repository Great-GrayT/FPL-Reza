import { z } from 'zod';

/**
 * A photograph of a ground, with everything needed to publish it lawfully.
 *
 * The Premier League CDN has no stadium imagery: every ground path it might
 * plausibly serve answers 403, which for that object store means absent. The
 * one keyless source of properly licensed stadium photographs is Wikimedia
 * Commons, reached through Wikidata, and almost all of it is Creative Commons
 * with an attribution condition. So the credit, the licence, and the link back
 * to the file page are stored beside the URL rather than fetched separately:
 * an image row that cannot be attributed cannot be shown, and making that
 * impossible to forget is the point of putting them in the same schema.
 */
export const groundImageSchema = z.object({
  groundId: z.number().int().positive(),
  /** The Wikidata item the photograph was resolved through, for auditing. */
  wikidataId: z.string().min(2),
  /** The article title the join matched, which is not always the ground name. */
  title: z.string().min(1),
  /** A thumbnail on the Commons upload host, already sized for the page. */
  imageUrl: z.string().url(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  /** The Commons file page, which the credit links to. */
  sourceUrl: z.string().url(),
  /** Short licence name, e.g. "CC BY-SA 4.0". */
  licence: z.string().min(1),
  licenceUrl: z.string().url().nullable(),
  /** The photographer, as Commons records them, stripped of markup. */
  credit: z.string().min(1),
  /**
   * Which rule accepted the join. Coordinates are the strong rule and the
   * default; the type rule is the weaker fallback for the three newest grounds,
   * for which the Premier League publishes no coordinates at all.
   */
  matchedBy: z.enum(['coordinates', 'stadium_type']),
  /**
   * Metres between the ground's own coordinates and the article's. The join is
   * only accepted under a tight threshold, and keeping the distance makes a
   * borderline match reviewable rather than invisible. Null where the ground
   * has no published coordinates and the type rule was used instead.
   */
  matchedWithinMetres: z.number().nonnegative().nullable(),
});

export type GroundImage = z.infer<typeof groundImageSchema>;

const EARTH_RADIUS_M = 6_371_000;

/** Great circle distance, which at these scales is exact enough to trust. */
export function distanceMetres(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * How close an article's coordinates must be to the ground's for the two to be
 * the same place. A large stadium is around 250 metres across and an article's
 * coordinate may sit on any corner of it, so 1,500 metres is generous enough
 * to survive that and tight enough to reject the neighbouring ground: no two
 * Premier League grounds are within 1.5 km of each other.
 */
export const GROUND_MATCH_METRES = 1500;

/**
 * Wikidata items that mean "this article is a place people watch sport in".
 * Used only where a ground has no coordinates to verify against, so the check
 * is that the article is a stadium rather than that it is this stadium.
 */
export const STADIUM_ENTITY_IDS: readonly string[] = [
  /** stadium */
  'Q483110',
  /** sports venue */
  'Q1076486',
  /** arena */
  'Q641226',
  /** association football stadium */
  'Q1154710',
  /** multi-purpose stadium */
  'Q1049757',
];
