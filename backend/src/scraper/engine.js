import { pool } from '../db.js';
import {
  computeBruttokalt,
  findMatchedMinBgSize,
  getRulesForCity,
} from '../services/kduMatcher.js';
import { fetchStealthHtml, sleepJitter } from './httpClient.js';
import {
  findCrossPortalDuplicate,
  mergeUserReferencesAndMarkOffline,
} from '../services/deduplicator.js';
import { notifyWatchersListingChanged } from '../services/notifications.js';
import {
  buildPagedSearchUrl,
  detectPortal,
  extractSearchListingLinks,
  isListingOfflineHtml,
  parseListingDetail,
} from './parser.js';
import { validateListing } from './validator.js';

const runtimeLocks = {
  deltaPollRunning: false,
  reconcileRunning: false,
};

export function getEngineStatus() {
  return { ...runtimeLocks };
}

async function getCityZipPrefixes(city) {
  try {
    const { rows } = await pool.query(
      `SELECT zip_prefixes FROM kdu_sources WHERE LOWER(city) = LOWER($1) LIMIT 1`,
      [city]
    );
    return rows[0]?.zip_prefixes || null;
  } catch {
    return null;
  }
}

async function createLog({ configId = null, runType, portal = null, details = null }) {
  const { rows } = await pool.query(
    `INSERT INTO scraper_logs (config_id, run_type, portal, status, details)
     VALUES ($1, $2, $3, 'running', $4)
     RETURNING id, started_at`,
    [configId, runType, portal, details ? JSON.stringify(details) : null]
  );
  return rows[0];
}

async function finishLog(
  logId,
  startedAt,
  { status, newCount = 0, updatedCount = 0, offlineCount = 0, errorMessage = null, details = null }
) {
  const durationMs = Math.max(0, Date.now() - new Date(startedAt).getTime());
  await pool.query(
    `UPDATE scraper_logs
     SET status = $1,
         finished_at = NOW(),
         duration_ms = $2,
         new_count = $3,
         updated_count = $4,
         offline_count = $5,
         error_message = $6,
         details = COALESCE($7::jsonb, details)
     WHERE id = $8`,
    [
      status,
      durationMs,
      newCount,
      updatedCount,
      offlineCount,
      errorMessage,
      details ? JSON.stringify(details) : null,
      logId,
    ]
  );
}

async function isListingSuppressed(externalId, url = null) {
  const { rows } = await pool.query(
    `SELECT 1 FROM suppressed_listings WHERE external_id = $1 OR ($2::text IS NOT NULL AND url = $2)
     UNION ALL
     SELECT 1 FROM listings WHERE external_id = $1 AND status = 'manual_hidden'
     LIMIT 1`,
    [externalId, url]
  );
  return rows.length > 0;
}

