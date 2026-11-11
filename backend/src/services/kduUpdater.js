import * as cheerio from 'cheerio';
import { pool } from '../db.js';
import { fetchStealthHtml } from '../scraper/httpClient.js';
import { parseGermanNumber } from '../scraper/parser.js';
import { recalculateAllListings } from './kduMatcher.js';

function normalizeRuleEntry(bgSize, sqm, eur, extraSqm = 15, extraEur = 116.6) {
  const bg = parseInt(bgSize, 10);
  const s = Number(sqm);
  const e = Number(eur);
  if (!Number.isInteger(bg) || bg < 1 || bg > 15) return null;
  if (!Number.isFinite(s) || s < 20 || s > 250) return null;
  if (!Number.isFinite(e) || e < 180 || e > 3000) return null;

  return {
    bg_size: bg,
    max_sqm: Math.round(s * 100) / 100,
    max_bruttokalt_eur: Math.round(e * 100) / 100,
    extra_person_sqm: Number.isFinite(Number(extraSqm)) ? Number(extraSqm) : 15,
    extra_person_eur: Number.isFinite(Number(extraEur)) ? Number(extraEur) : 116.6,
  };
}

function parseJsonKdu(rawText) {
  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    return null;
  }

  const arr = Array.isArray(data) ? data : Array.isArray(data?.rules) ? data.rules : null;
  if (!arr) return null;

  const extraSqm = data?.extra_person_sqm ?? 15;
  const extraEur = data?.extra_person_eur ?? 116.6;
  const parsed = [];

  for (const item of arr) {
    const entry = normalizeRuleEntry(
      item.bg_size ?? item.persons ?? item.personen,
      item.max_sqm ?? item.sqm ?? item.qm,
      item.max_bruttokalt_eur ?? item.bruttokalt ?? item.max_eur ?? item.amount,
      item.extra_person_sqm ?? extraSqm,
      item.extra_person_eur ?? extraEur
    );
    if (entry) parsed.push(entry);
  }

  return parsed.length >= 2 ? parsed : null;
}

function detectBgFromLine(text, allowBareNumber = false) {
  const t = String(text || '').toLowerCase().trim();
  if (
    /\b1\s*(?:person|pers\.?|p\.|personenhaushalt|personen-haushalt|erwachsene)\b|\balleinstehend|\beinpersonenhaushalt|\bsingle\b/.test(
      t
    )
  ) {
    return 1;
  }
  const wordNumbers = [
    ['zwei', 2],
    ['drei', 3],
    ['vier', 4],
    ['fünf', 5],
    ['fuenf', 5],
    ['sechs', 6],
  ];
  for (const [word, num] of wordNumbers) {
    if (new RegExp(`\\b${word}personen`, 'i').test(t)) return num;
  }
  const m = t.match(/\b([1-9]|10)\s*(?:-\s*)?(?:personen|pers\.?|p\b|personen-?haushalt|mitglieder|person)/i);
  if (m) return parseInt(m[1], 10);
  if (allowBareNumber && /^\d{1,2}$/.test(t)) {
    const n = parseInt(t, 10);
    if (n >= 1 && n <= 10) return n;
  }
  return null;
}

function extractExtraPersonFromText(text, fallbackSqm = 15) {
  const m = String(text || '').match(
    /(?:jede\s+weitere\s+person|weitere\s+person|\+\s*1\s*person)[\s\S]{0,160}/i
  );
  if (!m) return { extraSqm: fallbackSqm, extraEur: 116.6 };
  const snippet = m[0];
  const sqmM = snippet.match(/(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:m²|m2|qm\b)/i);
  const eurM = snippet.match(/(\d{2,4}(?:[.,]\d{1,2})?)\s*(?:€|eur\b)/i);
  return {
    extraSqm: sqmM ? parseGermanNumber(sqmM[1]) || fallbackSqm : fallbackSqm,
    extraEur: eurM ? parseGermanNumber(eurM[1]) || 116.6 : 116.6,
  };
}

