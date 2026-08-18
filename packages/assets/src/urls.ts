/**
 * URL builders for the Premier League's own public image CDN. These are the
 * same files the official site and the FPL app render, so no third party
 * hosting or licence is involved, and no credential is needed.
 *
 * Both are keyed by `code`, not `id`: FPL renumbers `id` every promotion
 * cycle, while `code` survives a player changing club and a club being
 * relegated and promoted, which is what makes a cached file stay valid.
 */

const RESOURCES = 'https://resources.premierleague.com/premierleague';
const FPL_DIST = 'https://fantasy.premierleague.com/dist/img';

export const ASSET_KINDS = ['team-badge', 'team-badge-svg', 'team-shirt', 'player-photo'] as const;

export type AssetKind = (typeof ASSET_KINDS)[number];

/** Raster badge sizes the CDN publishes, smallest first. */
export const BADGE_SIZES = [25, 50, 100] as const;

export type BadgeSize = (typeof BADGE_SIZES)[number];

/** Photo sizes the CDN publishes, smallest first. */
export const PHOTO_SIZES = ['40x40', '110x140', '250x250'] as const;

export type PhotoSize = (typeof PHOTO_SIZES)[number];

export const badgeUrl = (teamCode: number, size: BadgeSize = 50): string =>
  `${RESOURCES}/badges/${String(size)}/t${String(teamCode)}.png`;

/** Retina raster, for a badge rendered larger than its nominal size. */
export const badgeUrl2x = (teamCode: number, size: BadgeSize = 50): string =>
  `${RESOURCES}/badges/${String(size)}/t${String(teamCode)}@x2.png`;

/** Vector badge, preferred wherever the render size is not fixed. */
export const badgeSvgUrl = (teamCode: number): string =>
  `${RESOURCES}/badges/t${String(teamCode)}.svg`;

export const playerPhotoUrl = (playerCode: number, size: PhotoSize = '250x250'): string =>
  `${RESOURCES}/photos/players/${size}/p${String(playerCode)}.png`;

/**
 * A manager's published portrait. The CDN keys these by the Opta person id
 * with a `man` prefix rather than the `p` a player takes, and the Premier
 * League's own API publishes that id, so nothing has to be guessed. A manager
 * with no published photograph answers 403, the same as an unphotographed
 * player, which the component treats as absence rather than failure.
 */
export const managerPhotoUrl = (photoCode: number, size: PhotoSize = '250x250'): string =>
  `${RESOURCES}/photos/players/${size}/man${String(photoCode)}.png`;

/**
 * Outfield shirt. FPL serves kits from its own bundle rather than from the
 * resources CDN, and the goalkeeper kit is a separate file suffixed `_1`.
 */
export const shirtUrl = (teamCode: number, options?: { keeper?: boolean }): string => {
  const suffix = options?.keeper === true ? '_1' : '';
  return `${FPL_DIST}/shirts/standard/shirt_${String(teamCode)}${suffix}-110.png`;
};
