import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import { parseDeadlineLabel } from './london-time.js';
import {
  RULES_URL,
  rulesDocumentSchema,
  type ChipRow,
  type DeadlineEntry,
  type PhaseRow,
  type PointsRow,
  type RulesDocument,
} from './schema.js';

export interface ParseOptions {
  /** Calendar year the season starts in, used to date the printed deadlines. */
  seasonStartYear: number;
  fetchedAt?: Date;
  sourceUrl?: string;
}

/** Header signatures that identify each table on the page. */
const TABLE_KINDS = {
  deadlines: ['gameweek', 'deadline'],
  scoring: ['action', 'points'],
  bps: ['action', 'bps'],
  chips: ['name', 'effect'],
  phases: ['phase', 'first gameweek', 'last gameweek'],
} as const;

type TableKind = keyof typeof TABLE_KINDS;

export function parseRules(html: string, options: ParseOptions): RulesDocument {
  const $ = cheerio.load(html);
  const fetchedAt = options.fetchedAt ?? new Date();
  const sourceUrl = options.sourceUrl ?? RULES_URL;

  const tables = collectTables($);
  const bodyText = normaliseWhitespace($('body').text());

  // The rules page is server rendered today, but a client rendered build would
  // leave the content only in the Next.js payload, so that path is kept live.
  const nextDataText = extractNextDataText($);
  const usedNextData = tables.size === 0 && nextDataText.length > 0;
  const text = usedNextData ? nextDataText : bodyText;

  const deadlines = usedNextData
    ? deadlinesFromText(text, options.seasonStartYear)
    : deadlinesFromTable(tables.get('deadlines') ?? [], options.seasonStartYear);

  const document = {
    sourceUrl,
    fetchedAt,
    checksum: checksum(text),
    parsedFrom: tables.size > 0 ? 'html' : usedNextData ? 'next-data' : 'none',
    sections: usedNextData ? [] : collectSections($),
    deadlines,
    scoring: pointsRows(tables.get('scoring') ?? []),
    bps: pointsRows(tables.get('bps') ?? []),
    chips: chipRows(tables.get('chips') ?? []),
    phases: phaseRows(tables.get('phases') ?? []),
    squad: {
      size: firstInt(text, /squad of (\d+) players/i),
      budgetTenths: firstMoneyTenths(text, /must not exceed £([\d.]+) million/i),
      maxPerClub: firstInt(text, /up to (\d+) players from a single Premier League team/i),
    },
    transfers: {
      hitPoints: firstInt(text, /deduct (\d+) points from your total score/i),
      maxStoredFreeTransfers: firstInt(
        text,
        /free transfers you can store in any Gameweek is (\d+)/i,
      ),
      maxPerGameweek: firstInt(text, /limited to (\d+) transfers in any single Gameweek/i),
    },
  };

  return rulesDocumentSchema.parse(document);
}

export const checksum = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex');

type Row = string[];

function collectTables($: cheerio.CheerioAPI): Map<TableKind, Row[]> {
  const found = new Map<TableKind, Row[]>();

  $('table').each((_, element) => {
    const rows: Row[] = [];
    $(element)
      .find('tr')
      .each((__, tr) => {
        const cells = $(tr)
          .find('th,td')
          .map((___, cell) => normaliseWhitespace($(cell).text()))
          .get();
        if (cells.length > 0) rows.push(cells);
      });

    const header = rows[0];
    if (header === undefined) return;
    const kind = classify(header);
    // A page with two tables of the same shape keeps the first; the rules page
    // never repeats a table kind.
    if (kind !== undefined && !found.has(kind)) found.set(kind, rows.slice(1));
  });

  return found;
}

function classify(header: Row): TableKind | undefined {
  const cells = header.map((cell) => cell.toLowerCase().trim());
  for (const [kind, signature] of Object.entries(TABLE_KINDS)) {
    if (signature.every((wanted, index) => cells[index]?.startsWith(wanted) === true)) {
      return kind as TableKind;
    }
  }
  return undefined;
}

