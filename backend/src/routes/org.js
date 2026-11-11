import { Router } from 'express';
import { pool } from '../db.js';
import { requireActiveOrganization, requireUserAuth } from '../middleware/auth.js';
import { getRulesForCity, resolveRuleForBgSize, round2 } from '../services/kduMatcher.js';
import { buildHousingListPdfBuffer } from '../services/pdfExport.js';

const router = Router();
router.use(requireUserAuth, requireActiveOrganization);

async function queryOrganizationHousingList(query, user) {
  const city = String(query.city || user.preferred_city || 'Gelsenkirchen').trim();
  const rawBg = parseInt(String(query.bg_size ?? '1'), 10);
  const allSizes = rawBg === 0 || String(query.bg_size || '') === 'all';
  const bgSize = allSizes ? 0 : Math.min(15, Math.max(1, Number.isFinite(rawBg) ? rawBg : 1));
  const benefitType = query.benefit_type === 'sgb12' ? 'sgb12' : 'sgb2';
  const privateOnly = query.private_only === 'true' || query.private_only === '1';
  const includeTolerance = query.include_tolerance === 'true' || query.include_tolerance === '1';
  const district = String(query.district || 'all').trim();
  const wbs = String(query.wbs || 'all').trim();
  const requireDirectContact =
    query.require_direct_contact === undefined
      ? true
      : query.require_direct_contact !== 'false' && query.require_direct_contact !== '0';
  const search = String(query.search || '').trim();
  const sort = String(query.sort || 'newest').trim();

  const rules = await getRulesForCity(city);
  if (rules.length === 0) {
    const err = new Error(`Keine KdU-Regeln für Stadt "${city}" gefunden.`);
    err.statusCode = 404;
    throw err;
  }

  const effectiveRuleBg = allSizes ? 5 : bgSize;
  const activeRule = resolveRuleForBgSize(rules, effectiveRuleBg);
  const strictLimit = activeRule.max_bruttokalt_eur;
  const toleranceLimit = round2(strictLimit * 1.1);
  const maxBruttokaltFilter = includeTolerance ? toleranceLimit : strictLimit;

  const baseWhere = [`status = 'active'`, `LOWER(city) = LOWER($1)`, `calculated_bruttokalt IS NOT NULL`];
  const baseParams = [city];
  let idx = baseParams.length;

  if (!allSizes) {
    idx++;
    baseWhere.push(`calculated_bruttokalt <= $${idx}`);
    baseParams.push(maxBruttokaltFilter);
  }

  if (privateOnly) {
    baseWhere.push(`is_private_landlord = TRUE`);
  }

  if (district && district.toLowerCase() !== 'all') {
    idx++;
    baseWhere.push(`LOWER(district) = LOWER($${idx})`);
    baseParams.push(district);
  }

  if (wbs === 'without') {
    baseWhere.push(`wbs_required = FALSE`);
  } else if (wbs === 'only') {
    baseWhere.push(`wbs_required = TRUE`);
  }

  if (search) {
    idx++;
    baseWhere.push(`(title ILIKE $${idx} OR district ILIKE $${idx} OR zipcode ILIKE $${idx} OR COALESCE(contact_name,'') ILIKE $${idx})`);
    baseParams.push(`%${search}%`);
  }

  const baseWhereSql = baseWhere.join(' AND ');
  const directContactPredicate = `(COALESCE(TRIM(contact_phone), '') <> '' OR COALESCE(TRIM(contact_email), '') <> '')`;
  const finalWhereSql = requireDirectContact
    ? `${baseWhereSql} AND ${directContactPredicate}`
    : baseWhereSql;

  let orderSql = `is_private_landlord DESC, first_seen_at DESC`;
  if (sort === 'cheapest') {
    orderSql = `calculated_bruttokalt ASC, is_private_landlord DESC`;
  } else if (sort === 'largest') {
    orderSql = `sqm DESC NULLS LAST, calculated_bruttokalt ASC`;
  }

  const countRes = await pool.query(
    `SELECT
       COUNT(*)::int AS total_all,
       COUNT(*) FILTER (WHERE ${directContactPredicate})::int AS total_direct_contact
     FROM listings
     WHERE ${baseWhereSql}`,
    baseParams
  );

  const listRes = await pool.query(
    `SELECT
       id, external_id, portal, title, url, city, district, zipcode,
       cold_rent, additional_costs, heating_costs, calculated_bruttokalt,
       sqm, rooms, is_private_landlord, wbs_required, matched_min_bg_size,
       contact_name, contact_phone, contact_email,
       first_seen_at, last_seen_at
     FROM listings
     WHERE ${finalWhereSql}
     ORDER BY ${orderSql}
     LIMIT 250`,
    baseParams
  );

  const districtsRes = await pool.query(
    `SELECT DISTINCT district
     FROM listings
     WHERE status = 'active' AND LOWER(city) = LOWER($1) AND district IS NOT NULL AND district <> ''
     ORDER BY district ASC`,
    [city]
  );

  const items = listRes.rows.map((row) => ({
    ...row,
    cold_rent: row.cold_rent !== null ? Number(row.cold_rent) : null,
    additional_costs: Number(row.additional_costs || 0),
    heating_costs: Number(row.heating_costs || 0),
    calculated_bruttokalt: Number(row.calculated_bruttokalt),
    sqm: row.sqm !== null ? Number(row.sqm) : null,
    rooms: row.rooms !== null ? Number(row.rooms) : null,
  }));

  return {
    organization: {
      org_name: user.org_name || user.full_name || 'Organisation',
      org_subtitle: user.org_subtitle || '',
      org_logo_url: user.org_logo_url || '',
      org_contact: user.org_contact || '',
      org_status: user.org_status,
      org_license_unlimited: user.org_license_unlimited,
      org_license_expires_at: user.org_license_expires_at,
    },
    filters: {
      city,
      bg_size: bgSize,
      all_sizes: allSizes,
      benefit_type: benefitType,
      private_only: privateOnly,
      include_tolerance: includeTolerance,
      district,
      wbs,
      require_direct_contact: requireDirectContact,
      search,
      sort,
      max_bruttokalt_eur: allSizes ? null : maxBruttokaltFilter,
    },
    rule: activeRule,
    total: items.length,
    total_all: countRes.rows[0]?.total_all || 0,
    total_direct_contact: countRes.rows[0]?.total_direct_contact || 0,
    districts: districtsRes.rows.map((r) => r.district),
    items,
  };
}

router.get('/housing-list', async (req, res) => {
  try {
    const data = await queryOrganizationHousingList(req.query, req.user);
    return res.json(data);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.get('/housing-list/pdf', async (req, res) => {
  try {
    const data = await queryOrganizationHousingList(req.query, req.user);
    const pdfBuffer = await buildHousingListPdfBuffer({
      organization: data.organization,
      filters: data.filters,
      rule: data.rule,
      listings: data.items,
    });

    const safeCity = String(data.filters.city || 'Stadt')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 40);
    const dateStamp = new Date().toISOString().slice(0, 10);
    const filename = `Wohnungsliste_${safeCity}_${dateStamp}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(pdfBuffer.length));
    return res.send(pdfBuffer);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
});

export default router;
