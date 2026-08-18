import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { asMatchId, asSeason, matchSchema, type Match } from '@fpl/core';
import { estimateStrength, explainForecast, forecastMatch } from './strength.js';

const STRONG = 1;
const WEAK = 2;
const AVERAGE = 3;

let nextId = 1;

function played(
  homeTeamCode: number,
  awayTeamCode: number,
  homeScore: number,
  awayScore: number,
  season = '2025/26',
): Match {
  return matchSchema.parse({
    matchId: asMatchId(nextId++),
    season: asSeason(season),
    round: 1,
    kickoff: new Date('2026-01-01T15:00:00Z'),
    homeTeamCode,
    awayTeamCode,
    homeTeamName: `Team ${String(homeTeamCode)}`,
    awayTeamName: `Team ${String(awayTeamCode)}`,
    homeScore,
    awayScore,
    halfTimeHomeScore: null,
    halfTimeAwayScore: null,
    status: 'completed',
    outcome: homeScore > awayScore ? 'home' : homeScore === awayScore ? 'draw' : 'away',
    attendance: null,
    groundId: null,
    groundName: null,
    neutralGround: false,
    refereeId: null,
    refereeName: null,
  });
}

/** A season where one club scores freely, one concedes freely, one is neither. */
function sampleSeason(): Match[] {
  const matches: Match[] = [];
  for (let i = 0; i < 12; i += 1) {
    matches.push(played(STRONG, AVERAGE, 3, 1));
    matches.push(played(AVERAGE, STRONG, 1, 3));
    matches.push(played(WEAK, AVERAGE, 0, 2));
    matches.push(played(AVERAGE, WEAK, 2, 0));
  }
  return matches;
}

describe('estimateStrength', () => {
  it('rates the free scoring club above the division and the poor one below', () => {
    const model = estimateStrength(sampleSeason());
    const strong = model.teams.get(STRONG);
    const weak = model.teams.get(WEAK);
    assert.ok(strong !== undefined && weak !== undefined);
    assert.ok(strong.attack > 1, `expected attack above average, got ${strong.attack.toFixed(2)}`);
    assert.ok(weak.attack < 1, `expected attack below average, got ${weak.attack.toFixed(2)}`);
    assert.ok(weak.defence > 1, 'a club that concedes freely has a defence ratio above 1');
  });

  it('ignores a match that has not been played', () => {
    const unplayed = matchSchema.parse({
      ...played(STRONG, WEAK, 0, 0),
      matchId: asMatchId(9999),
      homeScore: null,
      awayScore: null,
      status: 'upcoming',
      outcome: null,
    });
    const model = estimateStrength([...sampleSeason(), unplayed]);
    assert.equal(model.matches, 48);
  });

  it('blends a club with almost no record towards the division average', () => {
    const model = estimateStrength([...sampleSeason(), played(99, AVERAGE, 6, 0)]);
    const newcomer = model.teams.get(99);
    assert.ok(newcomer !== undefined);
    assert.equal(newcomer.shrunk, true);
    // Six goals in one match is a rate of 6, far above the division. Shrinkage
    // must pull it well under that rather than trusting a single result.
    assert.ok(newcomer.attack < 3, `expected shrinkage, got ${newcomer.attack.toFixed(2)}`);
  });

  it('weights a recent season above an older one', () => {
    const old = Array.from({ length: 20 }, () => played(STRONG, AVERAGE, 5, 0, '2018/19'));
    const recent = Array.from({ length: 20 }, () => played(STRONG, AVERAGE, 1, 0, '2025/26'));
    const model = estimateStrength([...old, ...recent]);
    const strong = model.teams.get(STRONG);
    assert.ok(strong !== undefined);
    // The unweighted mean of 5 and 1 is 3. Weighting towards the recent season
    // has to land below that.
    const unweightedRate = 3;
    assert.ok(
      strong.attack * model.baseline < unweightedRate,
      'recent form must outweigh a distant season',
    );
  });

  it('has a sensible baseline and home advantage for an empty sample', () => {
    const model = estimateStrength([]);
    assert.ok(model.baseline > 0);
    assert.ok(model.homeAdvantage > 0);
    assert.equal(model.matches, 0);
  });
});

describe('forecastMatch', () => {
  it('makes the stronger side more likely to win', () => {
    const model = estimateStrength(sampleSeason());
    const forecast = forecastMatch(model, STRONG, WEAK);
    assert.ok(forecast.homeWin > forecast.awayWin);
    assert.ok(forecast.homeExpectedGoals > forecast.awayExpectedGoals);
  });

  it('produces three outcome probabilities that sum to one', () => {
    const model = estimateStrength(sampleSeason());
    const forecast = forecastMatch(model, STRONG, AVERAGE);
    const total = forecast.homeWin + forecast.draw + forecast.awayWin;
    assert.ok(Math.abs(total - 1) < 0.001, `outcomes summed to ${total.toFixed(4)}`);
  });

  it('gives the same fixture a different answer at each ground', () => {
    // The balanced sample above has no home advantage in it by construction,
    // so this needs its own: home sides scoring more than away sides is the
    // only thing separating the two forecasts.
    const withHomeAdvantage = Array.from({ length: 24 }, () => played(STRONG, AVERAGE, 2, 0));
    const model = estimateStrength([...sampleSeason(), ...withHomeAdvantage]);
    assert.ok(model.homeAdvantage > 1, 'the sample must actually carry a home advantage');

    const atHome = forecastMatch(model, STRONG, AVERAGE);
    const away = forecastMatch(model, AVERAGE, STRONG);
    assert.ok(
      atHome.homeWin > away.awayWin,
      'home advantage must favour the same club more at home',
    );
  });

  it('reads a clean sheet off the opposing expectation', () => {
    const model = estimateStrength(sampleSeason());
    const forecast = forecastMatch(model, STRONG, WEAK);
    assert.ok(
      Math.abs(forecast.homeCleanSheet - Math.exp(-forecast.awayExpectedGoals)) < 1e-9,
      'a home clean sheet is the away side failing to score',
    );
  });

  it('returns five scorelines, likeliest first', () => {
    const model = estimateStrength(sampleSeason());
    const { likelyScores } = forecastMatch(model, STRONG, AVERAGE);
    assert.equal(likelyScores.length, 5);
    for (let i = 1; i < likelyScores.length; i += 1) {
      const previous = likelyScores[i - 1];
      const current = likelyScores[i];
      assert.ok(previous !== undefined && current !== undefined);
      assert.ok(previous.probability >= current.probability);
    }
  });

  it('marks a forecast provisional when a club is barely known', () => {
    const model = estimateStrength(sampleSeason());
    assert.equal(forecastMatch(model, STRONG, 12345).provisional, true);
    assert.equal(forecastMatch(model, STRONG, AVERAGE).provisional, false);
  });
});

describe('explainForecast', () => {
  it('states the sample and the baseline it used', () => {
    const model = estimateStrength(sampleSeason());
    const lines = explainForecast(model, forecastMatch(model, STRONG, AVERAGE));
    assert.ok(lines.length >= 3);
    assert.ok(
      lines.some((line) => line.includes('48')),
      'names the matches behind it',
    );
    assert.ok(
      lines.some((line) => line.toLowerCase().includes('poisson')),
      'names its own simplification',
    );
  });

  it('warns when a club is blended towards the average', () => {
    const model = estimateStrength(sampleSeason());
    const lines = explainForecast(model, forecastMatch(model, STRONG, 12345));
    assert.ok(lines.some((line) => line.includes('ten matches')));
  });
});
