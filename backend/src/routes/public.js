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

    if (!listing) {
      return res.redirect(targetUrl);
    }

    const safeTitle = (listing.title || 'Wohnungsaushang Gelsenkirchen')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const safeDistrict = (listing.district || 'Gelsenkirchen')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const safeZip = (listing.zipcode || '45879')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const safeContact = (listing.contact_name || 'Vermieter / Hausverwaltung')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const phone = listing.contact_phone ? String(listing.contact_phone).trim() : '';
    const cleanPhone = phone.replace(/[^0-9+]/g, '');

    const coldRentStr = Number(listing.cold_rent || 0).toLocaleString('de-DE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + ' €';
    const sqmStr = Number(listing.sqm || 0).toLocaleString('de-DE', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 2,
    }) + ' m²';
    const roomsStr = (Number(listing.rooms || 0)).toLocaleString('de-DE') + ' Zimmer';
    const bgStr = (listing.matched_min_bg_size || 1) + ' Person(en)';

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(`<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <title>${safeTitle} – Kommunaler Wohnungsaushang Gelsenkirchen</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #0f172a;
      --border: #1e293b;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --emerald: #10b981;
      --emerald-hover: #059669;
      --emerald-dim: rgba(16, 185, 129, 0.15);
      --amber: #f59e0b;
      --amber-dim: rgba(245, 158, 11, 0.15);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px 16px;
    }
    .container {
      max-width: 620px;
      width: 100%;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 32px 24px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.6);
    }
    .badge-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 20px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: var(--emerald-dim);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.3);
      padding: 4px 12px;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 700;
    }
    .badge-amber {
      background: var(--amber-dim);
      color: #fbbf24;
      border-color: rgba(245, 158, 11, 0.3);
    }
    h1 {
      font-size: 1.35rem;
      font-weight: 800;
      color: #fff;
      line-height: 1.35;
      margin-bottom: 8px;
    }
    .location {
      font-size: 0.9rem;
      color: var(--text-muted);
      margin-bottom: 24px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .specs-grid {
      display: grid;
      grid-cols: 3;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      margin-bottom: 24px;
    }
    .spec-box {
      background: #0b1120;
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 14px 10px;
      text-align: center;
    }
    .spec-label {
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 4px;
    }
    .spec-value {
      font-size: 1.15rem;
      font-weight: 800;
      color: #fff;
    }
    .contact-card {
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(15, 23, 42, 0.8));
      border: 1px solid rgba(16, 185, 129, 0.35);
      border-radius: 18px;
      padding: 20px;
      margin-bottom: 24px;
      text-align: center;
    }
    .contact-card h3 {
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #34d399;
      margin-bottom: 8px;
    }
    .contact-card .name {
      font-size: 1.05rem;
      font-weight: 700;
      color: #fff;
      margin-bottom: 4px;
    }
    .contact-card .phone {
      font-size: 1.25rem;
      font-weight: 800;
      color: #fff;
      margin-bottom: 16px;
      letter-spacing: 0.02em;
    }
    .btn-call {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      background: var(--emerald);
      color: #022c22;
      font-weight: 800;
      font-size: 0.95rem;
      text-decoration: none;
      padding: 14px 24px;
      border-radius: 14px;
      width: 100%;
      box-shadow: 0 4px 14px rgba(16, 185, 129, 0.3);
      transition: all 0.2s;
    }
    .btn-call:hover {
      background: var(--emerald-hover);
      transform: translateY(-1px);
    }
    .info-box {
      background: #090e1a;
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 16px;
      font-size: 0.82rem;
      color: var(--text-muted);
      line-height: 1.5;
      margin-bottom: 24px;
    }
    .info-box strong { color: #cbd5e1; }
    .actions {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .btn-secondary {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      background: #1e293b;
      color: #e2e8f0;
      font-weight: 700;
      font-size: 0.85rem;
      text-decoration: none;
      padding: 12px 20px;
      border-radius: 12px;
      border: 1px solid #334155;
      transition: all 0.2s;
    }
    .btn-secondary:hover {
      background: #334155;
      color: #fff;
    }
    .btn-back {
      color: #64748b;
      text-decoration: none;
      font-size: 0.8rem;
      font-weight: 600;
      text-align: center;
      padding: 8px;
      transition: color 0.2s;
    }
    .btn-back:hover { color: #94a3b8; }
    @media (max-width: 480px) {
      .specs-grid { grid-template-columns: repeat(3, 1fr); gap: 6px; }
      .spec-box { padding: 10px 4px; }
      .spec-value { font-size: 0.95rem; }
      h1 { font-size: 1.15rem; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="badge-row">
      <span class="badge">🏛️ Stadt Gelsenkirchen · Wohnungsaushang</span>
      <span class="badge badge-amber">WBS erforderlich</span>
      <span class="badge">100% KdU-Konform (${bgStr})</span>
    </div>

    <h1>${safeTitle}</h1>
    <div class="location">
      📍 ${safeZip} Gelsenkirchen – ${safeDistrict}
    </div>

    <div class="specs-grid">
      <div class="spec-box">
        <div class="spec-label">Kaltmiete</div>
        <div class="spec-value">${coldRentStr}</div>
      </div>
      <div class="spec-box">
        <div class="spec-label">Wohnfläche</div>
        <div class="spec-value">${sqmStr}</div>
      </div>
      <div class="spec-box">
        <div class="spec-label">Räume</div>
        <div class="spec-value">${roomsStr}</div>
      </div>
    </div>

    <div class="contact-card">
      <h3>Offizieller Anbieterkontakt</h3>
      <div class="name">${safeContact}</div>
      ${phone ? `<div class="phone">${phone}</div>` : '<div class="phone">Keine Direktnummer</div>'}
      ${phone ? `<a href="tel:${cleanPhone}" class="btn-call">📞 Vermieter jetzt anrufen (${phone})</a>` : ''}
    </div>

    <div class="info-box">
      <strong>Amtlicher Nachweis:</strong> Dieses Angebot ist im offiziellen <em>Kommunalen Wohnungsaushang für geförderten Wohnraum</em> der Stadt Gelsenkirchen (Referat Stadtplanung / Bauen und Wohnen) gemeldet. Da die städtische Internetseite technisch eine reine Sammeltabelle ohne Direktlinks für Einzeleinträge nutzt, stellt unser System alle verifizierten Eckdaten und die direkte Rufnummer des Vermieters hier bereit.
    </div>

    <div class="actions">
      <a href="${targetUrl}" target="_blank" rel="noopener noreferrer" class="btn-secondary">
        Städtische Gesamtliste auf gelsenkirchen.de öffnen ↗
      </a>
      <a href="https://immo.autoacts.link" class="btn-back">
        ← Zurück zur Jobcenter-Wohnungssuche
      </a>
    </div>
  </div>
</body>
</html>`);
  } catch {
    return res.redirect(targetUrl);
  }
});
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
    const minRooms = Math.max(0, parseFloat(req.query.min_rooms || '0') || 0);
    const minSqm = Math.max(0, parseFloat(req.query.min_sqm || '0') || 0);
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

    const where = [
      `status = 'active'`,
      `LOWER(city) = LOWER($1)`,
      `calculated_bruttokalt IS NOT NULL`,
      `calculated_bruttokalt <= $2`,
      `url NOT LIKE '%mietsofort.de%'`,
      `external_id NOT LIKE 'ms_%'`,
    ];
    const params = [city, maxBruttokaltFilter];
    let idx = params.length;

    // Strict Jobcenter sqm upper bound for household size (e.g. max 50 sqm for 1 person)
    if (activeRule.max_sqm) {
      idx++;
      where.push(`(sqm IS NULL OR sqm <= $${idx})`);
      params.push(activeRule.max_sqm);
    }

    if (minRooms > 0) {
      idx++;
      where.push(`rooms IS NOT NULL AND rooms >= $${idx}`);
      params.push(minRooms);
    }

    if (minSqm > 0) {
      idx++;
      where.push(`sqm IS NOT NULL AND sqm >= $${idx}`);
      params.push(minSqm);
    }

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
      const complianceStatus = isStrict ? 'compliant' : 'tolerance';

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
      min_rooms: minRooms,
      min_sqm: minSqm,
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
