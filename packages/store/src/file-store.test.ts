import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { NotFoundError, asSeason } from '@fpl/core';
import { FileStore } from './file-store.js';
import { FORMATS } from './types.js';

const season = asSeason('2026/27');

const rowSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  price: z.number(),
  fit: z.boolean(),
  seen: z.coerce.date(),
  note: z.string().nullable(),
});

const rows = [
  {
    id: 1,
    name: 'Haaland',
    price: 15.1,
    fit: true,
    seen: new Date('2026-08-01T12:00:00Z'),
    note: null,
  },
  {
    id: 2,
    name: 'Saka',
    price: 10.4,
    fit: false,
    seen: new Date('2026-08-02T12:00:00Z'),
    note: 'knock',
  },
];

describe('FileStore', () => {
  let root: string;

  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'fpl-store-'));
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  for (const format of FORMATS) {
    it(`round trips rows through ${format}`, async () => {
      const store = new FileStore({ root, defaultFormat: format });
      const key = { season, dataset: `players-${format}` };

      const meta = await store.write(key, rows);
      assert.equal(meta.rows, 2);
      assert.equal(meta.format, format);
      assert.ok(meta.bytes > 0);

      const read = await store.read(key, rowSchema);
      assert.deepEqual(read, rows);
    });
  }

  it('keeps every snapshot and returns the newest by default', async () => {
    const store = new FileStore({ root, defaultFormat: 'jsonl' });
    const key = { season, dataset: 'history' };

    const first = await store.write(key, [{ id: 1 }], {
      capturedAt: new Date('2026-08-01T00:00:00Z'),
    });
    const second = await store.write(key, [{ id: 2 }], {
      capturedAt: new Date('2026-08-02T00:00:00Z'),
    });

    const history = await store.history(key);
    assert.equal(history.length, 2);
    assert.deepEqual(
      history.map((snapshot) => snapshot.file),
      [first.file, second.file],
    );

    const latest = await store.latest(key);
    assert.equal(latest?.capturedAt.toISOString(), second.capturedAt.toISOString());

    const older = await store.read(key, z.object({ id: z.number() }), {
      capturedAt: first.capturedAt,
    });
    assert.deepEqual(older, [{ id: 1 }]);
  });

  it('isolates partitions of the same dataset', async () => {
    const store = new FileStore({ root, defaultFormat: 'jsonl' });
    await store.write({ season, dataset: 'gw', partition: 'gw1' }, [{ id: 1 }]);
    await store.write({ season, dataset: 'gw', partition: 'gw2' }, [{ id: 2 }]);

    const gw1 = await store.read(
      { season, dataset: 'gw', partition: 'gw1' },
      z.object({ id: z.number() }),
    );
    assert.deepEqual(gw1, [{ id: 1 }]);
    assert.equal((await store.history({ season, dataset: 'gw', partition: 'gw2' })).length, 1);
  });

  it('lists the partitions written for a dataset', async () => {
    const store = new FileStore({ root, defaultFormat: 'jsonl' });
    assert.deepEqual(await store.partitions({ season, dataset: 'gw' }), ['gw1', 'gw2']);
  });

  it('reports no partitions for an unpartitioned dataset', async () => {
    const store = new FileStore({ root, defaultFormat: 'jsonl' });
    assert.deepEqual(await store.partitions({ season, dataset: 'history' }), []);
  });

  it('handles an empty dataset', async () => {
    const store = new FileStore({ root, defaultFormat: 'parquet' });
    const key = { season, dataset: 'empty' };
    await store.write(key, []);
    assert.deepEqual(await store.read(key, z.object({ id: z.number() })), []);
  });

  it('throws NotFoundError for a dataset that was never written', async () => {
    const store = new FileStore({ root });
    await assert.rejects(
      () => store.read({ season, dataset: 'missing' }, z.object({ id: z.number() })),
      NotFoundError,
    );
  });

  it('lists datasets for a season', async () => {
    const store = new FileStore({ root });
    const datasets = await store.datasets(season);
    assert.ok(datasets.includes('history'));
    assert.ok(datasets.includes('gw'));
  });
});
