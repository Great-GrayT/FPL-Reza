import type { Position } from '@fpl/core';

/**
 * Where a player probably was, conditioned on what he actually did.
 *
 * The role says where a player can be. His record says where his work
 * happened: threat is built from shots and where they were taken, creativity
 * from chances made, defensive contribution from the actions a defender only
 * performs in his own half. Neither is a position, and neither is worth much
 * alone. A role prior is the same picture for every left back alive; a pile of
 * per ninety rates says a player shoots from close range without saying he is
 * ever on the pitch to do it.
 *
 * So this is the product of the two, not their sum. The prior is a surface
 * over the ground his role reaches, the evidence is a multiplicative uplift on
 * top of it, and the posterior keeps only what both allow. Adding them would
 * be a union: one lucky finish and a centre back is drawn playing as a striker.
 * Multiplying is the inner join, and it is what makes the figure refuse to
 * invent a range no matter what is fed into it.
 *
 * Two guards make that safe. The uplift is `1 + sum of lobes`, so it can raise
 * a region and never annihilate one: a likelihood that could reach zero would
 * turn "the evidence and the role disagree" into a normalised field of noise.
 * And the prior carries a small uniform floor, because a Gaussian puts the
 * opposition box eleven exponents below nothing for a centre back, while a
 * centre back is in that box at every corner. A hard zero there is a wrong
 * claim, not a cautious one.
 *
 * Nothing here is fitted. Every constant is either a stated claim about roles
 * or a rate read off the archive, and both are named where they are declared.
 *
 * This module deliberately imports no value from anywhere. It runs in the
 * reader's browser so the figure can follow the gameweek ribbon, and
 * `@fpl/model`'s barrel would pull `@fpl/store`, and therefore `node:fs`, in
 * behind it.
 */

export type HeatmapBasis = 'slot' | 'position';

/** The match a shape was read from, which is what dates the estimate. */
export interface ShapeSource {
  season: string;
  gameweek: number | null;
  opponent: string | null;
}

/**
 * Where a role puts a player, before anything he did is taken into account.
 * Built on the server, because the slot it comes from needs the stored
 * teamsheets; everything after it is arithmetic and runs anywhere.
 */
export interface HeatmapPrior {
  position: Position;
  /** Across the pitch, 0 at the left touchline and 1 at the right. */
  lateral: number;
  centreX: number;
  centreY: number;
  spreadX: number;
  spreadY: number;
  /** Whether a named slot placed him, or only his position did. */
  basis: HeatmapBasis;
  formation: string | null;
  from: ShapeSource | null;
}

/** One gameweek of the record, carrying only what locates a player's work. */
export interface EvidenceRow {
  season: string;
  gameweek: number;
  minutes: number;
  threat: number | null;
  creativity: number | null;
  expectedGoals: number | null;
  expectedAssists: number | null;
  /**
   * CBIT for a defender, CBIRT for everyone else. Null before the rule
   * existed, and null in the archive, which does not carry the column: null is
   * "nobody counted", not "he did none".
   */
  defensiveContribution: number | null;
}

export type LobeKind = 'shot' | 'create' | 'defend';

/** One claim the evidence made, and how hard it pushed. */
export interface Lobe {
  kind: LobeKind;
  /** 0 to `LOBE_CAP`: how much more of his time went here than the role alone
   * implies. 1 is "twice as much", which is the most any measure may claim.
   */
  weight: number;
  /** The claim in words, which is what the caption prints. */
  note: string;
}

export interface HeatmapWindow {
  matches: number;
  minutes: number;
  from: { season: string; gameweek: number } | null;
  to: { season: string; gameweek: number } | null;
  /** True where the selected gameweek had nothing at or before it. */
  fellBack: boolean;
}

export interface EstimatedHeatmap {
  cols: number;
  rows: number;
  counts: number[];
  /**
   * The middle of the posterior, as a share of the pitch, in the domain's own
   * frame: x along the direction of play towards the goal being attacked, y
   * across it. A caller multiplies by 100 to reach pitch coordinates.
   */
  centreX: number;
  centreY: number;
  basis: HeatmapBasis;
  formation: string | null;
  from: ShapeSource | null;
  lobes: Lobe[];
  window: HeatmapWindow | null;
}

const COLS = 12;
const ROWS = 8;

/** The real pitch, which is what turns a shot distance into a share of it. */
const PITCH_LENGTH_METRES = 105;

/**
 * Where the two ends of the advancement scale sit along the pitch. Advancement
 * runs 0 at a club's defensive line and 1 at its furthest forward row, so these
 * two numbers are the whole claim about how a shape occupies ground: a back
 * line camps around a quarter of the way up, a forward line around four fifths.
 */
