import crypto from 'node:crypto';
import * as cheerio from 'cheerio';

const GELSENKIRCHEN_DISTRICTS = [
  'Schalke-Nord',
  'Bulmke-Hüllen',
  'Resser Mark',
  'Beckhausen',
  'Ückendorf',
  'Rotthausen',
  'Bismarck',
  'Feldmark',
  'Neustadt',
  'Altstadt',
  'Scholven',
  'Schalke',
  'Heßler',
  'Hessler',
  'Hassel',
  'Horst',
  'Resse',
  'Erle',
  'Buer',
];

const COMMERCIAL_KEYWORDS = [
  'gmbh',
  'mbh',
  'ug (haftungsbeschränkt)',
  'ag ',
  'kg ',
  'ohg',
  'gbr',
  'makler',
  'immobilien',
  'hausverwaltung',
  'wohnungsgesellschaft',
  'wohnungsbau',
  'wohnungsgenossenschaft',
  'vivawest',
  'vonovia',
  'leg wohnen',
  'grand city',
  'gcp',
  'tag immobilien',
  'covivio',
  'ggw',
  'gewerblicher anbieter',
  'gewerblich',
  'provisionspflichtig',
];

const PRIVATE_KEYWORDS = [
  'privater anbieter',
  'privatvermieter',
  'von privat',
  'privat zu vermieten',
  'private vermietung',
  'eigentümer',
];

export function detectPortal(url) {
  const lower = String(url || '').toLowerCase();
  if (lower.includes('kleinanzeigen.de')) return 'kleinanzeigen';
  if (lower.includes('immowelt.de')) return 'immowelt';
  if (lower.includes('immobilienscout24.de')) return 'immoscout';
  return 'other';
}

export function normalizeListingUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    u.hash = '';
    const stripParams = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_content',
      'utm_term',
      'fbclid',
      'gclid',
      'referrer',
      'searchId',
    ];
    for (const p of stripParams) {
      u.searchParams.delete(p);
    }
    return u.toString();
  } catch {
    return String(rawUrl || '').trim();
  }
}

export function extractExternalId(url, portal = null) {
  const resolvedPortal = portal || detectPortal(url);
  const cleanUrl = normalizeListingUrl(url);

  if (resolvedPortal === 'kleinanzeigen') {
    const match = cleanUrl.match(/\/(\d{6,14})(?:-[\d-]+)?(?:\?.*)?$/);
    if (match) return `ka_${match[1]}`;
  }

  if (resolvedPortal === 'immowelt') {
    const match = cleanUrl.match(/\/expose\/([a-zA-Z0-9_-]+)/i);
    if (match) return `iw_${match[1]}`;
  }

  if (resolvedPortal === 'immoscout') {
    const match = cleanUrl.match(/\/expose\/(\d+)/i);
    if (match) return `is_${match[1]}`;
  }

  const hash = crypto.createHash('sha1').update(cleanUrl).digest('hex').slice(0, 14);
  const prefix =
    resolvedPortal === 'kleinanzeigen'
      ? 'ka'
      : resolvedPortal === 'immowelt'
        ? 'iw'
        : resolvedPortal === 'immoscout'
          ? 'is'
          : 'other';
  return `${prefix}_${hash}`;
}

export function buildPagedSearchUrl(baseUrl, page, portal) {
  if (page <= 1) return baseUrl;
  try {
    const u = new URL(baseUrl);
    if (portal === 'kleinanzeigen') {
      if (/\/seite:\d+\//i.test(u.pathname)) {
        u.pathname = u.pathname.replace(/\/seite:\d+\//i, `/seite:${page}/`);
      } else {
        u.pathname = u.pathname.replace(/\/(c\d+l\d+)$/i, `/seite:${page}/$1`);
        if (!/\/seite:\d+\//i.test(u.pathname)) {
          u.pathname = `${u.pathname.replace(/\/$/, '')}/seite:${page}`;
        }
      }
      return u.toString();
    }

    if (portal === 'immowelt') {
      u.searchParams.set('sp', String(page));
      return u.toString();
    }

    u.searchParams.set('page', String(page));
    return u.toString();
  } catch {
    return baseUrl;
  }
}

/**
 * Parses German formatted numbers like "367,50 €", "1.250,00 EUR", "50,5 m²".
 */
export function parseGermanNumber(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const str = String(raw).trim();
  if (!str) return null;

  // Match number token like 1.234,56 or 450,50 or 450
  const m = str.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/);
  if (!m) return null;

  let token = m[1];
  if (token.includes(',') && token.includes('.')) {
    token = token.replace(/\./g, '').replace(',', '.');
  } else if (token.includes(',')) {
    token = token.replace(',', '.');
  } else if (/^\d{1,3}\.\d{3}$/.test(token)) {
    token = token.replace('.', '');
  }

  const num = Number(token);
  return Number.isFinite(num) ? num : null;
}

