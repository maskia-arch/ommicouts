import { pool } from '../db.js';
import { fetchStealthHtml } from '../scraper/httpClient.js';
import { reloadSchedules } from '../scraper/scheduler.js';
import {
  deriveSearchMaxRentFromRules,
  fetchAndPreviewKduFromUrl,
} from './kduUpdater.js';

export function toCitySlug(city) {
  return String(city || '')
    .trim()
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function resolveKleinanzeigenLocationId(city) {
  try {
    const url = `https://www.kleinanzeigen.de/s-ort-empfehlungen.json?query=${encodeURIComponent(city)}`;
    const res = await fetchStealthHtml(url, { preferDesktop: true, timeoutMs: 12000 });
    if (res.statusCode >= 400) return null;
    const data = JSON.parse(res.html);
    const lowerCity = city.trim().toLowerCase();

    // Prefer exact city match like "_1932": "Bochum - Nordrhein-Westfalen"
    for (const [key, label] of Object.entries(data)) {
      if (key === '_0') continue;
      const cleanLabel = String(label || '').toLowerCase();
      if (cleanLabel.startsWith(`${lowerCity} -`) || cleanLabel === lowerCity) {
        return key.replace(/^_/, '');
      }
    }

    // Fallback to first non-Germany match
    for (const [key] of Object.entries(data)) {
      if (key !== '_0' && /^_\d+$/.test(key)) {
        return key.replace(/^_/, '');
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function resolveImmoweltSearchUrl(citySlug, maxRent) {
  const listUrl = `https://www.immowelt.de/liste/${citySlug}/wohnungen/mieten`;
  try {
    const res = await fetchStealthHtml(listUrl, { preferDesktop: true, timeoutMs: 15000 });
    if (res.statusCode < 400 && res.finalUrl && res.finalUrl.includes('immowelt.de')) {
      const u = new URL(res.finalUrl);
      u.searchParams.set('priceMax', String(maxRent));
      u.searchParams.set('distributionTypes', 'Rent');
      u.searchParams.set('estateTypes', 'Apartment');
      u.searchParams.set('order', 'DateDesc');
      return u.toString();
    }
  } catch {
    // fallback below
  }
  return `${listUrl}?pma=${maxRent}&sd=DESC&sf=TIMESTAMP`;
}

async function resolveOhneMaklerSearchUrl(citySlug) {
  const states = ['nordrhein-westfalen', 'niedersachsen', 'hessen', 'bayern', 'baden-wuerttemberg', 'berlin', 'hamburg'];
  for (const state of states) {
    const url = `https://www.ohne-makler.net/immobilien/wohnung-mieten/${state}/${citySlug}/`;
    try {
      const res = await fetchStealthHtml(url, { preferDesktop: true, timeoutMs: 7000 });
      if (res.statusCode === 200 && res.html.includes('/immobilie/')) {
        return url;
      }
    } catch {
      // try next
    }
  }
  return null;
}

export async function generateSearchConfigsForCity(city, maxRentEur) {
  const cleanCity = String(city || '').trim();
  const slug = toCitySlug(cleanCity);
  const maxRent = Math.max(400, Math.round(Number(maxRentEur) || 850));

  const kaLocId = await resolveKleinanzeigenLocationId(cleanCity);
  const iwUrl = await resolveImmoweltSearchUrl(slug, maxRent);
  const omUrl = await resolveOhneMaklerSearchUrl(slug);

  const candidates = [];
  if (kaLocId) {
    candidates.push({
      portal: 'kleinanzeigen',
      city: cleanCity,
      name: `${cleanCity} Kleinanzeigen (Angebote, 150-${maxRent} EUR, ab 20m², ab 1 Zi.)`,
      search_url: `https://www.kleinanzeigen.de/s-wohnung-mieten/${slug}/anzeige:angebote/preis:150:${maxRent}/c203l${kaLocId}+wohnung_mieten.qm_d:20,+wohnung_mieten.zimmer_d:1,0?sortingField=SORTING_DATE`,
      cron_expression: '*/20 * * * *',
      is_active: true,
    });
    candidates.push({
      portal: 'kleinanzeigen',
      city: cleanCity,
      name: `${cleanCity} Kleinanzeigen Privatvermieter (Angebote, 150-${maxRent} EUR)`,
      search_url: `https://www.kleinanzeigen.de/s-wohnung-mieten/${slug}/anzeige:angebote/anbieter:privat/preis:150:${maxRent}/c203l${kaLocId}+wohnung_mieten.qm_d:20,+wohnung_mieten.zimmer_d:1,0?sortingField=SORTING_DATE`,
      cron_expression: '*/20 * * * *',
      is_active: true,
    });
    candidates.push({
      portal: 'kleinanzeigen',
      city: cleanCity,
      name: `${cleanCity} Kleinanzeigen WBS-Wohnungen (Angebote, 150-${maxRent} EUR)`,
      search_url: `https://www.kleinanzeigen.de/s-wohnung-mieten/${slug}/anzeige:angebote/preis:150:${maxRent}/wbs/k0c203l${kaLocId}?sortingField=SORTING_DATE`,
      cron_expression: '*/30 * * * *',
      is_active: true,
    });
  }

  candidates.push({
    portal: 'immowelt',
    city: cleanCity,
    name: `${cleanCity} Immowelt (Angebote bis ${maxRent} EUR, Neueste, Radius 0)`,
    search_url: iwUrl,
    cron_expression: '*/20 * * * *',
    is_active: true,
  });

  if (omUrl) {
    candidates.push({
      portal: 'other',
      city: cleanCity,
      name: `${cleanCity} Ohne-Makler.net (100% Privatvermieter)`,
      search_url: omUrl,
      cron_expression: '*/30 * * * *',
      is_active: true,
    });
  }

  candidates.push({
    portal: 'immoscout',
    city: cleanCity,
    name: `${cleanCity} ImmoScout24 (Optional mit Proxy aktivierbar, bis ${maxRent} EUR)`,
    search_url: `https://www.immobilienscout24.de/Suche/de/nordrhein-westfalen/${slug}/wohnung-mieten?price=-${maxRent}.0&sorting=2`,
    cron_expression: '*/30 * * * *',
    is_active: false,
  });

  const created = [];
  for (const c of candidates) {
    const { rows } = await pool.query(
      `INSERT INTO scraper_configs (portal, city, name, search_url, cron_expression, jitter_min_ms, jitter_max_ms, is_active)
       VALUES ($1, $2, $3, $4, $5, 4000, 15000, $6)
       ON CONFLICT (portal, search_url) DO UPDATE SET
         city = EXCLUDED.city,
         name = EXCLUDED.name,
         updated_at = NOW()
       RETURNING *`,
      [c.portal, c.city, c.name, c.search_url, c.cron_expression || '*/20 * * * *', c.is_active ?? true]
    );
    created.push(rows[0]);
  }

  await reloadSchedules();
  return {
    kleinanzeigenLocationId: kaLocId,
    createdConfigs: created,
  };
}

export async function onboardCity({
  city,
  zip_prefixes = null,
  source_url = null,
  auto_sync_enabled = false,
  sync_cron = '0 4 * * *',
  search_max_rent_eur = null,
  rules = null,
  auto_create_scrapers = true,
}) {
  const cleanCity = String(city || '').trim();
  if (!cleanCity) {
    throw new Error('Stadtname darf nicht leer sein.');
  }

  let resolvedRules = Array.isArray(rules) && rules.length > 0 ? rules : null;

  if (!resolvedRules && source_url) {
    const fetched = await fetchAndPreviewKduFromUrl(source_url);
    if (!fetched.ok) {
      throw new Error(`KdU-URL konnte nicht geparst werden: ${fetched.error}`);
    }
    resolvedRules = fetched.rules;
  }

  if (!resolvedRules || resolvedRules.length === 0) {
    throw new Error('Bitte mindestens KdU-Werte eingeben oder eine gültige KdU-Quell-URL angeben.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of resolvedRules) {
      await client.query(
        `INSERT INTO kdu_rules (city, bg_size, max_sqm, max_bruttokalt_eur, extra_person_sqm, extra_person_eur, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (city, bg_size) DO UPDATE SET
           max_sqm = EXCLUDED.max_sqm,
           max_bruttokalt_eur = EXCLUDED.max_bruttokalt_eur,
           extra_person_sqm = EXCLUDED.extra_person_sqm,
           extra_person_eur = EXCLUDED.extra_person_eur,
           updated_at = NOW()`,
        [
          cleanCity,
          parseInt(r.bg_size, 10),
          Number(r.max_sqm),
          Number(r.max_bruttokalt_eur),
          Number(r.extra_person_sqm ?? 15),
          Number(r.extra_person_eur ?? 116.6),
        ]
      );
    }

    const derivedCap = search_max_rent_eur
      ? Number(search_max_rent_eur)
      : deriveSearchMaxRentFromRules(resolvedRules);

    await client.query(
      `INSERT INTO kdu_sources (city, source_url, zip_prefixes, search_max_rent_eur, auto_sync_enabled, sync_cron, last_synced_at, last_sync_status, last_sync_message, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, NOW())
       ON CONFLICT (city) DO UPDATE SET
         source_url = COALESCE(EXCLUDED.source_url, kdu_sources.source_url),
         zip_prefixes = COALESCE(EXCLUDED.zip_prefixes, kdu_sources.zip_prefixes),
         search_max_rent_eur = EXCLUDED.search_max_rent_eur,
         auto_sync_enabled = EXCLUDED.auto_sync_enabled,
         sync_cron = EXCLUDED.sync_cron,
         last_synced_at = NOW(),
         last_sync_status = EXCLUDED.last_sync_status,
         last_sync_message = EXCLUDED.last_sync_message,
         updated_at = NOW()`,
      [
        cleanCity,
        source_url ? String(source_url).trim() : null,
        zip_prefixes ? String(zip_prefixes).trim() : null,
        derivedCap,
        Boolean(auto_sync_enabled && source_url),
        sync_cron || '0 4 * * *',
        source_url ? 'success' : 'manual',
        source_url
          ? `${resolvedRules.length} Stufen aus URL geladen`
          : `${resolvedRules.length} Stufen manuell gespeichert`,
      ]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const finalCap = search_max_rent_eur
    ? Number(search_max_rent_eur)
    : deriveSearchMaxRentFromRules(resolvedRules);

  let scraperResult = { createdConfigs: [] };
  if (auto_create_scrapers) {
    scraperResult = await generateSearchConfigsForCity(cleanCity, finalCap);
  } else {
    await reloadSchedules();
  }

  return {
    ok: true,
    city: cleanCity,
    rulesCount: resolvedRules.length,
    searchMaxRentEur: finalCap,
    ...scraperResult,
  };
}
