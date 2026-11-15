import { Router } from 'express';
import { pool } from '../db.js';
import { optionalUserAuth } from '../middleware/auth.js';
import { getRulesForCity, resolveRuleForBgSize, round2 } from '../services/kduMatcher.js';
import { fetchStealthHtml } from '../scraper/httpClient.js';

const router = Router();

const VALID_GE_DISTRICTS = new Set([
  'Altstadt',
  'Beckhausen',
  'Bismarck',
  'Buer',
  'Bulmke-Hüllen',
  'Erle',
  'Feldmark',
  'Hassel',
  'Heßler',
  'Horst',
  'Neustadt',
  'Resse',
  'Rotthausen',
  'Schalke',
  'Scholven',
  'Ückendorf',
]);

function mapToGeDistrict(district) {
  if (!district) return '';
  if (VALID_GE_DISTRICTS.has(district)) return district;
  const d = String(district).toLowerCase().trim();
  for (const valid of VALID_GE_DISTRICTS) {
    const v = valid.toLowerCase();
    if (d.includes(v) || v.includes(d)) {
      return valid;
    }
  }
  return '';
}

/**
 * Direct forwarder for Wohnungsaushang Gelsenkirchen.
 * Stadt Gelsenkirchen's ASP.NET WebForm requires a POST with __VIEWSTATE and suchenButton to display results.
 * This route fetches fresh tokens and renders an auto-submitting form so the user lands on the pre-filled results table.
 */
router.get('/wohnungsaushang/view', async (req, res) => {
  const targetUrl =
    'https://www.gelsenkirchen.de/de/infrastruktur/bauen_und_wohnen/wohnungsaushang.aspx';
  try {
    const rawId = String(req.query.id || '').trim();
    let listing = null;
    if (rawId) {
      const { rows } = await pool.query(
        `SELECT * FROM listings WHERE external_id = $1 OR id::text = $1 LIMIT 1`,
        [rawId]
      );
      listing = rows[0] || null;
    }

    const getRes = await fetchStealthHtml(targetUrl, { preferDesktop: true });
    const vsMatch = getRes.html.match(/id="__VIEWSTATE"\s+value="([^"]+)"/i);
    const evMatch = getRes.html.match(/id="__EVENTVALIDATION"\s+value="([^"]+)"/i);
    const vsgMatch = getRes.html.match(/id="__VIEWSTATEGENERATOR"\s+value="([^"]+)"/i);

    if (!vsMatch) {
      return res.redirect(targetUrl);
    }

    const vs = vsMatch[1];
    const ev = evMatch ? evMatch[1] : '';
    const vsg = vsgMatch ? vsgMatch[1] : '';

    const districtVal = mapToGeDistrict(listing?.district);

    let roomsVal = '';
    if (listing?.rooms) {
      const r = Number(listing.rooms);
      if (r === 1 || r === 2 || r === 3 || r === 3.5 || r === 4) {
        roomsVal = String(r);
      }
    }

    const safeTitle = (listing?.title || 'Wohnungsaushang Gelsenkirchen')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(`<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <title>Offizieller Wohnungsaushang Gelsenkirchen</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      margin: 0;
      background-color: #0b1120;
      color: #f1f5f9;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      text-align: center;
      padding: 24px;
      box-sizing: border-box;
    }
    .card {
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 20px;
      padding: 32px 24px;
      max-width: 480px;
      width: 100%;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
    }
    .spinner {
      width: 40px;
      height: 40px;
      border: 3px solid rgba(16, 185, 129, 0.2);
      border-top-color: #10b981;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 0 auto 20px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    h2 { font-size: 1.25rem; font-weight: 700; margin: 0 0 8px; color: #fff; }
    p { font-size: 0.875rem; color: #94a3b8; margin: 0 0 24px; line-height: 1.5; }
    .badge {
      display: inline-block;
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      padding: 4px 12px;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
      margin-bottom: 16px;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    button {
      background: #10b981;
      color: #022c22;
      border: none;
      padding: 12px 24px;
      border-radius: 12px;
      font-weight: 700;
      font-size: 0.875rem;
      cursor: pointer;
      width: 100%;
      transition: background 0.2s;
    }
    button:hover { background: #34d399; }
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <div class="badge">Kommunaler Wohnungsaushang Gelsenkirchen</div>
    <h2>Offizielle Inserate der Stadt</h2>
    <p>Die Originaldaten werden geladen und für <strong>${safeTitle}</strong> aufgerufen...</p>

    <form id="geForm" method="POST" action="${targetUrl}">
      <input type="hidden" name="__VIEWSTATE" value="${vs}" />
      <input type="hidden" name="__VIEWSTATEGENERATOR" value="${vsg}" />
      <input type="hidden" name="__EVENTVALIDATION" value="${ev}" />
      ${districtVal ? `<input type="hidden" name="ctl00$ctl00$contentContentPlaceHolder$spalte_links$ctl00$lbOrtsteile" value="${districtVal}" />` : ''}
      ${roomsVal ? `<input type="hidden" name="ctl00$ctl00$contentContentPlaceHolder$spalte_links$ctl00$lbRaeume" value="${roomsVal}" />` : ''}
      <input type="hidden" name="ctl00$ctl00$contentContentPlaceHolder$spalte_links$ctl00$suchenButton" value="Suchen" />
      <button type="submit">Weiterleitung manuell starten</button>
    </form>
  </div>
  <script>
    document.getElementById('geForm').submit();
  </script>
</body>
</html>`);
  } catch {
    return res.redirect(targetUrl);
  }
});

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