function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function collectJsonLd($) {
  const items = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).html();
    if (!raw) return;
    const parsed = safeJsonParse(raw.trim());
    if (!parsed) return;
    if (Array.isArray(parsed)) {
      items.push(...parsed);
    } else if (parsed['@graph'] && Array.isArray(parsed['@graph'])) {
      items.push(...parsed['@graph']);
    } else {
      items.push(parsed);
    }
  });
  return items;
}

function collectNextData($) {
  const raw = $('script#__NEXT_DATA__').html();
  if (!raw) return null;
  return safeJsonParse(raw.trim());
}

/**
 * Recursively finds objects/strings matching keys in hydration JSON.
 */
function deepSearchObjects(obj, predicate, results = [], seen = new Set()) {
  if (!obj || typeof obj !== 'object' || seen.has(obj)) return results;
  seen.add(obj);
  if (predicate(obj)) results.push(obj);
  if (Array.isArray(obj)) {
    for (const item of obj) deepSearchObjects(item, predicate, results, seen);
  } else {
    for (const val of Object.values(obj)) deepSearchObjects(val, predicate, results, seen);
  }
  return results;
}

export function extractSearchListingLinks(html, baseUrl, portal) {
  const $ = cheerio.load(html);
  const found = [];
  const seenIds = new Set();

  const pushCandidate = (rawHref, quickMeta = {}) => {
    if (!rawHref) return;
    let absUrl;
    try {
      absUrl = normalizeListingUrl(new URL(rawHref, baseUrl).toString());
    } catch {
      return;
    }

    if (portal === 'kleinanzeigen' && !absUrl.includes('/s-anzeige/')) return;
    if (portal === 'immowelt' && !absUrl.includes('/expose/')) return;
    if (portal === 'immoscout' && !absUrl.includes('/expose/')) return;

    const externalId = extractExternalId(absUrl, portal);
    if (seenIds.has(externalId)) return;
    seenIds.add(externalId);
    found.push({
      externalId,
      url: absUrl,
      portal,
      quickTitle: quickMeta.title ? String(quickMeta.title).trim() : null,
    });
  };

  // 1. JSON-LD ItemList
  for (const ld of collectJsonLd($)) {
    if (ld['@type'] === 'ItemList' && Array.isArray(ld.itemListElement)) {
      for (const el of ld.itemListElement) {
        const url = el.url || el.item?.url;
        const name = el.name || el.item?.name;
        pushCandidate(url, { title: name });
      }
    }
  }

  // 2. __NEXT_DATA__ hydration
  const nextData = collectNextData($);
  if (nextData) {
    const urlMatches = deepSearchObjects(
      nextData,
      (o) =>
        typeof o.url === 'string' &&
        (o.url.includes('/expose/') || o.url.includes('/s-anzeige/'))
    );
    for (const m of urlMatches) {
      pushCandidate(m.url, { title: m.title || m.headline || m.name });
    }
  }

  // 3. Portal DOM selectors (preserving newest-first visual order)
  if (portal === 'kleinanzeigen') {
    // Skip top-ads / featured banners if marked, or keep main list items
    $('article.aditem').each((_, el) => {
      const isTopAd = $(el).hasClass('is-topad') || $(el).closest('#srchrslt-adtable-topads').length > 0;
      if (isTopAd) return;
      const link = $(el).find('a[href*="/s-anzeige/"]').first();
      const href = link.attr('href');
      const title = link.text().trim() || $(el).find('.text-module-begin a').text().trim();
      pushCandidate(href, { title });
    });
    // Fallback if layout differs
    if (found.length === 0) {
      $('a[href*="/s-anzeige/"]').each((_, el) => {
        pushCandidate($(el).attr('href'), { title: $(el).text().trim() });
      });
    }
  } else if (portal === 'immowelt') {
    $('a[href*="/expose/"]').each((_, el) => {
      pushCandidate($(el).attr('href'), { title: $(el).text().trim() });
    });
  } else {
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (href && (href.includes('/expose/') || href.includes('/s-anzeige/'))) {
        pushCandidate(href, { title: $(el).text().trim() });
      }
    });
  }

  return found;
}

