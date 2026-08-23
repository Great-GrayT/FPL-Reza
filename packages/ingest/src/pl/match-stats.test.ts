import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { asSeason } from '@fpl/core';
import { toMatchTeamStats } from './match-stats.js';
import type { PlMatchStats } from './schemas.js';

const fixture = {
  competitionId: 5,
  competition: 'EFL Cup',
  season: asSeason('2026/27'),
  kickoff: new Date('2026-08-07T18:45:00Z'),
};

const payload = (over: Partial<PlMatchStats> = {}): PlMatchStats => ({
  entity: {
    id: 129909,
    teams: [
      { team: { id: 38, name: 'Wolverhampton Wanderers', altIds: { opta: 't39' } } },
      { team: { id: 175, name: 'Port Vale', altIds: { opta: 't50' } } },
    ],
  },
  data: {
    '38': {
      M: [
        { name: 'possession_percentage', value: 68.6 },
        { name: 'ppda', value: 9.7 },
      ],
    },
    '175': { M: [{ name: 'possession_percentage', value: 31.4 }] },
  },
  ...over,
});

describe('match statistics mapping', () => {
  it('produces one row per club, each knowing who it played', () => {
    const rows = toMatchTeamStats(payload(), fixture);
    assert.equal(rows.length, 2);

    const wolves = rows.find((row) => row.teamId === 38);
    assert.ok(wolves !== undefined);
    assert.equal(wolves.teamCode, 39, 'the Opta id is the join to FPL');
    assert.equal(wolves.opponentCode, 50);
    assert.equal(wolves.opponentName, 'Port Vale');
    assert.equal(wolves.home, true);
    assert.equal(wolves.stats['ppda'], 9.7);
    assert.equal(wolves.competition, 'EFL Cup');
  });

  it('marks the away side as away', () => {
    const rows = toMatchTeamStats(payload(), fixture);
    assert.equal(rows.find((row) => row.teamId === 175)?.home, false);
  });

  it('keeps a club the Opta id cannot place, rather than dropping the match', () => {
    // A club outside the league is exactly what a cup tie is made of, and its
    // opponent's statistics are still the Premier League club's own record.
    const raw = payload();
    raw.entity.teams[1] = { team: { id: 175, name: 'Port Vale' } };
    const rows = toMatchTeamStats(raw, fixture);
    assert.equal(rows.length, 2);
    assert.equal(rows.find((row) => row.teamId === 38)?.opponentCode, null);
  });

  it('records only the measures the match produced', () => {
    const rows = toMatchTeamStats(payload(), fixture);
    const vale = rows.find((row) => row.teamId === 175);
    assert.ok(vale !== undefined);
    // One measure in, one measure out: an absent statistic is absent, not zero,
    // and inventing a zero would report a press nobody measured.
    assert.deepEqual(Object.keys(vale.stats), ['possession_percentage']);
    assert.equal(vale.stats['ppda'], undefined);
  });

  it('skips a club with no measures at all', () => {
    const raw = payload();
    raw.data['175'] = { M: [] };
    assert.equal(toMatchTeamStats(raw, fixture).length, 1);
  });

  it('returns nothing where the payload names fewer than two clubs', () => {
    const raw = payload();
    raw.entity.teams = [];
    assert.deepEqual(toMatchTeamStats(raw, fixture), []);
  });
});
