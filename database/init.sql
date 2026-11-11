-- ==============================================================================
-- Jobcenter-Wohnungs-Matcher (Gelsenkirchen Edition)
-- Native PostgreSQL Schema & Seed Data (Idempotent)
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ------------------------------------------------------------------------------
-- 1. KdU-Regelwerk (Jobcenter Angemessenheitsgrenzen)
-- ------------------------------------------------------------------------------
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

-- Offizielle Gelsenkirchener KdU-Richtwerte (Bruttokaltmiete = Kaltmiete + kalte Betriebskosten)
INSERT INTO kdu_rules (city, bg_size, max_sqm, max_bruttokalt_eur, extra_person_sqm, extra_person_eur)
VALUES
    ('Gelsenkirchen', 1,  50.00, 367.50, 15.00, 116.60),
    ('Gelsenkirchen', 2,  65.00, 466.70, 15.00, 116.60),
    ('Gelsenkirchen', 3,  80.00, 579.20, 15.00, 116.60),
    ('Gelsenkirchen', 4,  95.00, 694.45, 15.00, 116.60),
    ('Gelsenkirchen', 5, 110.00, 841.50, 15.00, 116.60),
    ('Gelsenkirchen', 6, 125.00, 958.10, 15.00, 116.60)
ON CONFLICT (city, bg_size) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 2. Wohnungsangebote (Listings)
-- ------------------------------------------------------------------------------
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

-- ------------------------------------------------------------------------------
-- 3. Scraper-Konfigurationen
-- ------------------------------------------------------------------------------
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

INSERT INTO scraper_configs (portal, city, name, search_url, cron_expression, jitter_min_ms, jitter_max_ms, is_active)
VALUES
    (
        'kleinanzeigen',
        'Gelsenkirchen',
        'Kleinanzeigen Gelsenkirchen (bis 850 EUR Kaltmiete, Neueste)',
        'https://www.kleinanzeigen.de/s-wohnung-mieten/gelsenkirchen/preis::850/c203l2093?sortingField=SORTING_DATE',
        '*/20 * * * *',
        4000,
        15000,
        TRUE
    ),
    (
        'immowelt',
        'Gelsenkirchen',
        'Immowelt Gelsenkirchen (bis 850 EUR, Neueste)',
        'https://www.immowelt.de/liste/gelsenkirchen/wohnungen/mieten?pma=850&sd=DESC&sf=TIMESTAMP',
        '*/20 * * * *',
        4000,
        15000,
        TRUE
    )
ON CONFLICT (portal, search_url) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 4. Scraper-Protokolle
-- ------------------------------------------------------------------------------
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
