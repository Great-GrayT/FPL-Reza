import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS, PROBE_VERDICTS, REJECTED_PROVIDERS, providersCovering } from './providers.js';

describe('provider registry', () => {
  const all = [...PROVIDERS, ...REJECTED_PROVIDERS];

  it('records a verdict and a probe date for every entry', () => {
    for (const provider of all) {
      assert.ok(PROBE_VERDICTS.includes(provider.verdict), `${provider.id} has an unknown verdict`);
      // A verdict with no date is a reputation, which is what this field exists
      // to replace.
      assert.match(provider.probedAt, /^\d{4}-\d{2}-\d{2}$/, `${provider.id} has no probe date`);
    }
  });

  it('keeps ids unique across both lists', () => {
    const ids = all.map((provider) => provider.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('does not offer a source that refused collection as a candidate', () => {
    for (const provider of PROVIDERS) {
      assert.notEqual(
        provider.verdict,
        'refused_by_terms',
        `${provider.id} refused collection and must not be listed as a candidate`,
      );
    }
  });

  it('finds the official API for referees, lineups, and managers', () => {
    for (const kind of ['referees', 'lineups', 'managers'] as const) {
      const ids = providersCovering(kind).map((provider) => provider.id);
      assert.ok(ids.includes('pl-official-api'), `no candidate covers ${kind}`);
    }
  });
});
