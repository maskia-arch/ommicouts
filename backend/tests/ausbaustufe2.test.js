import test from 'node:test';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import { extractContactInfo } from '../src/scraper/parser.js';
import {
  generateOrgLicenseKey,
  normalizeOrgKeyInput,
  hashOrgKey,
  computeOrgLicenseState,
} from '../src/services/userAuth.js';
import { buildHousingListPdfBuffer } from '../src/services/pdfExport.js';
import { buildUpdatedScraperUrlAndName } from '../src/services/kduUpdater.js';
import {
  isCrossPortalDuplicatePair,
  pickDuplicateWinner,
} from '../src/services/deduplicator.js';
import { buildListingChangeEvents } from '../src/services/notifications.js';

test('extractContactInfo extracts phone, email, name and filters portal system emails', () => {
  const html = `
    <div>
      <a href="tel:+49209123456">Anrufen</a>
      <a href="mailto:vermietung@beispiel-haus.de">E-Mail</a>
      <a href="mailto:noreply@kleinanzeigen.de">System</a>
    </div>
  `;
  const $ = cheerio.load(html);
  const res = extractContactInfo($, {
    sellerName: 'Herr Mustermann  (Privat)',
    text: 'Bei Interesse bitte melden unter 0209 / 123456 oder vermietung@beispiel-haus.de',
  });

  assert.equal(res.contact_phone, '+49209123456');
  assert.equal(res.contact_email, 'vermietung@beispiel-haus.de');
  assert.ok(res.contact_name.includes('Herr Mustermann'));
});

test('extractContactInfo falls back to text regex and ignores placeholder portal addresses', () => {
  const $ = cheerio.load('<div>Nur Text ohne mailto oder tel links</div>');
  const res = extractContactInfo($, {
    text: 'Anfragen bitte per Mail an privacy@immowelt.de oder Frau Weber unter +49 176 98765432 sowie kontakt@wohnen-ge.de.',
  });

  assert.equal(res.contact_email, 'kontakt@wohnen-ge.de');
  assert.equal(res.contact_phone, '+49 176 98765432');
});

test('organization license keys hash deterministically regardless of case or whitespace', () => {
  const key = generateOrgLicenseKey();
  assert.match(key, /^ORG-[A-F0-9]{4}(-[A-F0-9]{4}){4}$/);

  const lowerWithSpaces = ` ${key.toLowerCase()} `;
  assert.equal(normalizeOrgKeyInput(lowerWithSpaces), key);
  assert.equal(hashOrgKey(lowerWithSpaces), hashOrgKey(key));
  assert.equal(hashOrgKey(key).length, 64);
});

test('computeOrgLicenseState enforces none, active, unlimited, expired and revoked states', () => {
  const now = new Date('2026-11-11T12:00:00Z').getTime();

  assert.equal(computeOrgLicenseState({ account_type: 'user' }, now), 'none');
  assert.equal(
    computeOrgLicenseState(
      {
        account_type: 'organization',
        org_key_status: 'revoked',
        org_license_unlimited: true,
      },
      now
    ),
    'revoked'
  );
  assert.equal(
    computeOrgLicenseState(
      {
        account_type: 'organization',
        org_key_id: 'k1',
        org_key_status: 'active',
        org_key_unlimited: true,
      },
      now
    ),
    'active'
  );
  assert.equal(
    computeOrgLicenseState(
      {
        account_type: 'organization',
        org_key_id: 'k2',
        org_key_status: 'active',
        org_key_unlimited: false,
        org_key_expires_at: '2026-11-12T12:00:00Z',
      },
      now
    ),
    'active'
  );
  assert.equal(
    computeOrgLicenseState(
      {
        account_type: 'organization',
        org_key_id: 'k3',
        org_key_status: 'active',
        org_key_unlimited: false,
        org_key_expires_at: '2026-11-10T12:00:00Z',
      },
      now
    ),
    'expired'
  );
});

