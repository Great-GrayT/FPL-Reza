import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../app.js';
import { createTestDeps, type TestDeps } from '../test-support.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('assets routes', () => {
  let context: TestDeps;
  let app: FastifyInstance;

  before(async () => {
    context = await createTestDeps();
    await context.deps.assets.put('player-photo', '101', {
      bytes: PNG,
      contentType: 'image/png',
      sourceUrl:
        'https://resources.premierleague.com/premierleague/photos/players/250x250/p101.png',
    });
    app = buildServer(context.deps);
    await app.ready();
  });

  after(async () => {
    await app.close();
    await context.cleanup();
  });

  it('lists the manifest', async () => {
    const response = await app.inject({ method: 'GET', url: '/assets' });
    assert.equal(response.statusCode, 200);
    const body = response.json<{ total: number; assets: { key: string }[] }>();
    assert.equal(body.total, 1);
    assert.equal(body.assets[0]?.key, '101');
  });

  it('rejects an unknown kind with a 400 rather than a 404', async () => {
    const response = await app.inject({ method: 'GET', url: '/assets?kind=nonsense' });
    assert.equal(response.statusCode, 400);
  });

  it('serves the bytes with the stored content type and an immutable cache', async () => {
    const response = await app.inject({ method: 'GET', url: '/assets/player-photo/101' });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'image/png');
    assert.match(String(response.headers['cache-control']), /immutable/);
    assert.deepEqual(new Uint8Array(response.rawPayload), PNG);
  });

  it('tolerates a caller appending the file extension', async () => {
    const response = await app.inject({ method: 'GET', url: '/assets/player-photo/101.png' });
    assert.equal(response.statusCode, 200);
  });

  it('404s an asset that was never downloaded', async () => {
    const response = await app.inject({ method: 'GET', url: '/assets/player-photo/999999' });
    assert.equal(response.statusCode, 404);
  });
});
