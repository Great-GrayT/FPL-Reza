import {
  asMatchId,
  asSeason,
  groundSchema,
  managerSchema,
  matchDetailSchema,
  matchSchema,
  playerCodeSchema,
  positionFromElementType,
  type Ground,
  type LineupPlayer,
  type Manager,
  type Match,
  type MatchDetail,
  type MatchEventType,
  type MatchOfficial,
  type MatchOutcome,
  type MatchStatus,
  type MatchTimelineEvent,
  type OfficialRole,
  type Position,
  type Season,
  type TeamSheet,
} from '@fpl/core';
import type { PlFixture, PlFixtureDetail, PlPerson, PlStaff, PlTeam } from './schemas.js';

/**
 * The Opta id is what makes this provider joinable without guessing. It ships
 * every person as `p231416` and every club as `t3`, and those digits are
 * exactly FPL's `Player.code` and `Team.code`. So the whole identity problem
 * that the Sofascore adapter solves with name normalisation and club scoping
 * is, here, a substring.
 */
export function optaDigits(altId: string | undefined, prefix: string): number | null {
  if (altId === undefined) return null;
  if (!altId.startsWith(prefix)) return null;
  const digits = Number(altId.slice(prefix.length));
  return Number.isInteger(digits) && digits > 0 ? digits : null;
}

export const teamCodeOf = (team: PlTeam): number | null => optaDigits(team.altIds?.opta, 't');

export const playerCodeOf = (person: PlPerson): number | null =>
  optaDigits(person.altIds?.opta, 'p');

/**
 * The provider writes the current season as "English Premier League Season
 * 2026/2027" and every past one as "2025/26". Both become the domain's
 * "2026/27", so a season label is one thing across the lake.
 */
export function normaliseSeasonLabel(label: string): Season | null {
  const match = /(\d{4})\/(\d{2,4})/.exec(label);
  if (match === null) return null;
  const start = match[1];
  const end = match[2];
  if (start === undefined || end === undefined) return null;
  return asSeason(`${start}/${end.slice(-2)}`);
}

const STATUS: Record<string, MatchStatus> = {
  C: 'completed',
  U: 'upcoming',
  L: 'live',
  P: 'postponed',
  A: 'abandoned',
};

const OUTCOME: Record<string, MatchOutcome> = { H: 'home', A: 'away', D: 'draw' };

const OFFICIAL_ROLE: Record<string, OfficialRole> = {
  MAIN: 'referee',
  FOURTH_OFFICIAL: 'fourth_official',
  VAR: 'var',
  ASSISTANT_VAR: 'assistant_var',
};

/**
 * The provider's event vocabulary. Anything unrecognised becomes `other`
 * rather than being dropped, so a timeline stays complete even where a code
 * is new: a visible "other" is a bug report, a silent drop is not.
 */
const EVENT_TYPE: Record<string, MatchEventType> = {
  G: 'goal',
  O: 'own_goal',
  P: 'penalty_goal',
  PM: 'penalty_missed',
  Y: 'yellow_card',
  YR: 'second_yellow',
  R: 'red_card',
  S: 'substitution',
};

/** Period markers, which are structure rather than incident. */
const IGNORED_EVENTS = new Set(['PS', 'PE', 'PSK', 'PSO', 'PSS', 'PSM', 'PSE']);

/** The provider prints a single letter for the position it lined a player up in. */
const MATCH_POSITION: Record<string, Position> = { G: 'GKP', D: 'DEF', M: 'MID', F: 'FWD' };

interface NamedPerson {
  name: { display?: string | undefined; first?: string | undefined; last?: string | undefined };
}

function personName(person: NamedPerson): string {
  const { display, first, last } = person.name;
  if (display !== undefined && display !== '') return display;
  return [first, last].filter((part) => part !== undefined && part !== '').join(' ') || 'Unknown';
}

function dateFromMillis(millis: number | undefined): Date | null {
  return millis === undefined ? null : new Date(millis);
}