test('buildHousingListPdfBuffer generates a valid landscape A4 PDF document', async () => {
  const buf = await buildHousingListPdfBuffer({
    organization: {
      org_name: 'Caritas Wohnberatung Gelsenkirchen',
      org_subtitle: 'Fachstelle Wohnraumsicherung',
      org_contact: 'Tel. 0209 555111',
      org_logo_url: '',
    },
    filters: {
      city: 'Gelsenkirchen',
      bg_size: 1,
      benefit_type: 'sgb2',
      district: 'all',
      require_direct_contact: true,
    },
    rule: {
      max_sqm: 50,
      max_bruttokalt_eur: 424,
    },
    listings: [
      {
        title: 'Helle 2-Zi-Wohnung in GE-Buer',
        portal: 'kleinanzeigen',
        url: 'https://www.kleinanzeigen.de/s-anzeige/test/123456',
        city: 'Gelsenkirchen',
        district: 'Buer',
        zipcode: '45894',
        cold_rent: 320,
        additional_costs: 95,
        calculated_bruttokalt: 415,
        sqm: 48,
        rooms: 2,
        is_private_landlord: true,
        wbs_required: false,
        contact_name: 'Frau Beispiel',
        contact_phone: '0209 123456',
        contact_email: 'miete@beispiel.de',
      },
    ],
  });

  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 1000);
  assert.equal(buf.subarray(0, 7).toString('utf8'), '%PDF-1.');
});

test('buildUpdatedScraperUrlAndName adapts cap across Kleinanzeigen, Immowelt and GGW', () => {
  const ka = buildUpdatedScraperUrlAndName(
    {
      portal: 'kleinanzeigen',
      name: 'Kleinanzeigen Gelsenkirchen (Angebote, 150-850 EUR)',
      search_url: 'https://www.kleinanzeigen.de/s-wohnung-mieten/gelsenkirchen/preis:150:850/c203',
    },
    950
  );
  assert.ok(ka.nextUrl.includes('/preis:150:950/'));
  assert.ok(ka.nextName.includes('150-950 EUR'));

  const iw = buildUpdatedScraperUrlAndName(
    {
      portal: 'immowelt',
      name: 'Immowelt Gelsenkirchen (Angebote bis 850 EUR)',
      search_url: 'https://www.immowelt.de/suche/mieten/wohnung/gelsenkirchen?priceMax=850',
    },
    950
  );
  assert.ok(iw.nextUrl.includes('priceMax=950'));
  assert.ok(iw.nextName.includes('bis 950 EUR'));
});

