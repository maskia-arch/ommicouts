import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveSearchMaxRentFromRules,
  parseKduContent,
} from '../src/services/kduUpdater.js';
import { validateListing } from '../src/scraper/validator.js';

test('parseKduContent extracts municipal HTML KdU table with extra person rate', () => {
  const html = `
    <html><body>
      <table>
        <tr><th>Haushaltsgröße</th><th>Wohnfläche</th><th>Bruttokaltmiete</th></tr>
        <tr><td>1 Person</td><td>50 m²</td><td>420,50 €</td></tr>
        <tr><td>2 Personen</td><td>65 m²</td><td>530,00 €</td></tr>
        <tr><td>3 Personen</td><td>80 m²</td><td>650,25 €</td></tr>
        <tr><td>4 Personen</td><td>95 m²</td><td>780,00 €</td></tr>
        <tr><td>5 Personen</td><td>110 m²</td><td>915,00 €</td></tr>
      </table>
      <p>Für jede weitere Person erhöhen sich die Werte um 15 m² bzw. 120,00 €.</p>
    </body></html>
  `;

  const res = parseKduContent(html, 'text/html');
  assert.equal(res.ok, true);
  assert.equal(res.format, 'html');
  assert.equal(res.rules.length, 5);
  assert.equal(res.rules[0].bg_size, 1);
  assert.equal(res.rules[0].max_sqm, 50);
  assert.equal(res.rules[0].max_bruttokalt_eur, 420.5);
  assert.equal(res.rules[0].extra_person_sqm, 15);
  assert.equal(res.rules[0].extra_person_eur, 120);
  assert.equal(res.rules[4].max_bruttokalt_eur, 915);
});

test('parseKduContent parses JSON KdU feed', () => {
  const json = JSON.stringify({
    extra_person_sqm: 15,
    extra_person_eur: 110,
    rules: [
      { bg_size: 1, max_sqm: 50, max_bruttokalt_eur: 400 },
      { bg_size: 2, max_sqm: 65, max_bruttokalt_eur: 510 },
      { bg_size: 3, max_sqm: 80, max_bruttokalt_eur: 620 },
    ],
  });

  const res = parseKduContent(json, 'application/json');
  assert.equal(res.ok, true);
  assert.equal(res.format, 'json');
  assert.equal(res.rules.length, 3);
  assert.equal(res.rules[1].max_bruttokalt_eur, 510);
});

test('parseKduContent rejects HTML with fewer than 3 valid tiers', () => {
  const html = `<html><body><p>1 Person: 50 m² / 400 €</p></body></html>`;
  const res = parseKduContent(html, 'text/html');
  assert.equal(res.ok, false);
});

test('deriveSearchMaxRentFromRules rounds BG5 Bruttokalt up to next 50 EUR', () => {
  const cap = deriveSearchMaxRentFromRules([
    { bg_size: 1, max_bruttokalt_eur: 367.5 },
    { bg_size: 5, max_bruttokalt_eur: 841.5 },
  ]);
  assert.equal(cap, 850);

  const bochumCap = deriveSearchMaxRentFromRules([
    { bg_size: 1, max_bruttokalt_eur: 420 },
    { bg_size: 5, max_bruttokalt_eur: 915 },
  ]);
  assert.equal(bochumCap, 950);
});

test('validateListing supports dynamic multi-city zipPrefixes and blocks Demenz-WG', () => {
  const bochumBase = {
    external_id: 'ka_bochum_1',
    portal: 'kleinanzeigen',
    title: 'Schöne 2-Zimmer-Wohnung in Bochum Ehrenfeld',
    url: 'https://www.kleinanzeigen.de/s-anzeige/wohnung-bochum/1',
    city: 'Bochum',
    district: 'Ehrenfeld',
    zipcode: '44787',
    cold_rent: 450,
    additional_costs: 90,
    sqm: 58,
    rooms: 2,
    is_wanted: false,
  };

  assert.deepEqual(
    validateListing(bochumBase, 'Bochum', { zipPrefixes: '447,448' }),
    { valid: true }
  );

  const wrongCity = validateListing(
    { ...bochumBase, zipcode: '45127', district: 'Essen-Mitte', title: '2-Zi Wohnung in Essen' },
    'Bochum',
    { zipPrefixes: '447,448' }
  );
  assert.equal(wrongCity.valid, false);

  const demenzWg = validateListing(
    { ...bochumBase, title: 'Bewohner gesucht für Demenz-WG in Bochum' },
    'Bochum',
    { zipPrefixes: '447,448' }
  );
  assert.equal(demenzWg.valid, false);
});