async function upsertParsedListing(parsed, rules) {
  if (await isListingSuppressed(parsed.external_id, parsed.url)) {
    return null;
  }

  const calculatedBruttokalt = computeBruttokalt(parsed.cold_rent, parsed.additional_costs);
  const matchedMinBgSize = findMatchedMinBgSize(calculatedBruttokalt, rules);

  const { rows: beforeRows } = await pool.query(
    `SELECT * FROM listings WHERE external_id = $1 LIMIT 1`,
    [parsed.external_id]
  );
  const beforeListing = beforeRows[0] || null;

  const dup = await findCrossPortalDuplicate(parsed);
  if (dup.duplicate && !dup.incomingWon) {
    // Existing listing on another portal wins -> enrich winner and store duplicate as offline so delta-poll skips it
    await mergeUserReferencesAndMarkOffline(dup.existing, { ...parsed, id: null }, rules);
    await pool.query(
      `INSERT INTO listings (
         external_id, portal, title, url, city, district, zipcode,
         cold_rent, additional_costs, heating_costs, calculated_bruttokalt,
         sqm, rooms, is_private_landlord, wbs_required, matched_min_bg_size,
         contact_name, contact_phone, contact_email,
         status, first_seen_at, last_seen_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'offline',NOW(),NOW())
       ON CONFLICT (external_id) DO UPDATE SET
         status = CASE WHEN listings.status = 'manual_hidden' THEN 'manual_hidden' ELSE 'offline' END,
         last_seen_at = NOW()`,
      [
        parsed.external_id,
        parsed.portal,
        parsed.title,
        parsed.url,
        parsed.city,
        parsed.district,
        parsed.zipcode,
        parsed.cold_rent,
        parsed.additional_costs,
        parsed.heating_costs,
        calculatedBruttokalt,
        parsed.sqm,
        parsed.rooms,
        parsed.is_private_landlord,
        parsed.wbs_required,
        matchedMinBgSize,
        parsed.contact_name || null,
        parsed.contact_phone || null,
        parsed.contact_email || null,
      ]
    );
    console.log(
      `[Deduplicator] Cross-Portal-Duplikat ${parsed.external_id} übersprungen (Primär-Inserat: ${dup.existing.external_id}).`
    );
    return null;
  }

  const { rows } = await pool.query(
    `INSERT INTO listings (
       external_id, portal, title, url, city, district, zipcode,
       cold_rent, additional_costs, heating_costs, calculated_bruttokalt,
       sqm, rooms, is_private_landlord, wbs_required, matched_min_bg_size,
       contact_name, contact_phone, contact_email,
       status, first_seen_at, last_seen_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'active',NOW(),NOW())
     ON CONFLICT (external_id) DO UPDATE SET
       title = EXCLUDED.title,
       url = EXCLUDED.url,
       city = EXCLUDED.city,
       district = COALESCE(EXCLUDED.district, listings.district),
       zipcode = COALESCE(EXCLUDED.zipcode, listings.zipcode),
       cold_rent = COALESCE(EXCLUDED.cold_rent, listings.cold_rent),
       additional_costs = EXCLUDED.additional_costs,
       heating_costs = EXCLUDED.heating_costs,
       calculated_bruttokalt = EXCLUDED.calculated_bruttokalt,
       sqm = COALESCE(EXCLUDED.sqm, listings.sqm),
       rooms = COALESCE(EXCLUDED.rooms, listings.rooms),
       is_private_landlord = EXCLUDED.is_private_landlord,
       wbs_required = EXCLUDED.wbs_required,
       matched_min_bg_size = EXCLUDED.matched_min_bg_size,
       contact_name = COALESCE(NULLIF(listings.contact_name, ''), EXCLUDED.contact_name),
       contact_phone = COALESCE(NULLIF(listings.contact_phone, ''), EXCLUDED.contact_phone),
       contact_email = COALESCE(NULLIF(listings.contact_email, ''), EXCLUDED.contact_email),
       status = CASE WHEN listings.status = 'manual_hidden' THEN 'manual_hidden' ELSE 'active' END,
       last_seen_at = NOW()
     RETURNING *`,
    [
      parsed.external_id,
      parsed.portal,
      parsed.title,
      parsed.url,
      parsed.city,
      parsed.district,
      parsed.zipcode,
      parsed.cold_rent,
      parsed.additional_costs,
      parsed.heating_costs,
      calculatedBruttokalt,
      parsed.sqm,
      parsed.rooms,
      parsed.is_private_landlord,
      parsed.wbs_required,
      matchedMinBgSize,
      parsed.contact_name || null,
      parsed.contact_phone || null,
      parsed.contact_email || null,
    ]
  );

  const savedWinner = rows[0];
  if (beforeListing) {
    await notifyWatchersListingChanged({ before: beforeListing, after: savedWinner });
  }
  if (dup.duplicate && dup.incomingWon && dup.existing) {
    await mergeUserReferencesAndMarkOffline(savedWinner, dup.existing, rules);
    console.log(
      `[Deduplicator] Primär-Inserat ${savedWinner.external_id} hat Duplikat ${dup.existing.external_id} ersetzt.`
    );
  }

  return savedWinner;
}