function detectTableColumnMapping($, tableEl) {
  const headerRows = $(tableEl).find('thead tr');
  const firstRow = headerRows.length > 0 ? headerRows.first() : $(tableEl).find('tr').first();
  const headers = firstRow
    .find('th, td')
    .map((_, c) => $(c).text().replace(/\s+/g, ' ').trim().toLowerCase())
    .get();

  let bgCol = -1;
  let sqmCol = -1;
  let kduCol = -1;
  let fallbackRentCol = -1;

  headers.forEach((h, idx) => {
    if (bgCol === -1 && /(haushalt|person|bedarfsgemeinschaft|\bbg\b|haushaltsgröße)/i.test(h)) {
      bgCol = idx;
    }
    if (sqmCol === -1 && /(wohnungsgröße|wohnfläche|fläche|\bm²\b|\bm2\b|\bqm\b)/i.test(h)) {
      sqmCol = idx;
    }
    if (
      /(angemessene\s*kdu|bruttokalt|gesamt(?:miete|betrag)?|kosten\s*der\s*unterkunft|mietobergrenze|höchstbetrag|richtwert)/i.test(
        h
      )
    ) {
      kduCol = idx;
    } else if (
      /(miete|\bkdu\b|betrag|€|eur)/i.test(h) &&
      !/(netto-?kalt|kaltmiete|betriebskosten|nebenkosten|heizkosten)/i.test(h)
    ) {
      fallbackRentCol = idx;
    }
  });

  const hasHeader = bgCol !== -1 || sqmCol !== -1 || kduCol !== -1;
  return {
    hasHeader,
    headerRowEl: hasHeader ? firstRow.get(0) : null,
    bgCol: bgCol !== -1 ? bgCol : 0,
    sqmCol,
    kduCol: kduCol !== -1 ? kduCol : fallbackRentCol,
  };
}

function inferSqmStep(entries) {
  if (entries.length < 2) return 15;
  const sorted = [...entries].sort((a, b) => a.bg_size - b.bg_size);
  const diff = Number(sorted[1].max_sqm) - Number(sorted[0].max_sqm);
  if (Number.isFinite(diff) && diff >= 5 && diff <= 30) {
    return Math.round(diff * 100) / 100;
  }
  return 15;
}

/**
 * Parses KdU rules from JSON or HTML/Text (header-aware tables, inline-unit tables, or paragraphs).
 */
