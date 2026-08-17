import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { FileAssetStore } from './file-asset-store.js';
import { syncAssets } from './sync.js';
import type { AssetFetcher } from './types.js';
import { badgeSvgUrl, badgeUrl, playerPhotoUrl, shirtUrl } from './urls.js';

/** Header plus enough padding to clear the sync's minimum image size check. */
const PNG = Uint8Array.from({ length: 1024 }, (_, index) =>
  index < 8 ? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index]! : index % 256,
);

/** What the CDN returns when a photo was pulled but the object was not removed. */
const TRUNCATED = new Uint8Array(263);

/** Serves only the URLs it is given, so an unlisted URL behaves as a real 404. */
function stubFetcher(available: Record<string, Uint8Array>): AssetFetcher & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    tryGetBytes(url) {
      calls.push(url);
      const bytes = available[url];
      if (bytes === undefined) return Promise.resolve(null);
      const contentType = url.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
      return Promise.resolve({ bytes, contentType });
    },
  };
}

describe('asset urls', () => {
  it('keys every url off the stable code, not the seasonal id', () => {
    assert.equal(
      badgeUrl(3, 50),
      'https://resources.premierleague.com/premierleague/badges/50/t3.png',
    );
    assert.equal(badgeSvgUrl(3), 'https://resources.premierleague.com/premierleague/badges/t3.svg');
    assert.equal(
      playerPhotoUrl(223094),
      'https://resources.premierleague.com/premierleague/photos/players/250x250/p223094.png',
    );
    assert.equal(
      shirtUrl(3, { keeper: true }),
      'https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_3_1-110.png',
    );
  });
});

describe('FileAssetStore', () => {
  let root: string;

  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'fpl-assets-'));
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('round trips a blob and records it in the manifest', async () => {
    const store = new FileAssetStore({ root });
    const record = await store.put('player-photo', '223094', {
      bytes: PNG,
      contentType: 'image/png',
      sourceUrl: playerPhotoUrl(223094),
    });

    assert.equal(record.file, 'player-photo/223094.png');
    assert.equal(record.bytes, PNG.byteLength);
    assert.equal(record.sha256.length, 64);
    assert.deepEqual(await store.read('player-photo', '223094'), PNG);

    // A fresh instance must see it, which proves the manifest was persisted.
    const reopened = new FileAssetStore({ root });
    assert.equal((await reopened.get('player-photo', '223094'))?.sha256, record.sha256);
    assert.equal((await reopened.list('player-photo')).length, 1);
  });

  it('picks the extension from the content type', async () => {
    const store = new FileAssetStore({ root });
    const record = await store.put('team-badge-svg', '3', {
      bytes: new TextEncoder().encode('<svg/>'),
      contentType: 'image/svg+xml; charset=utf-8',
      sourceUrl: badgeSvgUrl(3),
    });
    assert.equal(record.file, 'team-badge-svg/3.svg');
  });

  it('reports nothing for an unknown asset rather than throwing', async () => {
    const store = new FileAssetStore({ root });
    assert.equal(await store.get('player-photo', '999999'), undefined);
    assert.equal(await store.read('player-photo', '999999'), undefined);
  });
});

describe('syncAssets', () => {
  let root: string;

  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'fpl-assets-sync-'));
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('falls back to a smaller published size before declaring an asset missing', async () => {
    const store = new FileAssetStore({ root });
    const fetcher = stubFetcher({
      // 250x250 is absent for this player, 110x140 exists.
      [playerPhotoUrl(1, '110x140')]: PNG,
    });

    const report = await syncAssets({
      fetcher,
      store,
      teams: [],
      players: [{ code: 1 }],
      kinds: ['player-photo'],
    });

    assert.equal(report.downloaded, 1);
    assert.equal(report.missing, 0);
    assert.deepEqual(fetcher.calls, [playerPhotoUrl(1, '250x250'), playerPhotoUrl(1, '110x140')]);
    assert.equal((await store.get('player-photo', '1'))?.sourceUrl, playerPhotoUrl(1, '110x140'));
  });

  it('skips past a truncated file to the next published size', async () => {
    const store = new FileAssetStore({ root });
    const fetcher = stubFetcher({
      // 200 with a 263 byte body: the object exists but is not an image.
      [playerPhotoUrl(3, '250x250')]: TRUNCATED,
      [playerPhotoUrl(3, '110x140')]: PNG,
    });

    const report = await syncAssets({
      fetcher,
      store,
      teams: [],
      players: [{ code: 3 }],
      kinds: ['player-photo'],
    });

    assert.equal(report.downloaded, 1);
    assert.equal((await store.get('player-photo', '3'))?.bytes, PNG.byteLength);
  });

  it('records a player with no published photo as missing, not as a failure', async () => {
    const store = new FileAssetStore({ root });
    const report = await syncAssets({
      fetcher: stubFetcher({}),
      store,
      teams: [],
      players: [{ code: 2 }],
      kinds: ['player-photo'],
    });

    assert.equal(report.missing, 1);
    assert.equal(report.downloaded, 0);
    assert.deepEqual(report.missingKeys, ['player-photo/2']);
  });

  it('skips what the manifest already holds, and refetches it under force', async () => {
    const store = new FileAssetStore({ root });
    const available = {
      [badgeSvgUrl(3)]: new TextEncoder().encode(`<svg>${'x'.repeat(600)}</svg>`),
    };

    const first = stubFetcher(available);
    const initial = await syncAssets({
      fetcher: first,
      store,
      teams: [{ code: 3 }],
      players: [],
      kinds: ['team-badge-svg'],
    });
    assert.equal(initial.downloaded, 1);

    const second = stubFetcher(available);
    const rerun = await syncAssets({
      fetcher: second,
      store,
      teams: [{ code: 3 }],
      players: [],
      kinds: ['team-badge-svg'],
    });
    assert.equal(rerun.skipped, 1);
    assert.equal(rerun.downloaded, 0);
    assert.deepEqual(second.calls, []);

    const third = stubFetcher(available);
    const forced = await syncAssets({
      fetcher: third,
      store,
      teams: [{ code: 3 }],
      players: [],
      kinds: ['team-badge-svg'],
      force: true,
    });
    assert.equal(forced.downloaded, 1);
    assert.equal(third.calls.length, 1);
  });
});
