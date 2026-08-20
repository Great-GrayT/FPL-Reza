/**
 * What each column in the panel means, and what a reader is allowed to
 * conclude from it. This is the only place in the Lab that knows football:
 * `@fpl/quant` computes statistics over numbers, and this file says which
 * numbers those are, what they are called, and where they stop existing.
 */

export type Role = 'measure' | 'rate' | 'label' | 'context';

export interface ColumnMeta {
  name: string;
  label: string;
  role: Role;
  /** Short line shown under a picker and in a tooltip. */
  note: string;
  /** First season the measure was recorded. Absent means every stored season. */
  from?: string;
  /** Known before the gameweek is played, so it may be a feature. */
  knownBefore?: boolean;
  format?: 'integer' | 'decimal' | 'price' | 'percent';
}

export const PANEL_COLUMNS: ColumnMeta[] = [
  {
    name: 'season',
    label: 'Season',
    role: 'label',
    note: 'The season the gameweek belongs to.',
    knownBefore: true,
  },
  {
    name: 'gameweek',
    label: 'Gameweek',
    role: 'context',
    note: 'Gameweek number, 1 to 38.',
    knownBefore: true,
    format: 'integer',
  },
  {
    name: 'period',
    label: 'Period',
    role: 'context',
    note: 'Gameweeks counted continuously across seasons, so a rolling window can cross a summer.',
    knownBefore: true,
    format: 'integer',
  },
  {
    name: 'name',
    label: 'Player',
    role: 'label',
    note: 'Name as recorded in that season.',
    knownBefore: true,
  },
  {
    name: 'position',
    label: 'Position',
    role: 'label',
    note: 'GKP, DEF, MID, or FWD, as recorded at the time.',
    knownBefore: true,
  },
  {
    name: 'team',
    label: 'Club',
    role: 'label',
    note: 'Club at the time of the match.',
    knownBefore: true,
  },
  {
    name: 'opponentTeam',
    label: 'Opponent',
    role: 'context',
    note: "Opponent's club id in that season's numbering.",
    knownBefore: true,
    format: 'integer',
  },
  {
    name: 'wasHome',
    label: 'Home',
    role: 'context',
    note: 'Whether the player was at home.',
    knownBefore: true,
  },
  {
    name: 'price',
    label: 'Price',
    role: 'context',
    note: 'Price in tenths of a million at that gameweek.',
    knownBefore: true,
    format: 'price',
  },
  {
    name: 'selectedBy',
    label: 'Ownership',
    role: 'context',
    note: 'Share of managers holding the player, in percent.',
    knownBefore: true,
    format: 'percent',
  },

  {
    name: 'totalPoints',
    label: 'Points',
    role: 'measure',
    note: 'FPL points scored in the gameweek.',
    format: 'integer',
  },
  {
    name: 'minutes',
    label: 'Minutes',
    role: 'measure',
    note: 'Minutes played. Zero rows are the majority of the panel.',
    format: 'integer',
  },
  { name: 'goals', label: 'Goals', role: 'measure', note: 'Goals scored.', format: 'integer' },
  { name: 'assists', label: 'Assists', role: 'measure', note: 'Assists.', format: 'integer' },
  {
    name: 'cleanSheets',
    label: 'Clean sheets',
    role: 'measure',
    note: 'Clean sheet flag, which pays only on a sixty minute appearance.',
    format: 'integer',
  },
  {
    name: 'goalsConceded',
    label: 'Conceded',
    role: 'measure',
    note: 'Goals conceded while on the pitch.',
    format: 'integer',
  },
  {
    name: 'saves',
    label: 'Saves',
    role: 'measure',
    note: 'Saves, keepers only.',
    format: 'integer',
  },
  {
    name: 'bonus',
    label: 'Bonus',
    role: 'measure',
    note: 'Bonus points awarded.',
    format: 'integer',
  },
  {
    name: 'bps',
    label: 'BPS',
    role: 'measure',
    note: 'Bonus points system score, which decides the bonus.',
    format: 'integer',
  },
  {
    name: 'yellowCards',
    label: 'Yellows',
    role: 'measure',
    note: 'Yellow cards.',
    format: 'integer',
  },
  { name: 'redCards', label: 'Reds', role: 'measure', note: 'Red cards.', format: 'integer' },
  { name: 'ownGoals', label: 'Own goals', role: 'measure', note: 'Own goals.', format: 'integer' },
  {
    name: 'penaltiesSaved',
    label: 'Pens saved',
    role: 'measure',
    note: 'Penalties saved.',
    format: 'integer',
  },
  {
    name: 'penaltiesMissed',
    label: 'Pens missed',
    role: 'measure',
    note: 'Penalties missed.',
    format: 'integer',
  },

  {
    name: 'expectedGoals',
    label: 'xG',
    role: 'measure',
    note: 'Expected goals. Recorded from 2022/23 only: earlier seasons are missing, not zero.',
    from: '2022-23',
    format: 'decimal',
  },
  {
    name: 'expectedAssists',
    label: 'xA',
    role: 'measure',
    note: 'Expected assists. Recorded from 2022/23 only.',
    from: '2022-23',
    format: 'decimal',
  },
  {
    name: 'expectedGoalsConceded',
    label: 'xGC',
    role: 'measure',
    note: 'Expected goals conceded. Recorded from 2022/23 only.',
    from: '2022-23',
    format: 'decimal',
  },
  {
    name: 'expectedPoints',
    label: 'xP',
    role: 'measure',
    note: "FPL's own expected points. Recorded from 2020/21 only.",
    from: '2020-21',
    format: 'decimal',
  },
];

