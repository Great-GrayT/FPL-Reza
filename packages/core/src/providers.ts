/**
 * Candidate data sources, recorded as data so coverage gaps are visible in
 * code rather than living in someone's head. Nothing here fetches anything:
 * an entry is a statement of what a provider carries and what it costs to
 * access, which is what decides whether a source adapter gets written.
 */

export const ACCESS_MODES = [
  /** Open endpoint or file, no credentials. */
  'public',
  /** Free or paid key, self service. */
  'api_key',
  /** Commercial agreement required before any use. */
  'licensed',
  /** No feed: files are exported by hand and dropped into the lake. */
  'manual_upload',
] as const;

export type AccessMode = (typeof ACCESS_MODES)[number];

export const COVERAGE_KINDS = [
  'fpl_core',
  'match_results',
  'aggregated_stats',
  'shot_locations',
  'event_locations',
  'tracking',
  'odds',
  'club_transfers',
] as const;

export type CoverageKind = (typeof COVERAGE_KINDS)[number];

export interface ProviderInfo {
  id: string;
  name: string;
  url: string;
  access: AccessMode;
  coverage: readonly CoverageKind[];
  /** Access terms and practical limits. Read this before writing an adapter. */
  notes: string;
}

export const PROVIDERS: readonly ProviderInfo[] = [
  {
    id: 'fpl-api',
    name: 'Fantasy Premier League API',
    url: 'https://fantasy.premierleague.com/api',
    access: 'public',
    coverage: ['fpl_core', 'match_results', 'aggregated_stats'],
    notes:
      'Authoritative for prices, ownership, points, and deadlines. Carries no positional data. Unofficial in the sense that it is undocumented, so schemas must tolerate added fields.',
  },
  {
    id: 'football-data-uk',
    name: 'football-data.co.uk',
    url: 'https://www.football-data.co.uk/englandm.php',
    access: 'public',
    coverage: ['match_results', 'odds'],
    notes:
      'Free season CSVs with opening and closing odds from many bookmakers. Historical only, updated after matchdays, so it backfills a model but cannot price an upcoming fixture.',
  },
  {
    id: 'the-odds-api',
    name: 'The Odds API',
    url: 'https://the-odds-api.com',
    access: 'api_key',
    coverage: ['odds'],
    notes:
      'Live pre match and in play odds across bookmakers. Free tier is request capped, so poll on a schedule rather than on demand.',
  },
  {
    id: 'betfair-exchange',
    name: 'Betfair Exchange API',
    url: 'https://developer.betfair.com',
    access: 'api_key',
    coverage: ['odds'],
    notes:
      'Exchange prices carry a much smaller margin than bookmaker prices, so implied probabilities need less correction. Requires an application key and a certificate login.',
  },
  {
    id: 'understat',
    name: 'Understat',
    url: 'https://understat.com',
    access: 'public',
    coverage: ['shot_locations', 'aggregated_stats'],
    notes:
      'Shot level xG with coordinates. Data is embedded in page scripts, so ingestion means parsing HTML. Check the site terms before automating, and rate limit heavily.',
  },
  {
    id: 'fbref',
    name: 'FBref (Sports Reference)',
    url: 'https://fbref.com',
    access: 'public',
    coverage: ['aggregated_stats'],
    notes:
      'Per 90 detail including touches by third and penalty area, progressive carries and passes, and defensive actions. Zone aggregates only, not a true heatmap. Terms forbid heavy automated access, so cache and throttle.',
  },
  {
    id: 'statsbomb-open',
    name: 'StatsBomb Open Data',
    url: 'https://github.com/statsbomb/open-data',
    access: 'public',
    coverage: ['event_locations', 'shot_locations'],
    notes:
      'Full event streams with coordinates under a free licence, but Premier League coverage is limited to selected competitions and seasons. Best used to build and validate the event pipeline before paying for full coverage.',
  },
  {
    id: 'opta',
    name: 'Opta (Stats Perform)',
    url: 'https://www.statsperform.com',
    access: 'licensed',
    coverage: ['event_locations', 'aggregated_stats', 'match_results'],
    notes:
      'The feed FPL itself scores from, including the BPS inputs and the clearances, blocks, interceptions, tackles and recoveries behind defensive contribution. Commercial licence required.',
  },
  {
    id: 'skillcorner',
    name: 'SkillCorner',
    url: 'https://skillcorner.com',
    access: 'licensed',
    coverage: ['tracking'],
    notes:
      'Broadcast derived tracking: positions, distance, sprints, and off ball runs. This is the only category that supports true movement analysis rather than on ball events.',
  },
  {
    id: 'pff-fc',
    name: 'PFF FC',
    url: 'https://fc.pff.com',
    access: 'licensed',
    coverage: ['tracking', 'event_locations'],
    notes:
      'Tracking plus events from one provider, which removes the event to frame alignment step.',
  },
  {
    id: 'wyscout',
    name: 'Wyscout (Hudl)',
    url: 'https://www.hudl.com/products/wyscout',
    access: 'licensed',
    coverage: ['event_locations', 'aggregated_stats'],
    notes: 'Event data with coordinates and video. Common alternative to Opta for event coverage.',
  },
  {
    id: 'transfermarkt',
    name: 'Transfermarkt',
    url: 'https://www.transfermarkt.co.uk',
    access: 'manual_upload',
    coverage: ['club_transfers'],
    notes:
      'Fees, contract dates, and market values. Automated access is against the site terms, so treat this as a manual export rather than a scraped feed.',
  },
];

export const providersCovering = (kind: CoverageKind): ProviderInfo[] =>
  PROVIDERS.filter((provider) => provider.coverage.includes(kind));

/** Coverage kinds no currently accessible provider supplies. */
export function coverageGaps(available: readonly string[]): CoverageKind[] {
  const covered = new Set(
    PROVIDERS.filter((provider) => available.includes(provider.id)).flatMap(
      (provider) => provider.coverage,
    ),
  );
  return COVERAGE_KINDS.filter((kind) => !covered.has(kind));
}
