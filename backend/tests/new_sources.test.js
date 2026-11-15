import test from 'node:test';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import {
  extractExternalId,
  extractSearchListingLinks,
  parseListingDetail,
  parseMietsofortItem,
  parseWohnungsaushangTable,
} from '../src/scraper/parser.js';
import {
  computeListingPriorityScore,
  extractStreetForMatch,
  getListingOriginKey,
  isCrossPortalDuplicatePair,
  pickDuplicateWinner,
} from '../src/services/deduplicator.js';

test('Kommunaler Wohnungsaushang Gelsenkirchen table parses correctly', () => {
  const html = `
    <html>
      <body>
        <table id="contentContentPlaceHolder_spalte_links_ctl00_wohnungenGridView">
          <tr>
            <th>Räume</th>
            <th>Größe</th>
            <th>Miete</th>
            <th>Adresse</th>
            <th>Telefon</th>
          </tr>
          <tr>
            <td>3,5</td>
            <td>69,12 m²</td>
            <td>474,13 €</td>
            <td>Erle, Weststr. 4</td>
            <td>+49 (209) 75098</td>
          </tr>
          <tr>
            <td>2,0</td>
            <td>48,50 m²</td>
            <td>340,00 €</td>
            <td>Bismarck, Consolstr. 12</td>
            <td>0172 1234567</td>
          </tr>
        </table>
      </body>
    </html>
  `;

  const $ = cheerio.load(html);
  const candidates = parseWohnungsaushangTable(
    $,
    'https://www.gelsenkirchen.de/de/infrastruktur/bauen_und_wohnen/wohnungsaushang.aspx',
    'Gelsenkirchen'
  );

  assert.equal(candidates.length, 2);

  const [c1, c2] = candidates;
  assert.match(c1.externalId, /^ge_aushang_[a-f0-9]{12}$/);
  assert.equal(c1.serpParsed.cold_rent, 474.13);
  assert.equal(c1.serpParsed.sqm, 69.12);
  assert.equal(c1.serpParsed.rooms, 3.5);
  assert.equal(c1.serpParsed.district, 'Erle');
  assert.equal(c1.serpParsed.zipcode, '45891');
  assert.equal(c1.serpParsed.contact_phone, '+49 (209) 75098');
  assert.equal(c1.serpParsed.wbs_required, true);
  assert.equal(c1.serpParsed.is_private_landlord, true);
  assert.equal(c1.serpParsed.portal, 'other');

  assert.equal(c2.serpParsed.district, 'Bismarck');
  assert.equal(c2.serpParsed.zipcode, '45889');
  assert.equal(c2.serpParsed.cold_rent, 340);
  assert.equal(c2.serpParsed.contact_phone, '0172 1234567');
  assert.equal(c2.serpParsed.wbs_required, true);
});

test('Rentola search and detail parsing handles JSON-LD and HTML', () => {
  const searchHtml = `
    <html>
      <head>
        <script type="application/ld+json">
          {
            "@type": "ItemList",
            "itemListElement": [
              {
                "@type": "RealEstateListing",
                "name": "Schöne 2-Zimmer-Wohnung in Gelsenkirchen Buer",
                "url": "https://rentola.de/listings/schoene-2-zimmer-wohnung-in-buer-p42d2bf",
                "offers": {
                  "@type": "Offer",
                  "price": 420,
                  "itemOffered": {
                    "@type": "Apartment",
                    "floorSize": { "@type": "QuantitativeValue", "value": 52 },
                    "numberOfRooms": { "@type": "QuantitativeValue", "value": 2 },
                    "address": {
                      "@type": "PostalAddress",
                      "streetAddress": "Goldbergstraße 10, 45894 Gelsenkirchen"
                    }
                  }
                }
              }
            ]
          }
        </script>
      </head>
      <body>
        <a href="/listings/schoene-2-zimmer-wohnung-in-buer-p42d2bf">Details</a>
      </body>
    </html>
  `;

  const links = extractSearchListingLinks(
    searchHtml,
    'https://rentola.de/mieten/gelsenkirchen',
    'other',
    'Gelsenkirchen'
  );

  assert.equal(links.length, 1);
  const cand = links[0];
  assert.equal(cand.externalId, 'rt_42d2bf');
  assert.equal(cand.serpParsed.cold_rent, 420);
  assert.equal(cand.serpParsed.sqm, 52);
  assert.equal(cand.serpParsed.rooms, 2);
  assert.equal(cand.serpParsed.district, 'Buer');
  assert.equal(cand.serpParsed.zipcode, '45894');

  const detailHtml = `
    <html>
      <head>
        <script type="application/ld+json">
          {
            "@type": "RealEstateListing",
            "name": "Helle 2-Raum-Wohnung in Buer",
            "offers": {
              "price": 420,
              "itemOffered": {
                "floorSize": { "value": 52 },
                "numberOfRooms": { "value": 2 },
                "address": {
                  "streetAddress": "Goldbergstraße 10",
                  "postalCode": "45894",
                  "addressLocality": "Gelsenkirchen-Buer"
                }
              }
            }
          }
        </script>
      </head>
      <body>
        <h1>Helle 2-Raum-Wohnung in Buer</h1>
      </body>
    </html>
  `;

  const detail = parseListingDetail(
    detailHtml,
    'https://rentola.de/listings/schoene-2-zimmer-wohnung-in-buer-p42d2bf',
    'other',
    'Gelsenkirchen'
  );

  assert.equal(detail.external_id, 'rt_42d2bf');
  assert.equal(detail.cold_rent, 420);
  assert.equal(detail.sqm, 52);
  assert.equal(detail.rooms, 2);
  assert.equal(detail.district, 'Buer');
  assert.equal(detail.zipcode, '45894');
});