export const COLUMNS_BY_NAME = new Map(PANEL_COLUMNS.map((column) => [column.name, column]));

/** Columns a chart axis or a model should offer by default. */
export const NUMERIC_COLUMNS = PANEL_COLUMNS.filter(
  (column) => column.role === 'measure' || column.role === 'context',
).filter((column) => column.name !== 'wasHome');

export const LABEL_COLUMNS = PANEL_COLUMNS.filter((column) => column.role === 'label');

/** Features a model may legitimately use, since all of them predate kick off. */
export const KNOWN_BEFORE = PANEL_COLUMNS.filter((column) => column.knownBefore === true);

export interface DerivedColumn {
  name: string;
  label: string;
  formula: string;
  note: string;
}

/**
 * Derived columns every panel starts with. They are ordinary formulas, shown in
 * the formula bar and editable there, so nothing in the Lab is computed by a
 * route a reader cannot inspect or change.
 */
export const STARTER_COLUMNS: DerivedColumn[] = [
  {
    name: 'pointsPer90',
    label: 'Points per 90',
    formula: 'per90(totalPoints, minutes)',
    note: 'Points scaled to a full match. Missing where no minutes were played.',
  },
  {
    name: 'valuePerMillion',
    label: 'Points per million',
    formula: 'totalPoints / (price / 10)',
    note: 'Points divided by price in millions.',
  },
  {
    name: 'involvementPer90',
    label: 'xGI per 90',
    formula: 'per90(expectedGoals + expectedAssists, minutes)',
    note: 'Expected goal involvements per 90. Exists from 2022/23 onward.',
  },
  {
    name: 'started',
    label: 'Started',
    formula: 'minutes >= 60 ? 1 : 0',
    note: 'One where the player reached the sixty minute appearance threshold.',
  },
  {
    name: 'haul',
    label: 'Haul',
    formula: 'totalPoints >= 10 ? 1 : 0',
    note: 'One where the player returned ten or more points.',
  },
];

export const SEASONS = [
  '2016-17',
  '2017-18',
  '2018-19',
  '2019-20',
  '2020-21',
  '2021-22',
  '2022-23',
  '2023-24',
  '2024-25',
  '2025-26',
];

/** Coverage caveats printed on screen rather than buried in a footnote. */
export const COVERAGE_NOTES = [
  'Expected goals, assists, and goals conceded start in 2022/23. A factor built on them is measured over four seasons, not ten.',
  "FPL's own expected points starts in 2020/21.",
  '2022/23 is stored with 37 gameweeks rather than 38.',
  'The current season has no played gameweeks yet, so the panel is history and the live season enters through prices and fixtures.',
];
