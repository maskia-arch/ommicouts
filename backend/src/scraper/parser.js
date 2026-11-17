import crypto from 'node:crypto';
import * as cheerio from 'cheerio';
import LZString from 'lz-string';

export const GELSENKIRCHEN_ZIP_DISTRICTS = {
  '45879': ['Altstadt', 'Neustadt'],
  '45881': ['Schalke', 'Schalke-Nord'],
  '45883': ['Feldmark', 'Heßler'],
  '45884': ['Rotthausen'],
  '45886': ['Ückendorf'],
  '45888': ['Bulmke-Hüllen'],
  '45889': ['Bismarck'],
  '45891': ['Erle'],
  '45892': ['Resse', 'Resser Mark'],
  '45894': ['Buer'],
  '45896': ['Scholven', 'Hassel', 'Horst'],
  '45897': ['Buer-Nord', 'Hassel'],
  '45899': ['Beckhausen', 'Horst'],
};

export const GELSENKIRCHEN_DISTRICT_PRIMARY_ZIP = {
  Altstadt: '45879',
  Neustadt: '45879',
  Schalke: '45881',
  'Schalke-Nord': '45881',
  Feldmark: '45883',
  Heßler: '45883',
  Hessler: '45883',
  Rotthausen: '45884',
  Ückendorf: '45886',
  'Bulmke-Hüllen': '45888',
  Bismarck: '45889',
  Erle: '45891',
  Resse: '45892',
  'Resser Mark': '45892',
  Buer: '45894',
  'Buer-Nord': '45897',
  Hassel: '45896',
  Scholven: '45896',
  Beckhausen: '45899',
  Horst: '45899',
};

const GELSENKIRCHEN_DISTRICTS = [
  'Schalke-Nord',
  'Bulmke-Hüllen',
  'Resser Mark',
  'Buer-Nord',
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

const VALID_JSONLD_LISTING_TYPES = new Set([
  'apartment',
  'residence',
  'realestatelisting',
  'singlefamilyresidence',
  'house',
  'product',
  'offer',
  'accommodation',
]);

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
  const cleanUrl = normalizeListingUrl(url);
  const detected = detectPortal(cleanUrl);
  const resolvedPortal = portal && portal !== 'other' ? portal : detected;

  if (resolvedPortal === 'kleinanzeigen') {
    const match = cleanUrl.match(/\/(\d{6,14})(?:-[\d-]+)?(?:\?.*)?$/);
    if (match) return `ka_${match[1]}`;
  }

  if (resolvedPortal === 'immowelt' || cleanUrl.includes('immowelt.de')) {
    const match = cleanUrl.match(/\/expose\/([a-zA-Z0-9_-]+)/i);
    if (match) return `iw_${match[1]}`;
  }

  if (resolvedPortal === 'immoscout' || cleanUrl.includes('immobilienscout24.de')) {
    const match = cleanUrl.match(/\/expose\/(\d+)/i);
    if (match) return `is_${match[1]}`;
  }

  if (cleanUrl.includes('ohne-makler.net')) {
    const match = cleanUrl.match(/\/immobilie\/([a-z0-9]+)/i);
    if (match && match[1].toLowerCase() !== 'list') return `om_${match[1]}`;
  }

  if (cleanUrl.includes('ggw-gelsenkirchen.de')) {
    const match = cleanUrl.match(/\/object\/(\d+)/i);
    if (match) return `ggw_${match[1]}`;
  }

  if (cleanUrl.includes('quoka.de')) {
    const match = cleanUrl.match(/\/([a-z0-9]{12,40})\.html(?:\?.*)?$/i);
    if (match) return `qk_${match[1].toLowerCase()}`;
  }

  if (cleanUrl.includes('wohnungsaushang') || cleanUrl.includes('gelsenkirchen.de/de/infrastruktur/bauen_und_wohnen/wohnungsaushang')) {
    const match = cleanUrl.match(/#wohnung-([a-z0-9_-]+)/i) || cleanUrl.match(/([a-z0-9]{8,32})$/i);
    if (match) return `ge_aushang_${match[1]}`;
  }

  if (cleanUrl.includes('meinestadt.de')) {
    const match = cleanUrl.match(/\/expose\/([a-zA-Z0-9_-]+)/i) || cleanUrl.match(/\/(\d{5,12})(?:\.html|\/|$)/);
    if (match) return `mst_${match[1]}`;
  }

  if (cleanUrl.includes('mietsofort.de')) {
    const match = cleanUrl.match(/-p([a-f0-9-]+)(?:\?.*)?$/i) ||
      cleanUrl.match(/\/mietwohnungen\/([a-f0-9-]+)/i) ||
      cleanUrl.match(/\/wohnung\/([a-f0-9-]+)/i) ||
      cleanUrl.match(/\/expose\/([a-f0-9-]+)/i);
    if (match) return `ms_${match[1]}`;
  }

  if (cleanUrl.includes('rentola.de')) {
    const match = cleanUrl.match(/-p([a-f0-9]+)(?:\?.*)?$/i) ||
      cleanUrl.match(/\/listings\/([a-z0-9_-]+)/i);
    if (match) return `rt_${match[1]}`;
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
        u.pathname = u.pathname.replace(/\/(c\d+l\d+.*)$/i, `/seite:${page}/$1`);
        if (!/\/seite:\d+\//i.test(u.pathname)) {
          u.pathname = `${u.pathname.replace(/\/$/, '')}/seite:${page}`;
        }
      }
      return u.toString();
    }

    if (portal === 'immowelt') {
      if (u.pathname.includes('/suche/')) {
        u.searchParams.set('page', String(page));
      } else {
        u.searchParams.set('sp', String(page));
      }
      return u.toString();
    }

    if (
      u.hostname.includes('ggw-gelsenkirchen.de') ||
      u.hostname.includes('meinestadt.de') ||
      u.pathname.includes('wohnungsaushang')
    ) {
      return baseUrl;
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

  const m = str.match(/(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/);
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
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch {
    // Some portals (e.g. Quoka) embed raw newlines or unescaped control chars inside string literals
    try {
      const sanitized = str.replace(/[\u0000-\u001F]+/g, (match) => {
        if (match === '\n') return '\\n';
        if (match === '\r') return '\\r';
        if (match === '\t') return '\\t';
        return ' ';
      });
      return JSON.parse(sanitized);
    } catch {
      return null;
    }
  }
}

function collectJsonLd($) {
  const items = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).html();
    if (!raw) return;
    const parsed = safeJsonParse(raw.trim());
    if (!parsed) return;
    const list = Array.isArray(parsed)
      ? parsed
      : parsed['@graph'] && Array.isArray(parsed['@graph'])
        ? parsed['@graph']
        : [parsed];

    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const typeVal = Array.isArray(item['@type']) ? item['@type'][0] : item['@type'];
      const lowerType = String(typeVal || '').toLowerCase();
      if (VALID_JSONLD_LISTING_TYPES.has(lowerType)) {
        items.push(item);
      }
    }
  });
  return items;
}

function collectNextData($) {
  const raw = $('script#__NEXT_DATA__').html();
  if (!raw) return null;
  return safeJsonParse(raw.trim());
}

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