router.get('/listings', optionalUserAuth, async (req, res) => {
  try {
    const city = String(req.query.city || 'Gelsenkirchen').trim();
    const bgSize = Math.min(15, Math.max(1, parseInt(req.query.bg_size || '1', 10) || 1));
    const benefitType = req.query.benefit_type === 'sgb12' ? 'sgb12' : 'sgb2';
    const privateOnly = req.query.private_only === 'true' || req.query.private_only === '1';
    const includeTolerance =
      req.query.include_tolerance === 'true' || req.query.include_tolerance === '1';
    const districtRaw = String(req.query.district || '').trim();
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

    if (req.user?.id) {
      idx++;
      where.push(
        `NOT EXISTS (SELECT 1 FROM user_hidden_listings uhl WHERE uhl.user_id = $${idx} AND uhl.listing_id = listings.id)`
      );
      params.push(req.user.id);
    }

    if (privateOnly) {
      where.push(`is_private_landlord = TRUE`);
    }

    if (districtRaw && districtRaw.toLowerCase() !== 'all') {
      const selectedDistricts = districtRaw
        .split(',')
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean);
      if (selectedDistricts.length === 1) {
        idx++;
        where.push(`LOWER(district) = LOWER($${idx})`);
        params.push(selectedDistricts[0]);
      } else if (selectedDistricts.length > 1) {
        idx++;
        where.push(`LOWER(district) = ANY($${idx}::text[])`);
        params.push(selectedDistricts);
      }
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
         contact_name, contact_phone, contact_email,
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

    const isAuthenticated = Boolean(req.user?.id);
    const items = listRes.rows.map((row) => {
      const bk = Number(row.calculated_bruttokalt);
      const sqmNum = row.sqm !== null ? Number(row.sqm) : null;
      const isStrict = bk <= strictLimit;
      let complianceStatus = 'tolerance';
      if (isStrict) {
        complianceStatus =
          sqmNum !== null && sqmNum > activeRule.max_sqm ? 'produkttheorie' : 'compliant';
      }

      const isWohnungsaushang =
        row.external_id?.startsWith('ge_aushang_') ||
        String(row.url || '').includes('wohnungsaushang');
      const resolvedUrl = isWohnungsaushang
        ? `/api/wohnungsaushang/view?id=${encodeURIComponent(row.external_id)}`
        : row.url;

      return {
        ...row,
        url: resolvedUrl,
        contact_name: isAuthenticated ? row.contact_name : null,
        contact_phone: isAuthenticated ? row.contact_phone : null,
        contact_email: isAuthenticated ? row.contact_email : null,
        has_direct_contact: Boolean(row.contact_phone || row.contact_email),
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
