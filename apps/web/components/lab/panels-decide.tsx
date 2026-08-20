'use client';

/**
 * The three panels that turn an idea into a decision: simulate what could
 * happen, build the squad that trades return against risk, and read the archive
 * for what a season actually looks like.
 */
import { useState } from 'react';
import { useQuery } from '@/lib/quant/client';
import { SEASONS } from '@/lib/quant/schema';
import { BarChart, Fan, LineChart, formatNumber } from './charts';
import { Failure, Loading, NumberField, Section, Select, StatGrid, Verdict } from './controls';
import type { PanelProps } from './panels-explore';
import styles from './lab.module.css';

interface MatchResult {
  homeWin: number;
  draw: number;
  awayWin: number;
  homeCleanSheet: number;
  awayCleanSheet: number;
  bothScore: number;
  overTwoFive: number;
  homeGoals: { mean: number; p5: number; p25: number; median: number; p75: number; p95: number };
  awayGoals: { mean: number; p5: number; p25: number; median: number; p75: number; p95: number };
  scorelines: { home: number; away: number; probability: number }[];
  draws: number;
  seed: number;
}

interface PlayerResult {
  simulations: {
    name: string;
    fan: {
      mean: number;
      sd: number;
      p5: number;
      p25: number;
      median: number;
      p75: number;
      p95: number;
    };
    atLeast: { threshold: number; probability: number }[];
    blankRisk: number;
  }[];
  captaincy: { name: string; expected: number; winProbability: number; regretRisk: number }[];
}