function spacedText($, rootEl) {
  const tokens = [];
  const walk = (node) => {
    if (!node) return;
    if (node.type === 'text') {
      const t = String(node.data || '').replace(/\s+/g, ' ').trim();
      if (t) tokens.push(t);
    } else if (node.children) {
      for (const child of node.children) walk(child);
    }
  };
  walk(rootEl);
  return tokens.join(' ').replace(/\s+/g, ' ').trim();
}

export function parseImmoweltSerpCard($, cardEl, absUrl, defaultCity, classifiedData = null) {
  const cardText = spacedText($, cardEl);
  const externalId = extractExternalId(absUrl, 'immowelt');

  // Remove leading "1 / 15" photo pagination prefix before parsing price
  const cleanedText = cardText.replace(/^\s*\d+\s*\/\s*\d+\s+/, ' ');

  let coldRent = null;
  let warmRent = null;
  let additionalCosts = null;
  let heatingCosts = 0;

  if (classifiedData) {
    const prices = classifiedData.hardFacts?.prices || [];
    for (const pr of prices) {
      const lbl = pr.label?.toLowerCase() || '';
      const num = parseGermanNumber(pr.amount || pr.value);
      if (lbl.includes('warm')) warmRent = num;
      if (lbl.includes('kalt')) coldRent = num;
      if (lbl.includes('neben') || lbl.includes('betrieb')) additionalCosts = num;
    }
    if (coldRent === null && classifiedData.tracking?.price) {
      coldRent = Number(classifiedData.tracking.price);
    }
    if (warmRent === null && classifiedData.rawData?.price) {
      warmRent = Number(classifiedData.rawData.price);
    }
    if (additionalCosts === null && warmRent !== null && coldRent !== null && warmRent > coldRent) {
      additionalCosts = Math.round((warmRent - coldRent) * 100) / 100;
    }
  }

  if (coldRent === null) {
    const priceMatch =
      cleanedText.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*€\s*(?:Kaltmiete)?/i);
    if (priceMatch) coldRent = parseGermanNumber(priceMatch[1]);
  }

  let rooms = classifiedData?.rawData?.nbroom || null;
  if (!rooms) {
    const roomMatch = cleanedText.match(/(\d{1,2}(?:[.,]\d)?)\s*Zimmer/i);
    if (roomMatch) rooms = parseGermanNumber(roomMatch[1]);
  }

  let sqm = classifiedData?.rawData?.surface?.main || null;
  if (!sqm) {
    const sqmMatch = cleanedText.match(/(\d{1,4}(?:[.,]\d{1,2})?)\s*m²/i);
    if (sqmMatch) sqm = parseGermanNumber(sqmMatch[1]);
  }

  const zipcode = classifiedData?.location?.address?.zipCode || detectZipcode(cleanedText);
  const district = classifiedData?.location?.address?.district || detectDistrict(cleanedText, defaultCity);

  let title =
    classifiedData?.mainDescription?.headline ||
    classifiedData?.hardFacts?.title ||
    $(cardEl).find('[data-testid*="title"], h2, h3').first().text().replace(/\s+/g, ' ').trim() ||
    $(cardEl).find('a[href*="/expose/"]').attr('title')?.trim() ||
    '';

  if (!title) {
    const locLabel = district && district !== defaultCity ? `${defaultCity}-${district}` : defaultCity;
    title = `${rooms ? `${rooms}-Zimmer-Wohnung` : 'Mietwohnung'} in ${locLabel}${sqm ? ` (${sqm} m²)` : ''}`;
  }

  // Provider/Landlord name: check dedicated agency publisher logos/text on Immowelt cards first!
  const agencyPublisherEl = $(cardEl).find('[data-testid*="agency-publisher"], [class*="agency"], button:has(img)');
  const agencyImgAlt = agencyPublisherEl.find('img').attr('alt')?.trim() || '';
  const agencyText = agencyPublisherEl.text().replace(/\s+/g, ' ').trim();
  const providerPrefix = cardText.split(/\d+\s*\/\s*\d+/)[0]?.trim() || '';

  const sellerCandidates = [agencyImgAlt, agencyText, providerPrefix].filter(Boolean).join(' ');
  const isPrivateLandlord = classifiedData?.provider?.isPrivateOwner === true ? true : detectPrivateLandlord({
    sellerName: agencyImgAlt || agencyText || providerPrefix,
    fullText: `${sellerCandidates} ${cleanedText}`,
    portal: 'immowelt',
  });

  const wbsRequired = detectWbsRequired(cleanedText);
  const locSnippetMatch = cleanedText.match(/[^·\n]{0,60}Gelsenkirchen(?:\s*\(\d{5}\))?/i);

  return {
    external_id: externalId,
    portal: 'immowelt',
    title: title.slice(0, 300),
    url: absUrl,
    city: defaultCity,
    district: district || defaultCity,
    zipcode,
    locality_raw: locSnippetMatch ? locSnippetMatch[0] : cleanedText.slice(0, 200),
    cold_rent: coldRent,
    additional_costs: additionalCosts,
    heating_costs: heatingCosts,
    sqm,
    rooms,
    is_private_landlord: isPrivateLandlord,
    wbs_required: wbsRequired,
    is_wanted: false,
    description_snippet: (classifiedData?.mainDescription?.description || cleanedText).slice(0, 500),
  };
}

export function parseMeinestadtSerpCard($, cardEl, absUrl, defaultCity = 'Gelsenkirchen') {
  const cardText = spacedText($, cardEl);
  const isImmowelt = absUrl.includes('immowelt.de');
  const portal = isImmowelt ? 'immowelt' : 'other';
  const externalId = extractExternalId(absUrl, portal);

  let title =
    $(cardEl).find('[data-component="MsHeadline"], h2, h3, h4').first().text().replace(/\s+/g, ' ').trim() ||
    $(cardEl).find('img').attr('alt')?.trim() ||
    '';

  let coldRent = null;
  const priceMatch = cardText.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*€\s*(?:Kaltmiete)?/i);
  if (priceMatch) coldRent = parseGermanNumber(priceMatch[1]);

  let sqm = null;
  const sqmMatch = cardText.match(/(\d{1,4}(?:[.,]\d{1,2})?)\s*m²/i);
  if (sqmMatch) sqm = parseGermanNumber(sqmMatch[1]);

  let rooms = null;
  const roomMatch = cardText.match(/(\d{1,2}(?:[.,]\d)?)\s*Zimmer/i);
  if (roomMatch) rooms = parseGermanNumber(roomMatch[1]);

  const zipcode = detectZipcode(cardText);
  const district = detectDistrict(cardText, defaultCity, zipcode) || defaultCity;

  let isPrivateLandlord = false;
  if (cardText.includes('privates Angebot') || cardText.includes('Privatanbieter')) {
    isPrivateLandlord = true;
  } else if (cardText.includes('gewerbliches Angebot') || cardText.includes('Gewerblicher Anbieter')) {
    isPrivateLandlord = false;
  } else {
    isPrivateLandlord = detectPrivateLandlord({
      sellerName: '',
      fullText: cardText,
      portal,
    });
  }

  const wbsRequired = detectWbsRequired(cardText);

  if (!title) {
    const locLabel = district && district !== defaultCity ? `${defaultCity}-${district}` : defaultCity;
    title = `${rooms ? `${rooms}-Zimmer-Wohnung` : 'Mietwohnung'} in ${locLabel}${sqm ? ` (${sqm} m²)` : ''}`;
  }

  return {
    external_id: externalId,
    portal,
    title: title.slice(0, 300),
    url: absUrl,
    city: defaultCity,
    district,
    zipcode,
    locality_raw: cardText.slice(0, 200),
    cold_rent: coldRent,
    additional_costs: 0,
    heating_costs: 0,
    sqm,
    rooms,
    is_private_landlord: isPrivateLandlord,
    wbs_required: wbsRequired,
    is_wanted: false,
    description_snippet: cardText.slice(0, 500),
  };
}

