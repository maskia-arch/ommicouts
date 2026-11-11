import { Router } from 'express';
import { cleanupInvalidListings, pool } from '../db.js';
import { requireAdminKey } from '../middleware/auth.js';
import {
  crawlSingleUrl,
  getEngineStatus,
  runDeltaPoll,
  runReconciler,
} from '../scraper/engine.js';
import { reloadSchedules } from '../scraper/scheduler.js';
import {
  notifyWatchersListingChanged,
  notifyWatchersListingDeleted,
} from '../services/notifications.js';
import {
  computeBruttokalt,
  findMatchedMinBgSize,
  getRulesForCity,
  recalculateAllListings,
} from '../services/kduMatcher.js';
import {
  deriveSearchMaxRentFromRules,
  fetchAndPreviewKduFromUrl,
  syncAllAutoKduSources,
  syncKduSourceForCity,
  updateCityScraperPriceCaps,
} from '../services/kduUpdater.js';
import {
  generateSearchConfigsForCity,
  onboardCity,
} from '../services/cityOnboarding.js';
import {
  generateOrgLicenseKey,
  hashOrgKey,
  hashPassword,
  isValidEmail,
  normalizeEmail,
  normalizeLinkedPortals,
  sanitizeUser,
  USER_WITH_ORG_SELECT,
} from '../services/userAuth.js';

const router = Router();
router.use(requireAdminKey);

