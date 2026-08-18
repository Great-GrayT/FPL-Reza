import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCodeIndex,
  parseArchiveSeason,
  archiveGameweeksUrl,
  archivePlayersUrl,
} from './archive.js';
import { rawHistoryPastSchema, toPlayerSeason, seasonsByPlayerCode } from './player-seasons.js';

/** One real row's shape, trimmed: FPL prints its ICT family as strings. */
const rawPast = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  season_name: '2021/22',
  element_code: 154561,
  start_cost: 45,
  end_cost: 44,
  total_points: 95,
  minutes: 2160,
  starts: 0,
  goals_scored: 0,
  assists: 0,
  clean_sheets: 8,
  goals_conceded: 27,
  own_goals: 0,
  penalties_saved: 0,
  penalties_missed: 0,
  yellow_cards: 1,
  red_cards: 0,
  saves: 78,
  bonus: 5,
  bps: 496,
  influence: '593.4',
  creativity: '10.0',
  threat: '0.0',
  ict_index: '60.1',
  expected_goals: '0.00',
  expected_assists: '0.00',
  expected_goals_conceded: '0.00',
  defensive_contribution: 0,
  ...overrides,
});

const mapPast = (overrides: Record<string, unknown> = {}) =>
  toPlayerSeason(rawHistoryPastSchema.parse(rawPast(overrides)));

describe('toPlayerSeason', () => {
  it('maps a past season, coercing the ICT strings to numbers', () => {
    const season = mapPast();

    assert.equal(season.playerCode, 154561);
    assert.equal(season.season, '2021/22');
    assert.equal(season.totalPoints, 95);
    assert.equal(season.influence, 593.4);
    assert.equal(season.ictIndex, 60.1);
    assert.equal(season.saves, 78);
  });

  // FPL reports 0 for a measure that did not exist, which is a different claim
  // from "recorded none". Expected goals arrive in 2022/23.
  it('treats expected goals as absent before 2022/23', () => {
    const before = mapPast({ season_name: '2021/22', expected_goals: '0.00' });
    const after = mapPast({ season_name: '2022/23', expected_goals: '4.20' });

    assert.equal(before.expectedGoals, null);
    assert.equal(after.expectedGoals, 4.2);
  });

  it('treats defensive contribution as absent before 2025/26', () => {
    const before = mapPast({ season_name: '2024/25', defensive_contribution: 0 });
    const after = mapPast({ season_name: '2025/26', defensive_contribution: 31 });

    assert.equal(before.defensiveContribution, null);
    assert.equal(after.defensiveContribution, 31);
  });

  it('survives a season that omits the newer fields entirely', () => {
    const raw = rawPast();
    delete raw['starts'];
    delete raw['expected_goals'];
    delete raw['defensive_contribution'];

    const season = toPlayerSeason(rawHistoryPastSchema.parse(raw));

    assert.equal(season.starts, null);
    assert.equal(season.expectedGoals, null);
    assert.equal(season.defensiveContribution, null);
  });
});

describe('seasonsByPlayerCode', () => {
  it('groups by code with the newest season first', () => {
    const rows = [
      mapPast({ season_name: '2022/23' }),
      mapPast({ season_name: '2024/25' }),
      mapPast({ season_name: '2023/24' }),
      mapPast({ element_code: 118748, season_name: '2023/24' }),
    ];

    const byCode = seasonsByPlayerCode(rows);
    const first = rows[0];
    assert.ok(first !== undefined);

    assert.deepEqual(
      byCode.get(first.playerCode)?.map((row) => row.season),
      ['2024/25', '2023/24', '2022/23'],
    );
    assert.equal(byCode.size, 2);
  });
});

describe('archive urls', () => {
  it('spells the season with a hyphen, as the archive files it', () => {
    assert.match(archiveGameweeksUrl('2024/25'), /\/2024-25\/gws\/merged_gw\.csv$/);
    assert.match(archivePlayersUrl('2024/25'), /\/2024-25\/players_raw\.csv$/);
  });
});

const PLAYERS_CSV = [
  'id,code,first_name,second_name',
  '4,503139,Alex,Scott',
  '7,118748,Harry,Kane',
].join('\n');

const GAMEWEEKS_CSV = [
  'name,position,team,xP,element,GW,minutes,total_points,goals_scored,assists,clean_sheets,goals_conceded,own_goals,penalties_saved,penalties_missed,yellow_cards,red_cards,saves,bonus,bps,value,selected,was_home,kickoff_time,opponent_team,expected_goals,expected_assists,expected_goals_conceded',
  'Alex Scott,MID,Bournemouth,1.6,4,1,62,2,0,0,0,1,0,0,0,0,0,0,0,11,50,4339,False,2024-08-17T14:00:00Z,16,0.0,0.01,1.02',
  'Harry Kane,FWD,Spurs,6.1,7,1,90,12,2,0,0,0,0,0,0,0,0,0,3,45,110,1200000,True,2024-08-17T16:30:00Z,3,1.2,0.3,0.8',
  // An element the season's player list does not carry: dropped, not guessed.
  'Ghost Player,MID,Nowhere,0.0,999,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,40,0,True,2024-08-17T14:00:00Z,5,0.0,0.0,0.0',
].join('\n');

describe('buildCodeIndex', () => {
  it('maps that season element id to the permanent code', () => {
    const index = buildCodeIndex(PLAYERS_CSV);

    assert.equal(index.get(4), 503139);
    assert.equal(index.get(7), 118748);
    assert.equal(index.size, 2);
  });
});

describe('parseArchiveSeason', () => {
  const index = buildCodeIndex(PLAYERS_CSV);

  it('rekeys every row from the season element id to the permanent code', () => {
    const { rows } = parseArchiveSeason('2024/25', GAMEWEEKS_CSV, index);

    assert.deepEqual(
      rows.map((row) => row.playerCode),
      [503139, 118748],
    );
    assert.equal(rows[0]?.season, '2024/25');
    assert.equal(rows[0]?.name, 'Alex Scott');
    assert.equal(rows[0]?.minutes, 62);
    assert.equal(rows[0]?.totalPoints, 2);
    assert.equal(rows[0]?.wasHome, false);
    assert.equal(rows[0]?.kickoff?.toISOString(), '2024-08-17T14:00:00.000Z');
    assert.equal(rows[0]?.expectedPoints, 1.6);
  });

  it('counts and drops a row whose element is not in that season player list', () => {
    const { rows, unresolved } = parseArchiveSeason('2024/25', GAMEWEEKS_CSV, index);

    assert.equal(rows.length, 2);
    assert.equal(unresolved, 1);
  });

  it('maps the archive GK label onto the domain GKP position', () => {
    const csv = GAMEWEEKS_CSV.replace('Alex Scott,MID', 'Alex Scott,GK');
    const { rows } = parseArchiveSeason('2024/25', csv, index);

    assert.equal(rows[0]?.position, 'GKP');
  });

  it('leaves expected goals null for a season before the archive carried them', () => {
    const { rows } = parseArchiveSeason('2018/19', GAMEWEEKS_CSV, index);

    assert.equal(rows[0]?.expectedGoals, null);
    assert.equal(rows[0]?.expectedAssists, null);
    // FPL's own projection column predates expected goals, so it still maps.
    assert.equal(rows[0]?.expectedPoints, 1.6);
  });
});