export function parseWohnungsaushangTable($, baseUrl, defaultCity = 'Gelsenkirchen') {
  const candidates = [];
  const rows = $('table[id*="wohnungenGridView"] tr');
  if (rows.length <= 1) return candidates;

  rows.each((i, tr) => {
    if (i === 0 || $(tr).find('th').length > 0) return;
    const cols = $(tr).find('td');
    if (cols.length < 4) return;

    const roomsText = $(cols[0]).text().trim();
    const sqmText = $(cols[1]).text().trim();
    const rentText = $(cols[2]).text().trim();
    const addressText = $(cols[3]).text().replace(/\s+/g, ' ').trim();
    const phoneText = cols.length >= 5 ? $(cols[4]).text().replace(/\s+/g, ' ').trim() : '';

    const rooms = parseGermanNumber(roomsText);
    const sqm = parseGermanNumber(sqmText);
    const coldRent = parseGermanNumber(rentText);

    let districtCandidate = null;
    let streetCandidate = addressText;
    if (addressText.includes(',')) {
      const parts = addressText.split(',');
      districtCandidate = parts[0].trim();
      streetCandidate = parts.slice(1).join(',').trim();
    }

    const detectedDistrict = detectDistrict(districtCandidate || addressText, defaultCity);
    const district =
      detectedDistrict ||
      (districtCandidate && GELSENKIRCHEN_DISTRICT_PRIMARY_ZIP[districtCandidate] ? districtCandidate : defaultCity);
    const zipcode = GELSENKIRCHEN_DISTRICT_PRIMARY_ZIP[district] || detectZipcode(addressText) || '45879';

    const normKey = `${district}_${streetCandidate}_${sqm || ''}_${coldRent || ''}`
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    const hash = crypto.createHash('md5').update(normKey).digest('hex').slice(0, 12);
    const externalId = `ge_aushang_${hash}`;
    const url = `/api/wohnungsaushang/view?id=${externalId}`;

    const title = `${rooms ? `${rooms}-Zimmer-Wohnung` : 'Mietwohnung'} in Gelsenkirchen-${district}${streetCandidate ? `, ${streetCandidate}` : ''}${sqm ? ` (${sqm} m²)` : ''}`;

    const serpParsed = {
      external_id: externalId,
      portal: 'other',
      title: title.slice(0, 300),
      url,
      city: defaultCity,
      district: district || defaultCity,
      zipcode,
      locality_raw: `${addressText}, Gelsenkirchen`.slice(0, 200),
      cold_rent: coldRent,
      additional_costs: 0,
      heating_costs: 0,
      sqm,
      rooms,
      is_private_landlord: true,
      wbs_required: true,
      is_wanted: false,
      contact_name: 'Vermieter (Wohnungsaushang)',
      contact_phone: phoneText || null,
      contact_email: null,
      description_snippet: `Kommunaler Wohnungsaushang Gelsenkirchen: ${rooms || '?'} Zimmer, ${sqm || '?'} m², Kaltmiete ${coldRent || '?'} €. WBS erforderlich. Kontakt: ${phoneText || 'Stadt Gelsenkirchen'}`.slice(0, 500),
    };

    candidates.push({
      externalId,
      url,
      portal: 'other',
      quickTitle: title,
      serpParsed,
    });
  });

  return candidates;
}

export function parseMietsofortItem(item, defaultCity = 'Gelsenkirchen') {
  const id = String(item.id || '');
  const externalId = `ms_${id}`;
  const slug = item.slug || id;
  const url = `https://www.mietsofort.de/mietwohnungen/${slug}`;
  const coldRent = parseGermanNumber(item.price);
  const sqm = parseGermanNumber(item.size_sqm);
  const rooms = parseGermanNumber(item.rooms);
  const address = item.address || '';
  const zipcode = item.postal_code || detectZipcode(`${address} ${item.description || ''}`);
  const district = detectDistrict(`${address} ${item.title || ''}`, defaultCity, zipcode);
  const isPrivate = detectPrivateLandlord({
    sellerName: item.contact_name,
    fullText: `${item.title || ''} ${item.description || ''}`,
    portal: 'other',
  });
  const wbsRequired = detectWbsRequired(`${item.title || ''} ${item.description || ''}`);

  return {
    external_id: externalId,
    portal: 'other',
    title: (item.title || `${rooms ? `${rooms}-Zimmer-Wohnung` : 'Mietwohnung'} in ${defaultCity}`).slice(0, 300),
    url,
    city: defaultCity,
    district: district || defaultCity,
    zipcode,
    locality_raw: address ? `${address}, ${zipcode || ''} ${defaultCity}`.trim() : defaultCity,
    cold_rent: coldRent,
    additional_costs: 0,
    heating_costs: 0,
    sqm,
    rooms,
    is_private_landlord: isPrivate,
    wbs_required: wbsRequired,
    is_wanted: false,
    contact_name: item.contact_name || null,
    contact_phone: item.contact_phone || null,
    contact_email: item.contact_email || null,
    description_snippet: (item.description || item.title || '').slice(0, 500),
  };
}