// ------------------------------------------------------------------------------
// Overview & Telemetry
// ------------------------------------------------------------------------------
router.get('/overview', async (_req, res) => {
  try {
    const statsRes = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'active')::int AS active_total,
        COUNT(*) FILTER (WHERE status = 'active' AND LOWER(city) = 'gelsenkirchen')::int AS active_ge,
        COUNT(*) FILTER (WHERE status = 'active' AND LOWER(city) = 'gelsenkirchen' AND is_private_landlord = TRUE)::int AS private_ge,
        COUNT(*) FILTER (WHERE status = 'active' AND is_private_landlord = TRUE)::int AS private_total,
        COUNT(*) FILTER (WHERE status = 'offline')::int AS offline_total,
        COUNT(*) FILTER (WHERE status = 'manual_hidden')::int AS hidden_total,
        COUNT(*) FILTER (WHERE status = 'active' AND matched_min_bg_size = 1)::int AS bg1_matches,
        (SELECT COUNT(*)::int FROM listing_reports WHERE status = 'open') AS open_reports_count,
        (SELECT COUNT(*)::int FROM organization_keys WHERE status = 'active' AND (is_unlimited = TRUE OR expires_at IS NULL OR expires_at > NOW())) AS active_org_keys_count
      FROM listings
    `);

    const logsRes = await pool.query(`
      SELECT l.*, c.name AS config_name
      FROM scraper_logs l
      LEFT JOIN scraper_configs c ON c.id = l.config_id
      ORDER BY l.started_at DESC
      LIMIT 25
    `);

    const configsRes = await pool.query(`
      SELECT id, portal, city, name, is_active, cron_expression
      FROM scraper_configs
      ORDER BY id ASC
    `);

    return res.json({
      stats: statsRes.rows[0],
      engine: getEngineStatus(),
      configs: configsRes.rows,
      recentLogs: logsRes.rows,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------------------
// KdU Rules Management
// ------------------------------------------------------------------------------
router.get('/kdu', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, city, bg_size, max_sqm, max_bruttokalt_eur, extra_person_sqm, extra_person_eur, updated_at
       FROM kdu_rules
       ORDER BY city ASC, bg_size ASC`
    );
    return res.json({ rules: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/kdu', async (req, res) => {
  try {
    const {
      city = 'Gelsenkirchen',
      bg_size,
      max_sqm,
      max_bruttokalt_eur,
      extra_person_sqm = 15.0,
      extra_person_eur = 116.6,
    } = req.body;

    if (!bg_size || max_sqm === undefined || max_bruttokalt_eur === undefined) {
      return res.status(400).json({ error: 'bg_size, max_sqm und max_bruttokalt_eur sind Pflichtfelder.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO kdu_rules (city, bg_size, max_sqm, max_bruttokalt_eur, extra_person_sqm, extra_person_eur, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (city, bg_size) DO UPDATE SET
         max_sqm = EXCLUDED.max_sqm,
         max_bruttokalt_eur = EXCLUDED.max_bruttokalt_eur,
         extra_person_sqm = EXCLUDED.extra_person_sqm,
         extra_person_eur = EXCLUDED.extra_person_eur,
         updated_at = NOW()
       RETURNING *`,
      [
        String(city).trim(),
        parseInt(bg_size, 10),
        Number(max_sqm),
        Number(max_bruttokalt_eur),
        Number(extra_person_sqm),
        Number(extra_person_eur),
      ]
    );

    return res.status(201).json({ rule: rows[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.put('/kdu/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const {
      city,
      bg_size,
      max_sqm,
      max_bruttokalt_eur,
      extra_person_sqm,
      extra_person_eur,
    } = req.body;

    const { rows } = await pool.query(
      `UPDATE kdu_rules
       SET city = COALESCE($1, city),
           bg_size = COALESCE($2, bg_size),
           max_sqm = COALESCE($3, max_sqm),
           max_bruttokalt_eur = COALESCE($4, max_bruttokalt_eur),
           extra_person_sqm = COALESCE($5, extra_person_sqm),
           extra_person_eur = COALESCE($6, extra_person_eur),
           updated_at = NOW()
       WHERE id = $7
       RETURNING *`,
      [
        city !== undefined ? String(city).trim() : null,
        bg_size !== undefined ? parseInt(bg_size, 10) : null,
        max_sqm !== undefined ? Number(max_sqm) : null,
        max_bruttokalt_eur !== undefined ? Number(max_bruttokalt_eur) : null,
        extra_person_sqm !== undefined ? Number(extra_person_sqm) : null,
        extra_person_eur !== undefined ? Number(extra_person_eur) : null,
        id,
      ]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'KdU-Regel nicht gefunden.' });
    }
    return res.json({ rule: rows[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/kdu/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { rowCount } = await pool.query(`DELETE FROM kdu_rules WHERE id = $1`, [id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'KdU-Regel nicht gefunden.' });
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/kdu/recalculate', async (req, res) => {
  try {
    const city = req.body?.city ? String(req.body.city).trim() : null;
    const result = await recalculateAllListings(city);
    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------------------
// Multi-City Onboarding & 24h KdU-URL Auto-Sync
// ------------------------------------------------------------------------------
router.get('/cities', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        COALESCE(ks.city, kr.city) AS city,
        ks.source_url,
        ks.zip_prefixes,
        ks.search_max_rent_eur,
        COALESCE(ks.auto_sync_enabled, FALSE) AS auto_sync_enabled,
        COALESCE(ks.sync_cron, '0 4 * * *') AS sync_cron,
        ks.last_synced_at,
        ks.last_sync_status,
        ks.last_sync_message,
        COALESCE(kr.rules_count, 0)::int AS rules_count,
        COALESCE(sc.scrapers_count, 0)::int AS scrapers_count,
        COALESCE(sc.active_scrapers_count, 0)::int AS active_scrapers_count
      FROM kdu_sources ks
      FULL OUTER JOIN (
        SELECT city, COUNT(*) AS rules_count
        FROM kdu_rules
        GROUP BY city
      ) kr ON LOWER(kr.city) = LOWER(ks.city)
      LEFT JOIN (
        SELECT city,
               COUNT(*) AS scrapers_count,
               COUNT(*) FILTER (WHERE is_active = TRUE) AS active_scrapers_count
        FROM scraper_configs
        GROUP BY city
      ) sc ON LOWER(sc.city) = LOWER(COALESCE(ks.city, kr.city))
      ORDER BY COALESCE(ks.city, kr.city) ASC
    `);
    return res.json({ cities: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/cities', async (req, res) => {
  try {
    const result = await onboardCity(req.body || {});
    return res.status(201).json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post('/cities/:city/generate-scrapers', async (req, res) => {
  try {
    const cleanCity = String(req.params.city || '').trim();
    if (!cleanCity) {
      return res.status(400).json({ error: 'Stadtname fehlt.' });
    }

    let maxRent = req.body?.search_max_rent_eur ? Number(req.body.search_max_rent_eur) : null;
    if (!maxRent || !Number.isFinite(maxRent)) {
      const rules = await getRulesForCity(cleanCity);
      if (rules.length > 0) {
        maxRent = deriveSearchMaxRentFromRules(rules);
      } else {
        const srcRes = await pool.query(
          `SELECT search_max_rent_eur FROM kdu_sources WHERE LOWER(city) = LOWER($1)`,
          [cleanCity]
        );
        maxRent = Number(srcRes.rows[0]?.search_max_rent_eur) || 850;
      }
    }

    await pool.query(
      `INSERT INTO kdu_sources (city, search_max_rent_eur, last_sync_status, last_sync_message)
       VALUES ($1, $2, 'manual', 'Suchaufträge an örtliche KdU angepasst')
       ON CONFLICT (city) DO UPDATE SET
         search_max_rent_eur = EXCLUDED.search_max_rent_eur,
         updated_at = NOW()`,
      [cleanCity, maxRent]
    );

    const updatedScrapers = await updateCityScraperPriceCaps(cleanCity, maxRent);
    const generated = await generateSearchConfigsForCity(cleanCity, maxRent);

    return res.json({
      ok: true,
      city: cleanCity,
      maxRent,
      updatedScrapers,
      ...generated,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.put('/kdu/source/:city', async (req, res) => {
  try {
    const cleanCity = String(req.params.city || '').trim();
    if (!cleanCity) {
      return res.status(400).json({ error: 'Stadtname fehlt.' });
    }

    const {
      source_url = null,
      zip_prefixes = null,
      search_max_rent_eur = null,
      auto_sync_enabled = false,
      sync_cron = '0 4 * * *',
      update_scrapers = true,
    } = req.body || {};

    const cleanUrl = source_url ? String(source_url).trim() : null;
    const cleanPrefixes = zip_prefixes ? String(zip_prefixes).trim() : null;
    const cap = search_max_rent_eur ? Number(search_max_rent_eur) : null;

    const { rows } = await pool.query(
      `INSERT INTO kdu_sources (city, source_url, zip_prefixes, search_max_rent_eur, auto_sync_enabled, sync_cron, updated_at)
       VALUES ($1, $2, $3, COALESCE($4, 850.00), $5, $6, NOW())
       ON CONFLICT (city) DO UPDATE SET
         source_url = $2,
         zip_prefixes = $3,
         search_max_rent_eur = COALESCE($4, kdu_sources.search_max_rent_eur),
         auto_sync_enabled = $5,
         sync_cron = $6,
         updated_at = NOW()
       RETURNING *`,
      [
        cleanCity,
        cleanUrl,
        cleanPrefixes,
        Number.isFinite(cap) ? cap : null,
        Boolean(auto_sync_enabled && cleanUrl),
        String(sync_cron || '0 4 * * *').trim() || '0 4 * * *',
      ]
    );

    let scrapersUpdated = 0;
    if (update_scrapers && Number.isFinite(cap) && cap >= 400) {
      scrapersUpdated = await updateCityScraperPriceCaps(cleanCity, cap);
    }

    await reloadSchedules();
    return res.json({ ok: true, source: rows[0], scrapersUpdated });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/kdu/preview-url', async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url) {
      return res.status(400).json({ error: 'Bitte eine URL angeben.' });
    }
    const preview = await fetchAndPreviewKduFromUrl(String(url).trim());
    return res.json(preview);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/kdu/sync', async (req, res) => {
  try {
    const city = req.body?.city ? String(req.body.city).trim() : null;
    const result = city ? await syncKduSourceForCity(city) : await syncAllAutoKduSources();
    await reloadSchedules();
    return res.json({ ok: true, result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------------------
// Listings Manager
// ------------------------------------------------------------------------------
router.get('/listings', async (req, res) => {
  try {
    const status = String(req.query.status || 'all').trim();
    const city = String(req.query.city || '').trim();
    const portal = String(req.query.portal || 'all').trim();
    const privateOnly = req.query.private_only === 'true';
    const search = String(req.query.search || '').trim();
    const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '30', 10) || 30));
    const offset = (page - 1) * limit;

    const where = ['1=1'];
    const params = [];
    let idx = 0;

    if (status && status !== 'all') {
      idx++;
      where.push(`status = $${idx}`);
      params.push(status);
    }
    if (city) {
      idx++;
      where.push(`LOWER(city) = LOWER($${idx})`);
      params.push(city);
    }
    if (portal && portal !== 'all') {
      idx++;
      where.push(`portal = $${idx}`);
      params.push(portal);
    }
    if (privateOnly) {
      where.push(`is_private_landlord = TRUE`);
    }
    if (search) {
      idx++;
      where.push(`(title ILIKE $${idx} OR district ILIKE $${idx} OR external_id ILIKE $${idx} OR url ILIKE $${idx})`);
      params.push(`%${search}%`);
    }

    const whereSql = where.join(' AND ');
    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM listings WHERE ${whereSql}`,
      params
    );
    const listRes = await pool.query(
      `SELECT * FROM listings WHERE ${whereSql} ORDER BY last_seen_at DESC LIMIT $${idx + 1} OFFSET $${idx + 2}`,
      [...params, limit, offset]
    );

    return res.json({
      total: countRes.rows[0]?.total || 0,
      page,
      limit,
      items: listRes.rows,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/listings/crawl-url', async (req, res) => {
  try {
    const url = String(req.body?.url || '').trim();
    const city = String(req.body?.city || 'Gelsenkirchen').trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: 'Bitte eine gültige http(s):// URL angeben.' });
    }

    const result = await crawlSingleUrl(url, { runType: 'manual_url', city });
    if (!result.ok) {
      return res.status(422).json({ ok: false, error: result.reason });
    }
    return res.status(201).json({ ok: true, listing: result.listing });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.patch('/listings/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { rows: existingRows } = await pool.query(`SELECT * FROM listings WHERE id = $1`, [id]);
    if (existingRows.length === 0) {
      return res.status(404).json({ error: 'Inserat nicht gefunden.' });
    }
    const existing = existingRows[0];

    const coldRent =
      req.body.cold_rent !== undefined
        ? req.body.cold_rent === null || req.body.cold_rent === ''
          ? null
          : Number(req.body.cold_rent)
        : existing.cold_rent !== null
          ? Number(existing.cold_rent)
          : null;

    const additionalCosts =
      req.body.additional_costs !== undefined
        ? Number(req.body.additional_costs || 0)
        : Number(existing.additional_costs || 0);

    const heatingCosts =
      req.body.heating_costs !== undefined
        ? Number(req.body.heating_costs || 0)
        : Number(existing.heating_costs || 0);

    const city = req.body.city !== undefined ? String(req.body.city).trim() : existing.city;
    const calculatedBruttokalt = computeBruttokalt(coldRent, additionalCosts);
    const rules = await getRulesForCity(city);
    const matchedMinBgSize = findMatchedMinBgSize(calculatedBruttokalt, rules);

    const { rows } = await pool.query(
      `UPDATE listings
       SET title = COALESCE($1, title),
           city = $2,
           district = COALESCE($3, district),
           zipcode = COALESCE($4, zipcode),
           cold_rent = $5,
           additional_costs = $6,
           heating_costs = $7,
           calculated_bruttokalt = $8,
           sqm = COALESCE($9, sqm),
           rooms = COALESCE($10, rooms),
           is_private_landlord = COALESCE($11, is_private_landlord),
           wbs_required = COALESCE($12, wbs_required),
           status = COALESCE($13, status),
           matched_min_bg_size = $14,
           contact_name = CASE WHEN $15::boolean THEN $16 ELSE contact_name END,
           contact_phone = CASE WHEN $17::boolean THEN $18 ELSE contact_phone END,
           contact_email = CASE WHEN $19::boolean THEN $20 ELSE contact_email END
       WHERE id = $21
       RETURNING *`,
      [
        req.body.title !== undefined ? String(req.body.title).trim() : null,
        city,
        req.body.district !== undefined ? String(req.body.district).trim() : null,
        req.body.zipcode !== undefined ? String(req.body.zipcode).trim() : null,
        coldRent,
        additionalCosts,
        heatingCosts,
        calculatedBruttokalt,
        req.body.sqm !== undefined ? (req.body.sqm === null || req.body.sqm === '' ? null : Number(req.body.sqm)) : null,
        req.body.rooms !== undefined ? (req.body.rooms === null || req.body.rooms === '' ? null : Number(req.body.rooms)) : null,
        req.body.is_private_landlord !== undefined ? Boolean(req.body.is_private_landlord) : null,
        req.body.wbs_required !== undefined ? Boolean(req.body.wbs_required) : null,
        req.body.status !== undefined ? String(req.body.status).trim() : null,
        matchedMinBgSize,
        Object.prototype.hasOwnProperty.call(req.body, 'contact_name'),
        req.body.contact_name ? String(req.body.contact_name).trim().slice(0, 175) : null,
        Object.prototype.hasOwnProperty.call(req.body, 'contact_phone'),
        req.body.contact_phone ? String(req.body.contact_phone).trim().slice(0, 75) : null,
        Object.prototype.hasOwnProperty.call(req.body, 'contact_email'),
        req.body.contact_email ? String(req.body.contact_email).trim().slice(0, 175) : null,
        id,
      ]
    );

    const updatedListing = rows[0];
    if (updatedListing.status === 'manual_hidden') {
      await pool.query(
        `INSERT INTO suppressed_listings (external_id, portal, url, title, reason)
         VALUES ($1, $2, $3, $4, 'admin_manual_hidden')
         ON CONFLICT (external_id) DO UPDATE SET reason = 'admin_manual_hidden', created_at = NOW()`,
        [updatedListing.external_id, updatedListing.portal, updatedListing.url, updatedListing.title]
      );
    } else if (req.body.status === 'active') {
      await pool.query(`DELETE FROM suppressed_listings WHERE external_id = $1`, [
        updatedListing.external_id,
      ]);
    }

    await notifyWatchersListingChanged({ before: existing, after: updatedListing });
    return res.json({ listing: updatedListing });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/listings/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { rows: targetRows } = await pool.query(
      `SELECT id, external_id, portal, url, title FROM listings WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (targetRows.length === 0) {
      return res.status(404).json({ error: 'Inserat nicht gefunden.' });
    }
    const target = targetRows[0];

    await pool.query(
      `INSERT INTO suppressed_listings (external_id, portal, url, title, reason)
       VALUES ($1, $2, $3, $4, 'admin_deleted')
       ON CONFLICT (external_id) DO UPDATE SET reason = 'admin_deleted', created_at = NOW()`,
      [target.external_id, target.portal, target.url, target.title]
    );

    await notifyWatchersListingDeleted({ listing: target, reason: 'admin_deleted' });
    await pool.query(`DELETE FROM listings WHERE id = $1`, [id]);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/listings/cleanup', async (_req, res) => {
  try {
    const result = await cleanupInvalidListings();
    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------------------
// Scraper Configs, Manual Run & Logs
// ------------------------------------------------------------------------------
router.get('/scraper/configs', async (_req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM scraper_configs ORDER BY id ASC`);
    return res.json({ configs: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/scraper/configs', async (req, res) => {
  try {
    const {
      portal = 'kleinanzeigen',
      city = 'Gelsenkirchen',
      name,
      search_url,
      cron_expression = '*/20 * * * *',
      jitter_min_ms = 4000,
      jitter_max_ms = 15000,
      proxy_url = null,
      is_active = true,
    } = req.body;

    if (!name || !search_url) {
      return res.status(400).json({ error: 'name und search_url sind Pflichtfelder.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO scraper_configs
         (portal, city, name, search_url, cron_expression, jitter_min_ms, jitter_max_ms, proxy_url, is_active, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       RETURNING *`,
      [
        portal,
        String(city).trim(),
        String(name).trim(),
        String(search_url).trim(),
        String(cron_expression).trim(),
        parseInt(jitter_min_ms, 10) || 4000,
        parseInt(jitter_max_ms, 10) || 15000,
        proxy_url ? String(proxy_url).trim() : null,
        Boolean(is_active),
      ]
    );

    await reloadSchedules();
    return res.status(201).json({ config: rows[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.put('/scraper/configs/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const {
      portal,
      city,
      name,
      search_url,
      cron_expression,
      jitter_min_ms,
      jitter_max_ms,
      proxy_url,
      is_active,
    } = req.body;

    const hasProxyField = Object.prototype.hasOwnProperty.call(req.body, 'proxy_url');

    const { rows } = await pool.query(
      `UPDATE scraper_configs
       SET portal = COALESCE($1, portal),
           city = COALESCE($2, city),
           name = COALESCE($3, name),
           search_url = COALESCE($4, search_url),
           cron_expression = COALESCE($5, cron_expression),
           jitter_min_ms = COALESCE($6, jitter_min_ms),
           jitter_max_ms = COALESCE($7, jitter_max_ms),
           proxy_url = CASE WHEN $8::boolean THEN $9 ELSE proxy_url END,
           is_active = COALESCE($10, is_active),
           updated_at = NOW()
       WHERE id = $11
       RETURNING *`,
      [
        portal ?? null,
        city ?? null,
        name ?? null,
        search_url ?? null,
        cron_expression ?? null,
        jitter_min_ms !== undefined ? parseInt(jitter_min_ms, 10) : null,
        jitter_max_ms !== undefined ? parseInt(jitter_max_ms, 10) : null,
        hasProxyField,
        hasProxyField ? (proxy_url ? String(proxy_url).trim() : null) : null,
        is_active !== undefined ? Boolean(is_active) : null,
        id,
      ]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Scraper-Konfiguration nicht gefunden.' });
    }

    await reloadSchedules();
    return res.json({ config: rows[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/scraper/configs/toggle-all', async (req, res) => {
  try {
    const isActive = Boolean(req.body?.is_active);
    const city = req.body?.city ? String(req.body.city).trim() : null;
    const result = city
      ? await pool.query(
          `UPDATE scraper_configs SET is_active = $1, updated_at = NOW() WHERE LOWER(city) = LOWER($2)`,
          [isActive, city]
        )
      : await pool.query(`UPDATE scraper_configs SET is_active = $1, updated_at = NOW()`, [isActive]);

    await reloadSchedules();
    return res.json({ ok: true, is_active: isActive, updatedCount: result.rowCount || 0 });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/scraper/configs/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { rowCount } = await pool.query(`DELETE FROM scraper_configs WHERE id = $1`, [id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Scraper-Konfiguration nicht gefunden.' });
    }
    await reloadSchedules();
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/scraper/run', async (req, res) => {
  try {
    const mode = req.body?.mode === 'reconcile' ? 'reconcile' : 'delta';
    const configId = req.body?.configId ? parseInt(req.body.configId, 10) : null;
    const status = getEngineStatus();

    if (mode === 'delta' && status.deltaPollRunning) {
      return res.status(409).json({ ok: false, message: 'Delta-Poller läuft bereits.' });
    }
    if (mode === 'reconcile' && status.reconcileRunning) {
      return res.status(409).json({ ok: false, message: 'Reconciler läuft bereits.' });
    }

    // Trigger asynchronously so HTTP request returns immediately without gateway timeouts
    if (mode === 'reconcile') {
      runReconciler({ batchLimit: 80 }).catch((err) =>
        console.error('[Manual Reconciler Error]', err)
      );
    } else {
      runDeltaPoll({ configId }).catch((err) => console.error('[Manual DeltaPoll Error]', err));
    }

    return res.status(202).json({
      ok: true,
      started: mode,
      message:
        mode === 'reconcile'
          ? 'Offline-Check (Reconciler) wurde im Hintergrund gestartet.'
          : 'Sofort-Crawl (Delta-Poller) wurde im Hintergrund gestartet.',
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/scraper/logs', async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '40', 10) || 40));
    const { rows } = await pool.query(
      `SELECT l.*, c.name AS config_name
       FROM scraper_logs l
       LEFT JOIN scraper_configs c ON c.id = l.config_id
       ORDER BY l.started_at DESC
       LIMIT $1`,
      [limit]
    );
    return res.json({ logs: rows, engine: getEngineStatus() });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------------------
// User Management (/api/admin/users*)
// ------------------------------------------------------------------------------
router.get('/users', async (req, res) => {
  try {
    const status = String(req.query.status || 'all').trim();
    const search = String(req.query.search || '').trim();
    const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '30', 10) || 30));
    const offset = (page - 1) * limit;

    const where = ['1=1'];
    const params = [];
    let idx = 0;

    if (status && status !== 'all') {
      idx++;
      where.push(`u.status = $${idx}`);
      params.push(status);
    }
    if (search) {
      idx++;
      where.push(`(u.email ILIKE $${idx} OR u.full_name ILIKE $${idx} OR u.preferred_city ILIKE $${idx} OR u.phone ILIKE $${idx})`);
      params.push(`%${search}%`);
    }

    const whereSql = where.join(' AND ');
    const statsRes = await pool.query(`
      SELECT
        COUNT(*)::int AS total_users,
        COUNT(*) FILTER (WHERE status = 'active')::int AS active_users,
        COUNT(*) FILTER (WHERE status = 'blocked')::int AS blocked_users,
        (SELECT COUNT(*)::int FROM user_applications) AS total_applications
      FROM users
    `);

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM users u WHERE ${whereSql}`,
      params
    );

    const listRes = await pool.query(
      `SELECT
         u.id, u.email, u.full_name, u.phone, u.preferred_city, u.bg_size, u.benefit_type,
         u.move_in_date, u.personal_note, u.emphasize_direct_transfer, u.address_schufa_directly,
         u.linked_portals, u.status, u.admin_note, u.last_login_at, u.created_at, u.updated_at,
         u.account_type, u.org_key_id, u.org_name, u.org_subtitle, u.org_logo_url, u.org_contact,
         u.org_license_unlimited, u.org_license_expires_at,
         ok.key_prefix AS org_key_prefix, ok.status AS org_key_status,
         ok.is_unlimited AS org_key_unlimited, ok.expires_at AS org_key_expires_at,
         COUNT(ua.id)::int AS applications_count,
         COUNT(ua.id) FILTER (WHERE ua.status <> 'saved')::int AS contacted_count
       FROM users u
       LEFT JOIN organization_keys ok ON ok.id = u.org_key_id
       LEFT JOIN user_applications ua ON ua.user_id = u.id
       WHERE ${whereSql}
       GROUP BY u.id, ok.id
       ORDER BY u.created_at DESC
       LIMIT $${idx + 1} OFFSET $${idx + 2}`,
      [...params, limit, offset]
    );

    return res.json({
      stats: statsRes.rows[0],
      total: countRes.rows[0]?.total || 0,
      page,
      limit,
      users: listRes.rows.map((u) => sanitizeUser(u)),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/users', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const fullName = String(req.body?.full_name || '').trim().slice(0, 150);
    const phone = String(req.body?.phone || '').trim().slice(0, 60);
    const preferredCity = String(req.body?.preferred_city || 'Gelsenkirchen').trim().slice(0, 100) || 'Gelsenkirchen';
    const bgSize = Math.min(20, Math.max(1, parseInt(req.body?.bg_size || '1', 10) || 1));
    const benefitType = req.body?.benefit_type === 'sgb12' ? 'sgb12' : 'sgb2';
    const status = req.body?.status === 'blocked' ? 'blocked' : 'active';
    const adminNote = req.body?.admin_note ? String(req.body.admin_note).trim() : null;

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Bitte eine gültige E-Mail-Adresse eingeben.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Passwort muss mindestens 8 Zeichen lang sein.' });
    }

    const exists = await pool.query(`SELECT id FROM users WHERE LOWER(email) = LOWER($1)`, [email]);
    if (exists.rows.length > 0) {
      return res.status(409).json({ error: 'Diese E-Mail-Adresse existiert bereits.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO users (
         email, password_hash, full_name, phone, preferred_city, bg_size, benefit_type,
         linked_portals, status, admin_note
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
       RETURNING *`,
      [
        email,
        hashPassword(password),
        fullName,
        phone,
        preferredCity,
        bgSize,
        benefitType,
        JSON.stringify(normalizeLinkedPortals({})),
        status,
        adminNote,
      ]
    );

    return res.status(201).json({ user: sanitizeUser(rows[0]) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/users/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`${USER_WITH_ORG_SELECT} WHERE u.id = $1`, [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden.' });
    }

    const appsRes = await pool.query(
      `SELECT
         ua.id, ua.listing_id, ua.portal, ua.status AS application_status,
         ua.message_text, ua.notes, ua.contacted_at, ua.created_at, ua.updated_at,
         l.title, l.url, l.zipcode, l.district, l.calculated_bruttokalt
       FROM user_applications ua
       JOIN listings l ON l.id = ua.listing_id
       WHERE ua.user_id = $1
       ORDER BY ua.updated_at DESC`,
      [req.params.id]
    );

    return res.json({
      user: sanitizeUser(rows[0]),
      applications: appsRes.rows,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.patch('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { rows: curRows } = await pool.query(`SELECT * FROM users WHERE id = $1`, [id]);
    if (curRows.length === 0) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden.' });
    }

    const nextEmail =
      req.body?.email !== undefined ? normalizeEmail(req.body.email) : null;
    if (nextEmail !== null && !isValidEmail(nextEmail)) {
      return res.status(400).json({ error: 'Ungültige E-Mail-Adresse.' });
    }

    const nextStatus =
      req.body?.status !== undefined
        ? req.body.status === 'blocked'
          ? 'blocked'
          : 'active'
        : null;

    const nextLinked =
      req.body?.linked_portals !== undefined
        ? JSON.stringify(normalizeLinkedPortals(req.body.linked_portals))
        : null;

    const { rows } = await pool.query(
      `UPDATE users
       SET email = COALESCE($1, email),
           full_name = COALESCE($2, full_name),
           phone = COALESCE($3, phone),
           preferred_city = COALESCE($4, preferred_city),
           bg_size = COALESCE($5, bg_size),
           benefit_type = COALESCE($6, benefit_type),
           status = COALESCE($7, status),
           admin_note = CASE WHEN $8::boolean THEN $9 ELSE admin_note END,
           linked_portals = COALESCE($10::jsonb, linked_portals),
           updated_at = NOW()
       WHERE id = $11
       RETURNING *`,
      [
        nextEmail,
        req.body?.full_name !== undefined ? String(req.body.full_name).trim().slice(0, 150) : null,
        req.body?.phone !== undefined ? String(req.body.phone).trim().slice(0, 60) : null,
        req.body?.preferred_city !== undefined ? String(req.body.preferred_city).trim().slice(0, 100) : null,
        req.body?.bg_size !== undefined ? Math.min(20, Math.max(1, parseInt(req.body.bg_size, 10) || 1)) : null,
        req.body?.benefit_type !== undefined ? (req.body.benefit_type === 'sgb12' ? 'sgb12' : 'sgb2') : null,
        nextStatus,
        Object.prototype.hasOwnProperty.call(req.body || {}, 'admin_note'),
        req.body?.admin_note ? String(req.body.admin_note).trim() : null,
        nextLinked,
        id,
      ]
    );

    return res.json({ user: sanitizeUser(rows[0]) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/users/:id/reset-password', async (req, res) => {
  try {
    const newPassword = String(req.body?.new_password || '');
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Das neue Passwort muss mindestens 8 Zeichen lang sein.' });
    }
    const { rowCount } = await pool.query(
      `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
      [hashPassword(newPassword), req.params.id]
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden.' });
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(`DELETE FROM users WHERE id = $1`, [req.params.id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden.' });
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------------------
// Listing Reports Moderation (/api/admin/reports*)
// ------------------------------------------------------------------------------
router.get('/reports', async (req, res) => {
  try {
    const status = String(req.query.status || 'open').trim();
    const whereSql = status && status !== 'all' ? `WHERE r.status = $1` : '';
    const params = status && status !== 'all' ? [status] : [];

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS open_count FROM listing_reports WHERE status = 'open'`
    );

    const { rows } = await pool.query(
      `SELECT
         r.*,
         u.email AS reporter_email,
         u.full_name AS reporter_name,
         l.title AS current_listing_title,
         l.url AS current_listing_url,
         l.city AS current_listing_city,
         l.district AS current_listing_district,
         l.zipcode AS current_listing_zipcode,
         l.calculated_bruttokalt,
         l.status AS current_listing_status,
         l.portal AS current_listing_portal
       FROM listing_reports r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN listings l ON l.id = r.listing_id
       ${whereSql}
       ORDER BY CASE WHEN r.status = 'open' THEN 0 ELSE 1 END, r.created_at DESC
       LIMIT 150`,
      params
    );

    return res.json({
      open_count: countRes.rows[0]?.open_count || 0,
      reports: rows,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/reports/:id/resolve', async (req, res) => {
  const { id } = req.params;
  const action = String(req.body?.action || '').trim();
  const adminNote = req.body?.admin_note ? String(req.body.admin_note).trim().slice(0, 1000) : null;

  if (!['hide', 'delete', 'dismiss'].includes(action)) {
    return res.status(400).json({ error: 'Ungültige Aktion (erlaubt: hide, delete, dismiss).' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: repRows } = await client.query(`SELECT * FROM listing_reports WHERE id = $1 FOR UPDATE`, [
      id,
    ]);
    if (repRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Meldung nicht gefunden.' });
    }
    const rep = repRows[0];

    let listingRow = null;
    if (rep.listing_id) {
      const lRes = await client.query(`SELECT * FROM listings WHERE id = $1 LIMIT 1`, [rep.listing_id]);
      listingRow = lRes.rows[0] || null;
    }

    const extId = listingRow?.external_id || rep.listing_external_id;
    const portal = listingRow?.portal || rep.listing_portal;
    const url = listingRow?.url || rep.listing_url;
    const title = listingRow?.title || rep.listing_title;

    if (action === 'hide') {
      if (listingRow) {
        await client.query(`UPDATE listings SET status = 'manual_hidden' WHERE id = $1`, [listingRow.id]);
        await notifyWatchersListingChanged({
          before: listingRow,
          after: { ...listingRow, status: 'manual_hidden' },
          client,
        });
      }
      if (extId) {
        await client.query(
          `INSERT INTO suppressed_listings (external_id, portal, url, title, reason)
           VALUES ($1, $2, $3, $4, 'admin_report_hidden')
           ON CONFLICT (external_id) DO UPDATE SET reason = 'admin_report_hidden', created_at = NOW()`,
          [extId, portal, url, title]
        );
      }
      await client.query(
        `UPDATE listing_reports
         SET status = 'resolved_hidden',
             admin_note = COALESCE($1, admin_note),
             reviewed_at = NOW(),
             updated_at = NOW()
         WHERE id = $2 OR ($3::uuid IS NOT NULL AND listing_id = $3::uuid AND status = 'open')`,
        [adminNote, id, rep.listing_id]
      );
    } else if (action === 'delete') {
      if (extId) {
        await client.query(
          `INSERT INTO suppressed_listings (external_id, portal, url, title, reason)
           VALUES ($1, $2, $3, $4, 'admin_report_deleted')
           ON CONFLICT (external_id) DO UPDATE SET reason = 'admin_report_deleted', created_at = NOW()`,
          [extId, portal, url, title]
        );
      }
      await client.query(
        `UPDATE listing_reports
         SET status = 'resolved_deleted',
             admin_note = COALESCE($1, admin_note),
             reviewed_at = NOW(),
             updated_at = NOW()
         WHERE id = $2 OR ($3::uuid IS NOT NULL AND listing_id = $3::uuid AND status = 'open')`,
        [adminNote, id, rep.listing_id]
      );
      if (listingRow) {
        await notifyWatchersListingDeleted({
          listing: listingRow,
          reason: 'admin_report_deleted',
          client,
        });
        await client.query(`DELETE FROM listings WHERE id = $1`, [listingRow.id]);
      }
    } else {
      await client.query(
        `UPDATE listing_reports
         SET status = 'dismissed',
             admin_note = COALESCE($1, admin_note),
             reviewed_at = NOW(),
             updated_at = NOW()
         WHERE id = $2`,
        [adminNote, id]
      );
    }

    await client.query('COMMIT');
    return res.json({ ok: true, action });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ------------------------------------------------------------------------------
// Organization Keys & Licenses (/api/admin/org-keys*)
// ------------------------------------------------------------------------------
function computeAdminKeyLiveStatus(k) {
  if (k.status === 'revoked') return 'revoked';
  if (!k.is_unlimited && k.expires_at && new Date(k.expires_at).getTime() <= Date.now()) {
    return 'expired';
  }
  return k.redeemed_by_user_id ? 'active_redeemed' : 'active_unused';
}

router.get('/org-keys', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        ok.id, ok.key_prefix, ok.label, ok.preset_org_name, ok.preset_org_subtitle,
        ok.preset_org_logo_url, ok.preset_org_contact, ok.preset_city,
        ok.is_unlimited, ok.duration_days, ok.expires_at, ok.status,
        ok.redeemed_by_user_id, ok.redeemed_at, ok.admin_note, ok.created_at, ok.updated_at,
        u.email AS redeemed_user_email,
        u.full_name AS redeemed_user_name,
        u.org_name AS current_org_name
      FROM organization_keys ok
      LEFT JOIN users u ON u.id = ok.redeemed_by_user_id
      ORDER BY ok.created_at DESC
    `);

    const keys = rows.map((k) => ({
      ...k,
      live_status: computeAdminKeyLiveStatus(k),
    }));

    return res.json({ keys });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/org-keys', async (req, res) => {
  try {
    const {
      label = '',
      validity_mode = 'days',
      duration_days = 30,
      expires_at = null,
      preset_org_name = '',
      preset_org_subtitle = '',
      preset_org_logo_url = '',
      preset_org_contact = '',
      preset_city = 'Gelsenkirchen',
      admin_note = null,
    } = req.body || {};

    let isUnlimited = validity_mode === 'unlimited';
    let finalDurationDays = null;
    let finalExpiresAt = null;

    if (!isUnlimited) {
      if (validity_mode === 'fixed_date' && expires_at) {
        const dt = new Date(expires_at);
        if (!Number.isFinite(dt.getTime()) || dt.getTime() <= Date.now()) {
          return res.status(400).json({ error: 'Bitte ein gültiges zukünftiges Ablaufdatum angeben.' });
        }
        finalExpiresAt = dt;
      } else {
        const days = parseInt(String(duration_days || '30'), 10);
        if (!Number.isFinite(days) || days < 1 || days > 3650) {
          return res.status(400).json({ error: 'Laufzeit in Tagen muss zwischen 1 und 3650 liegen.' });
        }
        finalDurationDays = days;
      }
    }

    const plainKey = generateOrgLicenseKey();
    const keyHash = hashOrgKey(plainKey);
    const keyPrefix = `${plainKey.slice(0, 14)}...`;

    const { rows } = await pool.query(
      `INSERT INTO organization_keys (
         key_hash, key_prefix, label, preset_org_name, preset_org_subtitle,
         preset_org_logo_url, preset_org_contact, preset_city,
         is_unlimited, duration_days, expires_at, status, admin_note
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active',$12)
       RETURNING id, key_prefix, label, preset_org_name, preset_org_subtitle,
                 preset_org_logo_url, preset_org_contact, preset_city,
                 is_unlimited, duration_days, expires_at, status,
                 redeemed_by_user_id, redeemed_at, admin_note, created_at, updated_at`,
      [
        keyHash,
        keyPrefix,
        String(label || '').trim().slice(0, 160),
        String(preset_org_name || '').trim().slice(0, 180),
        String(preset_org_subtitle || '').trim().slice(0, 220),
        String(preset_org_logo_url || '').trim().slice(0, 550000),
        String(preset_org_contact || '').trim().slice(0, 500),
        String(preset_city || 'Gelsenkirchen').trim().slice(0, 100) || 'Gelsenkirchen',
        isUnlimited,
        finalDurationDays,
        finalExpiresAt,
        admin_note ? String(admin_note).trim() : null,
      ]
    );

    return res.status(201).json({
      orgKey: {
        ...rows[0],
        live_status: computeAdminKeyLiveStatus(rows[0]),
      },
      plainKey,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.patch('/org-keys/:id', async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: curRows } = await client.query(`SELECT * FROM organization_keys WHERE id = $1 FOR UPDATE`, [
      id,
    ]);
    if (curRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Organisations-Key nicht gefunden.' });
    }
    const cur = curRows[0];

    const nextStatus =
      req.body?.status === 'revoked'
        ? 'revoked'
        : req.body?.status === 'active'
          ? 'active'
          : cur.status;

    let nextUnlimited = cur.is_unlimited;
    let nextDurationDays = cur.duration_days;
    let nextExpiresAt = cur.expires_at;

    if (req.body?.validity_mode === 'unlimited' || req.body?.is_unlimited === true) {
      nextUnlimited = true;
      nextDurationDays = null;
      nextExpiresAt = null;
    } else if (req.body?.validity_mode === 'days' && req.body?.duration_days) {
      const days = Math.max(1, parseInt(String(req.body.duration_days), 10) || 30);
      nextUnlimited = false;
      nextDurationDays = days;
      nextExpiresAt = cur.redeemed_by_user_id ? new Date(Date.now() + days * 86400 * 1000) : null;
    } else if (req.body?.expires_at !== undefined) {
      nextUnlimited = false;
      nextExpiresAt = req.body.expires_at ? new Date(req.body.expires_at) : null;
    }

    const { rows: updatedRows } = await client.query(
      `UPDATE organization_keys
       SET status = $1,
           label = COALESCE($2, label),
           is_unlimited = $3,
           duration_days = $4,
           expires_at = $5,
           admin_note = CASE WHEN $6::boolean THEN $7 ELSE admin_note END,
           updated_at = NOW()
       WHERE id = $8
       RETURNING id, key_prefix, label, preset_org_name, preset_org_subtitle,
                 preset_org_logo_url, preset_org_contact, preset_city,
                 is_unlimited, duration_days, expires_at, status,
                 redeemed_by_user_id, redeemed_at, admin_note, created_at, updated_at`,
      [
        nextStatus,
        req.body?.label !== undefined ? String(req.body.label).trim().slice(0, 160) : null,
        nextUnlimited,
        nextDurationDays,
        nextExpiresAt,
        Object.prototype.hasOwnProperty.call(req.body || {}, 'admin_note'),
        req.body?.admin_note ? String(req.body.admin_note).trim() : null,
        id,
      ]
    );

    if (cur.redeemed_by_user_id) {
      await client.query(
        `UPDATE users
         SET org_license_unlimited = $1,
             org_license_expires_at = $2,
             updated_at = NOW()
         WHERE org_key_id = $3`,
        [nextUnlimited, nextExpiresAt, id]
      );
    }

    await client.query('COMMIT');
    return res.json({
      orgKey: {
        ...updatedRows[0],
        live_status: computeAdminKeyLiveStatus(updatedRows[0]),
      },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.delete('/org-keys/:id', async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE users
       SET org_key_id = NULL,
           org_license_unlimited = FALSE,
           org_license_expires_at = NOW(),
           updated_at = NOW()
       WHERE org_key_id = $1`,
      [id]
    );
    const { rowCount } = await client.query(`DELETE FROM organization_keys WHERE id = $1`, [id]);
    if (rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Organisations-Key nicht gefunden.' });
    }
    await client.query('COMMIT');
    return res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

export default router;
