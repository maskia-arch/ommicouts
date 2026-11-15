import { pool } from '../db.js';
import { computeBruttokalt, findMatchedMinBgSize } from './kduMatcher.js';

export function normalizeTitleForMatch(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '');
}

export function extractStreetForMatch(text) {
  if (!text) return null;
  const match = String(text).match(
    /\b(?:(?:am|an\s+der|auf\s+dem|auf\s+der|in\s+der|im|alte|alter|neue|neuer)\s+)?([a-zäöüß\-]+(?:\s*(?:str(?:aße|asse)?\.?|weg|platz|gasse|allee|delle|hof|ring|damm)))\s+(\d+\s*[a-z]?)\b/i
  );
  if (match) {
    const streetName = match[1]
      .toLowerCase()
      .replace(/str\./g, 'strasse')
      .replace(/str$/g, 'strasse')
      .replace(/straße/g, 'strasse')
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]/g, '');
    const houseNum = match[2].toLowerCase().replace(/[^a-z0-9]/g, '');
    return `${streetName}${houseNum}`;
  }
  return null;
}

export function getListingOriginKey(listing) {
  if (!listing) return '';
  const url = String(listing.url || '').toLowerCase();
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host) return host;
  } catch {
    // fallback
  }
  const ext = String(listing.external_id || '').toLowerCase();
  const match = ext.match(/^([a-z0-9]+)_/);
  if (match) return match[1];
  return String(listing.portal || '').toLowerCase();
}

function isSyndicatedWithoutAgentText(listing) {
  const hay = `${listing.contact_name || ''} ${listing.title || ''}`.toLowerCase();
  return /om\s+ohne\s+makler|ohne\s+makler\s*-\s*privat/.test(hay);
}

function isGenericTitle(title) {
  const t = String(title || '').trim().toLowerCase();
  return (
    !t ||
    t === 'von privat' ||
    t.startsWith('wohnung zur miete - ') ||
    t.startsWith('zbvv - zentral boden')
  );
}

/**
 * Scores a listing's canonical quality so primary landlord/municipal portals
 * and richer metadata always beat syndicated or sparse cross-portal copies.
 */
export function computeListingPriorityScore(listing) {
  let score = 0;
  const ext = String(listing.external_id || '').toLowerCase();
  const url = String(listing.url || '').toLowerCase();
  const portal = String(listing.portal || '').toLowerCase();

  // Primary municipal/landlord portals have top precedence
  if (ext.startsWith('ge_aushang_') || url.includes('wohnungsaushang') || url.includes('gelsenkirchen.de')) {
    score += 50; // Official municipal board (direct landlord phone)
  } else if (ext.startsWith('om_') || ext.startsWith('ggw_') || url.includes('ohne-makler.net') || url.includes('ggw-gelsenkirchen.de')) {
    score += 40; // Direct landlord/housing company
  } else if (portal === 'kleinanzeigen' || url.includes('kleinanzeigen.de')) {
    score += 25;
  } else if (portal === 'immowelt' || url.includes('immowelt.de')) {
    score += 18;
  } else if (url.includes('mietsofort.de')) {
    score += 15;
  } else if (url.includes('rentola.de')) {
    score += 14;
  } else {
    score += 10;
  }

  if (portal === 'kleinanzeigen' && isSyndicatedWithoutAgentText(listing)) {
    score -= 20;
  }

  if (listing.contact_phone) score += 10;
  if (listing.contact_email) score += 10;
  if (Number(listing.additional_costs || 0) > 0) score += 10;
  if (!isGenericTitle(listing.title)) score += 8;

  return score;
}

/**
 * Determines whether two listings from different portals describe the exact same apartment.
 */
