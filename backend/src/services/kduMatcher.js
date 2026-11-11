import { pool } from '../db.js';

export function round2(val) {
  if (val === null || val === undefined || Number.isNaN(Number(val))) return null;
  return Math.round(Number(val) * 100) / 100;
}

export function computeBruttokalt(coldRent, additionalCosts = 0) {
  if (coldRent === null || coldRent === undefined || Number.isNaN(Number(coldRent))) {
    return null;
  }
  const cold = Number(coldRent);
  const add = Number.isFinite(Number(additionalCosts)) ? Number(additionalCosts) : 0;
  return round2(cold + add);
}

/**
 * Resolves the KdU rule for any household size (1..20), extending beyond
 * the highest stored bg_size via extra_person_sqm & extra_person_eur.
 */
export function resolveRuleForBgSize(rules, bgSize) {
  if (!rules || rules.length === 0) return null;
  const sorted = [...rules].sort((a, b) => Number(a.bg_size) - Number(b.bg_size));
  const target = Math.max(1, parseInt(bgSize, 10) || 1);

  const exact = sorted.find((r) => Number(r.bg_size) === target);
  if (exact) {
    return {
      city: exact.city,
      bg_size: target,
      max_sqm: Number(exact.max_sqm),
      max_bruttokalt_eur: Number(exact.max_bruttokalt_eur),
      extra_person_sqm: Number(exact.extra_person_sqm),
      extra_person_eur: Number(exact.extra_person_eur),
      is_extrapolated: false,
    };
  }

  const highest = sorted[sorted.length - 1];
  const lowest = sorted[0];
  if (target > Number(highest.bg_size)) {
    const diff = target - Number(highest.bg_size);
    return {
      city: highest.city,
      bg_size: target,
      max_sqm: round2(Number(highest.max_sqm) + diff * Number(highest.extra_person_sqm)),
      max_bruttokalt_eur: round2(
        Number(highest.max_bruttokalt_eur) + diff * Number(highest.extra_person_eur)
      ),
      extra_person_sqm: Number(highest.extra_person_sqm),
      extra_person_eur: Number(highest.extra_person_eur),
      is_extrapolated: true,
    };
  }

  return {
    city: lowest.city,
    bg_size: target,
    max_sqm: Number(lowest.max_sqm),
    max_bruttokalt_eur: Number(lowest.max_bruttokalt_eur),
    extra_person_sqm: Number(lowest.extra_person_sqm),
    extra_person_eur: Number(lowest.extra_person_eur),
    is_extrapolated: true,
  };
}

/**
 * Applies SGB II / BSG Produkttheorie:
 * The decisive criterion for KdU appropriateness is Bruttokaltmiete <= max_bruttokalt_eur.
 * Returns the smallest bg_size (1..15) that covers this Bruttokaltmiete, or null.
 */
export function findMatchedMinBgSize(calculatedBruttokalt, rules) {
  if (
    calculatedBruttokalt === null ||
    calculatedBruttokalt === undefined ||
    !Number.isFinite(Number(calculatedBruttokalt)) ||
    Number(calculatedBruttokalt) <= 0 ||
    !rules ||
    rules.length === 0
  ) {
    return null;
  }

  const bk = Number(calculatedBruttokalt);
  for (let bg = 1; bg <= 15; bg++) {
    const rule = resolveRuleForBgSize(rules, bg);
    if (rule && bk <= rule.max_bruttokalt_eur) {
      return bg;
    }
  }
  return null;
}

export async function getRulesForCity(city = 'Gelsenkirchen') {
  const { rows } = await pool.query(
    `SELECT id, city, bg_size, max_sqm, max_bruttokalt_eur, extra_person_sqm, extra_person_eur, updated_at
     FROM kdu_rules
     WHERE LOWER(city) = LOWER($1)
     ORDER BY bg_size ASC`,
    [city]
  );
  return rows;
}

export async function getAllRulesGroupedByCity() {
  const { rows } = await pool.query(
    `SELECT id, city, bg_size, max_sqm, max_bruttokalt_eur, extra_person_sqm, extra_person_eur, updated_at
     FROM kdu_rules
     ORDER BY city ASC, bg_size ASC`
  );
  const map = new Map();
  for (const row of rows) {
    const key = row.city.toLowerCase();
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return { rows, map };
}

export async function recalculateAllListings(city = null) {
  const { map: rulesByCity } = await getAllRulesGroupedByCity();
  const fallbackRules = rulesByCity.get('gelsenkirchen') || [];

  const selectQuery = city
    ? `SELECT id, city, cold_rent, additional_costs FROM listings WHERE LOWER(city) = LOWER($1)`
    : `SELECT id, city, cold_rent, additional_costs FROM listings`;
  const selectParams = city ? [city] : [];

  const { rows: listings } = await pool.query(selectQuery, selectParams);

  const client = await pool.connect();
  let updated = 0;
  try {
    await client.query('BEGIN');
    for (const item of listings) {
      const cityRules = rulesByCity.get((item.city || 'Gelsenkirchen').toLowerCase()) || fallbackRules;
      const bruttokalt = computeBruttokalt(item.cold_rent, item.additional_costs);
      const matchedBg = findMatchedMinBgSize(bruttokalt, cityRules);

      await client.query(
        `UPDATE listings
         SET calculated_bruttokalt = $1,
             matched_min_bg_size = $2
         WHERE id = $3`,
        [bruttokalt, matchedBg, item.id]
      );
      updated++;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { totalProcessed: updated };
}
