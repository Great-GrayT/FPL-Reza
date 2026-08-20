// The runner compiles JSX with the classic transform, so React has to be in
// scope here even though the app itself uses the automatic one.
import React from 'react';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WeekPlan } from '@fpl/planner';
import { CashFlow, Output, Relation } from '../../components/planner-metrics';
import {
  Captaincy,
  Exposure,
  PointsSeries,
  Spend,
  ValueSeries,
} from '../../components/planner-panels';
import { StrategyScatter } from '../../components/strategy-scatter';
import type { WirePlayer } from './projections';
import type { StrategySpace } from './protocol';

/**
 * These panels solve in a worker after hydration, so nothing renders them on
 * the server and no page fetch can show them. Rendering each to static markup
 * is the cheapest honest check that they draw at all: it catches the undefined
 * read, the missing key, and the divide by zero that a typecheck cannot, which
 * is exactly the class of bug an unviewable panel hides best.
 */

const week = (over: Partial<WeekPlan> = {}): WeekPlan & { spread: number } => ({
  gameweek: 5,
  picks: [1, 2, 3],
  starters: [1, 2],
  bench: [3],
  captain: 1,
  viceCaptain: 2,
  transfersIn: [],
  transfersOut: [],
  transfers: 0,
  hit: 0,
  chip: null,
  expectedPoints: 52.4,
  bank: 12,
  squadValue: 988,
  freeTransfers: 1,
  spread: 6.1,
  ...over,
});

const wire = (code: number, over: Partial<WirePlayer> = {}): WirePlayer => ({
  code,
  name: `Player ${String(code)}`,
  position: 'MID',
  teamCode: code,
  price: 50 + code,
  projections: [4, 5, 6, 7],
  spread: 1.5,
  rise: 0.1,
  available: true,
  xg90: 0.31,
  xa90: 0.22,
  cbi90: 4.4,
  bps90: 21,
  minutes: 82,
  ownership: 12.5,
  ...over,
});

const players = [wire(1), wire(2), wire(3, { position: 'DEF' })];
const byCode = new Map(players.map((player) => [player.code, player]));
const plannerRows = new Map(
  players.map((player) => [
    player.code,
    {
      code: player.code,
      name: player.name,
      position: player.position,
      teamCode: player.teamCode,
      price: player.price,
      projections: player.projections,
    },
  ]),
);

describe('the plan page panels render', () => {
  it('draws the cash flow, including a week that moves nothing', () => {
    const markup = renderToStaticMarkup(
      <CashFlow
        weeks={[week(), week({ gameweek: 6, transfersIn: [2], transfersOut: [3], hit: 4 })]}
        byCode={byCode}
      />,
    );
    assert.ok(markup.includes('GW'));
    assert.ok(
      markup.includes('Receipts are what a sale returns') || markup.includes('no money moves'),
    );
  });

  it('draws the rate table without dividing by a blank gameweek', () => {
    const markup = renderToStaticMarkup(
      <Output
        weeks={[week(), week({ gameweek: 6 })]}
        byCode={byCode}
        // Club 1 blanks in the second week: the row must still draw.
        matches={{ '1': [1, 0], '2': [1, 2], '3': [1, 1] }}
        fromGameweek={5}
      />,
    );
    assert.ok(markup.includes('xGI'));
  });

  it('draws a relation with the squad marked, and refuses an empty pool', () => {
    const markup = renderToStaticMarkup(
      <Relation
        players={players}
        held={[1]}
        x={(player) => player.price / 10}
        y={(player) => player.xg90 + player.xa90}
        xLabel="Price"
        yLabel="xGI/90"
        note="note"
      />,
    );
    assert.ok(markup.includes('<svg'));
    assert.equal(
      renderToStaticMarkup(
        <Relation
          players={[]}
          held={[]}
          x={(player) => player.price}
          y={(player) => player.price}
          xLabel="x"
          yLabel="y"
          note="note"
        />,
      ),
      '',
    );
  });

  it('draws the series, the tables, and the flat value case', () => {
    assert.ok(
      renderToStaticMarkup(<PointsSeries weeks={[week(), week({ gameweek: 6 })]} />).includes(
        '<svg',
      ),
    );
    assert.ok(
      renderToStaticMarkup(<ValueSeries weeks={[week(), week({ gameweek: 6 })]} />).includes(
        'The plan moves no money',
      ),
      'a flat value line should be a sentence rather than a chart',
    );
    assert.ok(
      renderToStaticMarkup(
        <Captaincy weeks={[week()]} byCode={plannerRows} fromGameweek={5} />,
      ).includes('Margin'),
    );
    assert.ok(
      renderToStaticMarkup(
        <Exposure
          weeks={[week()]}
          byCode={plannerRows}
          calendar={[{ gameweek: 5, blanks: [1], doubles: [2] }]}
        />,
      ).includes('Blank'),
    );
    assert.ok(
      renderToStaticMarkup(<Spend picks={[1, 2, 3]} byCode={plannerRows} bank={12} />).includes(
        'Bank',
      ),
    );
  });
});

describe('the strategy scatter renders', () => {
  const space: StrategySpace = {
    dots: [
      {
        id: 0,
        picks: [1, 2],
        expected: 400,
        risk: 30,
        cost: 990,
        sharpe: 13.3,
        chipGain: 0,
        chipWeeks: [],
      },
      {
        id: 1,
        picks: [2, 3],
        expected: 420,
        risk: 36,
        cost: 1000,
        sharpe: 11.6,
        chipGain: 12,
        chipWeeks: [{ chip: 'bench_boost', gameweek: 3, gain: 12 }],
      },
    ],
    riskFree: { expected: 0, risk: 0 },
    tangency: { expected: 400, risk: 30, sharpe: 13.3, picks: [1, 2] },
    generated: 400,
    clubCorrelation: 0.35,
  };

  it('draws the cloud, the line, and the pinned strategy', () => {
    const markup = renderToStaticMarkup(
      <StrategyScatter
        space={space}
        pinned={{ label: 'Yours', expected: 410, risk: 33 }}
        selected={null}
        chips={['bench_boost']}
        onChip={() => undefined}
        onSelect={() => undefined}
        running={false}
      />,
    );
    assert.ok(markup.includes('<svg'));
    assert.ok(markup.includes('Best Sharpe'));
  });

  it('survives a space with nothing in it', () => {
    const markup = renderToStaticMarkup(
      <StrategyScatter
        space={{
          dots: [],
          riskFree: { expected: 0, risk: 0 },
          tangency: null,
          generated: 0,
          clubCorrelation: 0.35,
        }}
        pinned={null}
        selected={null}
        chips={[]}
        onChip={() => undefined}
        onSelect={() => undefined}
        running
      />,
    );
    assert.ok(markup.includes('Strategies'));
  });
});