export function detectDistrict(text, fallbackCity = 'Gelsenkirchen') {
  if (!text) return null;
  const normalized = String(text);
  for (const d of GELSENKIRCHEN_DISTRICTS) {
    const regex = new RegExp(`\\b${d.replace('-', '[-\\s]?')}\\b`, 'i');
    if (regex.test(normalized)) {
      if (d === 'Hessler') return 'Heßler';
      return d;
    }
  }
  if (normalized.toLowerCase().includes(fallbackCity.toLowerCase())) {
    return fallbackCity;
  }
  return null;
}

export function detectZipcode(text) {
  if (!text) return null;
  // Prefer Gelsenkirchen PLZ range (45879 - 45899)
  const geMatch = String(text).match(/\b(458[7-9]\d)\b/);
  if (geMatch) return geMatch[1];
  const anyMatch = String(text).match(/\b(\d{5})\b/);
  return anyMatch ? anyMatch[1] : null;
}

export function detectWbsRequired(text) {
  if (!text) return false;
  const lower = String(text).toLowerCase();
  if (!/\bwbs\b|wohnberechtigungsschein/.test(lower)) return false;
  if (
    /(?:kein|ohne|nicht\s+erforderlich|nicht\s+nötig|nicht\s+benötigt)[^.\n]{0,25}(?:wbs|wohnberechtigungsschein)|(?:wbs|wohnberechtigungsschein)[^.\n]{0,25}(?:nicht\s+erforderlich|nicht\s+nötig|entfällt|nicht\s+benötigt)/.test(
      lower
    )
  ) {
    return false;
  }
  return true;
}

export function detectPrivateLandlord({
  sellerTypeRaw = '',
  sellerName = '',
  fullText = '',
  portal = 'other',
}) {
  const combinedSeller = `${sellerTypeRaw} ${sellerName}`.toLowerCase();
  const lowerText = fullText.toLowerCase();

  if (
    combinedSeller.includes('private') ||
    combinedSeller.includes('privat') ||
    sellerTypeRaw.toLowerCase() === 'private'
  ) {
    // Double check sellerName doesn't explicitly contain commercial entity
    if (!COMMERCIAL_KEYWORDS.some((kw) => sellerName.toLowerCase().includes(kw))) {
      return true;
    }
  }

  if (
    combinedSeller.includes('commercial') ||
    combinedSeller.includes('gewerblich') ||
    combinedSeller.includes('business') ||
    combinedSeller.includes('agency')
  ) {
    return false;
  }

  for (const kw of COMMERCIAL_KEYWORDS) {
    if (combinedSeller.includes(kw) || lowerText.includes(kw)) {
      return false;
    }
  }

  for (const kw of PRIVATE_KEYWORDS) {
    if (combinedSeller.includes(kw) || lowerText.includes(kw)) {
      return true;
    }
  }

  // On Kleinanzeigen, if no commercial tag is present and no GmbH/Makler keywords appear,
  // check for explicit Kleinanzeigen badge or default conservative false unless verified
  if (portal === 'kleinanzeigen' && lowerText.includes('privater nutzer')) {
    return true;
  }

  return false;
}