export function SimulatePanel({ state, update }: PanelProps): React.ReactElement {
  const [homeGoals, setHomeGoals] = useState(1.7);
  const [awayGoals, setAwayGoals] = useState(1.1);
  const [draws, setDraws] = useState(20000);

  const match = useQuery<MatchResult>(
    { kind: 'simulateMatch', homeGoals, awayGoals, draws, seed: state.seed },
    `match|${homeGoals}|${awayGoals}|${draws}|${state.seed}`,
  );

  const profiles = [
    {
      name: 'Premium forward',
      position: 'FWD' as const,
      startProbability: 0.95,
      expectedGoals: 0.62,
      expectedAssists: 0.18,
      cleanSheetProbability: 0.28,
    },
    {
      name: 'Attacking midfielder',
      position: 'MID' as const,
      startProbability: 0.9,
      expectedGoals: 0.34,
      expectedAssists: 0.3,
      cleanSheetProbability: 0.3,
    },
    {
      name: 'Defender who attacks',
      position: 'DEF' as const,
      startProbability: 0.92,
      expectedGoals: 0.08,
      expectedAssists: 0.16,
      cleanSheetProbability: 0.36,
    },
  ];

  const player = useQuery<PlayerResult>(
    { kind: 'simulatePlayer', profiles, draws: Math.min(draws, 20000), seed: state.seed },
    `player|${draws}|${state.seed}`,
  );

  return (
    <>
      <Section
        title="One match, twenty thousand times"
        description="Two independent Poisson processes, drawn from a seed. The independence is the model's known error, and it always understates draws: a side two down attacks."
        aside={
          <div className={styles.inlineControls}>
            <NumberField
              label="Home goals expected"
              value={homeGoals}
              step={0.1}
              min={0.1}
              max={5}
              onChange={setHomeGoals}
            />
            <NumberField
              label="Away goals expected"
              value={awayGoals}
              step={0.1}
              min={0.1}
              max={5}
              onChange={setAwayGoals}
            />
            <NumberField
              label="Draws"
              value={draws}
              step={1000}
              min={1000}
              max={80000}
              onChange={(value) => {
                setDraws(Math.round(value));
              }}
            />
            <NumberField
              label="Seed"
              value={state.seed}
              min={1}
              onChange={(value) => {
                update({ seed: Math.round(value) });
              }}
            />
          </div>
        }
      >
        {match.error !== null ? <Failure message={match.error} /> : null}
        {match.data === null ? (
          <Loading label="Simulating…" />
        ) : (
          <>
            <StatGrid
              stats={[
                { label: 'Home win', value: `${formatNumber(match.data.homeWin * 100, 1)}%` },
                { label: 'Draw', value: `${formatNumber(match.data.draw * 100, 1)}%` },
                { label: 'Away win', value: `${formatNumber(match.data.awayWin * 100, 1)}%` },
                {
                  label: 'Home clean sheet',
                  value: `${formatNumber(match.data.homeCleanSheet * 100, 1)}%`,
                },
                {
                  label: 'Away clean sheet',
                  value: `${formatNumber(match.data.awayCleanSheet * 100, 1)}%`,
                },
                { label: 'Over 2.5', value: `${formatNumber(match.data.overTwoFive * 100, 1)}%` },
              ]}
            />
            <BarChart
              bars={match.data.scorelines.slice(0, 8).map((line) => ({
                label: `${line.home}–${line.away}`,
                value: line.probability * 100,
              }))}
              unit="%"
            />
            <Verdict>
              A clean sheet probability of {formatNumber(match.data.homeCleanSheet * 100, 1)}{' '}
              percent is exactly exp(−{formatNumber(awayGoals, 2)}) within simulation error, which
              is the check that the draws are doing what the model says. Seed {match.data.seed}{' '}
              reproduces this exactly.
            </Verdict>
          </>
        )}
      </Section>

      <Section
        title="What a gameweek looks like for one player"
        description="Minutes first, then goals and assists as counts, then the clean sheet and concession rules the position is paid under. A distribution, not a projection."
      >
        {player.data === null ? (
          <Loading label="Simulating players…" />
        ) : (
          <>
            <Fan
              points={player.data.simulations.map((simulation) => ({
                label: simulation.name.split(' ')[0] ?? simulation.name,
                p5: simulation.fan.p5,
                p25: simulation.fan.p25,
                median: simulation.fan.median,
                p75: simulation.fan.p75,
                p95: simulation.fan.p95,
                mean: simulation.fan.mean,
              }))}
            />
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Profile</th>
                    <th scope="col">Mean</th>
                    <th scope="col">Blank risk</th>
                    <th scope="col">6 or more</th>
                    <th scope="col">10 or more</th>
                    <th scope="col">Captain EV</th>
                    <th scope="col">Best of the three</th>
                  </tr>
                </thead>
                <tbody>
                  {player.data.simulations.map((simulation) => {
                    const captain = player.data?.captaincy.find(
                      (entry) => entry.name === simulation.name,
                    );
                    return (
                      <tr key={simulation.name}>
                        <th scope="row">{simulation.name}</th>
                        <td className="num">{formatNumber(simulation.fan.mean, 2)}</td>
                        <td className="num">{formatNumber(simulation.blankRisk * 100, 0)}%</td>
                        <td className="num">
                          {formatNumber(
                            (simulation.atLeast.find((entry) => entry.threshold === 6)
                              ?.probability ?? 0) * 100,
                            0,
                          )}
                          %
                        </td>
                        <td className="num">
                          {formatNumber(
                            (simulation.atLeast.find((entry) => entry.threshold === 10)
                              ?.probability ?? 0) * 100,
                            0,
                          )}
                          %
                        </td>
                        <td className="num">{formatNumber(captain?.expected ?? Number.NaN, 2)}</td>
                        <td className="num">
                          {formatNumber((captain?.winProbability ?? 0) * 100, 0)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Verdict>
              The captaincy column compares the three within the same simulated weeks, so "best of
              the three" is a paired probability rather than three separate runs put side by side.
            </Verdict>
          </>
        )}
      </Section>
    </>
  );
}

interface PortfolioResult {
  frontier: {
    lambda: number;
    expected: number;
    risk: number;
    cost: number;
    ratio: number;
    players: {
      name: string;
      club: string;
      group: string;
      cost: number;
      expected: number;
      risk: number;
    }[];
    contributions: { name: string; share: number }[];
  }[];
  candidates: number;
}

export function PortfolioPanel({ scope, scopeKey }: PanelProps): React.ReactElement {
  const [season, setSeason] = useState(SEASONS[SEASONS.length - 1] ?? '2025-26');
  const [budget, setBudget] = useState(1000);
  const [maxPerClub, setMaxPerClub] = useState(3);
  const [correlation, setCorrelation] = useState(0.35);
  const [selected, setSelected] = useState(0);

  const portfolio = useQuery<PortfolioResult>(
    { kind: 'portfolio', scope, season, budget, maxPerClub, clubCorrelation: correlation },
    `${scopeKey}|portfolio|${season}|${budget}|${maxPerClub}|${correlation}`,
  );

  const chosen =
    portfolio.data?.frontier[Math.min(selected, (portfolio.data.frontier.length || 1) - 1)];

  return (
    <Section
      title="The squad as a portfolio"
      description="Fifteen players, a budget, the 2/5/5/3 shape, and at most three from a club. Each point on the frontier is the best squad at one level of risk aversion, measured on that season's own week to week variance."
      aside={
        <div className={styles.inlineControls}>
          <Select
            label="Season"
            value={season}
            options={SEASONS.map((value) => ({ value, label: value.replace('-', '/') }))}
            onChange={setSeason}
          />
          <NumberField
            label="Budget"
            value={budget}
            step={10}
            min={600}
            max={1200}
            onChange={(value) => {
              setBudget(Math.round(value));
            }}
            hint="Tenths of a million"
          />
          <NumberField
            label="Per club"
            value={maxPerClub}
            min={1}
            max={5}
            onChange={(value) => {
              setMaxPerClub(Math.round(value));
            }}
          />
          <NumberField
            label="Club correlation"
            value={correlation}
            step={0.05}
            min={0}
            max={0.9}
            onChange={setCorrelation}
            hint="A clean sheet is one shared event"
          />
        </div>
      }
    >
      {portfolio.error !== null ? <Failure message={portfolio.error} /> : null}
      {portfolio.data === null ? (
        <Loading label="Searching squads…" />
      ) : portfolio.data.frontier.length === 0 ? (
        <Failure message="No legal squad fits that budget. Raise it, or widen the filter so more players qualify." />
      ) : (
        <>
          <LineChart
            series={[
              {
                name: 'Efficient frontier',
                points: portfolio.data.frontier.map((point) => ({
                  x: point.risk,
                  y: point.expected,
                })),
              },
            ]}
            xLabel="squad risk, points per gameweek"
            yLabel="expected points per gameweek"
          />
          <div className={styles.presetRow}>
            {portfolio.data.frontier.map((point, index) => (
              <button
                key={point.lambda}
                type="button"
                className={styles.columnChip}
                data-active={index === selected}
                aria-pressed={index === selected}
                onClick={() => {
                  setSelected(index);
                }}
              >
                risk {formatNumber(point.risk, 1)}
              </button>
            ))}
          </div>

          {chosen === undefined ? null : (
            <>
              <StatGrid
                stats={[
                  { label: 'Expected', value: formatNumber(chosen.expected, 2) },
                  { label: 'Risk', value: formatNumber(chosen.risk, 2) },
                  { label: 'Return per risk', value: formatNumber(chosen.ratio, 2) },
                  { label: 'Spend', value: `${formatNumber(chosen.cost / 10, 1)}m` },
                  { label: 'Candidates', value: portfolio.data.candidates.toLocaleString('en-GB') },
                ]}
              />
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">Player</th>
                      <th scope="col">Position</th>
                      <th scope="col">Club</th>
                      <th scope="col">Price</th>
                      <th scope="col">Expected</th>
                      <th scope="col">Risk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chosen.players.map((player) => (
                      <tr key={`${player.name}-${player.club}`}>
                        <th scope="row">{player.name}</th>
                        <td>{player.group}</td>
                        <td>{player.club}</td>
                        <td className="num">{formatNumber(player.cost / 10, 1)}</td>
                        <td className="num">{formatNumber(player.expected, 2)}</td>
                        <td className="num">{formatNumber(player.risk, 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <BarChart
                bars={chosen.contributions.map((entry) => ({
                  label: entry.name,
                  value: entry.share * 100,
                }))}
                unit="%"
              />
              <Verdict>
                Risk here is the week to week spread of points the squad actually delivered that
                season, not a guess. Two players from one club share a clean sheet, so the third
                pick from a club costs more variance than the first: that is what the correlation
                control changes.
              </Verdict>
            </>
          )}
        </>
      )}
    </Section>
  );
}

interface ArchiveResult {
  seasons: {
    season: string;
    played: number;
    goalsPerMatch: number;
    homeWinShare: number;
    drawShare: number;
    awayWinShare: number;
    attendance: number | null;
  }[];
  homeAdvantageTest: { statistic: number; pValue: number; estimate: number; verdict: string };
  homeAdvantagePermutation: { pValue: number; observed: number };
  matches: number;
}

export function ArchivePanel(): React.ReactElement {
  const archive = useQuery<ArchiveResult>({ kind: 'archive' }, 'archive');

  return (
    <Section
      title="Thirty five seasons"
      description="The official record, every match since 1992/93. This is where the Lab's numbers come from when the question is about the league rather than about a player."
    >
      {archive.error !== null ? <Failure message={archive.error} /> : null}
      {archive.data === null ? (
        <Loading label="Reading the archive…" />
      ) : (
        <>
          <StatGrid
            stats={[
              { label: 'Matches', value: archive.data.matches.toLocaleString('en-GB') },
              { label: 'Seasons', value: String(archive.data.seasons.length) },
              {
                label: 'Home win share now',
                value: `${formatNumber((archive.data.seasons[archive.data.seasons.length - 1]?.homeWinShare ?? 0) * 100, 1)}%`,
              },
              {
                label: 'Goals per match now',
                value: formatNumber(
                  archive.data.seasons[archive.data.seasons.length - 1]?.goalsPerMatch ??
                    Number.NaN,
                  2,
                ),
              },
            ]}
          />
          <LineChart
            series={[
              {
                name: 'Home win share',
                points: archive.data.seasons.map((season, index) => ({
                  x: index,
                  y: season.homeWinShare * 100,
                })),
              },
              {
                name: 'Draw share',
                points: archive.data.seasons.map((season, index) => ({
                  x: index,
                  y: season.drawShare * 100,
                })),
              },
              {
                name: 'Away win share',
                points: archive.data.seasons.map((season, index) => ({
                  x: index,
                  y: season.awayWinShare * 100,
                })),
              },
            ]}
            xLabel="seasons since 1992/93"
            yLabel="share of matches, percent"
          />
          <Verdict tone={archive.data.homeAdvantageTest.pValue < 0.05 ? 'good' : 'plain'}>
            Home advantage before 2010/11 against after it: a difference of{' '}
            {formatNumber(archive.data.homeAdvantageTest.estimate * 100, 1)} percentage points,
            Welch p ={' '}
            {archive.data.homeAdvantageTest.pValue < 0.001
              ? 'below 0.001'
              : formatNumber(archive.data.homeAdvantageTest.pValue, 3)}
            , and a permutation test over 4,000 shuffles agrees at p ={' '}
            {formatNumber(archive.data.homeAdvantagePermutation.pValue, 3)}. Tested rather than
            eyeballed, because a line that slopes is not evidence on its own.
          </Verdict>
          <LineChart
            series={[
              {
                name: 'Goals per match',
                points: archive.data.seasons.map((season, index) => ({
                  x: index,
                  y: season.goalsPerMatch,
                })),
              },
            ]}
            xLabel="seasons since 1992/93"
            yLabel="goals"
          />
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Season</th>
                  <th scope="col">Played</th>
                  <th scope="col">Goals per match</th>
                  <th scope="col">Home wins</th>
                  <th scope="col">Draws</th>
                  <th scope="col">Away wins</th>
                  <th scope="col">Attendance</th>
                </tr>
              </thead>
              <tbody>
                {[...archive.data.seasons].reverse().map((season) => (
                  <tr key={season.season}>
                    <th scope="row">{season.season}</th>
                    <td className="num">{season.played}</td>
                    <td className="num">{formatNumber(season.goalsPerMatch, 2)}</td>
                    <td className="num">{formatNumber(season.homeWinShare * 100, 1)}%</td>
                    <td className="num">{formatNumber(season.drawShare * 100, 1)}%</td>
                    <td className="num">{formatNumber(season.awayWinShare * 100, 1)}%</td>
                    <td className="num">
                      {season.attendance === null
                        ? 'n/a'
                        : Math.round(season.attendance).toLocaleString('en-GB')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Section>
  );
}
