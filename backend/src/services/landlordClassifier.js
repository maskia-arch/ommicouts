/**
 * Landlord & Commercial Housing Provider Classifier for jcimmo
 *
 * Reliably identifies commercial property managers, housing companies,
 * cooperatives, and brokers across all portals and data sources (including
 * Wohnungsaushang Gelsenkirchen, Kleinanzeigen, Immowelt, etc.).
 *
 * Ensures that commercial entities (such as Trah Hausverwaltung, Vivawest,
 * LEG, Vonovia, GGW, WBG Horst, etc.) are NEVER mislabeled as "Privatvermieter".
 */

export const KNOWN_COMMERCIAL_ENTITIES = [
  {
    name: 'Trah Hausverwaltung',
    phonePrefixes: ['0209508082', '0209808082', '020950808200'],
    domains: ['trah.eu'],
    keywords: ['trah', 'trah hausverwaltung', 'immobilienverwaltung trah', 'hausverwaltung trah'],
  },
  {
    name: 'Vivawest Wohnen GmbH',
    phonePrefixes: ['020917003', '023253775'],
    domains: ['vivawest.de'],
    keywords: ['vivawest', 'vivawest wohnen', 'vivawest gmbh'],
  },
  {
    name: 'LEG Wohnen NRW',
    phonePrefixes: ['02117407', '0211740'],
    domains: ['leg-wohnen.de', 'leg.de'],
    keywords: ['leg wohnen', 'leg immobilien', 'leg nrw', 'leg kundenservice'],
  },
  {
    name: 'GGW Gelsenkirchen',
    phonePrefixes: ['0209706'],
    domains: ['g-g-w.de'],
    keywords: ['ggw', 'gelsenkirchener gemeinnützige wohnungsbaugesellschaft', 'ggw gelsenkirchen'],
  },
  {
    name: 'Vonovia SE',
    phonePrefixes: ['0342580004', '0234314', '030897'],
    domains: ['vonovia.de', 'deutsche-wohnen.com'],
    keywords: ['vonovia', 'deutsche wohnen', 'vonovia se', 'vonovia kundenservice'],
  },
  {
    name: 'Wohnungsbaugenossenschaft Horst eG (WBG Horst)',
    phonePrefixes: ['020955548', '0209513164'],
    domains: ['wbg-horst.de'],
    keywords: ['wbg horst', 'genossenschaft horst', 'wohnungsbaugenossenschaft horst'],
  },
  {
    name: 'Buersche Ges. f. Hausverwaltung (Haus & Grund)',
    phonePrefixes: ['020930911', '02093091'],
    domains: ['hausundgrund.de', 'haus-und-grund.de'],
    keywords: ['buersche gesellschaft', 'buersche ges. f. hausverwaltung', 'haus & grund buer', 'haus und grund buer'],
  },
  {
    name: '4K Immobilien',
    phonePrefixes: ['02099566120', '0209956612'],
    keywords: ['4k immobilien'],
  },
  {
    name: 'Zabel Haus & Verwaltung',
    phonePrefixes: ['023619502060', '0236195020'],
    keywords: ['zabel haus', 'zabel immobilien', 'zabel haus & verwaltung'],
  },
  {
    name: 'Ev. Kirchenkreis Gelsenkirchen (Kreiskirchenamt)',
    phonePrefixes: ['0209589007'],
    domains: ['kirchegelsenkirchen.de'],
    keywords: ['kreiskirchenamt', 'kirchenkreis gelsenkirchen', 'evangelische kirche gelsenkirchen'],
  },
  {
    name: 'LIV Management GmbH',
    phonePrefixes: ['05121973560', '0512197356'],
    keywords: ['liv management'],
  },
  {
    name: 'HaBo Hausverwaltung GmbH',
    phonePrefixes: ['01722725955'],
    keywords: ['habo hausverwaltung'],
  },
  {
    name: 'Grand City Property',
    domains: ['grandcityproperty.de'],
    keywords: ['grand city property', 'gcp'],
  },
  {
    name: 'TAG Wohnen',
    domains: ['tag-ag.com', 'tag-wohnen.de'],
    keywords: ['tag wohnen', 'tag immobilien'],
  },
  {
    name: 'Covivio',
    domains: ['covivio.immo'],
    keywords: ['covivio'],
  },
  {
    name: 'Sahle Wohnen',
    domains: ['sahle.de'],
    keywords: ['sahle wohnen'],
  },
  {
    name: 'Belvona Residenzen',
    domains: ['belvona.de'],
    keywords: ['belvona'],
  },
];