export function extractSearchListingLinks(html, baseUrl, portal, defaultCity = 'Gelsenkirchen') {
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

    const detectedPortal = detectPortal(absUrl);
    const candidatePortal =
      portal && portal !== 'other' ? portal : detectedPortal !== 'other' ? detectedPortal : portal;
    const externalId = extractExternalId(absUrl, candidatePortal);
    if (seenIds.has(externalId)) return;
    seenIds.add(externalId);
    found.push({
      externalId,
      url: absUrl,
      portal: candidatePortal,
      quickTitle: quickMeta.title ? String(quickMeta.title).trim() : null,
      serpParsed: quickMeta.serpParsed || null,
    });
  };

  if (portal === 'kleinanzeigen') {
    // Hard DOM restriction: remove alternative/out-of-area ads and top-ads completely!
    $('#srchrslt-adtable-altads, #srchrslt-adtable-topads, .is-topad').remove();

    const mainTable = $('#srchrslt-adtable');
    if (mainTable.length > 0) {
      mainTable.find('li, article.aditem').each((_, el) => {
        const $el = $(el);
        if ($el.hasClass('is-topad') || $el.closest('#srchrslt-adtable-altads').length > 0) return;
        const link = $el.find('a[href*="/s-anzeige/"]').first();
        const href = link.attr('href') || $el.attr('data-href') || $el.find('[data-href*="/s-anzeige/"]').first().attr('data-href');
        const title = link.text().trim() || $el.find('.text-module-begin a, h2').first().text().trim();
        pushCandidate(href, { title });
      });
    } else {
      // Fallback only for test fixtures using article.aditem without #srchrslt-adtable wrapper
      $('article.aditem').each((_, el) => {
        const link = $(el).find('a[href*="/s-anzeige/"]').first();
        pushCandidate(link.attr('href'), { title: link.text().trim() });
      });
    }
    return found;
  }

  if (portal === 'immowelt') {
    let serpDataMap = new Map();
    try {
      const idx = html.indexOf('window["__UFRN_FETCHER__"]=JSON.parse(');
      if (idx !== -1) {
        const end = html.indexOf(');</script>', idx);
        const rawStr = html.slice(idx + 'window["__UFRN_FETCHER__"]=JSON.parse('.length, end);
        const parsed = JSON.parse(JSON.parse(rawStr));
        const compressed = parsed.data?.['classified-serp-init-data'];
        if (compressed) {
          const decompressed = LZString.decompressFromBase64(compressed);
          const root = JSON.parse(decompressed);
          const items = Object.values(root.pageProps?.classifiedsData || {});
          for (const it of items) {
            if (it.id) serpDataMap.set(it.id.toLowerCase(), it);
            if (it.metadata?.legacyId) serpDataMap.set(it.metadata.legacyId.toLowerCase(), it);
          }
        }
      }
    } catch {
      // Fallback cleanly to standard DOM parsing
    }

    const cards = $('[data-testid="serp-core-classified-card-testid"]');
    if (cards.length > 0) {
      cards.each((_, el) => {
        const href = $(el).find('a[href*="/expose/"]').first().attr('href');
        if (!href) return;
        let absUrl;
        try {
          absUrl = normalizeListingUrl(new URL(href, baseUrl).toString());
        } catch {
          return;
        }
        const m = absUrl.match(/\/expose\/([a-zA-Z0-9_-]+)/i);
        const cardId = m ? m[1].toLowerCase() : null;
        const classifiedData = cardId ? serpDataMap.get(cardId) : null;

        const serpParsed = parseImmoweltSerpCard($, el, absUrl, defaultCity, classifiedData);
        pushCandidate(absUrl, { title: serpParsed.title, serpParsed });
      });
      return found;
    }

    $('a[href*="/expose/"]').each((_, el) => {
      pushCandidate($(el).attr('href'), { title: $(el).text().trim() });
    });
    return found;
  }

  if (String(baseUrl || '').includes('ohne-makler.net')) {
    $('a[href*="/immobilie/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (/\/immobilie\/(?!list\b)[a-z0-9]+\/?$/i.test(href)) {
        pushCandidate(href, { title: $(el).text().trim() });
      }
    });
    return found;
  }

  if (String(baseUrl || '').includes('ggw-gelsenkirchen.de')) {
    $('a[href*="/object/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (/\/object\/\d+\/?/i.test(href)) {
        pushCandidate(href, { title: $(el).text().trim() });
      }
    });
    return found;
  }

  if (String(baseUrl || '').includes('meinestadt.de')) {
    $('a[href*="/expose/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      let absUrl;
      try {
        absUrl = normalizeListingUrl(new URL(href, baseUrl).toString().split('?')[0]);
      } catch {
        return;
      }
      if (!/\/expose\/[a-z0-9_-]+/i.test(absUrl)) return;

      const serpParsed = parseMeinestadtSerpCard($, el, absUrl, defaultCity);
      pushCandidate(absUrl, { title: serpParsed.title, serpParsed });
    });
    return found;
  }

  if (String(baseUrl || '').includes('quoka.de')) {
    $('a[href*="/anzeige/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (/\/anzeige\/.+\/[a-z0-9]+\.html/i.test(href)) {
        pushCandidate(href, { title: $(el).text().trim() });
      }
    });
    return found;
  }

  if (String(baseUrl || '').includes('wohnungsaushang')) {
    const list = parseWohnungsaushangTable($, baseUrl, defaultCity);
    for (const item of list) {
      if (!seenIds.has(item.externalId)) {
        seenIds.add(item.externalId);
        found.push(item);
      }
    }
    return found;
  }

  if (String(baseUrl || '').includes('rentola.de')) {
    // 1. JSON-LD ItemList
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const data = safeJsonParse($(el).html());
        if (data && (data['@type'] === 'ItemList' || data.itemListElement) && Array.isArray(data.itemListElement)) {
          for (const item of data.itemListElement) {
            if (!item || !item.url) continue;
            let absUrl;
            try {
              absUrl = normalizeListingUrl(new URL(item.url, baseUrl).toString());
            } catch {
              continue;
            }
            const extId = extractExternalId(absUrl, 'other');
            if (seenIds.has(extId)) continue;
            seenIds.add(extId);

            const coldRent = parseGermanNumber(item.offers?.price);
            const sqm = parseGermanNumber(item.offers?.itemOffered?.floorSize?.value);
            const rooms = parseGermanNumber(
              item.offers?.itemOffered?.numberOfRooms?.value ?? item.offers?.itemOffered?.numberOfBedrooms?.value
            );
            const streetAddr = item.offers?.itemOffered?.address?.streetAddress || '';
            const zipcode = detectZipcode(streetAddr);
            const district = detectDistrict(streetAddr || item.name, defaultCity, zipcode);
            const title = String(item.name || `${rooms ? `${rooms}-Zimmer-Wohnung` : 'Mietwohnung'} in ${defaultCity}`).trim();

            const serpParsed = {
              external_id: extId,
              portal: 'other',
              title: title.slice(0, 300),
              url: absUrl,
              city: defaultCity,
              district: district || defaultCity,
              zipcode,
              locality_raw: streetAddr ? `${streetAddr}, ${defaultCity}`.slice(0, 200) : defaultCity,
              cold_rent: coldRent,
              additional_costs: 0,
              heating_costs: 0,
              sqm,
              rooms,
              is_private_landlord: false,
              wbs_required: detectWbsRequired(title),
              is_wanted: false,
              description_snippet: title.slice(0, 500),
            };

            found.push({
              externalId: extId,
              url: absUrl,
              portal: 'other',
              quickTitle: title,
              serpParsed,
            });
          }
        }
      } catch {}
    });

    // 2. Fallback DOM links
    $('a[href*="/listings/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (/\/listings\/[a-z0-9_-]+/i.test(href)) {
        pushCandidate(href, { title: $(el).text().trim() });
      }
    });

    return found;
  }

  // Other portals: JSON-LD + __NEXT_DATA__ + DOM
  for (const ld of collectJsonLd($)) {
    if (ld.url) pushCandidate(ld.url, { title: ld.name });
  }

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

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (href && (href.includes('/expose/') || href.includes('/s-anzeige/'))) {
      pushCandidate(href, { title: $(el).text().trim() });
    }
  });

  return found;
}

function matchDistrictList(text, candidates) {
  if (!text) return null;
  const normalized = String(text);
  for (const d of candidates) {
    const regex = new RegExp(`\\b${d.replace('-', '[-\\s]?')}\\b`, 'i');
    if (regex.test(normalized)) {
      if (d === 'Hessler') return 'Heßler';
      return d;
    }
    if (d === 'Heßler' && /\bHessler\b/i.test(normalized)) {
      return 'Heßler';
    }
  }
  return null;
}

export function detectDistrict(text, fallbackCity = 'Gelsenkirchen', zipcode = null) {
  const zipCandidates =
    fallbackCity.toLowerCase() === 'gelsenkirchen' && zipcode
      ? GELSENKIRCHEN_ZIP_DISTRICTS[String(zipcode).trim()] || null
      : null;

  if (zipCandidates) {
    const matched = matchDistrictList(text, zipCandidates);
    return matched || zipCandidates[0];
  }

  if (!text) return null;
  const matched = matchDistrictList(text, GELSENKIRCHEN_DISTRICTS);
  if (matched) return matched;

  if (String(text).toLowerCase().includes(fallbackCity.toLowerCase())) {
    return fallbackCity;
  }
  return null;
}