test('Mietsofort item parser normalizes Supabase RPC listing payload', () => {
  const item = {
    id: '09a17e0c-291b-46bf-b124-cc76370264ba',
    title: '4 Zimmer Wohnung mit 89 m² in Gelsenkirchen',
    slug: '4-zimmer-wohnung-mit-89-m-in-gelsenkirchen-warendorfer-strasse-p09a17e0c',
    price: 779,
    size_sqm: 88.93,
    rooms: 4,
    address: 'Warendorfer Straße 1',
    postal_code: '45892',
    description: 'Renovierte Wohnung von Privatvermieter in Resse.',
    contact_name: 'Familie Müller',
    contact_phone: '0151 98765432',
  };

  const parsed = parseMietsofortItem(item, 'Gelsenkirchen');

  assert.equal(parsed.external_id, 'ms_09a17e0c-291b-46bf-b124-cc76370264ba');
  assert.equal(parsed.cold_rent, 779);
  assert.equal(parsed.sqm, 88.93);
  assert.equal(parsed.rooms, 4);
  assert.equal(parsed.district, 'Resse');
  assert.equal(parsed.zipcode, '45892');
  assert.equal(parsed.is_private_landlord, true);
  assert.equal(parsed.contact_name, 'Familie Müller');
  assert.equal(parsed.contact_phone, '0151 98765432');
  assert.equal(parsed.url, 'https://www.mietsofort.de/mietwohnungen/4-zimmer-wohnung-mit-89-m-in-gelsenkirchen-warendorfer-strasse-p09a17e0c');
});

test('Cross-portal deduplication prevents duplicates between Wohnungsaushang, Kleinanzeigen, Mietsofort, and Rentola', () => {
  const aushangListing = {
    external_id: 'ge_aushang_abc123456789',
    portal: 'other',
    url: 'https://www.gelsenkirchen.de/de/infrastruktur/bauen_und_wohnen/wohnungsaushang.aspx#wohnung-abc123456789',
    title: '3.5-Zimmer-Wohnung in Gelsenkirchen-Erle, Weststr. 4 (69.12 m²)',
    locality_raw: 'Erle, Weststr. 4, Gelsenkirchen',
    city: 'Gelsenkirchen',
    district: 'Erle',
    zipcode: '45891',
    cold_rent: 474.13,
    sqm: 69.12,
    rooms: 3.5,
    contact_phone: '+49 (209) 75098',
  };

  const kleinanzeigenSyndicated = {
    external_id: 'ka_987654321',
    portal: 'kleinanzeigen',
    url: 'https://www.kleinanzeigen.de/s-anzeige/schoene-wohnung-weststr-4-erle/987654321-203-2093',
    title: 'Schöne Wohnung Weststr. 4 in Gelsenkirchen-Erle',
    locality_raw: '45891 Gelsenkirchen - Erle',
    city: 'Gelsenkirchen',
    district: 'Erle',
    zipcode: '45891',
    cold_rent: 474.0,
    sqm: 69.0,
    rooms: 3.5,
  };

  const rentolaSyndicated = {
    external_id: 'rt_f1a2b3',
    portal: 'other',
    url: 'https://rentola.de/listings/weststr-4-erle-pf1a2b3',
    title: '3 Zimmer Wohnung Weststr. 4 Gelsenkirchen',
    locality_raw: 'Weststr. 4, Gelsenkirchen',
    city: 'Gelsenkirchen',
    district: 'Erle',
    zipcode: '45891',
    cold_rent: 474.13,
    sqm: 69.12,
    rooms: 3.5,
  };

  // 1. Origin keys differ
  assert.equal(getListingOriginKey(aushangListing), 'gelsenkirchen.de');
  assert.equal(getListingOriginKey(kleinanzeigenSyndicated), 'kleinanzeigen.de');
  assert.equal(getListingOriginKey(rentolaSyndicated), 'rentola.de');

  // 2. Exact street matching
  assert.equal(extractStreetForMatch(aushangListing.locality_raw), 'weststrasse4');
  assert.equal(extractStreetForMatch(kleinanzeigenSyndicated.title), 'weststrasse4');
  assert.equal(extractStreetForMatch(rentolaSyndicated.title), 'weststrasse4');

  // 3. Duplicate detection
  assert.equal(isCrossPortalDuplicatePair(aushangListing, kleinanzeigenSyndicated), true);
  assert.equal(isCrossPortalDuplicatePair(aushangListing, rentolaSyndicated), true);
  assert.equal(isCrossPortalDuplicatePair(rentolaSyndicated, kleinanzeigenSyndicated), true);

  // 4. Priority scoring: Wohnungsaushang (+50) beats Kleinanzeigen (+25) and Rentola (+14)
  const scoreAushang = computeListingPriorityScore(aushangListing);
  const scoreKA = computeListingPriorityScore(kleinanzeigenSyndicated);
  const scoreRentola = computeListingPriorityScore(rentolaSyndicated);

  assert.ok(scoreAushang > scoreKA, 'Wohnungsaushang must beat Kleinanzeigen');
  assert.ok(scoreKA > scoreRentola, 'Kleinanzeigen must beat Rentola');

  const { winner, loser } = pickDuplicateWinner(kleinanzeigenSyndicated, aushangListing);
  assert.equal(winner.external_id, aushangListing.external_id);
  assert.equal(loser.external_id, kleinanzeigenSyndicated.external_id);
});
