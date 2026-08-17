import type { Fixture, Team } from '@fpl/core';

/** Prices are integer tenths of a million everywhere in the domain. */
export const price = (tenths: number): string => `${(tenths / 10).toFixed(1)}m`;

export const signed = (value: number): string => (value > 0 ? `+${String(value)}` : String(value));

/**
 * Kickoff times render in Europe/London because that is the clock every FPL
 * deadline and broadcast slot is quoted in, regardless of where the reader is.
 */
const KICKOFF = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/London',
});

export const kickoff = (at: Date | null): string => (at === null ? 'TBC' : KICKOFF.format(at));

const DAY = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'Europe/London',
});

export const matchDay = (at: Date | null): string =>
  at === null ? 'Date to be confirmed' : DAY.format(at);

export const POSITION_LABEL: Record<string, string> = {
  GKP: 'Goalkeeper',
  DEF: 'Defender',
  MID: 'Midfielder',
  FWD: 'Forward',
};

export interface Opponent {
  name: string;
  short: string;
  code: number;
  home: boolean;
  difficulty: number;
}

/** Resolves the other side of a fixture from one team's point of view. */
export function opponentFor(
  fixture: Fixture,
  teamId: number,
  teams: ReadonlyMap<number, Team>,
): Opponent | null {
  const home = (fixture.homeTeam as number) === teamId;
  const otherId = home ? (fixture.awayTeam as number) : (fixture.homeTeam as number);
  const other = teams.get(otherId);
  if (other === undefined) return null;
  return {
    name: other.name,
    short: other.shortName,
    code: other.code,
    home,
    difficulty: home ? fixture.homeDifficulty : fixture.awayDifficulty,
  };
}