const BACK_LINE_X = 0.24;
const FRONT_LINE_X = 0.8;

/**
 * A keeper is off that scale rather than at the bottom of it, on the same 11
 * metre mark both keepers sit on in the frame the domain's coordinates were
 * normalised to.
 */
const KEEPER_X = 0.11;

/**
 * Where a position stands when no teamsheet places him, and how far it ranges.
 *
 * The spreads are wider than a player's average position, on purpose: this is
 * a prior over the ground a role covers across ninety minutes, not a guess at
 * where he stands. Under a product that distinction is the whole design. Too
 * tight and the evidence has nothing to lift, so an overlapping full back's
 * crosses land three standard deviations out and vanish; too loose and the
 * role stops constraining anything and the sum is back.
 */
const BY_POSITION: Record<Position, { advancement: number; spreadX: number; spreadY: number }> = {
  GKP: { advancement: 0, spreadX: 0.05, spreadY: 0.05 },
  DEF: { advancement: 0.06, spreadX: 0.18, spreadY: 0.16 },
  MID: { advancement: 0.5, spreadX: 0.22, spreadY: 0.22 },
  FWD: { advancement: 0.86, spreadX: 0.2, spreadY: 0.2 },
};

/**
 * The share of the prior's own mass spread flat across the pitch.
 *
 * Proportional rather than absolute, so it means the same thing for a keeper's
 * narrow cloud as for a midfielder's wide one: a flat floor of a fixed height
 * would be most of a keeper's mass and a rounding error in a midfielder's.
 */
const FLOOR_SHARE = 0.05;

/** The most any one lobe may raise its region, as a multiple of the prior. */
const LOBE_CAP = 1.2;

/**
 * Minutes at which the evidence is trusted half as far as it goes. Six full
 * matches: a player with two appearances is drawn as his role, which is all
 * anybody honestly knows about him.
 */
const MINUTES_HALF_WEIGHT = 540;

/** How many matches the default window reads. */
export const DEFAULT_WINDOW = 12;

/**
 * Per ninety rates at which a lobe is half its cap, by position.
 *
 * Read from the 2025/26 archive on 2026-08-20: the median rate among players
 * of that position with at least 450 minutes, so a typical player of his
 * position sits at the middle of the scale and the figure says something about
 * him rather than about his position, which the prior already said.
 *
 * Defensive contribution is not in that table, because the archive does not
 * carry the column: those two are the published award thresholds instead, 10
 * actions for a defender and 12 for everyone else, which is the rate at which
 * the two point award is roughly an even bet.
 */
const REFERENCE: Record<Position, { threat: number; creativity: number; defence: number }> = {
  GKP: { threat: Number.POSITIVE_INFINITY, creativity: Number.POSITIVE_INFINITY, defence: 10 },
  DEF: { threat: 6.03, creativity: 6.92, defence: 10 },
  MID: { threat: 13.14, creativity: 18.74, defence: 12 },
  FWD: { threat: 30.69, creativity: 10.07, defence: 12 },
};

/**
 * Expected goals per unit of threat, turned into the quality of one shot.
 *
 * A copy of `impliedShotQuality` in `@fpl/model`, which cannot be imported
 * here: see the note at the top of this file. `heatmap-lobes.test.ts` pins the
 * two against each other so a copy cannot become a fork.
 */
const THREAT_TO_SHOT_QUALITY = 9.5;

export function shotQuality(expectedGoalsPerThreat: number): number {
  if (!Number.isFinite(expectedGoalsPerThreat) || expectedGoalsPerThreat <= 0) return Number.NaN;
  return Math.min(0.9, expectedGoalsPerThreat * THREAT_TO_SHOT_QUALITY);
}

/** The distance that quality implies, in metres. The inverse of the above. */
export function shotDistanceMetres(quality: number): number {
  if (!Number.isFinite(quality) || quality <= 0) return Number.NaN;
  return Math.min(35, Math.max(4, -Math.log(quality) / 0.136));
}