export function isCrossPortalDuplicatePair(a, b) {
  if (!a || !b) return false;
  if (a.external_id && b.external_id && a.external_id === b.external_id) return false;

  const originA = getListingOriginKey(a);
  const originB = getListingOriginKey(b);
  if (!originA || !originB || originA === originB) return false;

  const cityA = String(a.city || '').trim().toLowerCase();
  const cityB = String(b.city || '').trim().toLowerCase();
  if (cityA && cityB && cityA !== cityB) return false;

  const sqmA = Number(a.sqm);
  const sqmB = Number(b.sqm);
  const rentA = Number(a.cold_rent);
  const rentB = Number(b.cold_rent);
  if (
    !Number.isFinite(sqmA) ||
    !Number.isFinite(sqmB) ||
    !Number.isFinite(rentA) ||
    !Number.isFinite(rentB)
  ) {
    return false;
  }

  if (Math.abs(sqmA - sqmB) > 1.0) return false;
  if (Math.abs(rentA - rentB) > 5.0) return false;

  const streetA = extractStreetForMatch(`${a.title || ''} ${a.locality_raw || ''} ${a.url || ''}`);
  const streetB = extractStreetForMatch(`${b.title || ''} ${b.locality_raw || ''} ${b.url || ''}`);
  const streetMatch = streetA && streetB && streetA === streetB;

  const zipA = String(a.zipcode || '').trim();
  const zipB = String(b.zipcode || '').trim();
  const titleA = normalizeTitleForMatch(a.title);
  const titleB = normalizeTitleForMatch(b.title);
  const strongTitleMatch =
    titleA.length >= 16 &&
    titleB.length >= 16 &&
    (titleA === titleB || titleA.startsWith(titleB.slice(0, 24)) || titleB.startsWith(titleA.slice(0, 24)));

  if (streetMatch) {
    // Exact street + house number matched with matching rent and sqm
    return true;
  }

  if (zipA && zipB) {
    if (zipA !== zipB) return false;
  } else if (!strongTitleMatch) {
    return false;
  }

  const roomsA = Number(a.rooms);
  const roomsB = Number(b.rooms);
  const roomsMatch =
    !Number.isFinite(roomsA) ||
    !Number.isFinite(roomsB) ||
    roomsA <= 0 ||
    roomsB <= 0 ||
    Math.abs(roomsA - roomsB) <= 0.1;

  return roomsMatch || strongTitleMatch;
}

export function pickDuplicateWinner(a, b) {
  const scoreA = computeListingPriorityScore(a);
  const scoreB = computeListingPriorityScore(b);
  if (scoreA !== scoreB) {
    return scoreA > scoreB ? { winner: a, loser: b } : { winner: b, loser: a };
  }
  const timeA = a.first_seen_at ? new Date(a.first_seen_at).getTime() : Number.MAX_SAFE_INTEGER;
  const timeB = b.first_seen_at ? new Date(b.first_seen_at).getTime() : Number.MAX_SAFE_INTEGER;
  return timeA <= timeB ? { winner: a, loser: b } : { winner: b, loser: a };
}

async function mergeUserReferencesAndMarkOffline(winner, loser, rules = null) {
  const rawLoserName = loser.contact_name && !isSyndicatedWithoutAgentText(loser) ? loser.contact_name : null;
  const contactName = winner.contact_name || rawLoserName || null;
  const contactPhone = winner.contact_phone || loser.contact_phone || null;
  const contactEmail = winner.contact_email || loser.contact_email || null;

  const winnerNk = Number(winner.additional_costs || 0);
  const loserNk = Number(loser.additional_costs || 0);
  const nextAdditional = winnerNk <= 0 && loserNk > 0 ? loserNk : winnerNk;
  const coldRent = Number(winner.cold_rent ?? loser.cold_rent ?? 0);
  const nextBruttokalt = computeBruttokalt(coldRent, nextAdditional);

  let nextBgSize = winner.matched_min_bg_size ?? null;
  if (Array.isArray(rules) && rules.length > 0 && nextAdditional !== winnerNk) {
    nextBgSize = findMatchedMinBgSize(nextBruttokalt, rules);
  }

  await pool.query(
    `UPDATE listings
     SET contact_name = COALESCE(NULLIF(contact_name, ''), $1),
         contact_phone = COALESCE(NULLIF(contact_phone, ''), $2),
         contact_email = COALESCE(NULLIF(contact_email, ''), $3),
         additional_costs = $4,
         calculated_bruttokalt = $5,
         matched_min_bg_size = COALESCE($6, matched_min_bg_size),
         last_seen_at = NOW()
     WHERE id = $7`,
    [contactName, contactPhone, contactEmail, nextAdditional, nextBruttokalt, nextBgSize, winner.id]
  );

  if (loser.id) {
    await pool.query(
      `UPDATE user_applications ua
       SET listing_id = $1
       WHERE ua.listing_id = $2
         AND NOT EXISTS (
           SELECT 1 FROM user_applications ua2
           WHERE ua2.user_id = ua.user_id AND ua2.listing_id = $1
         )`,
      [winner.id, loser.id]
    );
    await pool.query(`DELETE FROM user_applications WHERE listing_id = $1`, [loser.id]);

    await pool.query(
      `UPDATE user_hidden_listings uhl
       SET listing_id = $1
       WHERE uhl.listing_id = $2
         AND NOT EXISTS (
           SELECT 1 FROM user_hidden_listings u2
           WHERE u2.user_id = uhl.user_id AND u2.listing_id = $1
         )`,
      [winner.id, loser.id]
    );
    await pool.query(`DELETE FROM user_hidden_listings WHERE listing_id = $1`, [loser.id]);

    await pool.query(
      `UPDATE listings
       SET status = CASE WHEN status = 'manual_hidden' THEN 'manual_hidden' ELSE 'offline' END
       WHERE id = $1`,
      [loser.id]
    );
  }
}