test('cross-portal deduplicator detects Ohne-Makler/GGW vs Kleinanzeigen duplicates and keeps primary source', () => {
  const om = {
    id: 'id-om',
    portal: 'other',
    external_id: 'om_510668',
    city: 'Gelsenkirchen',
    zipcode: '45884',
    title: 'Ihr neues Zuhause: Stilvoll, hell und perfekt geschnitten! - 1-Zi.Wohnung in Gelsenkirchen',
    cold_rent: 350,
    additional_costs: 70,
    sqm: 40,
    rooms: 1,
    contact_name: null,
  };
  const kaSyndicated = {
    id: 'id-ka',
    portal: 'kleinanzeigen',
    external_id: 'ka_3556187433',
    city: 'Gelsenkirchen',
    zipcode: '45884',
    title: 'hr neues Zuhause: Stilvoll, hell und perfekt geschnitten! - 1-Zi.Wohnung in Gelsenkirchen',
    cold_rent: 350,
    additional_costs: 70,
    sqm: 40,
    rooms: 1,
    contact_name: 'OM Ohne Makler - Privat vom Eigentümer Gewerblicher Nutzer',
  };

  assert.equal(isCrossPortalDuplicatePair(om, kaSyndicated), true);
  const { winner, loser } = pickDuplicateWinner(kaSyndicated, om);
  assert.equal(winner.external_id, 'om_510668');
  assert.equal(loser.external_id, 'ka_3556187433');

  // Kleinanzeigen beats sparse Immowelt copy when direct portal is not involved
  const kaRich = {
    portal: 'kleinanzeigen',
    external_id: 'ka_3553674915',
    city: 'Gelsenkirchen',
    zipcode: '45886',
    title: 'Geräumige 1-Zimmer-Wohnung mit EBK in Gelsenkirchen',
    cold_rent: 499,
    additional_costs: 80,
    sqm: 45.95,
    rooms: 1,
  };
  const iwAuto = {
    portal: 'immowelt',
    external_id: 'iw_012871b2',
    city: 'Gelsenkirchen',
    zipcode: '45886',
    title: 'Wohnung zur Miete - Gelsenkirchen - 499 € - 1 Zimmer, 46 m²',
    cold_rent: 499,
    additional_costs: 0,
    sqm: 46,
    rooms: 1,
  };
  assert.equal(isCrossPortalDuplicatePair(kaRich, iwAuto), true);
  assert.equal(pickDuplicateWinner(iwAuto, kaRich).winner.external_id, 'ka_3553674915');

  // Distinct apartments with same template title must NOT be merged
  const vonoviaA = {
    portal: 'kleinanzeigen',
    external_id: 'ka_3534281960',
    city: 'Gelsenkirchen',
    zipcode: '45883',
    title: 'Bezugsfertige Wohnung - Einfach Möbel rein!',
    cold_rent: 392,
    sqm: 69.92,
    rooms: 3.5,
  };
  const vonoviaB = {
    portal: 'kleinanzeigen',
    external_id: 'ka_3522372334',
    city: 'Gelsenkirchen',
    zipcode: '45883',
    title: 'Bezugsfertige Wohnung - Einfach Möbel rein!',
    cold_rent: 462,
    sqm: 82.34,
    rooms: 4.5,
  };
  assert.equal(isCrossPortalDuplicatePair(vonoviaA, vonoviaB), false);
});

test('buildListingChangeEvents detects price drop/increase, offline transition, manual hide, and detail updates', () => {
  const base = {
    id: 'listing-1',
    title: 'Schöne 2-Zi Wohnung in Schalke',
    status: 'active',
    cold_rent: 350,
    additional_costs: 70,
    calculated_bruttokalt: 420,
    sqm: 52,
    rooms: 2,
    wbs_required: false,
  };

  // Price drop + room adjustment
  const priceEvents = buildListingChangeEvents(base, {
    ...base,
    cold_rent: 330,
    calculated_bruttokalt: 400,
    rooms: 2.5,
  });
  assert.equal(priceEvents.length, 2);
  assert.equal(priceEvents[0].event_type, 'price_changed');
  assert.ok(priceEvents[0].title.includes('gesunken'));
  assert.equal(priceEvents[1].event_type, 'listing_updated');

  // Price increase
  const higherEvents = buildListingChangeEvents(base, {
    ...base,
    additional_costs: 90,
    calculated_bruttokalt: 440,
  });
  assert.equal(higherEvents.length, 1);
  assert.equal(higherEvents[0].event_type, 'price_changed');
  assert.ok(higherEvents[0].title.includes('gestiegen'));

  // Status -> offline
  const offlineEvents = buildListingChangeEvents(base, {
    ...base,
    status: 'offline',
  });
  assert.equal(offlineEvents.length, 1);
  assert.equal(offlineEvents[0].event_type, 'listing_offline');

  // Status -> manual_hidden
  const hiddenEvents = buildListingChangeEvents(base, {
    ...base,
    status: 'manual_hidden',
  });
  assert.equal(hiddenEvents.length, 1);
  assert.equal(hiddenEvents[0].event_type, 'listing_hidden');

  // Identical listing produces no events
  assert.deepEqual(buildListingChangeEvents(base, { ...base }), []);
});
