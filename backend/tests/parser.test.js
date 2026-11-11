import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPagedSearchUrl,
  detectWbsRequired,
  extractExternalId,
  extractSearchListingLinks,
  extractUrlsFromWebhookPayload,
  isListingOfflineHtml,
  parseGermanNumber,
  parseListingDetail,
} from '../src/scraper/parser.js';

test('parseGermanNumber handles German currency and decimal formatting', () => {
  assert.equal(parseGermanNumber('367,50 €'), 367.5);
  assert.equal(parseGermanNumber('1.250,00 EUR'), 1250);
  assert.equal(parseGermanNumber('50,5 m²'), 50.5);
});

test('extractExternalId normalizes Kleinanzeigen and Immowelt IDs', () => {
  assert.equal(
    extractExternalId('https://www.kleinanzeigen.de/s-anzeige/2-zimmer-schalke/2849102934-203-2093'),
    'ka_2849102934'
  );
  assert.equal(
    extractExternalId('https://www.immowelt.de/expose/2e4f8a12-1234-4a5b-8c9d-111122223333?searchId=abc'),
    'iw_2e4f8a12-1234-4a5b-8c9d-111122223333'
  );
});

test('buildPagedSearchUrl constructs page 2 URLs properly', () => {
  const kaPage2 = buildPagedSearchUrl(
    'https://www.kleinanzeigen.de/s-wohnung-mieten/gelsenkirchen/preis::850/c203l2093?sortingField=SORTING_DATE',
    2,
    'kleinanzeigen'
  );
  assert.match(kaPage2, /\/seite:2\/c203l2093/);

  const iwPage2 = buildPagedSearchUrl(
    'https://www.immowelt.de/liste/gelsenkirchen/wohnungen/mieten?pma=850&sd=DESC&sf=TIMESTAMP',
    2,
    'immowelt'
  );
  assert.match(iwPage2, /sp=2/);
});

test('parseListingDetail extracts JSON-LD, DOM, private landlord and regex fallback', () => {
  const sampleHtml = `
    <html>
      <head>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "Apartment",
            "name": "Helle 2-Zimmer-Wohnung in GE-Schalke von Privat",
            "offers": {
              "@type": "Offer",
              "price": "285.00",
              "seller": { "@type": "Person", "name": "Privater Anbieter" }
            },
            "address": { "postalCode": "45881", "addressLocality": "Gelsenkirchen Schalke" }
          }
        </script>
      </head>
      <body>
        <h1 id="viewad-title">Helle 2-Zimmer-Wohnung in GE-Schalke von Privat</h1>
        <div id="viewad-description-text">
          Schöne Wohnung, Kaltmiete 285 €, kalte Nebenkosten 80 €, Heizkosten 65 €.
          Wohnfläche 49,5 m², 2 Zimmer. Kein WBS erforderlich. Direktabtretung Jobcenter möglich.
        </div>
      </body>
    </html>
  `;

  const parsed = parseListingDetail(
    sampleHtml,
    'https://www.kleinanzeigen.de/s-anzeige/helle-2-zimmer-schalke/123456789-203-2093',
    'kleinanzeigen',
    'Gelsenkirchen'
  );

  assert.equal(parsed.external_id, 'ka_123456789');
  assert.equal(parsed.district, 'Schalke');
  assert.equal(parsed.zipcode, '45881');
  assert.equal(parsed.cold_rent, 285);
  assert.equal(parsed.additional_costs, 80);
  assert.equal(parsed.heating_costs, 65);
  assert.equal(parsed.sqm, 49.5);
  assert.equal(parsed.rooms, 2);
  assert.equal(parsed.is_private_landlord, true);
  assert.equal(parsed.wbs_required, false);
});

test('detectWbsRequired distinguishes WBS required vs not required', () => {
  assert.equal(detectWbsRequired('Wohnung mit WBS erforderlich in Buer'), true);
  assert.equal(detectWbsRequired('Kein WBS erforderlich!'), false);
  assert.equal(detectWbsRequired('Ohne WBS anmietbar'), false);
});

test('extractSearchListingLinks skips topads and preserves newest-first order', () => {
  const html = `
    <div id="srchrslt-adtable-topads">
      <article class="aditem is-topad"><a href="/s-anzeige/top/999999999-203-2093">Top</a></article>
    </div>
    <ul>
      <article class="aditem"><a href="/s-anzeige/neu-1/111111111-203-2093">Neu 1</a></article>
      <article class="aditem"><a href="/s-anzeige/neu-2/222222222-203-2093">Neu 2</a></article>
    </ul>
  `;
  const links = extractSearchListingLinks(html, 'https://www.kleinanzeigen.de', 'kleinanzeigen');
  assert.equal(links.length, 2);
  assert.equal(links[0].externalId, 'ka_111111111');
  assert.equal(links[1].externalId, 'ka_222222222');
});

test('isListingOfflineHtml detects 404, redirects, and offline markers', () => {
  assert.equal(isListingOfflineHtml('', 'https://www.kleinanzeigen.de', 404, 'kleinanzeigen').offline, true);
  assert.equal(
    isListingOfflineHtml('<div>Anzeige nicht mehr verfügbar</div>', 'https://www.kleinanzeigen.de/s-anzeige/x/1', 200, 'kleinanzeigen').offline,
    true
  );
  assert.equal(
    isListingOfflineHtml('<div>Aktives Angebot</div>', 'https://www.kleinanzeigen.de/s-anzeige/x/1', 200, 'kleinanzeigen').offline,
    false
  );
});

test('extractUrlsFromWebhookPayload extracts supported listing links cleanly', () => {
  const urls = extractUrlsFromWebhookPayload({
    subject: 'Neue Wohnung in Gelsenkirchen',
    text: 'Schau dir diese an: https://www.kleinanzeigen.de/s-anzeige/test/555666777-203-2093?utm_source=mail und https://www.immowelt.de/expose/abc12345.',
  });
  assert.deepEqual(urls, [
    'https://www.kleinanzeigen.de/s-anzeige/test/555666777-203-2093',
    'https://www.immowelt.de/expose/abc12345',
  ]);
});
