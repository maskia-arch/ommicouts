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

const MAJOR_CITIES = [
  'düsseldorf',
  'duesseldorf',
  'essen',
  'bochum',
  'herne',
  'recklinghausen',
  'gladbeck',
  'bottrop',
  'herten',
  'marl',
  'dortmund',
  'duisburg',
  'oberhausen',
  'mülheim',
  'muelheim',
  'witten',
  'hattingen',
  'castrop',
  'waltrop',
  'dorsten',
  'haltern',
  'köln',
  'koeln',
  'wuppertal',
  'gelsenkirchen',
];

export const TITLE_BLACKLIST_REGEX =
  /\b(suche|suchen|gesucht|wohnungssuche|suchend|wir suchen|ich suche|dringend gesucht|tausche|wohnungstausch|wg-zimmer|wg zimmer|demenz-?wg|pflege-?wg|senioren-?wg|monteurzimmer|stellplatz|garage|gewerbe|ladenlokal)\b/i;

const DESCRIPTION_WANTED_REGEX =
  /\b(ich suche|wir suchen|auf der suche nach einer|wohnungssuche|dringend gesucht|wohnungstausch|bewohner gesucht|suche eine \d|suchen eine \d)\b/i;

export function isValidGelsenkirchenZip(zipcode) {
  if (!zipcode) return false;
  return /^458(79|8\d|9\d)$/.test(String(zipcode).trim());
}

function matchesZipPrefixes(zipcode, zipPrefixesStr) {
  if (!zipcode || !zipPrefixesStr) return true;
  const prefixes = String(zipPrefixesStr)
    .split(/[,;\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (prefixes.length === 0) return true;
  const z = String(zipcode).trim();
  return prefixes.some((p) => z.startsWith(p));
}

/**
 * Hard validation firewall executed before any listing is inserted/updated in PostgreSQL.
 * Supports strict Gelsenkirchen geofence and dynamic multi-city geofencing via zipPrefixes.
 */
export function validateListing(
  parsed,
  expectedCity = 'Gelsenkirchen',
  { zipPrefixes = null } = {}
) {
  if (!parsed || typeof parsed !== 'object') {
    return { valid: false, reason: 'Leeres Listing-Objekt' };
  }

  // 1. Anti-Gesuche-Filter
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

  // 2. City Geofence (strict 45879-45899 for Gelsenkirchen, dynamic for added cities)
  const targetCity = String(expectedCity || 'Gelsenkirchen').trim();
  const targetLower = targetCity.toLowerCase();
  const zip = parsed.zipcode ? String(parsed.zipcode).trim() : '';
  const localityContext = `${parsed.locality_raw || ''} ${parsed.district || ''} ${title}`.toLowerCase();
  const competingCities = MAJOR_CITIES.filter((c) => c !== targetLower);
  const competingRegex = new RegExp(`\\b(${competingCities.join('|')})\\b`, 'i');

  if (targetLower === 'gelsenkirchen') {
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
        competingRegex.test(parsed.locality_raw || '') ||
        (competingRegex.test(title) && !localityContext.includes('gelsenkirchen'))
      ) {
        return {
          valid: false,
          reason: 'Fremdstadt im Ort/Titel erkannt',
        };
      }
    }
  } else {
    if (zip && zipPrefixes && !matchesZipPrefixes(zip, zipPrefixes)) {
      return {
        valid: false,
        reason: `PLZ ${zip} passt nicht zu ${targetCity} (erwartet Präfix ${zipPrefixes})`,
      };
    }

    if (
      competingRegex.test(parsed.locality_raw || '') &&
      !String(parsed.locality_raw || '').toLowerCase().includes(targetLower)
    ) {
      return {
        valid: false,
        reason: `Fremdstadt statt ${targetCity} im Ort erkannt`,
      };
    }

    if (!zip && !localityContext.includes(targetLower)) {
      return {
        valid: false,
        reason: `Kein Ortsbezug zu ${targetCity}`,
      };
    }
  }

  // 3. Plausibilitäts-Grenzen (Sanity Checks)
  const coldRent =
    parsed.cold_rent !== null && parsed.cold_rent !== undefined ? Number(parsed.cold_rent) : NaN;
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
