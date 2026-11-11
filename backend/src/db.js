import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;

if (!config.databaseUrl) {
  console.warn('[DB] Warnung: DATABASE_URL ist nicht gesetzt.');
}

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 15,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('[DB] Unerwarteter Pool-Fehler:', err.message);
});

const STRICT_KA_ALL_URL =
  'https://www.kleinanzeigen.de/s-wohnung-mieten/gelsenkirchen/anzeige:angebote/preis:150:850/c203l1000+wohnung_mieten.qm_d:20,+wohnung_mieten.zimmer_d:1,0?sortingField=SORTING_DATE';
const STRICT_KA_PRIV_URL =
  'https://www.kleinanzeigen.de/s-wohnung-mieten/gelsenkirchen/anzeige:angebote/anbieter:privat/preis:150:850/c203l1000+wohnung_mieten.qm_d:20,+wohnung_mieten.zimmer_d:1,0?sortingField=SORTING_DATE';
const STRICT_IW_URL =
  'https://www.immowelt.de/suche/mieten/wohnung/nordrhein-westfalen/gelsenkirchen-45879/ad08de2278?priceMax=850&distributionTypes=Rent&estateTypes=Apartment&order=DateDesc';

const INIT_SQL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS kdu_rules (
    id SERIAL PRIMARY KEY,
    city VARCHAR(100) NOT NULL DEFAULT 'Gelsenkirchen',
    bg_size INT NOT NULL CHECK (bg_size >= 1 AND bg_size <= 20),
    max_sqm NUMERIC(6, 2) NOT NULL,
    max_bruttokalt_eur NUMERIC(8, 2) NOT NULL,
    extra_person_sqm NUMERIC(6, 2) NOT NULL DEFAULT 15.00,
    extra_person_eur NUMERIC(8, 2) NOT NULL DEFAULT 116.60,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_kdu_city_bg UNIQUE (city, bg_size)
);

INSERT INTO kdu_rules (city, bg_size, max_sqm, max_bruttokalt_eur, extra_person_sqm, extra_person_eur)
VALUES
    ('Gelsenkirchen', 1,  50.00, 367.50, 15.00, 116.60),
    ('Gelsenkirchen', 2,  65.00, 466.70, 15.00, 116.60),
    ('Gelsenkirchen', 3,  80.00, 579.20, 15.00, 116.60),
    ('Gelsenkirchen', 4,  95.00, 694.45, 15.00, 116.60),
    ('Gelsenkirchen', 5, 110.00, 841.50, 15.00, 116.60),
    ('Gelsenkirchen', 6, 125.00, 958.10, 15.00, 116.60)
ON CONFLICT (city, bg_size) DO NOTHING;

CREATE TABLE IF NOT EXISTS kdu_sources (
    id SERIAL PRIMARY KEY,
    city VARCHAR(100) UNIQUE NOT NULL,
    source_url TEXT,
    zip_prefixes VARCHAR(200),
    search_max_rent_eur NUMERIC(8, 2) DEFAULT 850.00,
    auto_sync_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    sync_cron VARCHAR(100) NOT NULL DEFAULT '0 4 * * *',
    last_synced_at TIMESTAMP,
    last_sync_status VARCHAR(30),
    last_sync_message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO kdu_sources (city, zip_prefixes, search_max_rent_eur, auto_sync_enabled, sync_cron, last_sync_status, last_sync_message)
VALUES ('Gelsenkirchen', '458', 850.00, FALSE, '0 4 * * *', 'manual', 'Standard-Richtwerte Gelsenkirchen')
ON CONFLICT (city) DO NOTHING;

CREATE TABLE IF NOT EXISTS listings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id VARCHAR(255) UNIQUE NOT NULL,
    portal VARCHAR(50) NOT NULL CHECK (portal IN ('kleinanzeigen', 'immowelt', 'immoscout', 'other')),
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    city VARCHAR(100) NOT NULL DEFAULT 'Gelsenkirchen',
    district VARCHAR(120),
    zipcode VARCHAR(20),
    cold_rent NUMERIC(8, 2),
    additional_costs NUMERIC(8, 2) NOT NULL DEFAULT 0.00,
    heating_costs NUMERIC(8, 2) NOT NULL DEFAULT 0.00,
    calculated_bruttokalt NUMERIC(8, 2),
    sqm NUMERIC(6, 2),
    rooms NUMERIC(4, 1),
    is_private_landlord BOOLEAN NOT NULL DEFAULT FALSE,
    wbs_required BOOLEAN NOT NULL DEFAULT FALSE,
    matched_min_bg_size INT,
    status VARCHAR(30) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'offline', 'manual_hidden')),
    first_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_listings_status_city ON listings (status, city);
