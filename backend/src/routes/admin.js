import { Router } from 'express';
import { pool } from '../db.js';
import { requireAdminKey } from '../middleware/auth.js';
import {
  crawlSingleUrl,
  getEngineStatus,
  runDeltaPoll,
  runReconciler,
} from '../scraper/engine.js';
import { reloadSchedules } from '../scraper/scheduler.js';
import {
  computeBruttokalt,
  findMatchedMinBgSize,
  getRulesForCity,
  recalculateAllListings,
} from '../services/kduMatcher.js';

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
        COUNT(*) FILTER (WHERE status = 'active' AND matched_min_bg_size = 1)::int AS bg1_matches
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
           matched_min_bg_size = $14
       WHERE id = $15
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
        id,
      ]
    );

    return res.json({ listing: rows[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/listings/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { rowCount } = await pool.query(`DELETE FROM listings WHERE id = $1`, [id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Inserat nicht gefunden.' });
    }
    return res.json({ ok: true });
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

export default router;
