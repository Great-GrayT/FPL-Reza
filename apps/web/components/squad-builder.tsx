'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  INITIAL_BUDGET,
  POSITIONS,
  SQUAD_QUOTA,
  SQUAD_SIZE,
  formatPrice,
  type Availability,
  type PlayerId,
  type Position,
  type TeamId,
} from '@fpl/core';
import {
  autoPick,
  bestStartingEleven,
  canAdd,
  formationLabel,
  squadCost,
  suggestTransfers,
  validateSquad,
  type SquadPlayer,
} from '@fpl/analytics';
import { shirtUrl } from '@fpl/assets/urls';
import { classes } from '@/lib/classes';
import { MetricTip } from './metric-tip';
import { PersonPhoto } from './person-photo';
import styles from './squad-builder.module.css';

/**
 * The squad on a printed pitch: the tactics plan from a matchday programme,
 * drawn in ink on flat green at the real 105 by 68 proportion, with each player
 * a club shirt pinned above a paper name tag. The tag is where the numbers go,
 * because a figure printed on grass is a figure nobody can read.
 *
 * Every tag carries what a choice is actually made on: the price, the projection
 * the model produced, the two inputs behind it that a manager can argue with
 * (recent scoring rate and how reliably he starts), his ownership, and the next
 * three fixtures by difficulty. Nothing on it is decoration.
 *
 * Every rule is enforced by the same engine the server uses (@fpl/analytics), so
 * the builder cannot disagree with the platform about whether a squad is legal.
 */

export interface BuilderPlayer extends SquadPlayer {
  code: number;
  totalPoints: number;
  form: number;
  ownership: number;
  minutes: number;
  availability: Availability;
  news: string;
  /** Projected points per gameweek, computed on the server. */
  projected: number;
  /** Why the projection landed where it did, in words. */
  why: string[];
  /** Share of recent gameweeks the player finished, as a percentage. */
  starterReliability: number;
  /** Points per ninety over the form window: the rate behind the projection. */
  pointsPer90: number;
  /** The next three fixtures, as the ticker on the tag prints them. */
  next: { gameweek: number; opponent: number; home: boolean; difficulty: number }[];
  /** Gameweeks in that runway with no fixture at all. */
  blanks: number[];
}

export interface BuilderTeam {
  id: TeamId;
  code: number;
  name: string;
  shortName: string;
}

type SortKey = 'projected' | 'points' | 'price' | 'form' | 'ownership' | 'value';

const SORTS: { key: SortKey; label: string; metric: string }[] = [
  { key: 'projected', label: 'Projected', metric: 'projection' },
  { key: 'points', label: 'Points', metric: 'points' },
  { key: 'form', label: 'Form', metric: 'form' },
  { key: 'value', label: 'Value', metric: 'ppm' },
  { key: 'price', label: 'Price', metric: 'price' },
  { key: 'ownership', label: 'Owned', metric: 'ownership' },
];

const STORAGE_KEY = 'fpl-lake.squad.v1';

const positionLabel: Record<Position, string> = {
  GKP: 'Goalkeepers',
  DEF: 'Defenders',
  MID: 'Midfielders',
  FWD: 'Forwards',
};

const sortValue = (row: BuilderPlayer, key: SortKey): number => {
  switch (key) {
    case 'projected':
      return row.projected;
    case 'points':
      return row.totalPoints;
    case 'form':
      return row.form;
    case 'price':
      return row.price;
    case 'ownership':
      return row.ownership;
    case 'value':
      return row.totalPoints / Math.max(row.price / 10, 0.1);
  }
};

