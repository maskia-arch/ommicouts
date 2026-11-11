import assert from 'node:assert/strict';
import test from 'node:test';
import { validateListing } from '../src/scraper/validator.js';

const validBase = {
  external_id: 'ka_3566918165',
  portal: 'kleinanzeigen',
  title: '1-Zimmer-Wohnung in Gelsenkirchen Buer',
  url: 'https://www.kleinanzeigen.de/s-anzeige/1-zimmer-wohnung-in-gelsenkirchen-buer/3566918165-203-1001',
  city: 'Gelsenkirchen',
  district: 'Buer',
  zipcode: '45894',
  cold_rent: 289,
  additional_costs: 70,
  sqm: 42,
  rooms: 1,
  is_wanted: false,
};

test('validateListing accepts valid Gelsenkirchen offer', () => {
  assert.deepEqual(validateListing(validBase, 'Gelsenkirchen'), { valid: true });
});

test('validateListing rejects out-of-city zipcode (e.g. 40210 Düsseldorf)', () => {
  const res = validateListing({ ...validBase, zipcode: '40210' }, 'Gelsenkirchen');
  assert.equal(res.valid, false);
  assert.match(res.reason, /40210/);
});

test('validateListing rejects wanted ads (Gesuch) by flag, title, and URL', () => {
  assert.equal(validateListing({ ...validBase, is_wanted: true }).valid, false);
  assert.equal(
    validateListing({ ...validBase, title: 'Suche kleine Wohnung für 1 Person' }).valid,
    false
  );
  assert.equal(
    validateListing({ ...validBase, title: 'WG-Zimmer in Buer frei' }).valid,
    false
  );
  assert.equal(
    validateListing({ ...validBase, title: 'Garage / Stellplatz in Schalke' }).valid,
    false
  );
});

test('validateListing rejects trash prices, tiny rooms, and 0 rooms', () => {
  assert.equal(validateListing({ ...validBase, cold_rent: 1 }).valid, false);
  assert.equal(validateListing({ ...validBase, cold_rent: 149.99 }).valid, false);
  assert.equal(validateListing({ ...validBase, sqm: 15 }).valid, false);
  assert.equal(validateListing({ ...validBase, rooms: 0 }).valid, false);
  assert.equal(validateListing({ ...validBase, title: 'Kleinanzeigen' }).valid, false);
});