/** The slim result row, which is what 35 seasons of history are stored as. */
export function toMatch(raw: PlFixture, fallbackSeason?: Season): Match | null {
  const label = raw.gameweek?.compSeason?.label;
  const season = label === undefined ? (fallbackSeason ?? null) : normaliseSeasonLabel(label);
  if (season === null) return null;

  const home = raw.teams[0];
  const away = raw.teams[1];
  if (home === undefined || away === undefined) return null;

  const homeCode = teamCodeOf(home.team);
  const awayCode = teamCodeOf(away.team);
  // Without both Opta codes the row cannot be joined to anything, and a row
  // that cannot be joined is worse than absent: it would look like coverage.
  if (homeCode === null || awayCode === null) return null;

  const round = raw.gameweek?.gameweek;

  return matchSchema.parse({
    matchId: asMatchId(Math.round(raw.id)),
    season,
    round: round === undefined || round < 1 || round > 47 ? null : Math.round(round),
    kickoff: dateFromMillis(raw.kickoff?.millis),
    homeTeamCode: homeCode,
    awayTeamCode: awayCode,
    homeTeamName: home.team.name,
    awayTeamName: away.team.name,
    homeScore: home.score ?? null,
    awayScore: away.score ?? null,
    halfTimeHomeScore: raw.halfTimeScore?.homeScore ?? null,
    halfTimeAwayScore: raw.halfTimeScore?.awayScore ?? null,
    status: STATUS[raw.status ?? ''] ?? 'upcoming',
    outcome: OUTCOME[raw.outcome ?? ''] ?? null,
    attendance: raw.attendance ?? null,
    groundId: raw.ground?.id === undefined ? null : Math.round(raw.ground.id),
    groundName: raw.ground?.name ?? null,
    neutralGround: raw.neutralGround ?? false,
    refereeId: null,
    refereeName: null,
  });
}

function toLineupPlayer(person: PlPerson): LineupPlayer {
  const code = playerCodeOf(person);
  const matchPosition = person.matchPosition ?? person.info?.position;
  return {
    playerCode: code === null ? null : playerCodeSchema.parse(code),
    personId: Math.round(person.id),
    name: personName(person),
    shirt: person.matchShirtNumber ?? person.info?.shirtNum ?? null,
    captain: person.captain ?? false,
    positionInfo: person.info?.positionInfo ?? null,
    position: matchPosition === undefined ? null : (MATCH_POSITION[matchPosition] ?? null),
    nationality: person.nationalTeam?.isoCode ?? null,
    country: person.nationalTeam?.country ?? null,
  };
}

function toOfficial(raw: NamedPerson & { id: number; role?: string | undefined }): MatchOfficial {
  return {
    officialId: Math.round(raw.id),
    name: personName(raw),
    // An entry with no role is a running assistant: the provider names only
    // the main referee, the fourth official, and the two video officials.
    role: OFFICIAL_ROLE[raw.role ?? ''] ?? 'assistant',
  };
}

/**
 * Teamsheets, officials, and the timeline. Player codes on the timeline are
 * resolved from the teamsheets, because the events carry only the provider's
 * own person id: joining them any other way would be a name match, and a name
 * match here would attribute one player's goal to another.
 */
