import * as cheerio from 'cheerio';
import { pool } from '../db.js';
import { fetchStealthHtml } from '../scraper/httpClient.js';
import { parseListingDetail, extractSearchListingLinks } from '../scraper/parser.js';
import { validateListing } from '../scraper/validator.js';
import { upsertParsedListing } from '../scraper/engine.js';

/**
 * Supported reputable portals for original listing resolution.
 * mietsofort.de is strictly excluded.
 */
const ALLOWED_ORIGINAL_DOMAINS = [
  'kleinanzeigen.de',
  'immowelt.de',
  'immowelt.at',
  'immonet.de',
  'immobilienscout24.de',
  'ggw-gelsenkirchen.de',
  'vonovia.de',
  'vivawest.de',
  'leg-wohnen.de',
  'ohne-makler.net',
  'quoka.de',
  'meinestadt.de',
];

/**
 * Ensures the mietsofort_leads table exists for tracking and caching leads.
 */
export async function ensureLeadTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mietsofort_leads (
      id SERIAL PRIMARY KEY,
      lead_id VARCHAR(100) UNIQUE NOT NULL,
      title TEXT,
      cold_rent NUMERIC(10,2),
      sqm NUMERIC(10,2),
      rooms NUMERIC(5,1),
      district VARCHAR(100),
      zipcode VARCHAR(20),
      locality_raw TEXT,
      status VARCHAR(50) NOT NULL,
      original_url TEXT,
      original_listing_id UUID REFERENCES listings(id) ON DELETE SET NULL,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_mietsofort_leads_status ON mietsofort_leads (status);
    CREATE INDEX IF NOT EXISTS idx_mietsofort_leads_created_at ON mietsofort_leads (created_at DESC);
  `);
}

/**
 * Resolves DuckDuckGo redirect link (//duckduckgo.com/l/?uddg=...) into real target URL.
 */
function decodeDuckDuckGoLink(href) {
  if (!href) return null;
  try {
    if (href.startsWith('//')) href = `https:${href}`;
    const u = new URL(href, 'https://duckduckgo.com');
    const uddg = u.searchParams.get('uddg');
    if (uddg) return decodeURIComponent(uddg);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      return u.toString();
    }
  } catch {
    // ignore invalid URLs
  }
  return null;
}

/**
 * Searches DuckDuckGo for potential original listing URLs on reputable portals.
 */
async function searchWebForOriginalUrls(query, { proxyUrl = null } = {}) {
  const targetUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    const res = await fetchStealthHtml(targetUrl, { preferDesktop: true, proxyUrl });
    if (res.statusCode >= 400 || !res.html) return [];

    const $ = cheerio.load(res.html);
    const discovered = [];
    const seen = new Set();

    $('a.result__url, a.result__snippet, .result__body a').each((_, el) => {
      const rawHref = $(el).attr('href');
      const cleanUrl = decodeDuckDuckGoLink(rawHref);
      if (!cleanUrl) return;

      const lower = cleanUrl.toLowerCase();
      if (lower.includes('mietsofort.de') || lower.includes('rentola.')) {
        return; // strictly banned
      }

      const isAllowedDomain = ALLOWED_ORIGINAL_DOMAINS.some((d) => lower.includes(d));
      if (!isAllowedDomain) return;

      // Filter to actual listing detail / expose URLs, not generic overview searches
      const isExposePattern =
        lower.includes('/expose/') ||
        lower.includes('/s-anzeige/') ||
        lower.includes('/angebot/') ||
        lower.includes('/object/') ||
        lower.includes('/detail/') ||
        /\/\d{7,}/.test(lower);

      if (isExposePattern && !seen.has(cleanUrl)) {
        seen.add(cleanUrl);
        discovered.push(cleanUrl);
      }
    });

    return discovered;
  } catch (err) {
    console.warn(`[LeadResolver] Web-Suche fehlgeschlagen ("${query}"):`, err.message);
    return [];
  }
}

/**
 * Fallback: Searches Kleinanzeigen directly for apartments matching sqm and cold rent range.
 */
async function searchKleinanzeigenForOriginalUrls(lead, targetCity = 'Gelsenkirchen', { proxyUrl = null } = {}) {
  if (!lead.sqm || !lead.cold_rent) return [];
  const minSqm = Math.max(15, Math.floor(lead.sqm - 1));
  const maxSqm = Math.ceil(lead.sqm + 1);
  const minPrice = Math.max(100, Math.floor(lead.cold_rent - 5));
  const maxPrice = Math.ceil(lead.cold_rent + 5);

  const searchUrl = `https://www.kleinanzeigen.de/s-wohnung-mieten/gelsenkirchen/c203l1994+wohnung_mieten.qm_d:${minSqm}%2C${maxSqm}+wohnung_mieten.preis_d:${minPrice}%2C${maxPrice}`;

  try {
    const res = await fetchStealthHtml(searchUrl, { preferDesktop: true, proxyUrl });
    if (res.statusCode >= 400 || !res.html) return [];

    const candidates = extractSearchListingLinks(res.html, searchUrl, 'kleinanzeigen', targetCity);
    return candidates.map((c) => c.url).filter(Boolean);
  } catch (err) {
    console.warn(`[LeadResolver] Kleinanzeigen-Direktsuche fehlgeschlagen:`, err.message);
    return [];
  }
}

