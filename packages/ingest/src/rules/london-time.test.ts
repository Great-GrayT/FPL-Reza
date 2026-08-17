import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { londonOffsetMs, londonToUtc, parseDeadlineLabel } from './london-time.js';

describe('londonOffsetMs', () => {
  it('is one hour ahead of UTC during British Summer Time', () => {
    assert.equal(londonOffsetMs(new Date('2026-08-21T12:00:00Z')), 3_600_000);
  });

  it('matches UTC in winter', () => {
    assert.equal(londonOffsetMs(new Date('2027-01-02T12:00:00Z')), 0);
  });
});

describe('londonToUtc', () => {
  it('shifts a summer wall clock time back an hour', () => {
    assert.equal(londonToUtc(2026, 7, 21, 18, 30).toISOString(), '2026-08-21T17:30:00.000Z');
  });

  it('leaves a winter wall clock time alone', () => {
    assert.equal(londonToUtc(2027, 0, 2, 13, 30).toISOString(), '2027-01-02T13:30:00.000Z');
  });
});

describe('parseDeadlineLabel', () => {
  it('dates an August deadline in the season start year', () => {
    const parsed = parseDeadlineLabel('Fri 21 Aug 18:30', 2026);
    assert.equal(parsed?.toISOString(), '2026-08-21T17:30:00.000Z');
  });

  it('rolls a January deadline into the following year', () => {
    const parsed = parseDeadlineLabel('Sat 2 Jan 13:30', 2026);
    assert.equal(parsed?.toISOString(), '2027-01-02T13:30:00.000Z');
  });

  it('handles the final gameweek in late May', () => {
    const parsed = parseDeadlineLabel('Sun 30 May 14:30', 2026);
    assert.equal(parsed?.toISOString(), '2027-05-30T13:30:00.000Z');
  });

  it('returns null for a label it cannot read', () => {
    assert.equal(parseDeadlineLabel('sometime next week', 2026), null);
    assert.equal(parseDeadlineLabel('Fri 21 Xyz 18:30', 2026), null);
  });
});