function extractCostsFromText(text) {
  const t = String(text || '');
  let coldRent = null;
  let additionalCosts = null;
  let heatingCosts = null;
  let sqm = null;
  let rooms = null;

  const coldPatterns = [
    /(?:kaltmiete|nettokaltmiete|grundmiete|miete\s+kalt)\s*[:\-]?\s*(?:ca\.?\s*)?(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:€|eur)/i,
    /(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:€|eur)\s*(?:kaltmiete|kalt\b)/i,
  ];
  for (const re of coldPatterns) {
    const m = t.match(re);
    if (m) {
      coldRent = parseGermanNumber(m[1]);
      if (coldRent) break;
    }
  }

  const nkPatterns = [
    /(?:kalte\s+betriebskosten|betriebskosten|nebenkosten|nk)\s*[:\-]?\s*(?:ca\.?\s*|\+\s*)?(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:€|eur)/i,
    /(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:€|eur)\s*(?:nebenkosten|betriebskosten|\bnk\b)/i,
  ];
  for (const re of nkPatterns) {
    const m = t.match(re);
    if (m) {
      additionalCosts = parseGermanNumber(m[1]);
      if (additionalCosts !== null) break;
    }
  }

  const hkPatterns = [
    /(?:heizkosten|heizung|hk)\s*[:\-]?\s*(?:ca\.?\s*|\+\s*)?(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:€|eur)/i,
  ];
  for (const re of hkPatterns) {
    const m = t.match(re);
    if (m) {
      heatingCosts = parseGermanNumber(m[1]);
      if (heatingCosts !== null) break;
    }
  }

  const sqmMatch = t.match(
    /(?:wohnfläche|fläche|größe)\s*[:\-]?\s*(?:ca\.?\s*)?(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:m²|qm|m2)/i
  ) || t.match(/(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:m²|qm)\b/i);
  if (sqmMatch) {
    sqm = parseGermanNumber(sqmMatch[1]);
  }

  const roomMatch = t.match(
    /(?:zimmer(?:anzahl)?)\s*[:\-]?\s*(\d{1,2}(?:[.,]\d)?)/i
  ) || t.match(/(\d{1,2}(?:[.,]\d)?)\s*(?:zimmer|zi\.|zimm\b)/i);
  if (roomMatch) {
    rooms = parseGermanNumber(roomMatch[1]);
  }

  return { coldRent, additionalCosts, heatingCosts, sqm, rooms };
}

/**
 * Parses a listing detail HTML page using JSON-LD, __NEXT_DATA__, DOM & Regex fallback.
 * Never persists description text or image URLs.
 */