/**
 * Checks if a parsed incoming listing already has an active cross-portal counterpart.
 * Returns { duplicate: false } or { duplicate: true, winner, incomingWon }.
 */
export async function findCrossPortalDuplicate(parsed) {
  const originIncoming = getListingOriginKey(parsed);
  const { rows: candidates } = await pool.query(
    `SELECT *
     FROM listings
     WHERE status = 'active'
       AND LOWER(city) = LOWER($1)
       AND external_id <> $2`,
    [parsed.city, parsed.external_id]
  );

  for (const existing of candidates) {
    const originExisting = getListingOriginKey(existing);
    if (originIncoming && originExisting && originIncoming === originExisting) continue;
    if (!isCrossPortalDuplicatePair(parsed, existing)) continue;

    const scoreIncoming = computeListingPriorityScore(parsed);
    const scoreExisting = computeListingPriorityScore(existing);
    if (scoreIncoming > scoreExisting) {
      return { duplicate: true, existing, incomingWon: true };
    }
    return { duplicate: true, existing, incomingWon: false };
  }

  return { duplicate: false, existing: null, incomingWon: false };
}

/**
 * Scans all currently active listings and consolidates cross-portal duplicates,
 * preserving the canonical winner and marking duplicate entries as offline.
 */
export async function deduplicateActiveListings() {
  const { rows: activeListings } = await pool.query(
    `SELECT * FROM listings WHERE status = 'active' ORDER BY first_seen_at ASC, id ASC`
  );

  const { rows: allRules } = await pool.query(
    `SELECT city, bg_size, max_sqm, max_bruttokalt_eur, extra_person_sqm, extra_person_eur FROM kdu_rules`
  );

  const deactivatedIds = new Set();
  const mergedPairs = [];

  for (let i = 0; i < activeListings.length; i++) {
    const a = activeListings[i];
    if (deactivatedIds.has(a.id)) continue;

    for (let j = i + 1; j < activeListings.length; j++) {
      const b = activeListings[j];
      if (deactivatedIds.has(b.id)) continue;

      if (!isCrossPortalDuplicatePair(a, b)) continue;

      const { winner, loser } = pickDuplicateWinner(a, b);
      const cityRules = allRules.filter(
        (r) => String(r.city).toLowerCase() === String(winner.city || '').toLowerCase()
      );
      await mergeUserReferencesAndMarkOffline(winner, loser, cityRules);

      // Update in-memory winner object for subsequent comparisons in the loop
      if (!winner.contact_name && loser.contact_name) winner.contact_name = loser.contact_name;
      if (!winner.contact_phone && loser.contact_phone) winner.contact_phone = loser.contact_phone;
      if (!winner.contact_email && loser.contact_email) winner.contact_email = loser.contact_email;
      if (Number(winner.additional_costs || 0) <= 0 && Number(loser.additional_costs || 0) > 0) {
        winner.additional_costs = loser.additional_costs;
      }

      deactivatedIds.add(loser.id);
      mergedPairs.push({
        winner: `${winner.portal}:${winner.external_id}`,
        loser: `${loser.portal}:${loser.external_id}`,
        title: winner.title,
      });

      if (loser.id === a.id) break;
    }
  }

  return {
    deduplicatedCount: deactivatedIds.size,
    pairs: mergedPairs,
  };
}

export { mergeUserReferencesAndMarkOffline };
