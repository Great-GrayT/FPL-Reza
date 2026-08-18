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
  /** Referee appointments per match, and card and penalty rates. */
  'referees',
  /** Formation and lineup as set, per side per match. */
  'lineups',
  /** Who managed a club, and when. */
  'managers',
  /** Injury and fitness, either as a live status or as a history of spells. */
  'injuries',
  /** Club strength ratings over time. */
  'team_ratings',
  /** Conditions at a kickoff. */
  'weather',
  /** Grounds themselves: where they are, how many they hold, what they look like. */
  'grounds',
] as const;

export type CoverageKind = (typeof COVERAGE_KINDS)[number];

export const PROBE_VERDICTS = [
  /** Reachable, terms permit collection, and an adapter exists. */
  'built',
  /** Reachable and permitted, no adapter yet. */
  'available',
  /** Reachable, but the terms ask us not to collect it. */
  'refused_by_terms',
  /** Terms permit it, but the endpoint blocks automated access. */
  'blocked',
  /** Reachable from elsewhere but not from the machine that probed it. */
  'unreachable_here',
  /** Never probed. */
  'unprobed',
] as const;

export type ProbeVerdict = (typeof PROBE_VERDICTS)[number];

export interface ProviderInfo {
  id: string;
  name: string;
  url: string;
  access: AccessMode;
  coverage: readonly CoverageKind[];
  /**
   * What happened when someone last hit it, and when. A reputation is not a
   * verdict: this field only ever changes alongside a fresh probe.
   */
  verdict: ProbeVerdict;
  /** ISO date of that probe. */
  probedAt: string;
  /** Access terms and practical limits. Read this before writing an adapter. */
  notes: string;
}

