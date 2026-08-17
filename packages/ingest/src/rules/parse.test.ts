import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseRules } from './parse.js';
import { diffRules, summariseChange } from './diff.js';
import {
  RULES_HTML_CHANGED,
  RULES_HTML_NEXT_DATA,
  RULES_HTML_SAMPLE,
} from './fixture.test-data.js';

const options = { seasonStartYear: 2026, fetchedAt: new Date('2026-08-16T00:00:00Z') };

describe('parseRules', () => {
  const document = parseRules(RULES_HTML_SAMPLE, options);

  it('reads the tables out of the rendered page', () => {
    assert.equal(document.parsedFrom, 'html');
  });

  it('extracts every deadline with a resolved instant', () => {
    assert.equal(document.deadlines.length, 3);
    const first = document.deadlines[0];
    assert.equal(first?.gameweek, 1);
    assert.equal(first?.label, 'Fri 21 Aug 18:30');
    assert.equal(first?.deadline?.toISOString(), '2026-08-21T17:30:00.000Z');
  });

  it('keeps a printed range as a range rather than inventing a number', () => {
    const bonus = document.scoring.find((row) => row.action.startsWith('Bonus points'));
    assert.equal(bonus?.raw, '1-3');
    assert.equal(bonus?.points, null);
  });

  it('parses negative scoring values', () => {
    const miss = document.scoring.find((row) => row.action.includes('penalty miss'));
    assert.equal(miss?.points, -2);
  });

  it('separates the BPS table from the scoring table', () => {
    assert.equal(document.scoring.length, 4);
    assert.equal(document.bps.length, 3);
    assert.equal(document.bps.find((row) => row.action === 'Assists')?.points, 9);
  });

  it('reads the chip and phase tables', () => {
    assert.equal(document.chips.length, 2);
    assert.deepEqual(document.phases[1], { name: 'August', from: 1, to: 2 });
  });

  it('pulls squad and transfer values out of prose', () => {
    assert.equal(document.squad.size, 15);
    assert.equal(document.squad.budgetTenths, 1000);
    assert.equal(document.squad.maxPerClub, 3);
    assert.equal(document.transfers.hitPoints, 4);
    assert.equal(document.transfers.maxStoredFreeTransfers, 5);
    assert.equal(document.transfers.maxPerGameweek, 20);
  });

  it('captures headed sections and a stable checksum', () => {
    assert.ok(document.sections.length > 0);
    assert.equal(document.checksum.length, 64);
    assert.equal(parseRules(RULES_HTML_SAMPLE, options).checksum, document.checksum);
  });

  it('falls back to the Next.js payload when the page ships no tables', () => {
    const fromPayload = parseRules(RULES_HTML_NEXT_DATA, options);
    assert.equal(fromPayload.parsedFrom, 'next-data');
    assert.equal(fromPayload.deadlines.length, 2);
    assert.equal(fromPayload.squad.size, 15);
  });

  it('reports an empty page rather than throwing', () => {
    const empty = parseRules('<html><body></body></html>', options);
    assert.equal(empty.parsedFrom, 'none');
    assert.deepEqual(empty.deadlines, []);
  });
});

describe('diffRules', () => {
  const before = parseRules(RULES_HTML_SAMPLE, options);
  const after = parseRules(RULES_HTML_CHANGED, options);

  it('treats a first scrape as a change', () => {
    const diff = diffRules(undefined, before);
    assert.equal(diff.changed, true);
    assert.equal(diff.checksumBefore, null);
    assert.equal(diff.changes[0]?.kind, 'added');
  });

  it('reports no change when the page is identical', () => {
    const diff = diffRules(before, before);
    assert.equal(diff.changed, false);
    assert.deepEqual(diff.changes, []);
  });

  it('names the moved deadline and the changed scoring value', () => {
    const diff = diffRules(before, after);
    assert.equal(diff.changed, true);

    const deadline = diff.changes.find((change) => change.path === 'deadlines.gw1');
    assert.equal(deadline?.kind, 'changed');
    assert.ok(deadline?.before?.includes('Fri 21 Aug 18:30'));
    assert.ok(deadline?.after?.includes('Sat 22 Aug 11:00'));

    const scoring = diff.changes.find((change) =>
      change.path.startsWith('scoring.For each goal scored by a defender'),
    );
    assert.equal(scoring?.before, '6');
    assert.equal(scoring?.after, '7');
  });

  it('summarises a change as one readable line', () => {
    const diff = diffRules(before, after);
    const line = summariseChange(
      diff.changes[0] ?? { kind: 'added', path: 'x', before: null, after: null },
    );
    assert.ok(line.length > 0);
    assert.ok(/changed|added|removed/.test(line));
  });
});
