'use client';

/**
 * The workspace itself: a rail that scopes the data, a strip of panels, and a
 * status bar that never lets you forget how many rows the number on screen was
 * computed from.
 *
 * The shape is a desk rather than a dashboard. A dashboard answers questions
 * somebody else chose; this is for the ones you arrive with.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@/lib/quant/client';
import type { Scope } from '@/lib/quant/protocol';
import { scopeKey as makeScopeKey } from '@/lib/quant/protocol';
import { COVERAGE_NOTES, SEASONS, STARTER_COLUMNS } from '@/lib/quant/schema';
import {
  DEFAULT_STATE,
  decodeState,
  deleteView,
  encodeState,
  loadViews,
  saveView,
  type LabState,
  type PanelId,
  type SavedView,
} from '@/lib/quant/url-state';
import { Coverage, formatNumber } from './charts';
import { Button, Chips, FormulaField, NumberField } from './controls';
import {
  DistributionsPanel,
  RelationshipsPanel,
  ScreenerPanel,
  TimePanel,
  type PanelProps,
} from './panels-explore';
import { BacktestPanel, FactorPanel, ModelPanel } from './panels-signal';
import { ArchivePanel, PortfolioPanel, SimulatePanel } from './panels-decide';
import { SpacePanel } from './panels-space';
import styles from './lab.module.css';

interface PanelDefinition {
  id: PanelId;
  label: string;
  blurb: string;
  Component: (props: PanelProps) => React.ReactElement;
}

const PANELS: PanelDefinition[] = [
  {
    id: 'screener',
    label: 'Screener',
    blurb: 'Every row, filtered and sorted',
    Component: ScreenerPanel,
  },
  {
    id: 'distributions',
    label: 'Distributions',
    blurb: 'One column, in full',
    Component: DistributionsPanel,
  },
  {
    id: 'relationships',
    label: 'Relationships',
    blurb: 'Two columns, and all of them',
    Component: RelationshipsPanel,
  },
  {
    id: 'space',
    label: 'Space (3D)',
    blurb: 'Three measures, a surface, and the player space',
    Component: SpacePanel,
  },
  {
    id: 'time',
    label: 'Time',
    blurb: 'Over gameweeks, and whether it persists',
    Component: TimePanel,
  },
  {
    id: 'factors',
    label: 'Factors',
    blurb: 'Does this number predict next week',
    Component: FactorPanel,
  },
  {
    id: 'model',
    label: 'Model',
    blurb: 'Fit one, and check it out of sample',
    Component: ModelPanel,
  },
  {
    id: 'backtest',
    label: 'Backtest',
    blurb: 'Would the rule have worked',
    Component: BacktestPanel,
  },
  {
    id: 'simulate',
    label: 'Simulate',
    blurb: 'What could happen, ten thousand times',
    Component: SimulatePanel,
  },
  {
    id: 'portfolio',
    label: 'Portfolio',
    blurb: 'Return against risk, under the real rules',
    Component: PortfolioPanel,
  },
  {
    id: 'archive',
    label: 'Archive',
    blurb: 'Thirty five seasons of results',
    Component: ArchivePanel,
  },
];

interface CoverageResult {
  cells: { season: string; gameweek: number; count: number }[];
  rows: number;
  players: number;
  measured: { expectedGoals?: number; expectedPoints?: number; bps?: number };
}

export function Lab({ generatedAt }: { generatedAt: string }): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const state = useMemo(() => decodeState(search.toString()), [search]);
  const [derived, setDerived] = useState(
    STARTER_COLUMNS.map((column) => ({ name: column.name, formula: column.formula })),
  );
  const [views, setViews] = useState<SavedView[]>([]);
  const [viewName, setViewName] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setViews(loadViews());
  }, []);

  const update = useCallback(
    (patch: Partial<LabState>) => {
      const next = { ...state, ...patch };
      const query = encodeState(next);
      router.replace(query === '' ? pathname : `${pathname}?${query}`, { scroll: false });
    },
    [pathname, router, state],
  );

  const scope: Scope = useMemo(
    () => ({
      seasons: state.seasons,
      filter: state.filter,
      minMinutes: state.minMinutes,
      derived,
    }),
    [state.seasons, state.filter, state.minMinutes, derived],
  );
  const scopeKey = useMemo(() => makeScopeKey(scope), [scope]);

  const coverage = useQuery<CoverageResult>({ kind: 'coverage', scope }, `${scopeKey}|coverage`);
  const active = PANELS.find((panel) => panel.id === state.panel) ?? PANELS[0];
  const Panel = active?.Component ?? ScreenerPanel;

  const share = (): void => {
    const query = encodeState(state);
    const url = `${window.location.origin}${pathname}${query === '' ? '' : `?${query}`}`;
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
      }, 2000);
    });
  };

  return (
    <div className={styles.lab}>
      <aside className={styles.rail} aria-label="Data scope">
        <div className={styles.railSection}>
          <h2 className={styles.railTitle}>Scope</h2>
          <Chips
            label="Seasons"
            values={SEASONS}
            selected={state.seasons}
            hint="Each season is a 260 KB file, fetched once and kept in memory."
            onToggle={(season) => {
              const next = state.seasons.includes(season)
                ? state.seasons.filter((entry) => entry !== season)
                : [...state.seasons, season];
              update({ seasons: next.length === 0 ? DEFAULT_STATE.seasons : next });
            }}
          />
          <FormulaField
            label="Filter"
            value={state.filter}
            placeholder='minutes > 0 && position == "MID"'
            hint="An expression over any column. Strings compare with double quotes."
            onChange={(value) => {
              update({ filter: value });
            }}
            {...(coverage.error === null ? {} : { error: coverage.error })}
          />
          <NumberField
            label="Minimum minutes"
            value={state.minMinutes}
            min={0}
            max={90}
            onChange={(value) => {
              update({ minMinutes: Math.round(value) });
            }}
            hint="Most rows in this panel are players who did not play."
          />
        </div>

        <div className={styles.railSection}>
          <h2 className={styles.railTitle}>Derived columns</h2>
          <p className={styles.railNote}>
            Every one of these is a formula, editable here, and usable in any filter, axis, factor,
            or model feature.
          </p>
          {derived.map((column, index) => (
            <FormulaField
              key={column.name}
              label={column.name}
              value={column.formula}
              onChange={(value) => {
                setDerived(
                  derived.map((entry, position) =>
                    position === index ? { ...entry, formula: value } : entry,
                  ),
                );
              }}
            />
          ))}
        </div>

        <div className={styles.railSection}>
          <h2 className={styles.railTitle}>This view</h2>
          <div className={styles.railButtons}>
            <Button onClick={share} tone="loud">
              {copied ? 'Link copied' : 'Copy link'}
            </Button>
          </div>
          <div className={styles.saveRow}>
            <input
              className={styles.saveInput}
              value={viewName}
              placeholder="Name this view"
              aria-label="Name this view"
              onChange={(event) => {
                setViewName(event.target.value);
              }}
            />
            <Button
              onClick={() => {
                if (viewName.trim() === '') return;
                setViews(saveView(viewName.trim(), encodeState(state)));
                setViewName('');
              }}
            >
              Save
            </Button>
          </div>
          {views.length === 0 ? (
            <p className={styles.railNote}>
              Saved views stay in this browser. Nothing is sent anywhere.
            </p>
          ) : (
            <ul className={styles.viewList}>
              {views.map((view) => (
                <li key={view.name}>
                  <button
                    type="button"
                    className={styles.viewLink}
                    onClick={() => {
                      router.replace(view.query === '' ? pathname : `${pathname}?${view.query}`, {
                        scroll: false,
                      });
                    }}
                  >
                    {view.name}
                  </button>
                  <button
                    type="button"
                    className={styles.viewDelete}
                    aria-label={`Delete the view named ${view.name}`}
                    onClick={() => {
                      setViews(deleteView(view.name));
                    }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={styles.railSection}>
          <h2 className={styles.railTitle}>What is missing</h2>
          <ul className={styles.noteList}>
            {COVERAGE_NOTES.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      </aside>

      <div className={styles.workbench}>
        <nav className={styles.tabs} aria-label="Panels">
          {PANELS.map((panel) => (
            <button
              key={panel.id}
              type="button"
              className={styles.tab}
              data-active={panel.id === state.panel}
              aria-current={panel.id === state.panel ? 'page' : undefined}
              onClick={() => {
                update({ panel: panel.id });
              }}
            >
              <span className={styles.tabLabel}>{panel.label}</span>
              <span className={styles.tabBlurb}>{panel.blurb}</span>
            </button>
          ))}
        </nav>

        <section className={styles.coveragePanel} aria-label="Coverage of the current scope">
          <div className={styles.coverageHead}>
            <h2 className={styles.railTitle}>Rows in scope</h2>
            <p className={styles.coverageSummary}>
              <strong className="num">{(coverage.data?.rows ?? 0).toLocaleString('en-GB')}</strong>{' '}
              rows,{' '}
              <span className="num">{(coverage.data?.players ?? 0).toLocaleString('en-GB')}</span>{' '}
              players, with expected goals recorded on{' '}
              <span className="num">
                {(coverage.data?.measured.expectedGoals ?? 0).toLocaleString('en-GB')}
              </span>{' '}
              of them.
            </p>
          </div>
          <Coverage
            cells={coverage.data?.cells ?? []}
            seasons={state.seasons}
            onSelect={(season, gameweek) => {
              update({ filter: `season == "${season}" && gameweek == ${gameweek}` });
            }}
          />
        </section>

        <main className={styles.panel}>
          <Panel state={state} update={update} scope={scope} scopeKey={scopeKey} />
        </main>

        <footer className={styles.status} aria-live="polite">
          <span>
            engine <strong className="num">{formatNumber(coverage.elapsed, 0)}</strong> ms
          </span>
          <span>
            seed <strong className="num">{state.seed}</strong>
          </span>
          <span>
            seasons <strong className="num">{state.seasons.length}</strong>
          </span>
          <span className={styles.statusFilter}>
            filter {state.filter === '' ? 'none' : state.filter}
          </span>
          <span>lake built {generatedAt.slice(0, 10)}</span>
        </footer>
      </div>
    </div>
  );
}