export async function crawlSingleUrl(
  url,
  { runType = 'manual_url', city = 'Gelsenkirchen', proxyUrl = null } = {}
) {
  const portal = detectPortal(url);
  const log = await createLog({
    runType,
    portal,
    details: { url, city },
  });

  try {
    const res = await fetchStealthHtml(url, { proxyUrl, preferDesktop: true });
    const offlineCheck = isListingOfflineHtml(res.html, res.finalUrl, res.statusCode, portal);

    if (offlineCheck.offline) {
      await finishLog(log.id, log.started_at, {
        status: 'error',
        errorMessage: `Inserat nicht verfügbar (${offlineCheck.reason})`,
      });
      return { ok: false, reason: offlineCheck.reason };
    }

    if (res.statusCode >= 400) {
      throw new Error(`HTTP Status ${res.statusCode} beim Abruf von ${url}`);
    }

    const parsed = parseListingDetail(res.html, res.finalUrl || url, portal, city);
    if (await isListingSuppressed(parsed.external_id, parsed.url)) {
      const msg = 'Skipped: Inserat wurde vom Administrator ausgeblendet/gelöscht';
      await finishLog(log.id, log.started_at, {
        status: 'success',
        errorMessage: msg,
        details: { external_id: parsed.external_id, url: parsed.url },
      });
      return { ok: false, reason: msg };
    }
    const zipPrefixes = await getCityZipPrefixes(city);
    const validation = validateListing(parsed, city, { zipPrefixes });

    if (!validation.valid) {
      const msg = `Skipped: Validation failed [${validation.reason}]`;
      console.log(`[Validator] ${msg} (${parsed.external_id})`);
      await finishLog(log.id, log.started_at, {
        status: 'error',
        errorMessage: msg,
        details: { external_id: parsed.external_id, url: parsed.url, reason: validation.reason },
      });
      return { ok: false, reason: msg };
    }

    const rules = await getRulesForCity(city);
    const saved = await upsertParsedListing(parsed, rules);
    if (!saved) {
      const msg = 'Skipped: Cross-Portal-Duplikat (bereits über anderes Portal erfasst)';
      await finishLog(log.id, log.started_at, {
        status: 'success',
        errorMessage: msg,
        details: { external_id: parsed.external_id, url: parsed.url },
      });
      return { ok: false, reason: msg };
    }

    await finishLog(log.id, log.started_at, {
      status: 'success',
      newCount: 1,
      details: { external_id: saved.external_id, url: saved.url },
    });

    return { ok: true, listing: saved };
  } catch (err) {
    await finishLog(log.id, log.started_at, {
      status: 'error',
      errorMessage: err.message,
    });
    throw err;
  }
}

/**
 * Phase A: Delta-Poller
 * Checks page 1 & 2 of active configs (newest first).
 * Stops immediately once 4 consecutive known external_ids appear in a row.
 */
