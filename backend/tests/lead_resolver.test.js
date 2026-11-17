import test from 'node:test';
import assert from 'node:assert/strict';
import { validateListing } from '../src/scraper/validator.js';
import { parseMietsofortItem } from '../src/scraper/parser.js';

test('validateListing strictly rejects direct mietsofort.de URLs and ms_ IDs (Hard Block)', () => {
  const mietsofortUrl = {
    external_id: 'other_123456',
    url: 'https://www.mietsofort.de/mietwohnungen/schone-2-zimmer-wohnung-p123456',
    title: 'Schöne 2-Zimmer-Wohnung in Gelsenkirchen',
    city: 'Gelsenkirchen',
    district: 'Buer',
    zipcode: '45894',
    cold_rent: 450,
    additional_costs: 120,
    sqm: 55,
    rooms: 2,
  };

  const validation1 = validateListing(mietsofortUrl, 'Gelsenkirchen');
  assert.equal(validation1.valid, false);
  assert.match(validation1.reason, /mietsofort\.de ist als direkte Quelle gesperrt/i);

  const mietsofortId = {
    external_id: 'ms_09a17e0c-291b-46bf-b124-cc76370264ba',
    url: 'https://example.com/listing',
    title: '4 Zimmer Wohnung in Gelsenkirchen Resse',
    city: 'Gelsenkirchen',
    district: 'Resse',
    zipcode: '45892',
    cold_rent: 550,
    additional_costs: 130,
    sqm: 80,
    rooms: 4,
  };

  const validation2 = validateListing(mietsofortId, 'Gelsenkirchen');
  assert.equal(validation2.valid, false);
  assert.match(validation2.reason, /mietsofort\.de ist als direkte Quelle gesperrt/i);
});

test('parseMietsofortItem extracts lead data properly for the resolver', () => {
  const rawItem = {
    id: 'test-uuid-1234',
    title: '3 Zimmer Wohnung mit 75 m² in Gelsenkirchen',
    slug: '3-zimmer-wohnung-mit-75-m-in-gelsenkirchen-allensteiner-str-ptest1234',
    price: 569,
    size_sqm: 75.93,
    rooms: 3,
    address: 'Allensteiner Straße 37',
    postal_code: '45897',
    description: 'Ruhige Lage in Buer.',
    contact_name: 'Vermieter',
  };

  const lead = parseMietsofortItem(rawItem, 'Gelsenkirchen');
  assert.equal(lead.external_id, 'ms_test-uuid-1234');
  assert.equal(lead.cold_rent, 569);
  assert.equal(lead.sqm, 75.93);
  assert.equal(lead.rooms, 3);
  assert.equal(lead.zipcode, '45897');
  assert.ok(lead.locality_raw.includes('Allensteiner Straße 37'));
});