export function resolveDistrictByZip(detectedDistrict, contextText, fallbackCity = 'Gelsenkirchen', zipcode = null) {
  const cleanZip = zipcode ? String(zipcode).trim() : null;
  const zipCandidates =
    fallbackCity.toLowerCase() === 'gelsenkirchen' && cleanZip
      ? GELSENKIRCHEN_ZIP_DISTRICTS[cleanZip] || null
      : null;

  if (zipCandidates) {
    if (detectedDistrict && zipCandidates.includes(detectedDistrict)) {
      return detectedDistrict;
    }
    return detectDistrict(contextText, fallbackCity, cleanZip);
  }

  return detectedDistrict || detectDistrict(contextText, fallbackCity, cleanZip) || fallbackCity;
}

export function detectZipcode(text) {
  if (!text) return null;
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
    /(?:kein|ohne|nicht\s+erforderlich|nicht\s+nötig|nicht\s+benötigt)[^.\n]{0,25}(?:wbs|wohnberechtigungsschein)|(?:wbs|wohnberechtigungsschein)[^.\n]{0,25}(?:nicht\s+erforderlich|nicht\s+nötig|entfällt|nicht\s+benötigt|erforderlich\s*[:\-]?\s*nein)/.test(
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
    sellerTypeRaw.toLowerCase().includes('person') ||
    sellerTypeRaw.toLowerCase() === 'private'
  ) {
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

  // On Immowelt SERP cards, private individuals often appear as "Vorname Nachname" or "Frau/Herr ..." without GmbH/Immobilien
  if (portal === 'immowelt' && sellerName.trim()) {
    const cleanName = sellerName.trim();
    if (/^(?:frau|herr)\s+/i.test(cleanName) || /^[A-ZÄÖÜ][a-zäöüß-]+\s+[A-ZÄÖÜ][a-zäöüß-]+$/.test(cleanName)) {
      return true;
    }
  }

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

  const sqmMatch =
    t.match(/(?:wohnfläche|fläche|größe)\s*[:\-]?\s*(?:ca\.?\s*)?(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:m²|qm|m2)/i) ||
    t.match(/(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:m²|qm)\b/i);
  if (sqmMatch) {
    sqm = parseGermanNumber(sqmMatch[1]);
  }

  const roomMatch =
    t.match(/(?:zimmer(?:anzahl)?)\s*[:\-]?\s*(\d{1,2}(?:[.,]\d)?)/i) ||
    t.match(/(\d{1,2}(?:[.,]\d)?)\s*(?:zimmer|zi\.|zimm\b)/i);
  if (roomMatch) {
    rooms = parseGermanNumber(roomMatch[1]);
  }

  return { coldRent, additionalCosts, heatingCosts, sqm, rooms };
}

const IGNORED_EMAIL_PATTERNS = [
  /^no-?reply@/i,
  /datenschutz@/i,
  /impressum@/i,
  /privacy@/i,
  /support@kleinanzeigen/i,
  /service@ohne-makler/i,
  /info@immowelt/i,
  /@sentry\./i,
  /@example\./i,
  /\.(png|jpe?g|webp|svg|gif)$/i,
];

function isValidContactEmail(email) {
  const s = String(email || '').trim().toLowerCase();
  if (!s || s.length > 160 || !/^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/i.test(s)) {
    return false;
  }
  return !IGNORED_EMAIL_PATTERNS.some((re) => re.test(s));
}

function normalizePhoneCandidate(raw) {
  const cleaned = String(raw || '')
    .replace(/^tel:/i, '')
    .replace(/[\u00A0\s]+/g, ' ')
    .trim();
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 16) return null;
  if (/^(19|20)\d{6,}$/.test(digits)) return null;
  return cleaned.slice(0, 75);
}

export function extractContactInfo($, { jsonLds = [], nextData = null, sellerName = '', text = '' } = {}) {
  let contactPhone = null;
  let contactEmail = null;

  // 1. Explicit tel: & mailto: links in DOM
  $('a[href^="tel:"]').each((_, el) => {
    if (contactPhone) return;
    const cand = normalizePhoneCandidate($(el).attr('href'));
    if (cand) contactPhone = cand;
  });

  $('a[href^="mailto:"]').each((_, el) => {
    if (contactEmail) return;
    const raw = String($(el).attr('href') || '')
      .replace(/^mailto:/i, '')
      .split('?')[0]
      .trim();
    if (isValidContactEmail(raw)) contactEmail = raw.toLowerCase();
  });

  // 2. JSON-LD seller / organization contact
  for (const ld of jsonLds) {
    const offer = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers;
    const phoneCand = normalizePhoneCandidate(offer?.seller?.telephone || ld.telephone);
    if (!contactPhone && phoneCand) contactPhone = phoneCand;
    const emailCand = offer?.seller?.email || ld.email;
    if (!contactEmail && isValidContactEmail(emailCand)) {
      contactEmail = String(emailCand).trim().toLowerCase();
    }
  }

  // 3. __NEXT_DATA__ contact objects
  if (nextData) {
    const contactObjs = deepSearchObjects(
      nextData,
      (o) => Boolean(o.phone || o.phoneNumber || o.telephone || o.mobile || o.email || o.contactEmail)
    );
    for (const c of contactObjs) {
      if (!contactPhone) {
        const cand = normalizePhoneCandidate(c.phone || c.phoneNumber || c.telephone || c.mobile);
        if (cand) contactPhone = cand;
      }
      if (!contactEmail) {
        const em = c.contactEmail || c.email;
        if (isValidContactEmail(em)) contactEmail = String(em).trim().toLowerCase();
      }
    }
  }

  // 4. Text regex extraction from description / contact blocks
  const sourceText = String(text || '');
  if (!contactEmail) {
    const emailMatches = sourceText.match(/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/gi) || [];
    for (const m of emailMatches) {
      if (isValidContactEmail(m)) {
        contactEmail = m.toLowerCase();
        break;
      }
    }
  }

  if (!contactPhone) {
    const phoneRe = /(?:\+49|0049|0)\s*(?:\(?1[567]\d\)?|[2-9]\d{1,4})(?:[\s\-\/.\u00A0]*\d){5,11}/g;
    const phoneMatches = sourceText.match(phoneRe) || [];
    for (const pm of phoneMatches) {
      const cand = normalizePhoneCandidate(pm);
      if (cand) {
        contactPhone = cand;
        break;
      }
    }
  }

  const rawName = String(sellerName || '')
    .replace(/\b(privater anbieter|gewerblicher anbieter|privatangebot)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 175);

  return {
    contact_name: rawName || null,
    contact_phone: contactPhone,
    contact_email: contactEmail,
  };
}