/** The role prior, from a slot where a teamsheet named one and a position otherwise. */
export function priorFor(input: {
  position: Position;
  lateral?: number | undefined;
  advancement?: number | undefined;
  basis?: HeatmapBasis | undefined;
  formation?: string | null | undefined;
  from?: ShapeSource | null | undefined;
}): HeatmapPrior {
  const defaults = BY_POSITION[input.position];
  const lateral = input.lateral ?? 0.5;
  const advancement = input.advancement ?? defaults.advancement;

  // A keeper is off the outfield scale, so his position wins whatever a
  // teamsheet says: the first row of a formation is the back line, not him.
  const centreX =
    input.position === 'GKP' ? KEEPER_X : BACK_LINE_X + advancement * (FRONT_LINE_X - BACK_LINE_X);

  const offCentre = input.position === 'GKP' ? 0 : Math.abs(lateral - 0.5) * 2;
  // A wide player's cloud leans inward, because a touchline is a wall.
  const centreY = input.position === 'GKP' ? 0.5 : lateral + (0.5 - lateral) * 0.22 * offCentre;

  return {
    position: input.position,
    lateral: input.position === 'GKP' ? 0.5 : lateral,
    centreX,
    centreY,
    spreadX: defaults.spreadX,
    spreadY: defaults.spreadY * (1 + offCentre * 0.35),
    basis: input.basis ?? (input.lateral === undefined ? 'position' : 'slot'),
    formation: input.formation ?? null,
    from: input.from ?? null,
  };
}

const before = (row: EvidenceRow, until: { season: string; gameweek: number }): boolean =>
  row.season < until.season || (row.season === until.season && row.gameweek <= until.gameweek);

/**
 * The matches the figure reads.
 *
 * Only matches he played: a gameweek on the bench says nothing about where he
 * plays, and counting it would drag every substitute towards his role prior
 * through the minutes term twice over.
 */
export function selectWindow(
  rows: readonly EvidenceRow[],
  until: { season: string; gameweek: number } | null,
  size: number = DEFAULT_WINDOW,
): { rows: EvidenceRow[]; fellBack: boolean } {
  const played = rows.filter((row) => row.minutes > 0);
  const ordered = [...played].sort((a, b) =>
    a.season === b.season ? a.gameweek - b.gameweek : a.season < b.season ? -1 : 1,
  );

  if (until === null) return { rows: ordered.slice(-size), fellBack: false };

  const upTo = ordered.filter((row) => before(row, until));
  // A selected gameweek before anything on record is August, when the ribbon
  // points at a week nobody has played yet. Falling back is right; doing it
  // silently is not, so the caller is told and the caption says which matches
  // it actually read.
  if (upTo.length === 0) return { rows: ordered.slice(-size), fellBack: ordered.length > 0 };
  return { rows: upTo.slice(-size), fellBack: false };
}

const sum = (rows: readonly EvidenceRow[], read: (row: EvidenceRow) => number | null): number =>
  rows.reduce((total, row) => total + (read(row) ?? 0), 0);

/** Whether a measure was recorded at all, which is not whether it was zero. */
const recorded = (
  rows: readonly EvidenceRow[],
  read: (row: EvidenceRow) => number | null,
): boolean => rows.some((row) => read(row) !== null);

/**
 * A rate on a 0 to 1 scale, half at the reference rate for that position.
 * Bounded and monotone, so an outlier leans harder without running away.
 */
const share = (rate: number, reference: number): number =>
  !Number.isFinite(rate) || rate <= 0 || !Number.isFinite(reference)
    ? 0
    : rate / (rate + reference);

const gaussian = (x: number, y: number, cx: number, cy: number, sx: number, sy: number): number => {
  const dx = (x - cx) / sx;
  const dy = (y - cy) / sy;
  return Math.exp(-0.5 * (dx * dx + dy * dy));
};

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

const side = (lateral: number): string =>
  lateral < 0.38 ? 'the left' : lateral > 0.62 ? 'the right' : 'the middle';

interface Bloom {
  lobe: Lobe;
  centreX: number;
  centreY: number;
  spreadX: number;
  spreadY: number;
}