CREATE INDEX IF NOT EXISTS idx_listings_private ON listings (is_private_landlord) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_listings_bg_size ON listings (matched_min_bg_size) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_listings_bruttokalt ON listings (calculated_bruttokalt) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_listings_last_seen ON listings (last_seen_at DESC);

CREATE TABLE IF NOT EXISTS scraper_configs (
    id SERIAL PRIMARY KEY,
    portal VARCHAR(50) NOT NULL CHECK (portal IN ('kleinanzeigen', 'immowelt', 'immoscout', 'other')),
    city VARCHAR(100) NOT NULL DEFAULT 'Gelsenkirchen',
    name VARCHAR(150) NOT NULL,
    search_url TEXT NOT NULL,
    cron_expression VARCHAR(100) NOT NULL DEFAULT '*/20 * * * *',
    jitter_min_ms INT NOT NULL DEFAULT 4000,
    jitter_max_ms INT NOT NULL DEFAULT 15000,
    proxy_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_scraper_portal_url UNIQUE (portal, search_url)
);

-- Migrate legacy or partial-district Gelsenkirchen seed URLs safely to full-city c203l1000
DELETE FROM scraper_configs sc
WHERE sc.portal = 'kleinanzeigen'
  AND LOWER(sc.city) = 'gelsenkirchen'
  AND (sc.search_url LIKE '%c203l2093%' OR sc.search_url LIKE '%c203l1004%' OR sc.search_url LIKE '%c203l1001%')
  AND EXISTS (
    SELECT 1 FROM scraper_configs s2
    WHERE s2.portal = 'kleinanzeigen'
      AND s2.search_url = CASE
        WHEN sc.search_url LIKE '%anbieter:privat%' THEN '${STRICT_KA_PRIV_URL}'
        ELSE '${STRICT_KA_ALL_URL}'
      END
  );

UPDATE scraper_configs
SET name = 'Kleinanzeigen Gelsenkirchen (Angebote, 150-850 EUR, ab 20m², ab 1 Zi.)',
    search_url = '${STRICT_KA_ALL_URL}',
    updated_at = NOW()
WHERE portal = 'kleinanzeigen'
  AND LOWER(city) = 'gelsenkirchen'
  AND search_url NOT LIKE '%anbieter:privat%'
  AND (search_url LIKE '%c203l2093%' OR search_url LIKE '%c203l1004%' OR search_url LIKE '%c203l1001%');

UPDATE scraper_configs
SET name = 'Kleinanzeigen Gelsenkirchen Privatvermieter (Angebote, 150-850 EUR)',
    search_url = '${STRICT_KA_PRIV_URL}',
    updated_at = NOW()
WHERE portal = 'kleinanzeigen'
  AND LOWER(city) = 'gelsenkirchen'
  AND search_url LIKE '%anbieter:privat%'
  AND (search_url LIKE '%c203l2093%' OR search_url LIKE '%c203l1004%' OR search_url LIKE '%c203l1001%');

UPDATE scraper_configs
SET name = 'Immowelt Gelsenkirchen (Angebote bis 850 EUR, Neueste, Radius 0)',
    search_url = '${STRICT_IW_URL}',
    updated_at = NOW()
WHERE portal = 'immowelt'
  AND search_url LIKE '%/liste/gelsenkirchen/%';

