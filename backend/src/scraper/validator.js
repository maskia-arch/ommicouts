const GE_DISTRICTS = [
  'altstadt',
  'beckhausen',
  'bismarck',
  'bulmke-hüllen',
  'bulmke',
  'buer',
  'erle',
  'feldmark',
  'hassel',
  'heßler',
  'hessler',
  'horst',
  'neustadt',
  'resse',
  'resser mark',
  'rotthausen',
  'schalke',
  'schalke-nord',
  'scholven',
  'ückendorf',
  'ueckendorf',
];

const OTHER_CITIES_REGEX =
  /\b(düsseldorf|duesseldorf|essen|bochum|herne|recklinghausen|gladbeck|bottrop|herten|marl|dortmund|duisburg|oberhausen|mülheim|muelheim|witten|hattingen|castrop|waltrop|dorsten|haltern|köln|koeln|wuppertal)\b/i;

export const TITLE_BLACKLIST_REGEX =
  /\b(suche|suchen|gesucht|wohnungssuche|suchend|wir suchen|ich suche|dringend gesucht|tausche|wohnungstausch|wg-zimmer|wg zimmer|monteurzimmer|stellplatz|garage|gewerbe|ladenlokal)\b/i;

const DESCRIPTION_WANTED_REGEX =
  /\b(ich suche|wir suchen|auf der suche nach einer|wohnungssuche|dringend gesucht|wohnungstausch|suche eine \d|suchen eine \d)\b/i;

export function isValidGelsenkirchenZip(zipcode) {
  if (!zipcode) return false;
  return /^458(79|8\d|9\d)$/.test(String(zipcode).trim());
}

/**
 * Hard validation firewall executed before any listing is inserted/updated in PostgreSQL.
 * Returns { valid: true } or { valid: false, reason: string }.
 */
export function validateListing(parsed, expectedCity = 'Gelsenkirchen') {
  if (!parsed || typeof parsed !== 'object') {
    return { valid: false, reason: 'Leeres Listing-Objekt' };
  }

  // 1. Anti-Gesuche-Filter (HTML/JSON Wanted Type + Title/URL Blacklist)
  if (parsed.is_wanted) {
    return { valid: false, reason: 'Inseratstyp ist Gesuch (WANTED)' };
  }

  const title = String(parsed.title || '').trim();
  const url = String(parsed.url || '').trim();
  const urlSlug = url.toLowerCase();

  if (!title || title.toLowerCase() === 'kleinanzeigen' || title.toLowerCase() === 'immowelt') {
    return { valid: false, reason: `Ungültiger Titel ("${title}")` };
  }

  if (TITLE_BLACKLIST_REGEX.test(title)) {
    const m = title.match(TITLE_BLACKLIST_REGEX);
    return { valid: false, reason: `Blacklist-Treffer im Titel ("${m?.[0]}")` };
  }

  if (TITLE_BLACKLIST_REGEX.test(urlSlug.replace(/[-_/]/g, ' '))) {
    const m = urlSlug.replace(/[-_/]/g, ' ').match(TITLE_BLACKLIST_REGEX);
    return { valid: false, reason: `Blacklist-Treffer in URL ("${m?.[0]}")` };
  }

  if (parsed.description_snippet && DESCRIPTION_WANTED_REGEX.test(parsed.description_snippet)) {
    const m = parsed.description_snippet.match(DESCRIPTION_WANTED_REGEX);
    return { valid: false, reason: `Gesuch-Formulierung in Beschreibung ("${m?.[0]}")` };
  }

  // 2. Strikter Gelsenkirchen-Geofence (PLZ & Orts-Check)
  if (String(expectedCity || 'Gelsenkirchen').toLowerCase() === 'gelsenkirchen') {
    const zip = parsed.zipcode ? String(parsed.zipcode).trim() : '';
    const localityContext = `${parsed.locality_raw || ''} ${parsed.district || ''} ${title}`.toLowerCase();

    if (zip) {
      if (!isValidGelsenkirchenZip(zip)) {
        return {
          valid: false,
          reason: `PLZ ${zip} außerhalb von Gelsenkirchen (erwartet 45879-45899)`,
        };
      }
    } else {
      const hasGeMarker =
        localityContext.includes('gelsenkirchen') ||
        GE_DISTRICTS.some((d) => new RegExp(`\\b${d}\\b`, 'i').test(localityContext));

      if (!hasGeMarker) {
        return {
          valid: false,
          reason: 'Keine Gelsenkirchen-PLZ (458xx) und kein GE-Orts-/Stadtteilbezug',
        };
      }

      if (
        OTHER_CITIES_REGEX.test(parsed.locality_raw || '') ||
        (OTHER_CITIES_REGEX.test(title) && !localityContext.includes('gelsenkirchen'))
      ) {
        return {
          valid: false,
          reason: 'Fremdstadt im Ort/Titel erkannt',
        };
      }
    }
  }

  // 3. Plausibilitäts-Grenzen (Sanity Checks gegen 1 € VB / 0 Zimmer / < 20 m²)
  const coldRent = parsed.cold_rent !== null && parsed.cold_rent !== undefined ? Number(parsed.cold_rent) : NaN;
  if (!Number.isFinite(coldRent) || coldRent < 150) {
    return {
      valid: false,
      reason: `Kaltmiete ungültig oder < 150 € (${parsed.cold_rent ?? 'null'})`,
    };
  }

  const sqm = parsed.sqm !== null && parsed.sqm !== undefined ? Number(parsed.sqm) : NaN;
  if (!Number.isFinite(sqm) || sqm < 20) {
    return {
      valid: false,
      reason: `Wohnfläche ungültig oder < 20 m² (${parsed.sqm ?? 'null'})`,
    };
  }

  const rooms = parsed.rooms !== null && parsed.rooms !== undefined ? Number(parsed.rooms) : NaN;
  if (!Number.isFinite(rooms) || rooms < 1) {
    return {
      valid: false,
      reason: `Zimmeranzahl ungültig oder < 1 (${parsed.rooms ?? 'null'})`,
    };
  }

  return { valid: true };
}
