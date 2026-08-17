import { asSeason, type Season } from '@fpl/core';

/** Premier League seasons roll over in July, so July onward belongs to the new season. */
const SEASON_START_MONTH = 6; // zero indexed, so 6 is July

export function seasonForDate(date: Date): Season {
  const year = date.getUTCFullYear();
  const startYear = date.getUTCMonth() >= SEASON_START_MONTH ? year : year - 1;
  const endYear = String((startYear + 1) % 100).padStart(2, '0');
  return asSeason(`${startYear}/${endYear}`);
}