export const GENERAL_COMMERCIAL_KEYWORDS = [
  'hausverwaltung',
  'immobilienverwaltung',
  'haus- und vermögensverwaltung',
  'vermögensverwaltung',
  'property management',
  'asset management',
  'wohnbau',
  'wohnungsbau',
  'wohnungsgesellschaft',
  'wohnungsgenossenschaft',
  'wohngenossenschaft',
  'baugenossenschaft',
  'wohnungswirtschaft',
  'makler',
  'immobilien',
  'real estate',
  'gmbh',
  'mbh',
  'co. kg',
  'co.kg',
  'kgaa',
  ' ug ',
  'ag ',
  'e. g.',
  ' eg ',
  'e.v.',
  ' ev ',
  'gewerblicher nutzer',
  'gewerblicher anbieter',
  'gewerbliches inserat',
  'gewerblich',
  'commercial',
  'agency',
  'firmenkunde',
  'kundenservice',
  'kundenbetreuung',
  'vermietungsteam',
  'zentrale',
  'provisionspflichtig',
  'courtage',
];

export const PRIVATE_KEYWORDS = [
  'privater anbieter',
  'privatvermieter',
  'von privat',
  'privat zu vermieten',
  'private vermietung',
  'eigentümer',
];

/**
 * Normalizes any phone string to digits only, mapping +49 / 0049 to a leading 0.
 * Examples:
 * "+49 (209) 50808200" -> "020950808200"
 * "0209 / 508082-00"   -> "020950808200"
 * "+49 209 17003-28547"-> "02091700328547"
 */
export function normalizePhoneDigits(phone) {
  if (!phone) return '';
  let s = String(phone).trim();
  s = s.replace(/^\+49/, '0').replace(/^0049/, '0');
  return s.replace(/\D/g, '');
}

/**
 * Classifies whether a landlord/contact is commercial or private.
 *
 * @param {object} params
 * @param {string} [params.phone] - Phone number
 * @param {string} [params.email] - Email address
 * @param {string} [params.sellerName] - Name of seller / contact
 * @param {string} [params.sellerTypeRaw] - Raw type string from portal (e.g. "commercial", "private")
 * @param {string} [params.fullText] - Description or combined text snippet
 * @param {string} [params.portal] - Source portal name
 * @returns {{ isCommercial: boolean, isPrivate: boolean, commercialName: string | null, reason: string }}
 */
