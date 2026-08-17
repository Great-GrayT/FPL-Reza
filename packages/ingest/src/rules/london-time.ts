/**
 * Deadlines on the rules page are printed in UK local time with no year and no
 * timezone, e.g. "Sat 2 Jan 13:30". Resolving them means supplying the season's
 * year and converting through Europe/London, which switches between GMT and
 * BST mid season.
 */

const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
] as const;

/** Premier League seasons open in August, so a January date belongs to the next year. */
const SEASON_ROLLOVER_MONTH = 6; // zero indexed July

const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Offset of Europe/London from UTC, in milliseconds, at a given instant. */
export function londonOffsetMs(at: Date): number {
  const parts = new Map(formatter.formatToParts(at).map((part) => [part.type, part.value]));
  const asIfUtc = Date.UTC(
    Number(parts.get('year')),
    Number(parts.get('month')) - 1,
    Number(parts.get('day')),
    Number(parts.get('hour')) % 24,
    Number(parts.get('minute')),
    Number(parts.get('second')),
  );
  return asIfUtc - at.getTime();
}

/**
 * Converts a London wall clock time to a UTC instant. The offset is applied
 * twice because the correct offset depends on the instant being computed,
 * which is only known after the first correction.
 */
export function londonToUtc(
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const naive = Date.UTC(year, monthIndex, day, hour, minute);
  const firstPass = naive - londonOffsetMs(new Date(naive));
  return new Date(naive - londonOffsetMs(new Date(firstPass)));
}

const DEADLINE_PATTERN =
  /^(?:mon|tue|wed|thu|fri|sat|sun)\s+(\d{1,2})\s+([a-z]{3})[a-z]*\s+(\d{1,2}):(\d{2})$/i;

/**
 * Parses a printed deadline against a season's starting year. Returns null
 * rather than throwing: one unparseable row must not fail a whole scrape.
 */
export function parseDeadlineLabel(label: string, seasonStartYear: number): Date | null {
  const match = DEADLINE_PATTERN.exec(label.trim().replace(/\s+/g, ' '));
  if (match === null) return null;

  const [, dayText, monthText, hourText, minuteText] = match;
  const monthIndex = MONTHS.indexOf(monthText?.toLowerCase() as (typeof MONTHS)[number]);
  if (monthIndex === -1) return null;

  const year = monthIndex > SEASON_ROLLOVER_MONTH ? seasonStartYear : seasonStartYear + 1;
  return londonToUtc(year, monthIndex, Number(dayText), Number(hourText), Number(minuteText));
}