export async function runDeltaPoll({ configId = null } = {}) {
  if (runtimeLocks.deltaPollRunning) {
    return { skipped: true, reason: 'Delta-Poller läuft bereits.' };
  }

  runtimeLocks.deltaPollRunning = true;
  const summary = [];

  try {
    const { rows: configs } = configId
      ? await pool.query(`SELECT * FROM scraper_configs WHERE id = $1`, [configId])
      : await pool.query(`SELECT * FROM scraper_configs WHERE is_active = TRUE ORDER BY id ASC`);

    for (const cfg of configs) {
      const targetCity = cfg.city || 'Gelsenkirchen';
      const log = await createLog({
        configId: cfg.id,
        runType: 'delta_poll',
        portal: cfg.portal,
        details: { configName: cfg.name, city: targetCity },
      });

      let newCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;
      let stoppedEarly = false;
      const errors = [];
      const skippedSamples = [];

      try {
        const rules = await getRulesForCity(targetCity);
        const zipPrefixes = await getCityZipPrefixes(targetCity);
        let consecutiveKnown = 0;

        for (const page of [1, 2]) {
          if (stoppedEarly) break;

          const pagedUrl = buildPagedSearchUrl(cfg.search_url, page, cfg.portal);
          if (page > 1 && pagedUrl === cfg.search_url) break;
          const searchRes = await fetchStealthHtml(pagedUrl, {
            proxyUrl: cfg.proxy_url,
            preferDesktop: true,
          });

          if (searchRes.statusCode >= 400) {
            errors.push(`Seite ${page}: HTTP ${searchRes.statusCode}`);
            break;
          }

          const candidates = extractSearchListingLinks(
            searchRes.html,
            pagedUrl,
            cfg.portal,
            targetCity
          );
          if (candidates.length === 0) {
            if (page === 1) {
              errors.push(`Seite ${page}: Keine Inserat-Links extrahiert.`);
            }
            break;
          }

          const extIds = candidates.map((c) => c.externalId);
          const { rows: existingRows } = await pool.query(
            `SELECT external_id, status FROM listings WHERE external_id = ANY($1::text[])`,
            [extIds]
          );
          const { rows: suppressedRows } = await pool.query(
            `SELECT external_id FROM suppressed_listings WHERE external_id = ANY($1::text[])`,
            [extIds]
          );

          const hiddenSet = new Set(
            existingRows.filter((r) => r.status === 'manual_hidden').map((r) => r.external_id)
          );
          const suppressedSet = new Set(suppressedRows.map((r) => r.external_id));
          const knownSet = new Set(
            existingRows.filter((r) => r.status !== 'manual_hidden').map((r) => r.external_id)
          );

          for (const candidate of candidates) {
            if (suppressedSet.has(candidate.externalId) || hiddenSet.has(candidate.externalId)) {
              skippedCount++;
              continue;
            }

            if (knownSet.has(candidate.externalId)) {
              consecutiveKnown++;
              updatedCount++;
              await pool.query(
                `UPDATE listings SET last_seen_at = NOW() WHERE external_id = $1`,
                [candidate.externalId]
              );

              if (consecutiveKnown >= 4) {
                stoppedEarly = true;
                break;
              }
              continue;
            }

            consecutiveKnown = 0;
            let parsed = null;

            // If SERP card already parsed everything (e.g. Immowelt), try detail page for NK/exact text,
            // and fall back cleanly to SERP card if detail page is blocked (403/429).
            await sleepJitter(cfg.jitter_min_ms, cfg.jitter_max_ms);

            try {
              const detailRes = await fetchStealthHtml(candidate.url, {
                proxyUrl: cfg.proxy_url,
                referer: pagedUrl,
                preferDesktop: true,
              });

              const offlineCheck = isListingOfflineHtml(
                detailRes.html,
                detailRes.finalUrl,
                detailRes.statusCode,
                cfg.portal
              );
              if (offlineCheck.offline) {
                continue;
              }

              if (detailRes.statusCode >= 400) {
                if (candidate.serpParsed) {
                  parsed = candidate.serpParsed;
                } else {
                  errors.push(`${candidate.externalId}: HTTP ${detailRes.statusCode}`);
                  continue;
                }
              } else {
                parsed = parseListingDetail(
                  detailRes.html,
                  detailRes.finalUrl || candidate.url,
                  cfg.portal,
                  targetCity
                );
                if (!parsed.title && candidate.quickTitle) {
                  parsed.title = candidate.quickTitle;
                }
              }
            } catch (detailErr) {
              if (candidate.serpParsed) {
                parsed = candidate.serpParsed;
              } else {
                errors.push(`${candidate.externalId}: ${detailErr.message}`);
                continue;
              }
            }

            if (!parsed) continue;

            // Strict Validation Firewall before PostgreSQL insert
            const validation = validateListing(parsed, targetCity, { zipPrefixes });
            if (!validation.valid) {
              skippedCount++;
              const skipMsg = `Skipped: Validation failed [${validation.reason}]`;
              console.log(`[Validator] ${skipMsg} (${parsed.external_id})`);
              if (skippedSamples.length < 15) {
                skippedSamples.push(`${parsed.external_id}: ${validation.reason}`);
              }
              continue;
            }

            const saved = await upsertParsedListing(parsed, rules);
            if (saved) {
              newCount++;
            } else {
              skippedCount++;
            }
          }

          if (!stoppedEarly && page === 1) {
            await sleepJitter(cfg.jitter_min_ms, cfg.jitter_max_ms);
          }
        }

        const status =
          errors.length === 0
            ? 'success'
            : newCount > 0 || updatedCount > 0 || skippedCount > 0
              ? 'partial'
              : 'error';

        const infoNotes = [];
        if (skippedCount > 0) infoNotes.push(`${skippedCount} verworfen (Validierung)`);
        if (errors.length > 0) infoNotes.push(errors.slice(0, 4).join(' | '));

        await finishLog(log.id, log.started_at, {
          status,
          newCount,
          updatedCount,
          errorMessage: infoNotes.length > 0 ? infoNotes.join(' · ') : null,
          details: {
            stoppedEarly,
            skippedCount,
            skippedSamples,
            configName: cfg.name,
          },
        });

        summary.push({
          configId: cfg.id,
          name: cfg.name,
          status,
          newCount,
          updatedCount,
          skippedCount,
          stoppedEarly,
        });
      } catch (cfgErr) {
        await finishLog(log.id, log.started_at, {
          status: 'error',
          newCount,
          updatedCount,
          errorMessage: cfgErr.message,
          details: { skippedCount, skippedSamples, configName: cfg.name },
        });
        summary.push({ configId: cfg.id, name: cfg.name, status: 'error', error: cfgErr.message });
      }
    }

    return { skipped: false, summary };
  } finally {
    runtimeLocks.deltaPollRunning = false;
  }
}