export function SquadBuilder({
  players,
  teams,
  gameweek,
  deadline,
  horizon,
}: {
  players: readonly BuilderPlayer[];
  teams: readonly BuilderTeam[];
  gameweek: number;
  deadline: string | null;
  horizon: number;
}) {
  const [picks, setPicks] = useState<PlayerId[]>([]);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState<Position | 'ALL'>('ALL');
  const [club, setClub] = useState<'ALL' | number>('ALL');
  const [maxPrice, setMaxPrice] = useState(150);
  const [sort, setSort] = useState<SortKey>('projected');
  /** The player picked up, by pointer or by keyboard. */
  const [holding, setHolding] = useState<PlayerId | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const liveRegion = useRef<HTMLParagraphElement>(null);

  const byId = useMemo(() => new Map(players.map((player) => [player.id, player])), [players]);
  const teamById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const teamName = useCallback(
    (id: TeamId): string => teamById.get(id)?.name ?? `club ${String(id)}`,
    [teamById],
  );

  // A squad in progress survives a refresh: this is a page people leave open
  // for an hour while they argue with themselves about a midfielder.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored !== null) {
        const parsed: unknown = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const ids = parsed.filter((id): id is number => typeof id === 'number');
          setPicks(ids.filter((id) => byId.has(id as PlayerId)) as PlayerId[]);
        }
      }
    } catch {
      // A corrupt or blocked store is not worth a broken page.
    }
    setRestored(true);
  }, [byId]);

  useEffect(() => {
    if (!restored) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(picks));
    } catch {
      // Private browsing refuses writes; the squad still works in memory.
    }
  }, [picks, restored]);

  const state = useMemo(() => ({ picks, budget: INITIAL_BUDGET }), [picks]);
  const cost = useMemo(() => squadCost(state, players), [state, players]);
  const issues = useMemo(() => validateSquad(state, players, teamName), [state, players, teamName]);

  const projection = useCallback(
    (player: SquadPlayer): number => byId.get(player.id)?.projected ?? 0,
    [byId],
  );

  const eleven = useMemo(
    () => bestStartingEleven(picks, players, projection),
    [picks, players, projection],
  );

  const transfers = useMemo(
    () => (picks.length === SQUAD_SIZE ? suggestTransfers(state, players, projection, 4) : []),
    [picks.length, state, players, projection],
  );

  const say = useCallback((text: string) => {
    setMessage(text);
  }, []);

  const add = useCallback(
    (id: PlayerId) => {
      const candidate = byId.get(id);
      if (candidate === undefined) return;
      const check = canAdd({ picks, budget: INITIAL_BUDGET }, candidate, players);
      if (!check.ok) {
        say(check.reason);
        return;
      }
      setPicks((current) => [...current, id]);
      say(`${candidate.webName} added. ${formatPrice(cost.remaining - candidate.price)} left.`);
      setHolding(null);
    },
    [byId, picks, players, cost.remaining, say],
  );

  const remove = useCallback(
    (id: PlayerId) => {
      const player = byId.get(id);
      setPicks((current) => current.filter((entry) => entry !== id));
      if (player !== undefined) say(`${player.webName} removed.`);
    },
    [byId, say],
  );

  const filled = useMemo(() => {
    const bySlot: Record<Position, BuilderPlayer[]> = { GKP: [], DEF: [], MID: [], FWD: [] };
    for (const id of picks) {
      const player = byId.get(id);
      if (player !== undefined) bySlot[player.position].push(player);
    }
    return bySlot;
  }, [picks, byId]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return players
      .filter((player) => {
        if (position !== 'ALL' && player.position !== position) return false;
        if (club !== 'ALL' && player.teamId !== club) return false;
        if (player.price > maxPrice) return false;
        if (needle === '') return true;
        const clubName = teamById.get(player.teamId)?.name.toLowerCase() ?? '';
        return player.webName.toLowerCase().includes(needle) || clubName.includes(needle);
      })
      .sort((a, b) =>
        sort === 'price' ? a.price - b.price : sortValue(b, sort) - sortValue(a, sort),
      )
      .slice(0, 120);
  }, [players, position, club, maxPrice, query, sort, teamById]);

  const autoFill = useCallback(() => {
    const complete = autoPick(players, projection, { keep: picks, budget: INITIAL_BUDGET });
    setPicks(complete);
    say(`Squad completed to ${String(complete.length)} players, keeping your picks.`);
  }, [players, projection, picks, say]);

  const clear = useCallback(() => {
    setPicks([]);
    say('Squad cleared.');
  }, [say]);

  const spentShare = Math.min(100, (cost.spent / cost.budget) * 100);
  const starters = new Set(eleven.starters);

  return (
    <div className={styles.page}>
      <header className={styles.masthead}>
        <p className={styles.eyebrow}>
          Gameweek {gameweek}
          {deadline !== null && (
            <>
              {' '}
              · deadline{' '}
              {new Date(deadline).toLocaleString('en-GB', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </>
          )}
        </p>
        <h1 className={styles.title}>Team sheet</h1>
        <p className={styles.standfirst}>
          Fifteen players, {formatPrice(INITIAL_BUDGET)}, no more than three from one club. Press a
          name to add them, or drag it onto a slot. Press a name in the squad to take them out.
          Every column is defined: follow the mark beside it.
        </p>
      </header>

      <div className={styles.layout}>
        <section className={styles.sheet} aria-labelledby="sheet">
          <h2 id="sheet" className="visually-hidden">
            Your squad
          </h2>

          <div className={styles.meters}>
            <div className={styles.budget}>
              <div className={styles.budgetHead}>
                <MetricTip id="budget">Budget</MetricTip>
                <p className="num">
                  <strong className={cost.remaining < 0 ? styles.over : undefined}>
                    {formatPrice(cost.remaining)}
                  </strong>{' '}
                  <span className={styles.of}>left of {formatPrice(cost.budget)}</span>
                </p>
              </div>
              <div
                className={styles.gauge}
                role="meter"
                aria-valuemin={0}
                aria-valuemax={cost.budget / 10}
                aria-valuenow={cost.spent / 10}
                aria-label="Budget spent"
              >
                <span
                  className={styles.gaugeFill}
                  data-over={cost.remaining < 0 ? 'true' : undefined}
                  style={{ inlineSize: `${String(spentShare)}%` }}
                />
              </div>
            </div>

            <dl className={styles.quotas}>
              {POSITIONS.map((slot) => (
                <div
                  key={slot}
                  className={styles.quota}
                  data-full={filled[slot].length === SQUAD_QUOTA[slot] ? 'true' : undefined}
                >
                  <dt>{slot}</dt>
                  <dd className="num">
                    {filled[slot].length}/{SQUAD_QUOTA[slot]}
                  </dd>
                </div>
              ))}
              <div className={styles.quota}>
                <dt>Squad</dt>
                <dd className="num">
                  {picks.length}/{SQUAD_SIZE}
                </dd>
              </div>
            </dl>
          </div>

          {holding !== null && (
            <p className={styles.holding}>
              Dragging <strong>{byId.get(holding)?.webName}</strong>. Drop them on a slot, or{' '}
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => {
                  setHolding(null);
                }}
              >
                cancel
              </button>
              .
            </p>
          )}

          <div className={styles.pitch}>
            <PitchLines />
            {POSITIONS.map((slot) => (
              <section key={slot} className={styles.line} aria-labelledby={`line-${slot}`}>
                <h3 id={`line-${slot}`} className={styles.lineHead}>
                  <span className={styles.stamp}>{slot}</span>
                  {positionLabel[slot]}
                  <span className={classes(styles.lineCount, 'num')}>
                    {filled[slot].length}/{SQUAD_QUOTA[slot]}
                  </span>
                </h3>

                <ul className={styles.slots}>
                  {Array.from({ length: SQUAD_QUOTA[slot] }, (_, index) => {
                    const player = filled[slot][index];
                    return (
                      <Slot
                        key={`${slot}-${String(index)}`}
                        slot={slot}
                        player={player}
                        isStarter={player !== undefined && starters.has(player.id)}
                        isCaptain={player?.id === eleven.captain}
                        club={player === undefined ? undefined : teamById.get(player.teamId)}
                        holding={holding}
                        onDropPlayer={add}
                        onRemove={remove}
                      />
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>

          <ul className={styles.tokenKey}>
            <li>
              Each tag reads <b>price</b>, the <b>projection</b>, <b>points per ninety</b>, the{' '}
              <b>share of recent gameweeks finished</b>, and <b>ownership</b>.
            </li>
            <li>
              The three bars are the next three fixtures, coloured by difficulty. Fewer than three
              means a blank gameweek.
            </li>
          </ul>

          <section className={styles.readout} aria-labelledby="readout">
            <h3 id="readout" className={styles.readoutHead}>
              Where this squad stands
            </h3>

            {issues.length === 0 ? (
              <p className={styles.legal}>
                Legal squad. Best eleven is {formationLabel(eleven.formation)} for{' '}
                <strong className="num">{eleven.projectedPoints.toFixed(1)}</strong>{' '}
                <MetricTip id="projection">projected points</MetricTip> next gameweek, captaining{' '}
                <strong>{byId.get(eleven.captain ?? (0 as PlayerId))?.webName ?? 'nobody'}</strong>.
              </p>
            ) : (
              <ul className={styles.issues}>
                {issues.map((issue, index) => (
                  <li key={`${issue.code}-${String(index)}`}>{issue.message}</li>
                ))}
              </ul>
            )}

            {transfers.length > 0 && (
              <div className={styles.transfers}>
                <h4 className={styles.transfersHead}>Swaps that raise the projection</h4>
                <ul>
                  {transfers.map((swap) => {
                    const out = byId.get(swap.out);
                    const incoming = byId.get(swap.in);
                    if (out === undefined || incoming === undefined) return null;
                    return (
                      <li key={`${String(swap.out)}-${String(swap.in)}`}>
                        <button
                          type="button"
                          className={styles.swap}
                          onClick={() => {
                            setPicks((current) => [
                              ...current.filter((id) => id !== swap.out),
                              swap.in,
                            ]);
                            say(`${out.webName} out, ${incoming.webName} in.`);
                          }}
                        >
                          <span>
                            {out.webName} → {incoming.webName}
                          </span>
                          <span className="num">
                            +{swap.gain.toFixed(1)} pts
                            {swap.freed !== 0 && (
                              <>
                                {' '}
                                · {swap.freed > 0 ? 'frees' : 'costs'}{' '}
                                {formatPrice(Math.abs(swap.freed))}
                              </>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <div className={styles.actions}>
              <button type="button" className={styles.primary} onClick={autoFill}>
                Complete the squad
              </button>
              <button type="button" className={styles.secondary} onClick={clear}>
                Clear
              </button>
            </div>
          </section>
        </section>

        <section className={styles.panel} aria-labelledby="panel">
          <h2 id="panel" className={styles.panelHead}>
            Available players
          </h2>

          <div className={styles.filters}>
            <label className={styles.field}>
              <span>Search</span>
              <input
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
                placeholder="Name or club"
              />
            </label>

            <label className={styles.field}>
              <span>Position</span>
              <select
                value={position}
                onChange={(event) => {
                  setPosition(event.target.value as Position | 'ALL');
                }}
              >
                <option value="ALL">All</option>
                {POSITIONS.map((slot) => (
                  <option key={slot} value={slot}>
                    {slot}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.field}>
              <span>Club</span>
              <select
                value={String(club)}
                onChange={(event) => {
                  setClub(event.target.value === 'ALL' ? 'ALL' : Number(event.target.value));
                }}
              >
                <option value="ALL">All</option>
                {[...teams]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
              </select>
            </label>

            <label className={styles.field}>
              <span>
                Max <MetricTip id="price">price</MetricTip> {formatPrice(maxPrice)}
              </span>
              <input
                type="range"
                min={38}
                max={150}
                step={1}
                value={maxPrice}
                onChange={(event) => {
                  setMaxPrice(Number(event.target.value));
                }}
              />
            </label>
          </div>

          <div className={styles.sorts} role="group" aria-label="Sort by">
            {SORTS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={styles.sortButton}
                aria-pressed={sort === option.key}
                onClick={() => {
                  setSort(option.key);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>

          <p className={styles.count}>
            {visible.length} shown of {players.length}. Projection weighs the next {horizon}{' '}
            gameweeks.
          </p>

          <ul className={styles.list}>
            {visible.map((player) => {
              const club = teamById.get(player.teamId);
              const held = picks.includes(player.id);
              const check = canAdd({ picks, budget: INITIAL_BUDGET }, player, players);
              const blocked = !held && !check.ok;

              return (
                <li key={player.id}>
                  <div
                    className={styles.row}
                    data-held={held ? 'true' : undefined}
                    data-blocked={blocked ? 'true' : undefined}
                    draggable={!held}
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/plain', String(player.id));
                      event.dataTransfer.effectAllowed = 'copy';
                      setHolding(player.id);
                    }}
                    onDragEnd={() => {
                      setHolding(null);
                    }}
                  >
                    <button
                      type="button"
                      className={styles.rowMain}
                      onClick={() => {
                        if (held) remove(player.id);
                        else add(player.id);
                      }}
                      aria-describedby={`why-${String(player.id)}`}
                    >
                      <PersonPhoto
                        kind="player"
                        code={player.code}
                        name={player.webName}
                        size="sm"
                        className={styles.rowFace ?? ''}
                      />
                      <span className={styles.rowName}>
                        <span className={styles.rowClub}>{club?.shortName ?? '???'}</span>
                        {player.webName}
                        {player.availability !== 'available' && (
                          <span className={styles.flag}>
                            {player.availability === 'doubtful' ? 'doubt' : player.availability}
                          </span>
                        )}
                      </span>
                      <span className={classes(styles.rowStats, 'num')}>
                        <span title="Position">{player.position}</span>
                        <span title="Price">{formatPrice(player.price)}</span>
                        <strong title="Projected points, from the model">
                          {player.projected.toFixed(1)}
                        </strong>
                        <span title="Points per ninety over the form window">
                          {player.pointsPer90.toFixed(1)}
                        </span>
                        <span title="Share of recent gameweeks he finished">
                          {player.starterReliability}%
                        </span>
                        <span title="Owned by">{player.ownership.toFixed(0)}%</span>
                        <span className={styles.rowPoints} title="Points this season">
                          {player.totalPoints}
                        </span>
                        <span className={styles.rowTicker} aria-hidden="true">
                          {player.next.map((fixture) => (
                            <span
                              key={fixture.gameweek}
                              className={styles.tick}
                              data-difficulty={fixture.difficulty}
                            />
                          ))}
                        </span>
                      </span>
                    </button>
                    <p id={`why-${String(player.id)}`} className={styles.why}>
                      {player.news === '' ? player.why.join('; ') : player.news}
                      {held && '. In your squad: press again to take them out.'}
                      {!check.ok && !held && (
                        <span className={styles.blockedReason}> {check.reason}</span>
                      )}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>

          {visible.length === 0 && (
            <p className={styles.empty}>
              No player matches those filters. Widen the price or clear the search.
            </p>
          )}
        </section>
      </div>

      <p aria-live="polite" role="status" className={styles.live} ref={liveRegion}>
        {message}
      </p>

      <section className={styles.legend} aria-labelledby="legend">
        <h2 id="legend" className={styles.legendHead}>
          The columns, defined
        </h2>
        <ul className={styles.legendList}>
          {SORTS.map((option) => (
            <li key={option.key}>
              <MetricTip id={option.metric}>{option.label}</MetricTip>
            </li>
          ))}
          <li>
            <MetricTip id="fdr" />
          </li>
          <li>
            <MetricTip id="selling-price" />
          </li>
        </ul>
      </section>
    </div>
  );
}

function Slot({
  slot,
  player,
  club,
  isStarter,
  isCaptain,
  holding,
  onDropPlayer,
  onRemove,
}: {
  slot: Position;
  player: BuilderPlayer | undefined;
  club: BuilderTeam | undefined;
  isStarter: boolean;
  isCaptain: boolean;
  holding: PlayerId | null;
  onDropPlayer: (id: PlayerId) => void;
  onRemove: (id: PlayerId) => void;
}) {
  const [over, setOver] = useState(false);

  const accept = (raw: string): void => {
    const id = Number(raw);
    if (Number.isInteger(id) && id > 0) onDropPlayer(id as PlayerId);
  };

  return (
    <li
      className={styles.slot}
      data-filled={player !== undefined ? 'true' : undefined}
      data-over={over ? 'true' : undefined}
      data-starter={isStarter ? 'true' : undefined}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => {
        setOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        accept(event.dataTransfer.getData('text/plain'));
      }}
    >
      {player === undefined ? (
        <button
          type="button"
          className={styles.emptySlot}
          // Keyboard and touch route: pick a player up in the list, then choose
          // a slot. Drag and drop alone would exclude both.
          onClick={() => {
            if (holding !== null) onDropPlayer(holding);
          }}
        >
          <span className={styles.slotStamp}>{slot}</span>
          <span className={styles.slotHint}>{holding === null ? 'Empty' : 'Drop here'}</span>
        </button>
      ) : (
        <div className={styles.card}>
          <span className={styles.shirt}>
            {club === undefined ? (
              <span className={styles.shirtBlank} aria-hidden="true" />
            ) : (
              // A plain img: the CDN serves one fixed size, and next/image
              // would proxy 590 of them for nothing.
              <img
                className={styles.shirtImage}
                src={shirtUrl(club.code, { keeper: slot === 'GKP' })}
                alt=""
                width={54}
                height={68}
                loading="lazy"
              />
            )}
            {isCaptain && (
              <abbr className={styles.captain} title="Captain: the projection's top starter">
                C
              </abbr>
            )}
            {!isStarter && <span className={styles.benched}>Bench</span>}
          </span>

          <span className={styles.tag}>
            <span className={styles.cardName}>{player.webName}</span>
            <span className={styles.cardClub}>
              {club?.shortName ?? '???'}
              {player.availability !== 'available' && (
                <abbr
                  className={styles.doubt}
                  title={player.news === '' ? player.availability : player.news}
                >
                  !
                </abbr>
              )}
            </span>

            <span className={classes(styles.metrics, 'num')}>
              <span title="Price">{formatPrice(player.price)}</span>
              <strong title="Projected points, from the model">
                {player.projected.toFixed(1)}
              </strong>
              <span title="Points per ninety over the form window">
                {player.pointsPer90.toFixed(1)}
              </span>
              <span title="Share of recent gameweeks he finished">
                {player.starterReliability}%
              </span>
              <span title="Owned by">{player.ownership.toFixed(0)}%</span>
            </span>

            <span className={styles.ticker} aria-hidden="true">
              {player.next.length === 0 ? (
                <span className={styles.tickBlank} title="No fixture in the next three">
                  &ndash;
                </span>
              ) : (
                player.next.map((fixture) => (
                  <span
                    key={fixture.gameweek}
                    className={styles.tick}
                    data-difficulty={fixture.difficulty}
                    title={`Gameweek ${String(fixture.gameweek)}, difficulty ${String(fixture.difficulty)}`}
                  />
                ))
              )}
            </span>
            <span className="visually-hidden">
              {`${player.next.length.toString()} of the next three gameweeks have a fixture`}
            </span>
          </span>

          <button
            type="button"
            className={styles.removeButton}
            onClick={() => {
              onRemove(player.id);
            }}
            aria-label={`Remove ${player.webName}`}
          >
            ×
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * The pitch itself: ink line-work on flat green at the real 105 by 68 ratio, the
 * same proportion `components/pitch.tsx` draws a heatmap on, so a squad and a
 * heatmap describe the same rectangle. Drawn rather than photographed, because
 * every other surface on this site is printed and a photograph of grass here
 * would be the one thing that is not.
 */
function PitchLines() {
  return (
    <svg
      className={styles.pitchLines}
      viewBox="0 0 1050 680"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <g fill="none" stroke="currentColor" strokeWidth="3">
        <rect x="8" y="8" width="1034" height="664" />
        <line x1="525" y1="8" x2="525" y2="672" />
        <circle cx="525" cy="340" r="91" />
        <rect x="8" y="139" width="165" height="402" />
        <rect x="8" y="248" width="55" height="184" />
        <rect x="877" y="139" width="165" height="402" />
        <rect x="987" y="248" width="55" height="184" />
      </g>
      <g fill="currentColor">
        <circle cx="525" cy="340" r="5" />
        <circle cx="118" cy="340" r="5" />
        <circle cx="932" cy="340" r="5" />
      </g>
    </svg>
  );
}
