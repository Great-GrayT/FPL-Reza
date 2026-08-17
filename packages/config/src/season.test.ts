import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { seasonForDate } from './season.js';
import { loadConfig } from './config.js';
import { ValidationError } from '@fpl/core';

describe('seasonForDate', () => {
  it('treats July onward as the new season', () => {
    assert.equal(seasonForDate(new Date('2026-07-01T00:00:00Z')), '2026/27');
    assert.equal(seasonForDate(new Date('2026-08-16T00:00:00Z')), '2026/27');
  });

  it('treats January to June as the previous season', () => {
    assert.equal(seasonForDate(new Date('2026-05-20T00:00:00Z')), '2025/26');
  });

  it('pads the end year across a century boundary', () => {
    assert.equal(seasonForDate(new Date('2099-09-01T00:00:00Z')), '2099/00');
  });
});

describe('loadConfig', () => {
  it('fills defaults from an empty environment', () => {
    const config = loadConfig({}, new Date('2026-08-16T00:00:00Z'));
    assert.equal(config.season, '2026/27');
    assert.equal(config.dataDir, 'data');
    assert.equal(config.fpl.retries, 3);
  });

  it('overrides from the environment', () => {
    const config = loadConfig(
      { FPL_DATA_DIR: 'lake', FPL_RETRIES: '0', FPL_LOG_LEVEL: 'debug' },
      new Date('2026-08-16T00:00:00Z'),
    );
    assert.equal(config.dataDir, 'lake');
    assert.equal(config.fpl.retries, 0);
    assert.equal(config.logLevel, 'debug');
  });

  it('rejects a non integer numeric setting', () => {
    assert.throws(() => loadConfig({ FPL_RETRIES: 'many' }), ValidationError);
  });

  it('rejects a malformed season', () => {
    assert.throws(() => loadConfig({ FPL_SEASON: '2026-27' }), ValidationError);
  });
});
