import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GROUND_MATCH_METRES, distanceMetres, groundImageSchema } from './grounds.js';

describe('distanceMetres', () => {
  it('is zero for the same point', () => {
    const point = { latitude: 51.5548, longitude: -0.108533 };
    assert.equal(distanceMetres(point, point), 0);
  });

  it('measures the Emirates against its own article coordinate', () => {
    // Emirates Stadium as the Premier League publishes it, against the
    // coordinate on its Wikidata item. A few dozen metres apart, which is why
    // the tolerance is generous but nowhere near a kilometre.
    const ground = { latitude: 51.5548, longitude: -0.108533 };
    const article = { latitude: 51.55499, longitude: -0.10854 };
    const metres = distanceMetres(ground, article);
    assert.ok(metres < 50, `expected under 50m, got ${metres.toFixed(0)}m`);
  });

  it('separates two grounds in the same city by more than the tolerance', () => {
    // The Emirates and Stamford Bridge: the closest pair of Premier League
    // grounds is nothing like this close, so the tolerance cannot confuse two.
    const emirates = { latitude: 51.5548, longitude: -0.108533 };
    const stamfordBridge = { latitude: 51.4816, longitude: -0.19087 };
    assert.ok(distanceMetres(emirates, stamfordBridge) > GROUND_MATCH_METRES);
  });

  it('is symmetric', () => {
    const a = { latitude: 53.4308, longitude: -2.9611 };
    const b = { latitude: 53.4631, longitude: -2.2913 };
    assert.equal(Math.round(distanceMetres(a, b)), Math.round(distanceMetres(b, a)));
  });
});

describe('groundImageSchema', () => {
  const valid = {
    groundId: 9523,
    wikidataId: 'Q163995',
    title: 'Emirates Stadium',
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/b/x.jpg/960px-x.jpg',
    width: 960,
    height: 640,
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:X.jpg',
    licence: 'CC BY-SA 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
    credit: 'A Photographer',
    matchedBy: 'coordinates' as const,
    matchedWithinMetres: 26,
  };

  it('accepts a fully attributed photograph', () => {
    assert.equal(groundImageSchema.parse(valid).credit, 'A Photographer');
  });

  it('refuses a photograph with no credit, since the licence requires one', () => {
    assert.throws(() => groundImageSchema.parse({ ...valid, credit: '' }));
  });

  it('refuses a photograph with no licence named', () => {
    assert.throws(() => groundImageSchema.parse({ ...valid, licence: '' }));
  });

  it('allows a null distance only alongside the type rule', () => {
    const parsed = groundImageSchema.parse({
      ...valid,
      matchedBy: 'stadium_type',
      matchedWithinMetres: null,
    });
    assert.equal(parsed.matchedBy, 'stadium_type');
    assert.equal(parsed.matchedWithinMetres, null);
  });
});