export function parseListingDetail(html, url, portal = null, defaultCity = 'Gelsenkirchen') {
  const resolvedPortal = portal || detectPortal(url);
  const cleanUrl = normalizeListingUrl(url);
  const externalId = extractExternalId(cleanUrl, resolvedPortal);
  const $ = cheerio.load(html);

  let title = '';
  let coldRent = null;
  let additionalCosts = null;
  let heatingCosts = null;
  let sqm = null;
  let rooms = null;
  let district = null;
  let zipcode = null;
  let sellerTypeRaw = '';
  let sellerName = '';
  let descriptionText = '';

  // 1. JSON-LD extraction
  const jsonLds = collectJsonLd($);
  for (const ld of jsonLds) {
    if (!title && (ld.name || ld.headline)) {
      title = String(ld.name || ld.headline).trim();
    }
    if (!descriptionText && ld.description) {
      descriptionText = String(ld.description);
    }
    if (ld.offers) {
      const offer = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers;
      if (offer?.price && coldRent === null) {
        coldRent = parseGermanNumber(offer.price);
      }
      if (offer?.seller) {
        if (offer.seller['@type']) sellerTypeRaw += ` ${offer.seller['@type']}`;
        if (offer.seller.name) sellerName += ` ${offer.seller.name}`;
      }
    }
    if (ld.floorSize?.value && sqm === null) {
      sqm = parseGermanNumber(ld.floorSize.value);
    }
    if (ld.numberOfRooms && rooms === null) {
      rooms = parseGermanNumber(ld.numberOfRooms);
    }
    if (ld.address) {
      if (ld.address.postalCode && !zipcode) zipcode = String(ld.address.postalCode).trim();
      if (ld.address.addressLocality && !district) {
        district = detectDistrict(ld.address.addressLocality, defaultCity);
      }
    }
  }

  // 2. __NEXT_DATA__ hydration extraction
  const nextData = collectNextData($);
  if (nextData) {
    const priceObjs = deepSearchObjects(
      nextData,
      (o) =>
        o.coldRent !== undefined ||
        o.baseRent !== undefined ||
        o.additionalCosts !== undefined ||
        o.serviceCharge !== undefined ||
        o.livingSpace !== undefined
    );
    for (const p of priceObjs) {
      if (coldRent === null && (p.coldRent ?? p.baseRent) !== undefined) {
        coldRent = parseGermanNumber(p.coldRent ?? p.baseRent);
      }
      if (additionalCosts === null && (p.additionalCosts ?? p.serviceCharge) !== undefined) {
        additionalCosts = parseGermanNumber(p.additionalCosts ?? p.serviceCharge);
      }
      if (heatingCosts === null && p.heatingCosts !== undefined) {
        heatingCosts = parseGermanNumber(p.heatingCosts);
      }
      if (sqm === null && (p.livingSpace ?? p.area) !== undefined) {
        sqm = parseGermanNumber(p.livingSpace ?? p.area);
      }
      if (rooms === null && (p.numberOfRooms ?? p.rooms) !== undefined) {
        rooms = parseGermanNumber(p.numberOfRooms ?? p.rooms);
      }
    }

    const sellerObjs = deepSearchObjects(
      nextData,
      (o) => o.sellerType || o.isPrivate !== undefined || o.customerType
    );
    for (const s of sellerObjs) {
      if (s.isPrivate === true) sellerTypeRaw += ' private';
      if (s.isPrivate === false) sellerTypeRaw += ' commercial';
      if (s.sellerType) sellerTypeRaw += ` ${s.sellerType}`;
      if (s.customerType) sellerTypeRaw += ` ${s.customerType}`;
      if (s.companyName || s.name) sellerName += ` ${s.companyName || s.name}`;
    }
  }

  // 3. Portal-specific DOM extraction
  if (resolvedPortal === 'kleinanzeigen') {
    if (!title) title = $('#viewad-title').text().replace(/\s+/g, ' ').trim();
    const priceText = $('#viewad-price').text().trim();
    if (coldRent === null && priceText) {
      coldRent = parseGermanNumber(priceText);
    }

    const locality = $('#viewad-locality').text().replace(/\s+/g, ' ').trim();
    if (locality) {
      if (!zipcode) zipcode = detectZipcode(locality);
      if (!district) district = detectDistrict(locality, defaultCity);
    }

    $('.addetailslist--detail').each((_, el) => {
      const full = $(el).text().replace(/\s+/g, ' ').trim();
      const val = $(el).find('.addetailslist--detail--value').text().trim() || full;
      const lower = full.toLowerCase();
      if (lower.includes('wohnfläche') && sqm === null) sqm = parseGermanNumber(val);
      if (lower.includes('zimmer') && rooms === null) rooms = parseGermanNumber(val);
      if ((lower.includes('nebenkosten') || lower.includes('betriebskosten')) && additionalCosts === null) {
        additionalCosts = parseGermanNumber(val);
      }
      if (lower.includes('heizkosten') && heatingCosts === null) {
        heatingCosts = parseGermanNumber(val);
      }
      if (lower.includes('kaltmiete') && coldRent === null) {
        coldRent = parseGermanNumber(val);
      }
    });

    const contactText = $('#viewad-contact, .userprofile-vip').text().replace(/\s+/g, ' ').trim();
    if (contactText) {
      sellerName += ` ${contactText}`;
    }
    const descDom = $('#viewad-description-text').text().replace(/\s+/g, ' ').trim();
    if (descDom) descriptionText += ` ${descDom}`;
  } else {
    if (!title) {
      title =
        $('h1').first().text().replace(/\s+/g, ' ').trim() ||
        $('meta[property="og:title"]').attr('content')?.trim() ||
        $('title').text().trim();
    }
  }

  if (!descriptionText) {
    descriptionText =
      $('meta[name="description"]').attr('content') ||
      $('main').text().replace(/\s+/g, ' ').slice(0, 6000) ||
      $('body').text().replace(/\s+/g, ' ').slice(0, 6000);
  }

  // 4. Intelligent Regex Fallback
  const fullText = `${title}\n${descriptionText}`;
  const regexParsed = extractCostsFromText(fullText);

  if (coldRent === null) coldRent = regexParsed.coldRent;
  if (additionalCosts === null) additionalCosts = regexParsed.additionalCosts ?? 0;
  if (heatingCosts === null) heatingCosts = regexParsed.heatingCosts ?? 0;
  if (sqm === null) sqm = regexParsed.sqm;
  if (rooms === null) rooms = regexParsed.rooms;
  if (!zipcode) zipcode = detectZipcode(fullText);
  if (!district) district = detectDistrict(fullText, defaultCity);

  const isPrivateLandlord = detectPrivateLandlord({
    sellerTypeRaw,
    sellerName,
    fullText: `${sellerName} ${fullText}`,
    portal: resolvedPortal,
  });

  const wbsRequired = detectWbsRequired(fullText);

  return {
    external_id: externalId,
    portal: resolvedPortal,
    title: (title || `Wohnungsangebot (${externalId})`).slice(0, 300),
    url: cleanUrl,
    city: defaultCity,
    district: district || defaultCity,
    zipcode,
    cold_rent: coldRent,
    additional_costs: additionalCosts ?? 0,
    heating_costs: heatingCosts ?? 0,
    sqm,
    rooms,
    is_private_landlord: Boolean(isPrivateLandlord),
    wbs_required: Boolean(wbsRequired),
  };
}

