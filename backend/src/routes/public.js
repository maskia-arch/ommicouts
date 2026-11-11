import { Router } from 'express';
import { pool } from '../db.js';
import { getRulesForCity, resolveRuleForBgSize, round2 } from '../services/kduMatcher.js';

const router = Router();

router.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.json({ ok: true, status: 'healthy', timestamp: new Date().toISOString() });
  } catch (err) {
    return res.status(503).json({ ok: false, status: 'unhealthy', error: err.message });
  }
});

router.get('/kdu', async (req, res) => {
  try {
    const city = String(req.query.city || '').trim();
    const { rows: cityRows } = await pool.query(
      `SELECT DISTINCT city FROM kdu_rules ORDER BY city ASC`
    );
    const cities = cityRows.map((r) => r.city);

    const rules = city
      ? await getRulesForCity(city)
      : (
          await pool.query(
            `SELECT id, city, bg_size, max_sqm, max_bruttokalt_eur, extra_person_sqm, extra_person_eur, updated_at
             FROM kdu_rules
             ORDER BY city ASC, bg_size ASC`
          )
        ).rows;

    return res.json({ cities, rules });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/listings', async (req, res) => {
  try {
    const city = String(req.query.city || 'Gelsenkirchen').trim();
    const bgSize = Math.min(15, Math.max(1, parseInt(req.query.bg_size || '1', 10) || 1));
    const benefitType = req.query.benefit_type === 'sgb12' ? 'sgb12' : 'sgb2';
    const privateOnly = req.query.private_only === 'true' || req.query.private_only === '1';
    const includeTolerance =
      req.query.include_tolerance === 'true' || req.query.include_tolerance === '1';
    const district = String(req.query.district || '').trim();
    const wbs = String(req.query.wbs || 'all').trim(); // 'all' | 'without' | 'only'
    const search = String(req.query.search || '').trim();
    const sort = String(req.query.sort || 'newest').trim();
    const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '24', 10) || 24));
    const offset = (page - 1) * limit;

    const rules = await getRulesForCity(city);
    if (rules.length === 0) {
      return res.status(404).json({ error: `Keine KdU-Regeln für Stadt "${city}" gefunden.` });
    }

    const activeRule = resolveRuleForBgSize(rules, bgSize);
    const strictLimit = activeRule.max_bruttokalt_eur;
    const toleranceLimit = round2(strictLimit * 1.1);
    const maxBruttokaltFilter = includeTolerance ? toleranceLimit : strictLimit;

    const where = [`status = 'active'`, `LOWER(city) = LOWER($1)`, `calculated_bruttokalt IS NOT NULL`, `calculated_bruttokalt <= $2`];
    const params = [city, maxBruttokaltFilter];
    let idx = params.length;

    if (privateOnly) {
      where.push(`is_private_landlord = TRUE`);
    }

    if (district && district.toLowerCase() !== 'all') {
      idx++;
      where.push(`LOWER(district) = LOWER($${idx})`);
      params.push(district);
    }

    if (wbs === 'without') {
      where.push(`wbs_required = FALSE`);
    } else if (wbs === 'only') {
      where.push(`wbs_required = TRUE`);
    }

    if (search) {
      idx++;
      where.push(`(title ILIKE $${idx} OR district ILIKE $${idx} OR zipcode ILIKE $${idx})`);
      params.push(`%${search}%`);
    }

    const whereSql = where.join(' AND ');

    let orderSql = `is_private_landlord DESC, first_seen_at DESC`;
    if (sort === 'cheapest') {
      orderSql = `calculated_bruttokalt ASC, is_private_landlord DESC`;
    } else if (sort === 'largest') {
      orderSql = `sqm DESC NULLS LAST, calculated_bruttokalt ASC`;
    } else if (sort === 'newest') {
      orderSql = `first_seen_at DESC, is_private_landlord DESC`;
    }

    const countRes = await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE is_private_landlord = TRUE)::int AS private_count,
         COUNT(*) FILTER (WHERE calculated_bruttokalt <= $${idx + 1})::int AS strict_count
       FROM listings
       WHERE ${whereSql}`,
      [...params, strictLimit]
    );

    const listRes = await pool.query(
      `SELECT
         id, external_id, portal, title, url, city, district, zipcode,
         cold_rent, additional_costs, heating_costs, calculated_bruttokalt,
         sqm, rooms, is_private_landlord, wbs_required, matched_min_bg_size,
         first_seen_at, last_seen_at
       FROM listings
       WHERE ${whereSql}
       ORDER BY ${orderSql}
       LIMIT $${idx + 1} OFFSET $${idx + 2}`,
      [...params, limit, offset]
    );

    const districtsRes = await pool.query(
      `SELECT DISTINCT district
       FROM listings
       WHERE status = 'active' AND LOWER(city) = LOWER($1) AND district IS NOT NULL AND district <> ''
       ORDER BY district ASC`,
      [city]
    );

    const items = listRes.rows.map((row) => {
      const bk = Number(row.calculated_bruttokalt);
      const sqmNum = row.sqm !== null ? Number(row.sqm) : null;
      const isStrict = bk <= strictLimit;
      let complianceStatus = 'tolerance';
      if (isStrict) {
        complianceStatus =
          sqmNum !== null && sqmNum > activeRule.max_sqm ? 'produkttheorie' : 'compliant';
      }

      return {
        ...row,
        cold_rent: row.cold_rent !== null ? Number(row.cold_rent) : null,
        additional_costs: Number(row.additional_costs || 0),
        heating_costs: Number(row.heating_costs || 0),
        calculated_bruttokalt: bk,
        sqm: sqmNum,
        rooms: row.rooms !== null ? Number(row.rooms) : null,
        compliance_status: complianceStatus,
        eigenanteil_eur: isStrict ? 0 : round2(bk - strictLimit),
      };
    });

    return res.json({
      city,
      bg_size: bgSize,
      benefit_type: benefitType,
      rule: activeRule,
      tolerance_limit_eur: toleranceLimit,
      include_tolerance: includeTolerance,
      total: countRes.rows[0]?.total || 0,
      private_count: countRes.rows[0]?.private_count || 0,
      strict_count: countRes.rows[0]?.strict_count || 0,
      page,
      limit,
      districts: districtsRes.rows.map((d) => d.district),
      items,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