export function parseKduContent(content, contentType = '') {
  const text = String(content || '').trim();
  if (!text) return { ok: false, error: 'Leere Antwort von KdU-Quell-URL.' };

  if (contentType.includes('json') || text.startsWith('{') || text.startsWith('[')) {
    const jsonRules = parseJsonKdu(text);
    if (jsonRules) {
      return { ok: true, format: 'json', rules: jsonRules };
    }
  }

  const $ = cheerio.load(text);
  const fullBodyText = $('body').text().replace(/\s+/g, ' ');
  const { extraSqm: parsedExtraSqm, extraEur } = extractExtraPersonFromText(fullBodyText);

  const byBg = new Map();

  // 1. Scan each HTML table with header column detection (handles unitless m² cells like "50" under "Wohnungsgröße in m²")
  $('table').each((_, tableEl) => {
    const colMap = detectTableColumnMapping($, tableEl);

    $(tableEl)
      .find('tr')
      .each((__, tr) => {
        if (colMap.headerRowEl && tr === colMap.headerRowEl) return;

        const cells = $(tr)
          .find('th, td')
          .map((___, c) => $(c).text().replace(/\s+/g, ' ').trim())
          .get();
        if (cells.length < 2) return;

        const rowText = cells.join(' | ');
        const bgCell = cells[colMap.bgCol] ?? cells[0];
        const bg = detectBgFromLine(bgCell, colMap.hasHeader) || detectBgFromLine(rowText);
        if (!bg) return;

        let sqm = null;
        if (colMap.sqmCol >= 0 && cells[colMap.sqmCol] !== undefined) {
          sqm = parseGermanNumber(cells[colMap.sqmCol]);
        }
        if (sqm === null) {
          const sqmMatches = [...rowText.matchAll(/(\d{2,3}(?:[.,]\d{1,2})?)\s*(?:m²|m2|qm\b)/gi)];
          if (sqmMatches.length > 0) sqm = parseGermanNumber(sqmMatches[0][1]);
        }
        if (sqm === null) {
          // Last-resort unitless sqm column (integer/decimal in 20..250 without currency symbol)
          for (let i = 1; i < cells.length; i++) {
            if (!/[€eur]/i.test(cells[i])) {
              const candidate = parseGermanNumber(cells[i]);
              if (candidate !== null && candidate >= 20 && candidate <= 250) {
                sqm = candidate;
                break;
              }
            }
          }
        }

        let eur = null;
        if (colMap.kduCol >= 0 && cells[colMap.kduCol] !== undefined) {
          const val = parseGermanNumber(cells[colMap.kduCol]);
          if (val !== null && val >= 180 && val <= 3000) eur = val;
        }
        if (eur === null) {
          const eurMatches = [...rowText.matchAll(/(\d{3,4}(?:[.,]\d{1,2})?)\s*(?:€|eur\b)/gi)];
          const eurCandidates = eurMatches
            .map((m) => parseGermanNumber(m[1]))
            .filter((n) => n !== null && n >= 180 && n <= 3000);
          if (eurCandidates.length > 0) eur = eurCandidates[eurCandidates.length - 1];
        }

        const entry = normalizeRuleEntry(bg, sqm, eur, parsedExtraSqm, extraEur);
        if (entry && !byBg.has(bg)) {
          byBg.set(bg, entry);
        }
      });
  });

  // 2. Fallback: scan list items / lines
  if (byBg.size < 3) {
    $('li, p, tr').each((_, el) => {
      const line = $(el).text().replace(/\s+/g, ' ').trim();
      if (line.length > 260) return;
      const bg = detectBgFromLine(line);
      if (!bg || byBg.has(bg)) return;
      const sqmM = line.match(/(\d{2,3}(?:[.,]\d{1,2})?)\s*(?:m²|m2|qm\b)/i);
      const eurM = line.match(/(\d{3,4}(?:[.,]\d{1,2})?)\s*(?:€|eur\b)/i);
      const entry = normalizeRuleEntry(
        bg,
        sqmM ? parseGermanNumber(sqmM[1]) : null,
        eurM ? parseGermanNumber(eurM[1]) : null,
        parsedExtraSqm,
        extraEur
      );
      if (entry) byBg.set(bg, entry);
    });
  }

  const rawRules = [...byBg.values()].sort((a, b) => a.bg_size - b.bg_size);
  const inferredSqmStep = inferSqmStep(rawRules);
  const finalExtraSqm =
    fullBodyText.match(/(?:jede\s+weitere\s+person|weitere\s+person|\+\s*1\s*person)[\s\S]{0,120}(?:m²|qm)/i)
      ? parsedExtraSqm
      : inferredSqmStep;

  const rules = rawRules.map((r) => ({
    ...r,
    extra_person_sqm: finalExtraSqm,
    extra_person_eur: extraEur,
  }));

  // Guardrail: require at least 3 valid consecutive/distinct tiers to prevent bad overwrites
  if (rules.length < 3) {
    return {
      ok: false,
      error: `Zu wenige gültige KdU-Stufen erkannt (${rules.length} gefunden, mindestens 3 benötigt). Bitte JSON- oder Tabellenstruktur prüfen oder Werte händisch eintragen.`,
    };
  }

  return { ok: true, format: 'html', rules };
}

