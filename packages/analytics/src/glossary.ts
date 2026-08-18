/**
 * The dictionary behind every number this platform shows. A metric with no
 * stated definition is a number a manager cannot argue with, and an interface
 * full of unarguable numbers is one nobody trusts twice.
 *
 * Each entry carries what it is, how it is computed (the exact operation, not a
 * paraphrase), and where the input comes from. The web app links every column
 * header and stat label to its entry, and the glossary page renders the lot.
 */

export interface GlossaryEntry {
  /** Stable id, used as an anchor and as the key a UI looks up. */
  id: string;
  term: string;
  short: string;
  /** How it is computed, precisely enough to reproduce. */
  formula?: string;
  /** Where the underlying numbers come from. */
  source: string;
  /** What it is good and bad for, where that is not obvious. */
  caveat?: string;
}

export const GLOSSARY: readonly GlossaryEntry[] = [
  {
    id: 'points',
    term: 'Points',
    short: 'Fantasy points scored, by the official scoring table.',
    formula:
      'Appearance, goals, assists, clean sheets, saves, penalties, cards, own goals, defensive contribution, and bonus, summed per match.',
    source: 'FPL, and recomputed independently by this platform from the match stats.',
  },
  {
    id: 'form',
    term: 'Form',
    short: 'Points per game over the last six gameweeks.',
    formula: 'Sum of points in the window divided by the gameweeks in it.',
    source: 'Per gameweek history from the FPL API.',
    caveat:
      'A blank gameweek counts as a played gameweek with a low score, so form falls for a player whose club did not play.',
  },
  {
    id: 'points-per-90',
    term: 'Points per 90',
    short: 'Points scaled to a full match, so a substitute is comparable to a starter.',
    formula: 'points divided by minutes, times 90. Zero minutes yields 0 rather than a division.',
    source: 'Per gameweek history.',
    caveat:
      'Flattering for a player with few minutes: appearance points make a 10 minute cameo look efficient.',
  },
  {
    id: 'starter-reliability',
    term: 'Starter reliability',
    short: 'Share of recent gameweeks with a full, 60 minute appearance.',
    formula: 'Gameweeks with 60 or more minutes divided by gameweeks considered.',
    source: 'Per gameweek history.',
  },
  {
    id: 'ppm',
    term: 'Points per million',
    short: 'Points returned for each million of price.',
    formula: 'total points divided by price in millions.',
    source: 'FPL totals and current price.',
    caveat:
      'Rewards cheap players who play. A 4.0m defender who plays every week beats a 14.0m forward on this measure and would still lose you the season.',
  },
  {
    id: 'price',
    term: 'Price',
    short: 'Current cost, in millions.',
    formula:
      'Held internally as integer tenths of a million, so budget arithmetic is exact rather than floating point.',
    source: 'FPL bootstrap.',
  },
  {
    id: 'selling-price',
    term: 'Selling price',
    short: 'What a squad receives on selling a player.',
    formula:
      'A price fall is passed on in full; a rise is only half realised, rounded down to the nearest tenth.',
    source: 'The published FPL transfer rules.',
  },
  {
    id: 'xg',
    term: 'xG, expected goals',
    short: 'The goals a set of shots would be expected to yield.',
    formula: 'Sum over shots of the modelled probability that each becomes a goal.',
    source: 'FPL from the 2022/23 season onward, and Sofascore per shot where available.',
    caveat:
      'Not recorded before 2022/23, so those seasons are blank rather than zero. It describes chance quality, not finishing.',
  },
  {
    id: 'xa',
    term: 'xA, expected assists',
    short: 'The assists a set of passes would be expected to yield.',
    formula: 'Sum over passes of the modelled probability that each leads to a goal.',
    source: 'FPL from 2022/23 onward.',
  },
  {
    id: 'xgi',
    term: 'xGI, expected goal involvements',
    short: 'Expected goals and expected assists together.',
    formula: 'xG plus xA, per 90 minutes where shown as a rate.',
    source: 'FPL from 2022/23 onward.',
  },
  {
    id: 'bps',
    term: 'BPS, bonus points system',
    short: 'The per match score that decides who receives the bonus points.',
    formula:
      'A weighted sum of match actions: goals and assists by position, tackles, saves, key passes, pass completion bands from 30 attempted passes, minus errors and cards.',
    source: 'FPL per match, with the weights mirrored in this codebase.',
  },
  {
    id: 'bonus',
    term: 'Bonus',
    short: 'The 3, 2, and 1 points awarded to the best BPS scores in each match.',
    formula:
      'Highest BPS takes 3, next 2, next 1. A tie consumes as many slots as it has members, so two players tied for first both score 3 and the 2 is skipped.',
    source: 'FPL, and predicted by this platform from live BPS.',
  },
  {
    id: 'defensive-contribution',
    term: 'DC, defensive contribution',
    short: 'Two points for defensive volume, introduced in 2025/26.',
    formula:
      'A flat 2 points at 10 clearances, blocks, interceptions and tackles for a defender, or 12 of those plus recoveries for a midfielder or forward. It does not stack past the threshold.',
    source: 'FPL from 2025/26 onward.',
    caveat: 'Blank for seasons before 2025/26, since nobody was recording it for scoring.',
  },
  {
    id: 'fdr',
    term: 'FDR, fixture difficulty',
    short: 'How hard a fixture is for a given club, from 1 easiest to 5 hardest.',
    formula:
      'Published by FPL per fixture and per side. This platform also computes a strength adjusted variant from the two clubs attack and defence ratings.',
    source: 'FPL fixtures.',
    caveat:
      'Coarse and set before the season. Averaging it over a horizon hides a blank or a double, which is why those are reported separately rather than folded into the average.',
  },
  {
    id: 'blank',
    term: 'Blank gameweek',
    short: 'A gameweek in which a club does not play.',
    source: 'Derived from the fixture list.',
    caveat: 'A blank scores zero for every player at that club, however good their form.',
  },
  {
    id: 'double',
    term: 'Double gameweek',
    short: 'A gameweek in which a club plays twice.',
    source: 'Derived from the fixture list.',
  },
  {
    id: 'ownership',
    term: 'Ownership',
    short: 'Share of FPL squads holding the player.',
    source: 'FPL bootstrap, updated daily.',
    caveat:
      'The only competitive dimension that is not points: a player everybody owns cannot gain you rank however well they score.',
  },
  {
    id: 'projection',
    term: 'Projected points',
    short: 'This platform own estimate of points per gameweek ahead.',
    formula:
      'Points per game over the last six gameweeks (or last season before this one starts), multiplied by a fixture term of 1 plus 0.12 per difficulty step either side of neutral, then by availability and starter reliability.',
    source: 'Computed here from form, fixtures, and availability.',
    caveat:
      'A transparent heuristic with no fitted parameters, not a model. Every input is shown so you can disagree with it.',
  },
  {
    id: 'edge',
    term: 'Edge',
    short: 'Projected points per gameweek for each percent of ownership.',
    formula: 'Projected points divided by ownership percent, floored at a tenth of a percent.',
    source: 'Computed here.',
    caveat: 'A ranking device for finding overlooked players, not a quantity with a unit.',
  },
  {
    id: 'clean-sheet-probability',
    term: 'Clean sheet probability',
    short: 'Chance a club concedes nothing, implied by the betting market.',
    formula:
      'Bookmaker prices become probabilities, the margin is removed proportionally, and the goal expectations that best fit those fair probabilities are recovered from a Poisson scoreline grid. The clean sheet chance is exp of minus the opposing expectation.',
    source: 'Closing odds from football-data.co.uk.',
  },
  {
    id: 'budget',
    term: 'Budget',
    short: 'The 100.0m a new squad has to spend on fifteen players.',
    formula:
      'Squad cost is the sum of the fifteen current prices. Two goalkeepers, five defenders, five midfielders, three forwards, and no more than three players from one club.',
    source: 'The published FPL squad rules.',
  },
];

const BY_ID = new Map(GLOSSARY.map((entry) => [entry.id, entry]));

export const glossaryEntry = (id: string): GlossaryEntry | undefined => BY_ID.get(id);

/** Ids in the order the glossary page prints them: as authored, not alphabetical. */
export const GLOSSARY_IDS: readonly string[] = GLOSSARY.map((entry) => entry.id);