export function classifyLandlord({
  phone = '',
  email = '',
  sellerName = '',
  sellerTypeRaw = '',
  fullText = '',
  portal = 'other',
} = {}) {
  const normDigits = normalizePhoneDigits(phone);
  const lowerEmail = String(email || '').trim().toLowerCase();
  const lowerName = String(sellerName || '').trim().toLowerCase();
  const lowerSellerType = String(sellerTypeRaw || '').trim().toLowerCase();
  const lowerText = String(fullText || '').toLowerCase();
  const combinedHaystack = `${lowerName} ${lowerSellerType} ${lowerText}`;

  // 1. Direct Phone Prefix Match against Known Commercial Entities
  if (normDigits) {
    for (const entity of KNOWN_COMMERCIAL_ENTITIES) {
      if (entity.phonePrefixes) {
        for (const prefix of entity.phonePrefixes) {
          if (normDigits.startsWith(prefix) || normDigits === prefix) {
            return {
              isCommercial: true,
              isPrivate: false,
              commercialName: entity.name,
              reason: `phone_match_${prefix}`,
            };
          }
        }
      }
    }
  }

  // 2. Email Domain Match against Known Commercial Entities
  if (lowerEmail && lowerEmail.includes('@')) {
    const emailDomain = lowerEmail.split('@')[1];
    for (const entity of KNOWN_COMMERCIAL_ENTITIES) {
      if (entity.domains && entity.domains.some((d) => emailDomain === d || emailDomain.endsWith('.' + d))) {
        return {
          isCommercial: true,
          isPrivate: false,
          commercialName: entity.name,
          reason: `email_domain_match_${emailDomain}`,
        };
      }
    }
    // Generic commercial email patterns
    if (/(?:hausverwaltung|immobilien|makler|wohnbau|verwaltung|property|service)\./i.test(emailDomain)) {
      return {
        isCommercial: true,
        isPrivate: false,
        commercialName: lowerName && lowerName !== 'vermieter' ? sellerName : 'Gewerbliche Hausverwaltung',
        reason: 'generic_commercial_email_domain',
      };
    }
  }

  // 3. Entity Keyword Match in seller name or text
  for (const entity of KNOWN_COMMERCIAL_ENTITIES) {
    if (entity.keywords) {
      for (const kw of entity.keywords) {
        const regex = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (regex.test(combinedHaystack)) {
          return {
            isCommercial: true,
            isPrivate: false,
            commercialName: entity.name,
            reason: `keyword_match_${kw}`,
          };
        }
      }
    }
  }

  // 4. Portal-reported commercial flag
  if (
    lowerSellerType === 'commercial' ||
    lowerSellerType.includes('gewerblich') ||
    lowerSellerType.includes('business') ||
    lowerSellerType.includes('agency')
  ) {
    return {
      isCommercial: true,
      isPrivate: false,
      commercialName: lowerName && lowerName !== 'vermieter' ? sellerName : 'Gewerblicher Anbieter',
      reason: 'portal_commercial_type',
    };
  }

  // 5. General Commercial Keywords (GmbH, Hausverwaltung, Immobilien, Makler, etc.)
  for (const kw of GENERAL_COMMERCIAL_KEYWORDS) {
    // For short tokens (ag, eg, ug), use strict word boundary. For longer terms, allow German compound words.
    const isShort = kw.trim().length <= 3;
    const regex = isShort
      ? new RegExp(`\\b${kw.trim()}\\b`, 'i')
      : new RegExp(`(?:\\b|\\w*)${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');

    if (regex.test(lowerName) || regex.test(lowerSellerType)) {
      return {
        isCommercial: true,
        isPrivate: false,
        commercialName: sellerName.trim() || 'Gewerblicher Anbieter',
        reason: `seller_commercial_keyword_${kw}`,
      };
    }
    if (regex.test(lowerText)) {
      return {
        isCommercial: true,
        isPrivate: false,
        commercialName: lowerName ? sellerName.trim() : 'Gewerblicher Anbieter',
        reason: `text_commercial_keyword_${kw}`,
      };
    }
  }

  // 6. Explicit Private Indicators
  if (
    lowerSellerType === 'private' ||
    lowerSellerType.includes('privat') ||
    lowerSellerType.includes('person')
  ) {
    return {
      isCommercial: false,
      isPrivate: true,
      commercialName: null,
      reason: 'portal_private_type',
    };
  }

  for (const kw of PRIVATE_KEYWORDS) {
    const regex = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (regex.test(combinedHaystack)) {
      return {
        isCommercial: false,
        isPrivate: true,
        commercialName: null,
        reason: `explicit_private_keyword_${kw}`,
      };
    }
  }

  // 7. Natural Person Name Check (e.g. "Herr Mustermann", "Frau Schmidt", "Vorname Nachname")
  if (sellerName.trim()) {
    const clean = sellerName.trim();
    if (/^(?:frau|herr|familie)\s+/i.test(clean) || /^[A-ZÄÖÜ][a-zäöüß-]+\s+[A-ZÄÖÜ][a-zäöüß-]+$/.test(clean)) {
      return {
        isCommercial: false,
        isPrivate: true,
        commercialName: null,
        reason: 'natural_person_name',
      };
    }
  }

  // 8. Default fallback for Wohnungsaushang without commercial indicators:
  // If no commercial indicator was found, we assume private if it is a single individual posting
  if (portal === 'wohnungsaushang') {
    return {
      isCommercial: false,
      isPrivate: true,
      commercialName: null,
      reason: 'wohnungsaushang_default_private',
    };
  }

  // Default for other portals without any indicators: not confirmed private
  return {
    isCommercial: false,
    isPrivate: false,
    commercialName: null,
    reason: 'unclassified_default_false',
  };
}

/**
 * Runs batch re-classification on the database:
 * 1. Checks all listings with known commercial phone numbers, emails, or names and updates them.
 * 2. Checks phone numbers appearing across 3+ listings (serial portfolio managers) and marks them commercial.
 * 3. Corrects contact_name to official company names where identified.
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<{ updatedCount: number, commercialCount: number, privateCount: number }>}
 */
export async function reclassifyLandlordsInDb(pool) {
  let updatedCount = 0;

  // 1. Direct re-classification of known entities by phone number / prefix
  for (const entity of KNOWN_COMMERCIAL_ENTITIES) {
    if (entity.phonePrefixes) {
      for (const prefix of entity.phonePrefixes) {
        // Strip leading 0 to match digits inside various formatting styles
        const coreDigits = prefix.replace(/^0/, '');
        const res = await pool.query(
          `UPDATE listings
           SET is_private_landlord = FALSE,
               contact_name = COALESCE(NULLIF(contact_name, 'Vermieter (Wohnungsaushang)'), $1)
           WHERE (
             contact_phone ~* $2
             OR regexp_replace(COALESCE(contact_phone, ''), '\\D', '', 'g') LIKE $3
           ) AND (is_private_landlord = TRUE OR contact_name = 'Vermieter (Wohnungsaushang)')`,
          [entity.name, coreDigits, `%${coreDigits}%`]
        );
        updatedCount += res.rowCount || 0;
      }
    }

    if (entity.domains) {
      for (const domain of entity.domains) {
        const res = await pool.query(
          `UPDATE listings
           SET is_private_landlord = FALSE,
               contact_name = COALESCE(NULLIF(contact_name, 'Vermieter (Wohnungsaushang)'), $1)
           WHERE contact_email ILIKE $2 AND (is_private_landlord = TRUE OR contact_name = 'Vermieter (Wohnungsaushang)')`,
          [entity.name, `%@${domain}`]
        );
        updatedCount += res.rowCount || 0;
      }
    }

    if (entity.keywords) {
      for (const kw of entity.keywords) {
        const res = await pool.query(
          `UPDATE listings
           SET is_private_landlord = FALSE,
               contact_name = COALESCE(NULLIF(contact_name, 'Vermieter (Wohnungsaushang)'), $1)
           WHERE (contact_name ILIKE $2 OR title ILIKE $2)
             AND (is_private_landlord = TRUE OR contact_name = 'Vermieter (Wohnungsaushang)')`,
          [entity.name, `%${kw}%`]
        );
        updatedCount += res.rowCount || 0;
      }
    }
  }

  // 2. Commercial keywords in contact_name or title
  const kwRes = await pool.query(`
    UPDATE listings
    SET is_private_landlord = FALSE
    WHERE (
      contact_name ~* '\\m(gmbh|mbh|kg|ag|eg|ug|hausverwaltung|immobilien|makler|wohnungsgesellschaft|wohnbau|vivawest|leg|vonovia|ggw|trah)\\M'
      OR title ~* '\\m(hausverwaltung|immobilienverwaltung|trah|vivawest|leg wohnen|vonovia|ggw)\\M'
    ) AND is_private_landlord = TRUE;
  `);
  updatedCount += kwRes.rowCount || 0;

  // 3. Multi-listing serial phone numbers (>= 3 active listings with same phone number, excluding Ohne-Makler hotline)
  const multiRes = await pool.query(`
    WITH serial_phones AS (
      SELECT contact_phone
      FROM listings
      WHERE contact_phone IS NOT NULL
        AND status = 'active'
        AND contact_phone NOT LIKE '%781020610%' -- skip Ohne-Makler customer support line
      GROUP BY contact_phone
      HAVING COUNT(*) >= 3
    )
    UPDATE listings
    SET is_private_landlord = FALSE
    WHERE contact_phone IN (SELECT contact_phone FROM serial_phones)
      AND is_private_landlord = TRUE;
  `);
  updatedCount += multiRes.rowCount || 0;

  const countRes = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'active' AND is_private_landlord = FALSE)::int AS commercial_count,
      COUNT(*) FILTER (WHERE status = 'active' AND is_private_landlord = TRUE)::int AS private_count
    FROM listings;
  `);

  return {
    updatedCount,
    commercialCount: countRes.rows[0]?.commercial_count || 0,
    privateCount: countRes.rows[0]?.private_count || 0,
  };
}