export async function fetchAndPreviewKduFromUrl(url) {
  const res = await fetchStealthHtml(url, { preferDesktop: true, timeoutMs: 20000 });
  if (res.statusCode >= 400) {
    return {
      ok: false,
      error: `HTTP ${res.statusCode} beim Abruf der KdU-Quell-URL.`,
    };
  }
  const contentType = String(res.headers?.['content-type'] || '');
  return parseKduContent(res.html, contentType);
}

/**
 * Derives a sensible cold-rent search cap (rounded up to nearest 50 EUR) from local KdU rules.
 */
export function deriveSearchMaxRentFromRules(rules) {
  if (!rules || rules.length === 0) return 850;
  const sorted = [...rules].sort((a, b) => Number(a.bg_size) - Number(b.bg_size));
  const bg5 = sorted.find((r) => Number(r.bg_size) === 5) || sorted[sorted.length - 1];
  const rawMax = Number(bg5.max_bruttokalt_eur || 850);
  return Math.max(500, Math.ceil(rawMax / 50) * 50);
}

export function buildUpdatedScraperUrlAndName(cfg, cap) {
  let nextUrl = cfg.search_url;
  if (cfg.portal === 'kleinanzeigen') {
    nextUrl = nextUrl.replace(/\/preis:\d*:\d+\//i, `/preis:150:${cap}/`);
  } else if (cfg.portal === 'immowelt') {
    try {
      const u = new URL(nextUrl);
      u.searchParams.set('priceMax', String(cap));
      nextUrl = u.toString();
    } catch {
      // ignore invalid URL
    }
  } else if (cfg.portal === 'immoscout') {
    try {
      const u = new URL(nextUrl);
      u.searchParams.set('price', `-${cap}.0`);
      nextUrl = u.toString();
    } catch {
      // ignore invalid URL
    }
  } else if (nextUrl.includes('ggw-gelsenkirchen.de')) {
    try {
      const u = new URL(nextUrl);
      u.searchParams.set('price', String(cap));
      nextUrl = u.toString();
    } catch {
      // ignore invalid URL
    }
  }

  const nextName = String(cfg.name || '')
    .replace(/150-\d+\s*EUR/i, `150-${cap} EUR`)
    .replace(/bis\s+\d+\s*EUR/i, `bis ${cap} EUR`);
  return { nextUrl, nextName };
}

export async function updateCityScraperPriceCaps(city, maxRentEur) {
  const cap = Math.round(Number(maxRentEur));
  if (!Number.isFinite(cap) || cap < 300) return 0;

  const { rows: configs } = await pool.query(
    `SELECT id, portal, search_url, name, is_active FROM scraper_configs WHERE LOWER(city) = LOWER($1) ORDER BY id ASC`,
    [city]
  );

  let updated = 0;
  let merged = 0;
  for (const cfg of configs) {
    const { nextUrl, nextName } = buildUpdatedScraperUrlAndName(cfg, cap);
    if (nextUrl === cfg.search_url && nextName === cfg.name) continue;

    // Check if updating search_url would collide with another config having the same (portal, search_url)
    const { rows: collision } = await pool.query(
      `SELECT id, is_active FROM scraper_configs WHERE portal = $1 AND search_url = $2 AND id <> $3 LIMIT 1`,
      [cfg.portal, nextUrl, cfg.id]
    );

    if (collision.length > 0) {
      const survivor = collision[0];
      if (cfg.is_active && !survivor.is_active) {
        await pool.query(`UPDATE scraper_configs SET is_active = TRUE, updated_at = NOW() WHERE id = $1`, [
          survivor.id,
        ]);
      }
      await pool.query(`DELETE FROM scraper_configs WHERE id = $1`, [cfg.id]);
      merged++;
      updated++;
      continue;
    }

    await pool.query(
      `UPDATE scraper_configs SET search_url = $1, name = $2, updated_at = NOW() WHERE id = $3`,
      [nextUrl, nextName, cfg.id]
    );
    updated++;
  }

  if (merged > 0) {
    try {
      const { reloadSchedules } = await import('../scraper/scheduler.js');
      await reloadSchedules();
    } catch {
      // non-fatal during isolated scripts/tests
    }
  }
  return updated;
}

export async function syncKduSourceForCity(city) {
  const { rows } = await pool.query(
    `SELECT * FROM kdu_sources WHERE LOWER(city) = LOWER($1)`,
    [city]
  );
  if (rows.length === 0) {
    throw new Error(`Keine KdU-Quelle für Stadt "${city}" gefunden.`);
  }
  const src = rows[0];
  if (!src.source_url) {
    throw new Error(`Für "${src.city}" ist keine KdU-Quell-URL hinterlegt.`);
  }

  const preview = await fetchAndPreviewKduFromUrl(src.source_url);
  if (!preview.ok) {
    await pool.query(
      `UPDATE kdu_sources
       SET last_synced_at = NOW(), last_sync_status = 'error', last_sync_message = $1, updated_at = NOW()
       WHERE id = $2`,
      [preview.error, src.id]
    );
    return { ok: false, city: src.city, error: preview.error };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of preview.rules) {
      await client.query(
        `INSERT INTO kdu_rules (city, bg_size, max_sqm, max_bruttokalt_eur, extra_person_sqm, extra_person_eur, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (city, bg_size) DO UPDATE SET
           max_sqm = EXCLUDED.max_sqm,
           max_bruttokalt_eur = EXCLUDED.max_bruttokalt_eur,
           extra_person_sqm = EXCLUDED.extra_person_sqm,
           extra_person_eur = EXCLUDED.extra_person_eur,
           updated_at = NOW()`,
        [src.city, r.bg_size, r.max_sqm, r.max_bruttokalt_eur, r.extra_person_sqm, r.extra_person_eur]
      );
    }
    const maxParsedBg = Math.max(...preview.rules.map((r) => r.bg_size));
    await client.query(
      `DELETE FROM kdu_rules WHERE LOWER(city) = LOWER($1) AND bg_size > $2`,
      [src.city, maxParsedBg]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const derivedMaxRent = deriveSearchMaxRentFromRules(preview.rules);
  try {
    const scrapersUpdated = await updateCityScraperPriceCaps(src.city, derivedMaxRent);
    const recalc = await recalculateAllListings(src.city);

    await pool.query(
      `UPDATE kdu_sources
       SET search_max_rent_eur = $1,
           last_synced_at = NOW(),
           last_sync_status = 'success',
           last_sync_message = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [
        derivedMaxRent,
        `${preview.rules.length} Stufen via ${preview.format.toUpperCase()} aktualisiert.`,
        src.id,
      ]
    );

    return {
      ok: true,
      city: src.city,
      rulesUpdated: preview.rules.length,
      derivedMaxRent,
      scrapersUpdated,
      listingsRecalculated: recalc.totalProcessed,
    };
  } catch (err) {
    await pool.query(
      `UPDATE kdu_sources
       SET last_synced_at = NOW(), last_sync_status = 'error', last_sync_message = $1, updated_at = NOW()
       WHERE id = $2`,
      [String(err.message || 'Unbekannter Fehler beim Anwenden der KdU-Daten'), src.id]
    );
    throw err;
  }
}

export async function syncAllAutoKduSources() {
  const { rows } = await pool.query(
    `SELECT city FROM kdu_sources WHERE auto_sync_enabled = TRUE AND source_url IS NOT NULL AND source_url <> ''`
  );
  const results = [];
  for (const row of rows) {
    try {
      results.push(await syncKduSourceForCity(row.city));
    } catch (err) {
      results.push({ ok: false, city: row.city, error: err.message });
    }
  }
  return results;
}