/**
 * Parses a listing detail HTML page using DOM, valid JSON-LD, __NEXT_DATA__ & Regex fallback.
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
  let localityRaw = '';
  let sellerTypeRaw = '';
  let sellerName = '';
  let descriptionText = '';
  let isWanted = false;

  let wbsExplicit = null;

  // 1. Portal-specific DOM extraction FIRST (especially for Kleinanzeigen where WebSite JSON-LD had "Kleinanzeigen")
  if (resolvedPortal === 'kleinanzeigen') {
    title =
      $('#viewad-title').text().replace(/\s+/g, ' ').trim() ||
      $('meta[property="og:title"]').attr('content')?.trim() ||
      '';

    const priceText = $('#viewad-price').text().trim();
    if (priceText) {
      coldRent = parseGermanNumber(priceText);
    }

    localityRaw = $('#viewad-locality').text().replace(/\s+/g, ' ').trim();
    if (localityRaw) {
      zipcode = detectZipcode(localityRaw);
      district = detectDistrict(localityRaw, defaultCity);
    }

    const adTypeText = `${$('#viewad-adtype').text()} ${$('#viewad-breadcrumbs').text()}`.toLowerCase();
    if (adTypeText.includes('gesuch') || /"adtype"\s*:\s*"wanted"/i.test(html)) {
      isWanted = true;
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
  } else if (cleanUrl.includes('ohne-makler.net')) {
    title = $('h1').first().text().replace(/\s+/g, ' ').trim();
    sellerTypeRaw = 'private';
    sellerName = 'Privatangebot';

    const mainText = $('main, article, body').first().text().replace(/\s+/g, ' ').trim();
    const locMatch = mainText.match(/\b(\d{5})\s+([A-Za-zÄÖÜäöüß\-]+(?:\s*\([^)]+\))?)/);
    if (locMatch) {
      localityRaw = locMatch[0];
      zipcode = locMatch[1];
      district = detectDistrict(locMatch[0], defaultCity);
    }

    $('table tr').each((_, tr) => {
      const rowText = $(tr).text().replace(/\s+/g, ' ').trim();
      const lower = rowText.toLowerCase();
      if (lower.startsWith('kaltmiete') && coldRent === null) {
        coldRent = parseGermanNumber(rowText);
      } else if (lower.includes('nebenkosten ohne heizkosten') && additionalCosts === null) {
        additionalCosts = parseGermanNumber(rowText);
      } else if (lower.startsWith('heizkosten') && heatingCosts === null) {
        heatingCosts = parseGermanNumber(rowText);
      } else if (lower.includes('wohnfläche') && sqm === null) {
        sqm = parseGermanNumber(rowText);
      } else if ((lower.startsWith('zimmer') || lower.includes('anzahl zimmer')) && rooms === null) {
        rooms = parseGermanNumber(rowText);
      }
    });

    const sqmSummary = mainText.match(/(\d{2,3}(?:[.,]\d{1,2})?)\s*m²\s*Wohnfläche/i);
    if (sqm === null && sqmSummary) sqm = parseGermanNumber(sqmSummary[1]);
    const roomsSummary = mainText.match(/(\d{1,2}(?:[.,]\d)?)\s*Zimmer\b/i);
    if (rooms === null && roomsSummary) rooms = parseGermanNumber(roomsSummary[1]);
    descriptionText = mainText.slice(0, 5000);
  } else if (cleanUrl.includes('ggw-gelsenkirchen.de')) {
    title = $('h1').first().text().replace(/\s+/g, ' ').trim();
    sellerTypeRaw = 'commercial';
    sellerName = 'GGW Gelsenkirchen';

    const mainText = $('main, body').first().text().replace(/\s+/g, ' ').trim();
    const locMatch = mainText.match(/\b(458\d{2})\s+Gelsenkirchen/i);
    if (locMatch) {
      localityRaw = locMatch[0];
      zipcode = locMatch[1];
      district = detectDistrict(mainText.slice(0, 1800), defaultCity);
    }

    const kaltM = mainText.match(/Netto-Kalt-Miete:\s*([\d.,]+)\s*€/i);
    if (kaltM) coldRent = parseGermanNumber(kaltM[1]);

    const nkM = mainText.match(/Nebenkosten:\s*([\d.,]+)\s*€/i);
    const hkM = mainText.match(/Heizkosten:\s*([\d.,]+)\s*€\s*(\(In Nebenkosten enthalten\))?/i);
    const totalNk = nkM ? parseGermanNumber(nkM[1]) : 0;
    const hkVal = hkM ? parseGermanNumber(hkM[1]) : 0;
    heatingCosts = hkVal ?? 0;
    if (hkM?.[2] && totalNk !== null && hkVal !== null && totalNk >= hkVal) {
      additionalCosts = Math.round((totalNk - hkVal) * 100) / 100;
    } else {
      additionalCosts = totalNk ?? 0;
    }

    const sqmM = mainText.match(/Wohnfläche:\s*([\d.,]+)\s*m²/i);
    if (sqmM) sqm = parseGermanNumber(sqmM[1]);

    const roomsM = mainText.match(/Anzahl\s+Zimmer:\s*([\d.,]+)/i);
    if (roomsM) rooms = parseGermanNumber(roomsM[1]);

    const wbsM = mainText.match(/WBS\s+erforderlich:\s*(Ja|Nein)/i);
    if (wbsM) wbsExplicit = wbsM[1].toLowerCase() === 'ja';

    // Trim contact form suffix ("Dieses Objekt anfragen...") so inquiry checkboxes don't pollute heuristics
    descriptionText = mainText.split(/Dieses Objekt anfragen/i)[0].slice(0, 5000);
  } else if (cleanUrl.includes('quoka.de')) {
    title =
      $('h1').first().text().replace(/\s+/g, ' ').trim() ||
      $('meta[property="og:title"]').attr('content')?.trim() ||
      '';

    const priceText = $('.product-price').first().text().replace(/\s+/g, ' ').trim();
    if (priceText && coldRent === null) {
      coldRent = parseGermanNumber(priceText);
    }

    const locText = $('.location').text().replace(/\s+/g, ' ').trim();
    const zipCodeSpan = $('.location .zip-code').text().trim();
    if (zipCodeSpan && !zipcode) {
      zipcode = detectZipcode(zipCodeSpan);
    }
    if (locText) {
      localityRaw = locText;
      if (!zipcode) zipcode = detectZipcode(locText);
      if (!district) district = detectDistrict(locText, defaultCity, zipcode);
    }

    $('.article-attributes .attribute-item').each((_, el) => {
      const itemText = $(el).text().replace(/\s+/g, ' ').trim();
      const lower = itemText.toLowerCase();
      if ((lower.includes('wohnfläche') || lower.includes('qm')) && sqm === null) {
        sqm = parseGermanNumber(itemText);
      }
      if (lower.includes('zimmerzahl') && rooms === null) {
        rooms = parseGermanNumber(itemText);
      }
      if (lower.includes('plz') && !zipcode) {
        zipcode = detectZipcode(itemText);
      }
    });

    const descDom = $('.article-description').text().replace(/\s+/g, ' ').trim();
    if (descDom) descriptionText += ` ${descDom}`;
  } else if (cleanUrl.includes('meinestadt.de')) {
    title = $('h1').first().text().replace(/\s+/g, ' ').trim();
    const mainText = $('main, article, body').first().text().replace(/\s+/g, ' ').trim();

    const locMatch = mainText.match(/\b(458\d{2})\s+Gelsenkirchen/i) || mainText.match(/\b(\d{5})\s+([A-Za-zÄÖÜäöüß\-]+)/);
    if (locMatch) {
      localityRaw = locMatch[0];
      zipcode = locMatch[1];
      district = detectDistrict(locMatch[0], defaultCity, zipcode);
    }

    let totalNk = null;
    let warmRent = null;
    let hkIncludedInNk = false;

    $('table tr').each((_, tr) => {
      const rowText = $(tr).text().replace(/\s+/g, ' ').trim();
      const lower = rowText.toLowerCase();

      if (lower.startsWith('kaltmiete') && coldRent === null) {
        coldRent = parseGermanNumber(rowText);
      } else if (lower.startsWith('warmmiete') && warmRent === null) {
        warmRent = parseGermanNumber(rowText);
      } else if (lower.includes('heizkosten in nebenkosten enthalten')) {
        hkIncludedInNk = lower.includes('ja');
      } else if (lower.startsWith('nebenkosten') && totalNk === null) {
        totalNk = parseGermanNumber(rowText);
      } else if (lower.startsWith('heizkosten') && heatingCosts === null) {
        heatingCosts = parseGermanNumber(rowText);
      } else if (lower.startsWith('wohnfläche') && sqm === null) {
        sqm = parseGermanNumber(rowText);
      } else if ((lower.startsWith('zimmer') || lower.includes('schlafzimmer') || lower.includes('anzahl zimmer')) && rooms === null) {
        rooms = parseGermanNumber(rowText);
      }
    });

    if (rooms === null) {
      const rMatch = mainText.match(/(\d{1,2}(?:[.,]\d)?)\s*Zimmer\b/i);
      if (rMatch) rooms = parseGermanNumber(rMatch[1]);
    }
    if (sqm === null) {
      const sMatch = mainText.match(/(\d{1,4}(?:[.,]\d{1,2})?)\s*m²\b/i);
      if (sMatch) sqm = parseGermanNumber(sMatch[1]);
    }

    if (totalNk !== null) {
      if (hkIncludedInNk && heatingCosts !== null && totalNk >= heatingCosts) {
        additionalCosts = Math.round((totalNk - heatingCosts) * 100) / 100;
      } else {
        additionalCosts = totalNk;
      }
    } else if (warmRent !== null && coldRent !== null && warmRent >= coldRent) {
      additionalCosts = Math.round((warmRent - coldRent) * 100) / 100;
    }

    if (mainText.includes('privates Angebot') || mainText.includes('Privatanbieter')) {
      sellerTypeRaw = 'private';
      sellerName = 'Privatanbieter';
    } else if (mainText.includes('gewerbliches Angebot') || mainText.includes('Gewerblicher Anbieter')) {
      sellerTypeRaw = 'commercial';
      sellerName = 'Gewerblicher Anbieter';
    }

    if (wbsExplicit === null) {
      wbsExplicit = detectWbsRequired(mainText);
    }

    descriptionText = mainText.slice(0, 5000);
  } else if (cleanUrl.includes('immowelt.de') || resolvedPortal === 'immowelt') {
    title =
      $('h1').first().text().replace(/\s+/g, ' ').trim() ||
      $('meta[property="og:title"]').attr('content')?.trim() ||
      '';

    let warmRent = null;
    let heatingInWarm = false;
    let heatingSeparate = false;

    $('span, div, p, dt, th').each((_, el) => {
      const label = $(el).text().trim();

      if (/^Nebenkosten$/i.test(label) && additionalCosts === null) {
        const sib = $(el).next().text().trim() || $(el).parent().next().text().trim();
        const num = parseGermanNumber(sib);
        if (num !== null) additionalCosts = num;
        else {
          const gp = $(el).parent().parent().text().replace(/\s+/g, ' ');
          const m = gp.match(/Nebenkosten\s*([\d.,]+)\s*€/i);
          if (m) additionalCosts = parseGermanNumber(m[1]);
        }
      }

      if (/^Heizkosten$/i.test(label) && heatingCosts === null) {
        const sib =
          $(el).next().text().trim() ||
          $(el).parent().next().text().trim() ||
          $(el).parent().parent().text().replace(/\s+/g, ' ');
        if (/in Warmmiete enthalten/i.test(sib)) {
          heatingInWarm = true;
          heatingCosts = 0;
        } else if (/nicht in Nebenkosten enthalten|separat/i.test(sib)) {
          heatingSeparate = true;
          heatingCosts = 0;
        } else {
          const num = parseGermanNumber(sib);
          if (num !== null) heatingCosts = num;
        }
      }

      if (/^Kaltmiete$/i.test(label) && coldRent === null) {
        const sib = $(el).prev().text().trim() || $(el).parent().text().replace(/\s+/g, ' ');
        const m =
          sib.match(/([\d.,]+)\s*€\s*Kaltmiete/i) ||
          sib.match(/Kaltmiete\s*(?:(?:\d+[.,]\d+\s*€\/m²\s*)?)([\d.,]+)\s*€/i);
        if (m) {
          const num = parseGermanNumber(m[1]);
          if (num && num >= 150) coldRent = num;
        }
      }

      if (/^Warmmiete(?:\s*ca\.)?$/i.test(label) && warmRent === null) {
        const sib =
          $(el).prev().text().trim() ||
          $(el).parent().next().text().trim() ||
          $(el).parent().text().replace(/\s+/g, ' ');
        const m =
          sib.match(/([\d.,]+)\s*€\s*Warmmiete/i) ||
          sib.match(/Warmmiete(?:\s*ca\.)?\s*~?([\d.,]+)\s*€/i);
        if (m) warmRent = parseGermanNumber(m[1]);
      }
    });

    const bodyText = $('body').text().replace(/\s+/g, ' ');

    if (coldRent === null) {
      const m =
        bodyText.match(/([\d.,]+)\s*€\s*Kaltmiete/i) ||
        bodyText.match(/Kaltmiete\s+(?:(?:\d+\s*€\/m²\s+)?)([\d.,]+)\s*€/i);
      if (m) {
        const num = parseGermanNumber(m[1]);
        if (num && num >= 150) coldRent = num;
      }
    }

    if (additionalCosts === null) {
      const m = bodyText.match(/Nebenkosten\s*([\d.,]+)\s*€/i);
      if (m) additionalCosts = parseGermanNumber(m[1]);
      else if (warmRent !== null && coldRent !== null && warmRent > coldRent) {
        additionalCosts = Math.round((warmRent - coldRent) * 100) / 100;
      }
    }

    if (heatingCosts === null && !heatingInWarm && !heatingSeparate) {
      if (/Heizkosten\s*in Warmmiete enthalten/i.test(bodyText)) {
        heatingCosts = 0;
      } else if (/Heizkosten\s*(?:nicht in Nebenkosten enthalten|separat)/i.test(bodyText)) {
        heatingCosts = 0;
      } else {
        const m = bodyText.match(/Heizkosten\s*([\d.,]+)\s*€/i);
        if (m) heatingCosts = parseGermanNumber(m[1]);
      }
    }

    const locMatch =
      bodyText.match(/\b(458\d{2})\s+Gelsenkirchen/i) ||
      bodyText.match(/\b(\d{5})\s+([A-Za-zÄÖÜäöüß\-]+)/);
    if (locMatch) {
      localityRaw = locMatch[0];
      zipcode = locMatch[1];
      district = detectDistrict(locMatch[0], defaultCity, zipcode);
    }

    const rMatch = bodyText.match(/(\d{1,2}(?:[.,]\d)?)\s*Zimmer\b/i);
    if (rMatch && rooms === null) rooms = parseGermanNumber(rMatch[1]);

    const sMatch = bodyText.match(/(\d{1,4}(?:[.,]\d{1,2})?)\s*m²/i);
    if (sMatch && sqm === null) sqm = parseGermanNumber(sMatch[1]);

    descriptionText = bodyText.slice(0, 5000);
  }

  // 2. Valid Listing JSON-LD extraction (ignores WebSite / BreadcrumbList / ImageObject)
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
      if (offer?.itemOffered) {
        const item = offer.itemOffered;
        if (sqm === null && item.floorSize?.value) {
          sqm = parseGermanNumber(item.floorSize.value);
        }
        if (rooms === null && (item.numberOfRooms?.value ?? item.numberOfBedrooms?.value)) {
          rooms = parseGermanNumber(item.numberOfRooms?.value ?? item.numberOfBedrooms?.value);
        }
        if (item.address) {
          if (item.address.postalCode && !zipcode) zipcode = String(item.address.postalCode).trim();
          if (item.address.addressLocality) {
            if (!localityRaw) localityRaw = String(item.address.addressLocality).trim();
            if (!district) district = detectDistrict(item.address.addressLocality, defaultCity);
          }
          if (item.address.streetAddress && !localityRaw) {
            localityRaw = String(item.address.streetAddress).trim();
          }
        }
      }
    }
    if (ld.floorSize?.value && sqm === null) {
      sqm = parseGermanNumber(ld.floorSize.value);
    }
    if (ld.numberOfRooms && rooms === null) {
      rooms = parseGermanNumber(ld.numberOfRooms);
    }
    if (Array.isArray(ld.additionalProperty)) {
      for (const prop of ld.additionalProperty) {
        const pName = String(prop?.name || '').toLowerCase();
        const pVal = prop?.value;
        if (!pVal) continue;
        if (pName === 'plz' && !zipcode) {
          const zMatch = String(pVal).match(/\b(\d{5})\b/);
          if (zMatch) zipcode = zMatch[1];
        } else if (pName.includes('zimmer') && rooms === null) {
          rooms = parseGermanNumber(pVal);
        } else if ((pName.includes('wohnfl') || pName.includes('qm')) && sqm === null) {
          sqm = parseGermanNumber(pVal);
        }
      }
    }
    if (ld.address) {
      if (ld.address.postalCode && !zipcode) zipcode = String(ld.address.postalCode).trim();
      if (ld.address.addressLocality) {
        if (!localityRaw) localityRaw = String(ld.address.addressLocality).trim();
        if (!district) district = detectDistrict(ld.address.addressLocality, defaultCity);
      }
    }
  }

  // 3. __NEXT_DATA__ hydration extraction
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

  if (!title) {
    title =
      $('h1').first().text().replace(/\s+/g, ' ').trim() ||
      $('meta[property="og:title"]').attr('content')?.trim() ||
      $('title').text().trim();
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
  if (!zipcode) zipcode = detectZipcode(`${localityRaw} ${fullText}`);
  district = resolveDistrictByZip(district, `${localityRaw} ${title}`, defaultCity, zipcode);

  const isPrivateLandlord = detectPrivateLandlord({
    sellerTypeRaw,
    sellerName,
    fullText: `${sellerName} ${fullText}`,
    portal: resolvedPortal,
  });

  const wbsRequired = wbsExplicit !== null ? wbsExplicit : detectWbsRequired(fullText);
  const contactInfo = extractContactInfo($, {
    jsonLds,
    nextData,
    sellerName,
    text: `${sellerName}\n${descriptionText}\n${$('footer').text().slice(0, 800)}`,
  });

  return {
    external_id: externalId,
    portal: resolvedPortal,
    title: (title || `Wohnungsangebot (${externalId})`).slice(0, 300),
    url: cleanUrl,
    city: defaultCity,
    district: district || defaultCity,
    zipcode,
    locality_raw: localityRaw,
    cold_rent: coldRent,
    additional_costs: additionalCosts ?? 0,
    heating_costs: heatingCosts ?? 0,
    sqm,
    rooms,
    is_private_landlord: Boolean(isPrivateLandlord),
    wbs_required: Boolean(wbsRequired),
    is_wanted: Boolean(isWanted),
    contact_name: contactInfo.contact_name,
    contact_phone: contactInfo.contact_phone,
    contact_email: contactInfo.contact_email,
    description_snippet: descriptionText.slice(0, 800),
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
  if (portal === 'immowelt' && (lowerUrl.includes('/liste/') || lowerUrl.includes('/suche/')) && !lowerUrl.includes('/expose/')) {
    return { offline: true, reason: 'Redirect zur Immowelt-Liste' };
  }
  if (lowerUrl.includes('ohne-makler.net/immobilien/') && !lowerUrl.includes('/immobilie/')) {
    return { offline: true, reason: 'Redirect zur Ohne-Makler-Liste' };
  }
  if (lowerUrl.includes('rentola.de') && !lowerUrl.includes('/listings/')) {
    return { offline: true, reason: 'Redirect zur Rentola-Übersicht' };
  }
  if (lowerUrl.includes('ggw-gelsenkirchen.de/mietangebote')) {
    return { offline: true, reason: 'Redirect zur GGW-Übersicht' };
  }
  if (
    lowerUrl.includes('quoka.de/') &&
    (lowerUrl.includes('/error/notfound') ||
      (lowerUrl.includes('/vermietung-wohnungen/') && !lowerUrl.includes('/anzeige/')))
  ) {
    return { offline: true, reason: 'Redirect zur Quoka-Übersicht / 404' };
  }
  if (lowerUrl.includes('meinestadt.de') && !lowerUrl.includes('/expose/') && lowerUrl.includes('/immobilien/')) {
    return { offline: true, reason: 'Redirect zur Meinestadt-Übersicht' };
  }

  const lowerHtml = String(html || '').toLowerCase();
  const offlineMarkers = [
    'inserat ist nicht mehr verfügbar',
    'anzeige ist nicht mehr verfügbar',
    'anzeige nicht mehr verfügbar',
    'dieses inserat wurde gelöscht',
    'seite nicht gefunden',
    '404 - page not found',
    'listing is no longer available',
    'anzeige ist leider nicht mehr verfügbar',
    'diese anzeige existiert nicht mehr',
    'anzeige ist nicht mehr aktiv',
    'anzeige wurde gelöscht',
    'anzeige ist deaktiviert',
    'dieses angebot ist leider nicht mehr verfügbar',
    'leider wurde die gesuchte anzeige nicht gefunden',
    'leider wurde keine anzeige gefunden',
    'objekt ist nicht mehr verfügbar',
    'expose nicht gefunden',
    '404 page - quoka',
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
      (lower.includes('immobilienscout24.de') && lower.includes('/expose/')) ||
      (lower.includes('ohne-makler.net') && /\/immobilie\/(?!list\b)[a-z0-9]+/i.test(lower)) ||
      (lower.includes('ggw-gelsenkirchen.de') && /\/object\/\d+/i.test(lower)) ||
      (lower.includes('quoka.de') && /\/anzeige\/.+\/[a-z0-9]+\.html/i.test(lower));

    if (isSupportedListing) {
      cleaned.add(normalizeListingUrl(trimmed));
    }
  }

  return [...cleaned];
}