INSERT INTO scraper_configs (portal, city, name, search_url, cron_expression, jitter_min_ms, jitter_max_ms, is_active)
VALUES
    (
        'kleinanzeigen',
        'Gelsenkirchen',
        'Kleinanzeigen Gelsenkirchen (Angebote, 150-850 EUR, ab 20m², ab 1 Zi.)',
        '${STRICT_KA_ALL_URL}',
        '*/20 * * * *',
        4000,
        15000,
        TRUE
    ),
    (
        'kleinanzeigen',
        'Gelsenkirchen',
        'Kleinanzeigen Gelsenkirchen Privatvermieter (Angebote, 150-850 EUR)',
        '${STRICT_KA_PRIV_URL}',
        '*/20 * * * *',
        4000,
        15000,
        TRUE
    ),
    (
        'immowelt',
        'Gelsenkirchen',
        'Immowelt Gelsenkirchen (Angebote bis 850 EUR, Neueste, Radius 0)',
        '${STRICT_IW_URL}',
        '*/20 * * * *',
        4000,
        15000,
        TRUE
    )
ON CONFLICT (portal, search_url) DO NOTHING;

CREATE TABLE IF NOT EXISTS scraper_logs (
    id SERIAL PRIMARY KEY,
    config_id INT REFERENCES scraper_configs(id) ON DELETE SET NULL,
    run_type VARCHAR(50) NOT NULL CHECK (run_type IN ('delta_poll', 'reconcile', 'manual_url', 'webhook')),
    portal VARCHAR(50),
    status VARCHAR(30) NOT NULL CHECK (status IN ('running', 'success', 'partial', 'error')),
    started_at TIMESTAMP NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMP,
    duration_ms INT,
    new_count INT NOT NULL DEFAULT 0,
    updated_count INT NOT NULL DEFAULT 0,
    offline_count INT NOT NULL DEFAULT 0,
    error_message TEXT,
    details JSONB
);

CREATE INDEX IF NOT EXISTS idx_scraper_logs_started_at ON scraper_logs (started_at DESC);
`;

export async function cleanupInvalidListings() {
  const { rowCount } = await pool.query(`
    DELETE FROM listings
    WHERE (LOWER(city) = 'gelsenkirchen' AND (zipcode IS NULL OR zipcode !~ '^458(79|8[0-9]|9[0-9])$'))
       OR cold_rent IS NULL
       OR cold_rent < 150
       OR sqm IS NULL
       OR sqm < 20
       OR rooms IS NULL
       OR rooms < 1
       OR LOWER(title) IN ('kleinanzeigen', 'immowelt')
       OR title ~* '\\m(suche|suchen|gesucht|wohnungssuche|suchend|tausche|wohnungstausch|wg-zimmer|monteurzimmer|stellplatz|garage|gewerbe|ladenlokal|demenz-?wg|pflege-?wg|senioren-?wg|pflegewohngemeinschaft)\\M'
       OR url ~* '(gesucht|wohnungssuche|suche-wohnung|wg-zimmer|stellplatz|garage|demenz-wg|pflege-wg|senioren-wg)'
  `);

  const countRes = await pool.query(`SELECT COUNT(*)::int AS remaining FROM listings`);
  return {
    deletedCount: rowCount || 0,
    remainingCount: countRes.rows[0]?.remaining || 0,
  };
}

export async function ensureDatabaseInitialized(retries = 10, delayMs = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await pool.query('SELECT 1');
      await pool.query(INIT_SQL);

      // Clean up stale 'running' logs from previous container restarts
      await pool.query(`
        UPDATE scraper_logs
        SET status = 'error',
            finished_at = NOW(),
            error_message = COALESCE(error_message, 'Durch Server-Neustart unterbrochen')
        WHERE status = 'running' AND started_at < NOW() - INTERVAL '5 minutes'
      `);

      const cleanup = await cleanupInvalidListings();
      console.log(
        `[DB] PostgreSQL verbunden, Schema/Configs aktuell. Cleanup: ${cleanup.deletedCount} fehlerhafte Listings entfernt (${cleanup.remainingCount} verbleibend).`
      );
      return;
    } catch (err) {
      console.warn(
        `[DB] Verbindungsversuch ${attempt}/${retries} fehlgeschlagen: ${err.message}`
      );
      if (attempt === retries) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