/** What the record claims, as regions of the pitch with a weight each. */
function bloomsFor(prior: HeatmapPrior, rows: readonly EvidenceRow[]): Bloom[] {
  // A keeper's record locates nothing: his threat is a corner he went up for
  // and his creativity is a long kick. His role is the whole of what is known.
  if (prior.position === 'GKP' || rows.length === 0) return [];

  const minutes = rows.reduce((total, row) => total + row.minutes, 0);
  if (minutes <= 0) return [];

  // How far the evidence is trusted, which is a question about sample size
  // rather than about the player.
  const trust = minutes / (minutes + MINUTES_HALF_WEIGHT);
  const per90 = (total: number): number => (total * 90) / minutes;
  const reference = REFERENCE[prior.position];
  const blooms: Bloom[] = [];

  const threat = sum(rows, (row) => row.threat);
  if (recorded(rows, (row) => row.threat) && threat > 0) {
    const expectedGoals = sum(rows, (row) => row.expectedGoals);
    const quality = shotQuality(expectedGoals / threat);
    const distance = Number.isFinite(quality) ? shotDistanceMetres(quality) : Number.NaN;
    if (Number.isFinite(distance)) {
      const weight = LOBE_CAP * trust * share(per90(threat), reference.threat);
      blooms.push({
        lobe: {
          kind: 'shot',
          weight,
          note: `shooting from about ${String(Math.round(distance))} m`,
        },
        // Shots converge on the goal whoever takes them, so the lobe sits
        // mostly central however wide the player starts.
        centreX: clamp(1 - distance / PITCH_LENGTH_METRES, 0.5, 0.96),
        centreY: clamp(0.5 + (prior.lateral - 0.5) * 0.35, 0.1, 0.9),
        spreadX: 0.07,
        spreadY: 0.13,
      });
    }
  }

  const creativity =
    sum(rows, (row) => row.creativity) + 60 * sum(rows, (row) => row.expectedAssists);
  if (recorded(rows, (row) => row.creativity) && creativity > 0) {
    const weight = LOBE_CAP * trust * share(per90(creativity), reference.creativity);
    // Chances are made from the flanks and the half spaces, further out than
    // they are finished, and on the side the player already occupies.
    const wide = clamp(prior.lateral + (prior.lateral - 0.5) * 0.4, 0.08, 0.92);
    blooms.push({
      lobe: { kind: 'create', weight, note: `creating from ${side(wide)}` },
      centreX: 0.72,
      centreY: wide,
      spreadX: 0.1,
      spreadY: 0.1,
    });
  }

  const defence = sum(rows, (row) => row.defensiveContribution);
  if (recorded(rows, (row) => row.defensiveContribution) && defence > 0) {
    const weight = LOBE_CAP * trust * share(per90(defence), reference.defence);
    blooms.push({
      lobe: { kind: 'defend', weight, note: 'defensive work in his own third' },
      centreX: Math.max(0.08, prior.centreX - 0.22),
      centreY: prior.lateral,
      spreadX: 0.12,
      spreadY: 0.15,
    });
  }

  return blooms.filter((bloom) => bloom.lobe.weight > 0.02);
}

/**
 * The figure: the role prior, raised where the record says his work happened.
 *
 * `posterior = (prior + floor) * (1 + sum of lobes)`. The uplift never falls
 * below one, so a disagreement between role and record leaves the role
 * standing rather than cancelling it to noise.
 */
export function composeHeatmap(
  prior: HeatmapPrior,
  rows: readonly EvidenceRow[],
  until: { season: string; gameweek: number } | null,
  size: number = DEFAULT_WINDOW,
): EstimatedHeatmap {
  const chosen = selectWindow(rows, until, size);
  const blooms = bloomsFor(prior, chosen.rows);

  const priors: number[] = [];
  let priorMass = 0;
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const value = gaussian(
        (col + 0.5) / COLS,
        (row + 0.5) / ROWS,
        prior.centreX,
        prior.centreY,
        prior.spreadX,
        prior.spreadY,
      );
      priors.push(value);
      priorMass += value;
    }
  }

  const floor = ((FLOOR_SHARE / (1 - FLOOR_SHARE)) * priorMass) / (COLS * ROWS);

  const counts: number[] = [];
  let mass = 0;
  let centreX = 0;
  let centreY = 0;
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const index = row * COLS + col;
      const x = (col + 0.5) / COLS;
      const y = (row + 0.5) / ROWS;
      let uplift = 1;
      for (const bloom of blooms) {
        uplift +=
          bloom.lobe.weight *
          gaussian(x, y, bloom.centreX, bloom.centreY, bloom.spreadX, bloom.spreadY);
      }
      const value = ((priors[index] ?? 0) + floor) * uplift;
      counts.push(value);
      mass += value;
      centreX += value * x;
      centreY += value * y;
    }
  }

  const first = chosen.rows[0];
  const last = chosen.rows[chosen.rows.length - 1];

  return {
    cols: COLS,
    rows: ROWS,
    counts,
    centreX: mass > 0 ? centreX / mass : prior.centreX,
    centreY: mass > 0 ? centreY / mass : prior.centreY,
    basis: prior.basis,
    formation: prior.formation,
    from: prior.from,
    lobes: blooms.map((bloom) => bloom.lobe),
    window:
      chosen.rows.length === 0
        ? null
        : {
            matches: chosen.rows.length,
            minutes: chosen.rows.reduce((total, row) => total + row.minutes, 0),
            from: first === undefined ? null : { season: first.season, gameweek: first.gameweek },
            to: last === undefined ? null : { season: last.season, gameweek: last.gameweek },
            fellBack: chosen.fellBack,
          },
  };
}