function collectSections(
  $: cheerio.CheerioAPI,
): { heading: string; level: number; text: string }[] {
  const sections: { heading: string; level: number; text: string }[] = [];

  $('h1,h2,h3,h4').each((_, element) => {
    const heading = normaliseWhitespace($(element).text());
    if (heading === '') return;

    const level = Number(element.tagName.slice(1));
    const parts: string[] = [];
    let node = $(element).next();
    while (node.length > 0 && !/^h[1-4]$/i.test(node.prop('tagName') ?? '')) {
      parts.push(normaliseWhitespace(node.text()));
      node = node.next();
    }

    sections.push({ heading, level, text: parts.filter(Boolean).join('\n') });
  });

  return sections;
}

function deadlinesFromTable(rows: Row[], seasonStartYear: number): DeadlineEntry[] {
  const entries: DeadlineEntry[] = [];
  for (const row of rows) {
    const gameweek = firstInt(row[0] ?? '', /gameweek\s+(\d+)/i);
    const label = row[1]?.trim() ?? '';
    if (gameweek === null || label === '') continue;
    entries.push({ gameweek, label, deadline: parseDeadlineLabel(label, seasonStartYear) });
  }
  return entries;
}

const DEADLINE_IN_TEXT =
  /Gameweek\s+(\d{1,2})\s+((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{1,2}\s+[A-Z][a-z]{2}\s+\d{1,2}:\d{2})/g;

function deadlinesFromText(text: string, seasonStartYear: number): DeadlineEntry[] {
  const entries: DeadlineEntry[] = [];
  for (const match of text.matchAll(DEADLINE_IN_TEXT)) {
    const gameweek = Number(match[1]);
    const label = match[2] ?? '';
    if (!Number.isInteger(gameweek) || label === '') continue;
    entries.push({ gameweek, label, deadline: parseDeadlineLabel(label, seasonStartYear) });
  }
  return entries;
}

function pointsRows(rows: Row[]): PointsRow[] {
  const parsed: PointsRow[] = [];
  for (const row of rows) {
    const action = row[0]?.trim() ?? '';
    const raw = row[1]?.trim() ?? '';
    if (action === '' || raw === '') continue;
    parsed.push({ action, raw, points: singlePoints(raw) });
  }
  return parsed;
}

/** "1-3" is a range and stays null; "-2" is a single negative value. */
function singlePoints(raw: string): number | null {
  if (/^-?\d+\s*(?:to|-)\s*-?\d+$/i.test(raw) && !/^-\d+$/.test(raw)) return null;
  const value = Number(raw.replace(/[^\d.-]/g, ''));
  return Number.isFinite(value) ? value : null;
}

function chipRows(rows: Row[]): ChipRow[] {
  return rows
    .map((row) => ({ name: row[0]?.trim() ?? '', effect: row[1]?.trim() ?? '' }))
    .filter((row) => row.name !== '' && row.effect !== '');
}

function phaseRows(rows: Row[]): PhaseRow[] {
  const parsed: PhaseRow[] = [];
  for (const row of rows) {
    const name = row[0]?.trim() ?? '';
    const from = firstInt(row[1] ?? '', /(\d+)/);
    const to = firstInt(row[2] ?? '', /(\d+)/);
    if (name === '' || from === null || to === null) continue;
    parsed.push({ name, from, to });
  }
  return parsed;
}

/** Concatenates every string in the Next.js payload so text extractors still work. */
function extractNextDataText($: cheerio.CheerioAPI): string {
  const raw = $('script#__NEXT_DATA__').first().text();
  if (raw.trim() === '') return '';

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return '';
  }

  const strings: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      strings.push(value);
    } else if (Array.isArray(value)) {
      for (const item of value) walk(item);
    } else if (typeof value === 'object' && value !== null) {
      for (const item of Object.values(value)) walk(item);
    }
  };
  walk(payload);

  return normaliseWhitespace(strings.join(' '));
}

const normaliseWhitespace = (text: string): string =>
  text
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function firstInt(text: string, pattern: RegExp): number | null {
  const match = pattern.exec(text);
  if (match?.[1] === undefined) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) ? value : null;
}

/** Money on the page is in millions; the domain stores tenths. */
function firstMoneyTenths(text: string, pattern: RegExp): number | null {
  const match = pattern.exec(text);
  if (match?.[1] === undefined) return null;
  const millions = Number(match[1]);
  return Number.isFinite(millions) ? Math.round(millions * 10) : null;
}