export function toMatchDetail(raw: PlFixtureDetail, fallbackSeason?: Season): MatchDetail | null {
  const label = raw.gameweek?.compSeason?.label;
  const season = label === undefined ? (fallbackSeason ?? null) : normaliseSeasonLabel(label);
  if (season === null) return null;

  const codeByPerson = new Map<number, number>();
  const nameByPerson = new Map<number, string>();
  const teamByPerson = new Map<number, number>();

  const teamCodeById = new Map<number, number>();
  for (const entry of raw.teams) {
    const code = teamCodeOf(entry.team);
    if (code !== null) teamCodeById.set(Math.round(entry.team.id), code);
  }

  const sheets: TeamSheet[] = [];
  for (const list of raw.teamLists ?? []) {
    const teamCode = teamCodeById.get(Math.round(list.teamId));
    if (teamCode === undefined) continue;

    const lineup = (list.lineup ?? []).map(toLineupPlayer);
    const substitutes = (list.substitutes ?? []).map(toLineupPlayer);
    for (const person of [...lineup, ...substitutes]) {
      if (person.playerCode !== null) codeByPerson.set(person.personId, person.playerCode);
      nameByPerson.set(person.personId, person.name);
      teamByPerson.set(person.personId, teamCode);
    }

    sheets.push({
      teamCode,
      formation: list.formation?.label ?? null,
      formationRows: (list.formation?.players ?? []).map((row) => row.map((id) => Math.round(id))),
      lineup,
      substitutes,
    });
  }

  const events: MatchTimelineEvent[] = [];
  for (const raw_ of raw.events ?? []) {
    const type = raw_.type ?? '';
    if (IGNORED_EVENTS.has(type)) continue;
    const personId = raw_.personId === undefined ? null : Math.round(raw_.personId);
    const relatedId = raw_.assistId === undefined ? null : Math.round(raw_.assistId);
    const teamId = raw_.teamId === undefined ? null : Math.round(raw_.teamId);
    const secs = raw_.clock?.secs;

    const playerCode = personId === null ? null : (codeByPerson.get(personId) ?? null);
    const relatedCode = relatedId === null ? null : (codeByPerson.get(relatedId) ?? null);

    events.push({
      type: EVENT_TYPE[type] ?? 'other',
      minute: secs === undefined ? null : Math.min(130, Math.max(0, Math.round(secs / 60))),
      teamCode:
        teamId === null
          ? personId === null
            ? null
            : (teamByPerson.get(personId) ?? null)
          : (teamCodeById.get(teamId) ?? null),
      personId,
      playerCode: playerCode === null ? null : playerCodeSchema.parse(playerCode),
      name: personId === null ? null : (nameByPerson.get(personId) ?? null),
      relatedPersonId: relatedId,
      relatedPlayerCode: relatedCode === null ? null : playerCodeSchema.parse(relatedCode),
      relatedName: relatedId === null ? null : (nameByPerson.get(relatedId) ?? null),
      homeScore: raw_.score?.homeScore ?? null,
      awayScore: raw_.score?.awayScore ?? null,
    });
  }

  return matchDetailSchema.parse({
    matchId: asMatchId(Math.round(raw.id)),
    season,
    officials: (raw.matchOfficials ?? []).map(toOfficial),
    sheets,
    events,
  });
}

/** The referee alone, lifted onto the slim row so a card rate needs one read. */
export function refereeOf(detail: MatchDetail): { id: number; name: string } | null {
  const referee = detail.officials.find((official) => official.role === 'referee');
  return referee === undefined ? null : { id: referee.officialId, name: referee.name };
}

export function toGrounds(teams: readonly PlTeam[]): Ground[] {
  const grounds: Ground[] = [];
  for (const team of teams) {
    const teamCode = teamCodeOf(team);
    for (const ground of team.grounds ?? []) {
      grounds.push(
        groundSchema.parse({
          groundId: Math.round(ground.id),
          name: ground.name,
          city: ground.city ?? null,
          capacity: ground.capacity ?? null,
          latitude: ground.location?.latitude ?? null,
          longitude: ground.location?.longitude ?? null,
          teamCode,
        }),
      );
    }
  }
  return grounds;
}

export function toManagers(staff: PlStaff, season: Season, teamCode: number): Manager[] {
  return (staff.officials ?? [])
    .filter((official) => (official.role ?? '').toLowerCase().includes('manager'))
    .map((official) =>
      managerSchema.parse({
        managerId: Math.round(official.id),
        photoCode: optaDigits(official.altIds?.opta, 'man'),
        name: personName(official),
        teamCode,
        season,
        role: official.role ?? 'Manager',
        nationality: official.birth?.country?.isoCode ?? null,
        country: official.birth?.country?.country ?? null,
        birthDate: dateFromMillis(official.birth?.date?.millis),
        active: official.active ?? true,
      }),
    );
}

/** Kept exported so a caller can turn an FPL element type into the same enum. */
export { positionFromElementType };