export function isListingOfflineHtml(html, finalUrl, statusCode, portal) {
  if (statusCode === 404 || statusCode === 410) {
    return { offline: true, reason: `HTTP ${statusCode}` };
  }

  const lowerUrl = String(finalUrl || '').toLowerCase();
  if (
    portal === 'kleinanzeigen' &&
    !lowerUrl.includes('/s-anzeige/') &&
    (lowerUrl.includes('/s-wohnung-mieten/') || lowerUrl.includes('kleinanzeigen.de/m-'))
  ) {
    return { offline: true, reason: 'Redirect zur Übersicht' };
  }
  if (portal === 'immowelt' && lowerUrl.includes('/liste/') && !lowerUrl.includes('/expose/')) {
    return { offline: true, reason: 'Redirect zur Immowelt-Liste' };
  }

  const lowerHtml = String(html || '').toLowerCase();
  const offlineMarkers = [
    'anzeige nicht mehr verfügbar',
    'anzeige ist nicht mehr verfügbar',
    'anzeige wurde gelöscht',
    'anzeige ist deaktiviert',
    'dieses angebot ist leider nicht mehr verfügbar',
    'leider wurde die gesuchte anzeige nicht gefunden',
    'objekt ist nicht mehr verfügbar',
    'expose nicht gefunden',
    'status-deleted',
  ];

  for (const marker of offlineMarkers) {
    if (lowerHtml.includes(marker)) {
      return { offline: true, reason: `Marker: ${marker}` };
    }
  }

  return { offline: false, reason: null };
}

export function extractUrlsFromWebhookPayload(payload) {
  const chunks = [];
  if (typeof payload === 'string') {
    chunks.push(payload);
  } else if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.urls)) chunks.push(...payload.urls.map(String));
    for (const key of ['url', 'link', 'text', 'html', 'body', 'subject', 'message', 'plain']) {
      if (payload[key]) chunks.push(String(payload[key]));
    }
    if (chunks.length === 0) {
      chunks.push(JSON.stringify(payload));
    }
  }

  const combined = chunks.join('\n');
  const rawUrls = combined.match(/https?:\/\/[^\s"'<>)\]]+/gi) || [];
  const cleaned = new Set();

  for (const raw of rawUrls) {
    const trimmed = raw.replace(/[.,;!?]+$/, '');
    const lower = trimmed.toLowerCase();
    const isSupportedListing =
      (lower.includes('kleinanzeigen.de') && lower.includes('/s-anzeige/')) ||
      (lower.includes('immowelt.de') && lower.includes('/expose/')) ||
      (lower.includes('immobilienscout24.de') && lower.includes('/expose/'));

    if (isSupportedListing) {
      cleaned.add(normalizeListingUrl(trimmed));
    }
  }

  return [...cleaned];
}