export const PROVIDERS: readonly ProviderInfo[] = [
  {
    id: 'pl-official-api',
    name: 'Premier League official API',
    url: 'https://footballapi.pulselive.com/football',
    access: 'public',
    coverage: ['match_results', 'lineups', 'referees', 'managers'],
    verdict: 'built',
    probedAt: '2026-08-18',
    notes:
      'The site own backing API, keyless, needing an Origin and Referer of premierleague.com. 13,546 fixtures across 35 seasons from 1992/93. Per fixture it carries matchOfficials (the referee, role MAIN), events with minutes (goals, bookings, substitutions), and teamLists with a formation label plus its positional rows of player ids, full lineups with shirt number, captain flag and positionInfo in words. teams/{id}/compseasons/{seasonId}/staff carries the manager. This one source covers referees, formations, and managers officially. Its ids need no mapping at all: with altIds=true it publishes the Opta id beside its own for every club and person, and those digits are exactly FPL Team.code and Player.code, so the join is a substring rather than a name match. Ingested by pl-official as the matches, match-details, managers, and grounds datasets.',
  },
  {
    id: 'fpl-api',
    name: 'Fantasy Premier League API',
    url: 'https://fantasy.premierleague.com/api',
    access: 'public',
    coverage: ['fpl_core', 'match_results', 'aggregated_stats'],
    verdict: 'built',
    probedAt: '2026-08-18',
    notes:
      'Authoritative for prices, ownership, points, and deadlines. Carries no positional data. Unofficial in the sense that it is undocumented, so schemas must tolerate added fields.',
  },
  {
    id: 'football-data-uk',
    name: 'football-data.co.uk',
    url: 'https://www.football-data.co.uk/englandm.php',
    access: 'public',
    coverage: ['match_results', 'odds'],
    verdict: 'built',
    probedAt: '2026-08-18',
    notes:
      'Free season CSVs with opening and closing odds from many bookmakers. Historical only, updated after matchdays, so it backfills a model but cannot price an upcoming fixture.',
  },
  {
    id: 'open-meteo',
    name: 'Open-Meteo',
    url: 'https://open-meteo.com',
    access: 'public',
    coverage: ['weather'],
    verdict: 'built',
    probedAt: '2026-08-18',
    notes:
      'Keyless forecast and historical archive, no account and no attribution header. A ground carries its own coordinates on the Premier League API, so no geocoding step exists. The forecast reaches about sixteen days ahead and answers anything further with 400, and the archive lags reality by about five days, which is why the source picks between them by kickoff date. Ingested by weather-open-meteo.',
  },
  {
    id: 'wikimedia-commons',
    name: 'Wikimedia Commons, through Wikidata',
    url: 'https://commons.wikimedia.org',
    access: 'public',
    coverage: ['grounds'],
    verdict: 'built',
    probedAt: '2026-08-18',
    notes:
      'The only keyless source of licensed stadium photographs: the Premier League CDN answers every plausible ground path with 403, which for that object store means absent. A Wikipedia search finds candidates, Wikidata supplies each one coordinates (P625) and its image (P18), and a candidate is accepted only within 1.5 km of the ground the Premier League publishes, which is what resolves "American Express Stadium" to the article titled "Falmer Stadium". Almost every file is Creative Commons with an attribution condition, so the credit and licence are stored with the URL and a file whose credit cannot be read is refused: 19 of 20 grounds resolved on 2026-08-18. Ingested by grounds-wikimedia.',
  },
  {
    id: 'the-odds-api',
    name: 'The Odds API',
    url: 'https://the-odds-api.com',
    access: 'api_key',
    coverage: ['odds'],
    verdict: 'unprobed',
    probedAt: '2026-08-16',
    notes:
      'Live pre match and in play odds across bookmakers. Free tier is request capped, so poll on a schedule rather than on demand.',
  },
  {
    id: 'betfair-exchange',
    name: 'Betfair Exchange API',
    url: 'https://developer.betfair.com',
    access: 'api_key',
    coverage: ['odds'],
    verdict: 'unprobed',
    probedAt: '2026-08-16',
    notes:
      'Exchange prices carry a much smaller margin than bookmaker prices, so implied probabilities need less correction. Requires an application key and a certificate login.',
  },
  {
    id: 'fbref',
    name: 'FBref (Sports Reference)',
    url: 'https://fbref.com',
    access: 'public',
    coverage: ['aggregated_stats'],
    verdict: 'blocked',
    probedAt: '2026-08-18',
    notes:
      'Per 90 Opta derived detail. Every path, robots.txt included, answers a Cloudflare interactive challenge, so there is no adapter to write that does not defeat a bot check. Its aggregates overlap heavily with FPL and Sofascore anyway.',
  },
  {
    id: 'statsbomb-open',
    name: 'StatsBomb Open Data',
    url: 'https://github.com/statsbomb/open-data',
    access: 'public',
    coverage: ['event_locations', 'shot_locations'],
    verdict: 'available',
    probedAt: '2026-08-18',
    notes:
      'Full event streams with coordinates under a free licence, but Premier League coverage is limited to selected competitions and seasons. Best used to build and validate the event pipeline before paying for full coverage.',
  },
  {
    id: 'opta',
    name: 'Opta (Stats Perform)',
    url: 'https://www.statsperform.com',
    access: 'licensed',
    coverage: ['event_locations', 'aggregated_stats', 'match_results'],
    verdict: 'unprobed',
    probedAt: '2026-08-16',
    notes:
      'The feed FPL itself scores from, including the BPS inputs and the clearances, blocks, interceptions, tackles and recoveries behind defensive contribution. Commercial licence required.',
  },
  {
    id: 'skillcorner',
    name: 'SkillCorner',
    url: 'https://skillcorner.com',
    access: 'licensed',
    coverage: ['tracking'],
    verdict: 'unprobed',
    probedAt: '2026-08-16',
    notes:
      'Broadcast derived tracking: positions, distance, sprints, and off ball runs. This is the only category that supports true movement analysis rather than on ball events.',
  },
  {
    id: 'pff-fc',
    name: 'PFF FC',
    url: 'https://fc.pff.com',
    access: 'licensed',
    coverage: ['tracking', 'event_locations'],
    verdict: 'unprobed',
    probedAt: '2026-08-16',
    notes:
      'Tracking plus events from one provider, which removes the event to frame alignment step.',
  },
  {
    id: 'wyscout',
    name: 'Wyscout (Hudl)',
    url: 'https://www.hudl.com/products/wyscout',
    access: 'licensed',
    coverage: ['event_locations', 'aggregated_stats'],
    verdict: 'unprobed',
    probedAt: '2026-08-16',
    notes: 'Event data with coordinates and video. Common alternative to Opta for event coverage.',
  },
  {
    id: 'sofascore',
    name: 'Sofascore',
    url: 'https://api.sofascore.com/api/v1',
    access: 'public',
    coverage: ['event_locations', 'shot_locations', 'aggregated_stats'],
    verdict: 'blocked',
    probedAt: '2026-08-18',
    notes:
      'Player heatmaps, average positions, per player match statistics, shot coordinates with expected goals, and national team records. The adapter is written and works: on 2026-08-18 it resolved 272 of a completed season 380 fixtures against the official record, the 108 misses being clubs since relegated. Then, part way through that backfill, every path began answering 403 with a body of {"error":{"code":403,"reason":"challenge"}}, listing endpoints included, and was still doing so an hour later. So this is a rate limit or a bot challenge tripped by sustained use rather than a change of terms, and the verdict is blocked rather than refused. Retry from a different address, and slower: the adapter costs one request per player per match.',
  },
  {
    id: 'transfermarkt',
    name: 'Transfermarkt',
    url: 'https://www.transfermarkt.com',
    access: 'public',
    coverage: ['club_transfers', 'injuries', 'managers', 'referees'],
    verdict: 'available',
    probedAt: '2026-08-18',
    notes:
      'robots.txt allows * and disallows wget by name, so a real user agent and a courteous delay are the requirement. Per player injury history is server rendered and parses (2 tables on the page probed). Manager career history is on the same terms. The referee section path still needs finding: the guessed URL returned no table, so do not assume it.',
  },
];

/** Sources probed and rejected, kept so nobody rediscovers them. */
export const REJECTED_PROVIDERS: readonly ProviderInfo[] = [
  {
    id: 'understat',
    name: 'Understat',
    url: 'https://understat.com',
    access: 'public',
    coverage: ['shot_locations', 'aggregated_stats'],
    verdict: 'refused_by_terms',
    probedAt: '2026-08-18',
    notes:
      'Shot level xG with coordinates, embedded in page scripts. The page answers 200, but robots.txt is User-agent * with Disallow /, so the whole site asks not to be crawled. Excluded on the terms, not the technology. FPL carries xG from 2022/23 and Sofascore gives it per shot, so what is lost is a second opinion.',
  },
  {
    id: 'worldfootball',
    name: 'worldfootball.net',
    url: 'https://www.worldfootball.net',
    access: 'public',
    coverage: ['referees', 'match_results'],
    verdict: 'blocked',
    probedAt: '2026-08-18',
    notes:
      'Referee appointments. Answers 403 to a browser user agent, and again with language and accept headers. Redundant in any case: the PL official API gives the referee per match.',
  },
  {
    id: 'whoscored',
    name: 'WhoScored',
    url: 'https://www.whoscored.com',
    access: 'public',
    coverage: ['lineups', 'aggregated_stats'],
    verdict: 'available',
    probedAt: '2026-08-18',
    notes:
      'Formations per match, inside a matchCentreData payload on match pages; robots.txt disallows only account, prediction and user paths. Not worth building: the PL official API gives formations officially with the positional rows, and this site is heavily protected. Revisit only if that changes.',
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