/**
 * Resolves a Mietsofort lead into an original listing.
 *
 * @param {object} lead - Parsed lead item from Mietsofort RPC
 * @param {string} targetCity - e.g. 'Gelsenkirchen'
 * @param {Array} rules - KdU rules for target city
 * @param {object} options - { zipPrefixes, proxyUrl }
 */
export async function resolveMietsofortLead(
  lead,
  targetCity = 'Gelsenkirchen',
  rules,
  { zipPrefixes = null, proxyUrl = null } = {}
) {
  if (!lead || !lead.external_id) {
    return { resolved: false, reason: 'invalid_lead_object' };
  }

  const leadId = lead.external_id;
  const coldRent = Number(lead.cold_rent) || 0;
  const sqm = Number(lead.sqm) || 0;
  const rooms = Number(lead.rooms) || 0;
  const district = lead.district || '';
  const zipcode = lead.zipcode || '';
  const localityRaw = lead.locality_raw || '';
  const title = lead.title || '';

  // 1. Check mietsofort_leads table cache
  try {
    const { rows: cacheRows } = await pool.query(
      `SELECT status, original_url FROM mietsofort_leads WHERE lead_id = $1 LIMIT 1`,
      [leadId]
    );
    if (cacheRows.length > 0) {
      const cached = cacheRows[0];
      if (['matched_existing', 'resolved_original', 'unresolved_discarded'].includes(cached.status)) {
        return {
          resolved: cached.status === 'resolved_original',
          reason: `cached_${cached.status}`,
          originalUrl: cached.original_url,
        };
      }
    }
  } catch {
    // If table doesn't exist yet, ensure and proceed
    await ensureLeadTables();
  }

  // Stufe 1: Interner DB-Abgleich
  // "Prüfe zuerst, ob wir das Originalinserat über unsere anderen Scraper bereits in der PostgreSQL-DB haben
  // (Toleranz: Fläche ±1 m², Kaltmiete ±5 € und Stadtteil/Straße)."
  if (sqm > 0 && coldRent > 0) {
    try {
      const { rows: dbMatches } = await pool.query(
        `SELECT id, external_id, title, url, cold_rent, additional_costs, calculated_bruttokalt, sqm, rooms, district, zipcode
         FROM listings
         WHERE city = $1
           AND status = 'active'
           AND url NOT LIKE '%mietsofort.de%'
           AND external_id NOT LIKE 'ms_%'
           AND ABS(sqm - $2) <= 1.0
           AND ABS(cold_rent - $3) <= 5.0
           AND (
             ($4 <> '' AND district IS NOT NULL AND LOWER(district) = LOWER($4))
             OR ($5 <> '' AND zipcode IS NOT NULL AND zipcode = $5)
           )
         LIMIT 1`,
        [targetCity, sqm, coldRent, district, zipcode]
      );

      if (dbMatches.length > 0) {
        const existing = dbMatches[0];
        await pool.query(
          `INSERT INTO mietsofort_leads (lead_id, title, cold_rent, sqm, rooms, district, zipcode, locality_raw, status, original_url, original_listing_id, notes, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'matched_existing', $9, $10, $11, NOW())
           ON CONFLICT (lead_id) DO UPDATE SET
             status = 'matched_existing',
             original_url = EXCLUDED.original_url,
             original_listing_id = EXCLUDED.original_listing_id,
             updated_at = NOW()`,
          [
            leadId,
            title,
            coldRent,
            sqm,
            rooms,
            district,
            zipcode,
            localityRaw,
            existing.url,
            existing.id,
            `Original bereits in DB: ${existing.external_id} (${existing.title})`,
          ]
        );

        console.log(
          `[LeadResolver] Stufe 1 Treffer: Original existiert bereits in DB (${existing.external_id} - ${existing.url}). Lead verworfen.`
        );
        return { resolved: false, reason: 'already_in_db', existing };
      }
    } catch (err) {
      console.warn(`[LeadResolver] Fehler beim internen DB-Abgleich:`, err.message);
    }
  }

  // Stufe 2: Gezielte Original-Suche auf seriösen Portalen
  // "Falls das Inserat noch nicht in unserer DB ist, nutze die extrahierten Eckdaten,
  // um gezielt nach dem Originalinserat auf seriösen Portalen zu suchen und dessen Exposé zu scrapen."
  const cleanStreetMatch = localityRaw.match(/^([^,]+)/);
  const cleanStreet = cleanStreetMatch && !cleanStreetMatch[1].toLowerCase().includes('gelsenkirchen')
    ? cleanStreetMatch[1].trim()
    : '';

  const searchCandidateUrls = new Set();

  // Query 1: Mit Straßenname falls bekannt
  if (cleanStreet) {
    const urls = await searchWebForOriginalUrls(`"${cleanStreet}" ${targetCity} mieten`, { proxyUrl });
    urls.forEach((u) => searchCandidateUrls.add(u));
  }

  // Query 2: Mit Stadtteil / PLZ, Quadratmeter und Kaltmiete
  if (searchCandidateUrls.size === 0 && (district || zipcode) && sqm > 0 && coldRent > 0) {
    const query = `"${district || zipcode}" ${rooms ? `${rooms} Zimmer ` : ''}${Math.round(sqm)} m² ${Math.round(coldRent)} € ${targetCity} mieten`;
    const urls = await searchWebForOriginalUrls(query, { proxyUrl });
    urls.forEach((u) => searchCandidateUrls.add(u));
  }

  // Query 3: Kleinanzeigen-Direktsuche als Fallback
  if (searchCandidateUrls.size === 0 && sqm > 0 && coldRent > 0) {
    const urls = await searchKleinanzeigenForOriginalUrls(lead, targetCity, { proxyUrl });
    urls.forEach((u) => searchCandidateUrls.add(u));
  }

  // Examine top candidate expose URLs (max 4 to preserve rate limits)
  const candidateUrlsList = Array.from(searchCandidateUrls).slice(0, 4);

  for (const candidateUrl of candidateUrlsList) {
    try {
      const lower = candidateUrl.toLowerCase();
      if (lower.includes('mietsofort.de') || lower.includes('rentola.')) {
        continue; // strictly forbidden
      }

      let portal = 'other';
      if (lower.includes('kleinanzeigen.de')) portal = 'kleinanzeigen';
      else if (lower.includes('immowelt.')) portal = 'immowelt';
      else if (lower.includes('immoscout') || lower.includes('immobilienscout24')) portal = 'immoscout';

      const detailRes = await fetchStealthHtml(candidateUrl, { preferDesktop: true, proxyUrl });
      if (detailRes.statusCode >= 400 || !detailRes.html) continue;

      const parsed = parseListingDetail(
        detailRes.html,
        detailRes.finalUrl || candidateUrl,
        portal,
        targetCity
      );

      if (!parsed || !parsed.cold_rent || !parsed.sqm) continue;

      // Tolerance checks: sqm ±1.5 m², cold rent ±10 €
      const sqmDiff = Math.abs(parsed.sqm - sqm);
      const rentDiff = Math.abs(parsed.cold_rent - coldRent);
      if (sqmDiff > 1.5 || rentDiff > 10.0) {
        continue;
      }

      // Location check: must match district or zipcode or street
      const parsedLoc = `${parsed.locality_raw || ''} ${parsed.district || ''} ${parsed.zipcode || ''}`.toLowerCase();
      const leadLoc = `${localityRaw} ${district} ${zipcode}`.toLowerCase();
      const hasLocationMatch =
        (district && parsedLoc.includes(district.toLowerCase())) ||
        (zipcode && parsed.zipcode === zipcode) ||
        (cleanStreet && parsedLoc.includes(cleanStreet.toLowerCase()));

      if (!hasLocationMatch) {
        continue;
      }

      // Stufe 3: Vollständigkeits-Check & Freigabe
      // "Nur wenn das Originalinserat erfolgreich gefunden wurde und die vollständigen Mietdaten
      // (insbesondere Kaltmiete + Nebenkosten) vorliegen, wird das Listing mit dem Original-Link
      // gespeichert und für die KdU-Prüfung freigegeben."
      const hasCompleteRentData =
        parsed.cold_rent > 0 &&
        parsed.additional_costs !== null &&
        parsed.additional_costs !== undefined &&
        Number(parsed.additional_costs) > 0;

      if (!hasCompleteRentData) {
        console.log(
          `[LeadResolver] Kandidat ${candidateUrl} verworfen: Unvollständige Nebenkosten (Kalt: ${parsed.cold_rent}, NK: ${parsed.additional_costs}).`
        );
        continue;
      }

      // Validate against strict geofence and constraints
      const validation = validateListing(parsed, targetCity, { zipPrefixes });
      if (!validation.valid) {
        console.log(
          `[LeadResolver] Kandidat ${candidateUrl} Validierung fehlgeschlagen: ${validation.reason}`
        );
        continue;
      }

      // Save original listing to DB!
      const saved = await upsertParsedListing(parsed, rules);
      if (saved) {
        await pool.query(
          `INSERT INTO mietsofort_leads (lead_id, title, cold_rent, sqm, rooms, district, zipcode, locality_raw, status, original_url, original_listing_id, notes, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'resolved_original', $9, $10, $11, NOW())
           ON CONFLICT (lead_id) DO UPDATE SET
             status = 'resolved_original',
             original_url = EXCLUDED.original_url,
             original_listing_id = EXCLUDED.original_listing_id,
             updated_at = NOW()`,
          [
            leadId,
            title,
            coldRent,
            sqm,
            rooms,
            district,
            zipcode,
            localityRaw,
            parsed.url,
            saved.id,
            `Erfolgreich aufgelöst auf ${parsed.portal} (${parsed.url})`,
          ]
        );

        console.log(
          `[LeadResolver] Stufe 2 ERFOLG: Original für Lead ${leadId} gefunden! -> ${parsed.url} (Kalt: ${parsed.cold_rent} €, NK: ${parsed.additional_costs} €). Freigegeben.`
        );
        return { resolved: true, originalListing: parsed };
      }
    } catch (candErr) {
      console.warn(`[LeadResolver] Fehler beim Parsen von Kandidat ${candidateUrl}:`, candErr.message);
    }
  }

  // Wird kein Originalinserat gefunden, wird der mietsofort.de-Lead verworfen und niemals veröffentlicht.
  await pool.query(
    `INSERT INTO mietsofort_leads (lead_id, title, cold_rent, sqm, rooms, district, zipcode, locality_raw, status, original_url, notes, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'unresolved_discarded', NULL, $9, NOW())
     ON CONFLICT (lead_id) DO UPDATE SET
       status = 'unresolved_discarded',
       updated_at = NOW()`,
    [
      leadId,
      title,
      coldRent,
      sqm,
      rooms,
      district,
      zipcode,
      localityRaw,
      'Kein vollständiges Originalinserat mit Kaltmiete + Nebenkosten ermittelbar.',
    ]
  );

  console.log(`[LeadResolver] Kein vollständiges Original für Lead ${leadId} gefunden. Lead verworfen.`);
  return { resolved: false, reason: 'unresolved_discarded' };
}