/**
 * Phase B: Garbage Collector / Reconciler
 * Verifies active listings and marks 404 / 410 / redirected / deleted listings as offline.
 */
export async function runReconciler({ batchLimit = 60 } = {}) {
  if (runtimeLocks.reconcileRunning) {
    return { skipped: true, reason: 'Reconciler läuft bereits.' };
  }

  runtimeLocks.reconcileRunning = true;
  const log = await createLog({
    runType: 'reconcile',
    portal: 'all',
    details: { batchLimit },
  });

  let updatedCount = 0;
  let offlineCount = 0;
  const errors = [];

  try {
    const { rows: activeListings } = await pool.query(
      `SELECT *
       FROM listings
       WHERE status = 'active'
       ORDER BY last_seen_at ASC
       LIMIT $1`,
      [batchLimit]
    );

    for (const item of activeListings) {
      await sleepJitter(3500, 9000);
      try {
        const res = await fetchStealthHtml(item.url, { preferDesktop: true });
        const offlineCheck = isListingOfflineHtml(
          res.html,
          res.finalUrl,
          res.statusCode,
          item.portal
        );

        if (offlineCheck.offline) {
          const { rows: offRows } = await pool.query(
            `UPDATE listings SET status = 'offline', last_seen_at = NOW() WHERE id = $1 RETURNING *`,
            [item.id]
          );
          if (offRows[0]) {
            await notifyWatchersListingChanged({ before: item, after: offRows[0] });
          }
          offlineCount++;
        } else if (res.statusCode >= 200 && res.statusCode < 400) {
          const parsedContact = parseListingDetail(
            res.html,
            res.finalUrl || item.url,
            item.portal
          );
          await pool.query(
            `UPDATE listings
             SET contact_name = COALESCE(NULLIF(contact_name, ''), $2),
                 contact_phone = COALESCE(NULLIF(contact_phone, ''), $3),
                 contact_email = COALESCE(NULLIF(contact_email, ''), $4),
                 last_seen_at = NOW()
             WHERE id = $1`,
            [
              item.id,
              parsedContact.contact_name || null,
              parsedContact.contact_phone || null,
              parsedContact.contact_email || null,
            ]
          );
          updatedCount++;
        }
      } catch (err) {
        errors.push(`${item.external_id}: ${err.message}`);
      }
    }

    const status =
      errors.length === 0 ? 'success' : updatedCount + offlineCount > 0 ? 'partial' : 'error';

    await finishLog(log.id, log.started_at, {
      status,
      updatedCount,
      offlineCount,
      errorMessage: errors.length > 0 ? errors.slice(0, 5).join(' | ') : null,
      details: { checked: activeListings.length },
    });

    return { skipped: false, checked: activeListings.length, updatedCount, offlineCount };
  } catch (err) {
    await finishLog(log.id, log.started_at, {
      status: 'error',
      updatedCount,
      offlineCount,
      errorMessage: err.message,
    });
    throw err;
  } finally {
    runtimeLocks.reconcileRunning = false;
  }
}
