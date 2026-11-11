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
-- 1b. KdU-Quellen & Auto-Sync Konfiguration pro Stadt (24h Update / PLZ-Prefixes)
-- ------------------------------------------------------------------------------
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
        'Kleinanzeigen Gelsenkirchen (Angebote, 150-850 EUR, ab 20m², ab 1 Zi.)',
        'https://www.kleinanzeigen.de/s-wohnung-mieten/gelsenkirchen/anzeige:angebote/preis:150:850/c203l1000+wohnung_mieten.qm_d:20,+wohnung_mieten.zimmer_d:1,0?sortingField=SORTING_DATE',
        '*/20 * * * *',
        4000,
        15000,
        TRUE
    ),
    (
        'kleinanzeigen',
        'Gelsenkirchen',
        'Kleinanzeigen Gelsenkirchen Privatvermieter (Angebote, 150-850 EUR)',
        'https://www.kleinanzeigen.de/s-wohnung-mieten/gelsenkirchen/anzeige:angebote/anbieter:privat/preis:150:850/c203l1000+wohnung_mieten.qm_d:20,+wohnung_mieten.zimmer_d:1,0?sortingField=SORTING_DATE',
        '*/20 * * * *',
        4000,
        15000,
        TRUE
    ),
    (
        'kleinanzeigen',
        'Gelsenkirchen',
        'Kleinanzeigen Gelsenkirchen WBS-Wohnungen (Angebote, 150-850 EUR)',
        'https://www.kleinanzeigen.de/s-wohnung-mieten/gelsenkirchen/anzeige:angebote/preis:150:850/wbs/k0c203l1000?sortingField=SORTING_DATE',
        '*/30 * * * *',
        4000,
        15000,
        TRUE
    ),
    (
        'immowelt',
        'Gelsenkirchen',
        'Immowelt Gelsenkirchen (Angebote bis 850 EUR, Neueste, Radius 0)',
        'https://www.immowelt.de/suche/mieten/wohnung/nordrhein-westfalen/gelsenkirchen-45879/ad08de2278?priceMax=850&distributionTypes=Rent&estateTypes=Apartment&order=DateDesc',
        '*/20 * * * *',
        4000,
        15000,
        TRUE
    ),
    (
        'other',
        'Gelsenkirchen',
        'Ohne-Makler.net Gelsenkirchen (100% Privatvermieter)',
        'https://www.ohne-makler.net/immobilien/wohnung-mieten/nordrhein-westfalen/gelsenkirchen/',
        '*/30 * * * *',
        4000,
        15000,
        TRUE
    ),
    (
        'other',
        'Gelsenkirchen',
        'GGW Gelsenkirchen (Städtische Wohnungen & WBS, ab 20m², bis 850 EUR)',
        'https://www.ggw-gelsenkirchen.de/mietangebote/?rooms=1&size=20&price=850',
        '0 */2 * * *',
        4000,
        15000,
        TRUE
    ),
    (
        'immoscout',
        'Gelsenkirchen',
        'ImmoScout24 Gelsenkirchen (Optional mit Wohn-Proxy aktivierbar, bis 850 EUR)',
        'https://www.immobilienscout24.de/Suche/de/nordrhein-westfalen/gelsenkirchen/wohnung-mieten?price=-850.0&sorting=2',
        '*/30 * * * *',
        5000,
        15000,
        FALSE
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

-- ------------------------------------------------------------------------------
-- 5. Benutzerkonten & Bewerbungs-Tracker (Ausbaustufe 1)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name VARCHAR(150) NOT NULL DEFAULT '',
    phone VARCHAR(60) NOT NULL DEFAULT '',
    preferred_city VARCHAR(100) NOT NULL DEFAULT 'Gelsenkirchen',
    bg_size INT NOT NULL DEFAULT 1 CHECK (bg_size >= 1 AND bg_size <= 20),
    benefit_type VARCHAR(20) NOT NULL DEFAULT 'sgb2' CHECK (benefit_type IN ('sgb2', 'sgb12')),
    move_in_date VARCHAR(120) NOT NULL DEFAULT 'ab sofort / nach Absprache',
    personal_note TEXT NOT NULL DEFAULT '',
    emphasize_direct_transfer BOOLEAN NOT NULL DEFAULT TRUE,
    address_schufa_directly BOOLEAN NOT NULL DEFAULT TRUE,
    linked_portals JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
    admin_note TEXT,
    last_login_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_status ON users (status);

CREATE TABLE IF NOT EXISTS user_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    portal VARCHAR(50) NOT NULL DEFAULT 'other',
    status VARCHAR(30) NOT NULL DEFAULT 'contacted' CHECK (status IN ('saved', 'contacted', 'viewing', 'accepted', 'rejected')),
    message_text TEXT,
    notes TEXT,
    contacted_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_user_listing UNIQUE (user_id, listing_id)
);

CREATE INDEX IF NOT EXISTS idx_user_apps_user_id ON user_applications (user_id, updated_at DESC);

-- ------------------------------------------------------------------------------
-- 6. Meldungen, Ausblenden, Sync-Ausschluss & Organisations-Lizenzen (Ausbaustufe 2)
-- ------------------------------------------------------------------------------
ALTER TABLE listings ADD COLUMN IF NOT EXISTS contact_name VARCHAR(180);
ALTER TABLE listings ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(80);
ALTER TABLE listings ADD COLUMN IF NOT EXISTS contact_email VARCHAR(180);

CREATE TABLE IF NOT EXISTS suppressed_listings (
    id SERIAL PRIMARY KEY,
    external_id VARCHAR(255) UNIQUE NOT NULL,
    portal VARCHAR(50),
    url TEXT,
    title TEXT,
    reason VARCHAR(120) NOT NULL DEFAULT 'admin_deleted',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_suppressed_ext ON suppressed_listings (external_id);

CREATE TABLE IF NOT EXISTS organization_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_hash VARCHAR(64) UNIQUE NOT NULL,
    key_prefix VARCHAR(32) NOT NULL,
    label VARCHAR(160) NOT NULL DEFAULT '',
    preset_org_name VARCHAR(180) NOT NULL DEFAULT '',
    preset_org_subtitle VARCHAR(220) NOT NULL DEFAULT '',
    preset_org_logo_url TEXT NOT NULL DEFAULT '',
    preset_org_contact TEXT NOT NULL DEFAULT '',
    preset_city VARCHAR(100) NOT NULL DEFAULT 'Gelsenkirchen',
    is_unlimited BOOLEAN NOT NULL DEFAULT FALSE,
    duration_days INT CHECK (duration_days IS NULL OR duration_days > 0),
    expires_at TIMESTAMP,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    redeemed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    redeemed_at TIMESTAMP,
    admin_note TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS account_type VARCHAR(20) NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS org_key_id UUID REFERENCES organization_keys(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS org_name VARCHAR(180) NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS org_subtitle VARCHAR(220) NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS org_logo_url TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS org_contact TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS org_license_unlimited BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS org_license_expires_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS listing_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id UUID REFERENCES listings(id) ON DELETE SET NULL,
    listing_external_id VARCHAR(255),
    listing_portal VARCHAR(50),
    listing_city VARCHAR(100),
    listing_title TEXT,
    listing_url TEXT,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason_code VARCHAR(60) NOT NULL,
    reason_label VARCHAR(160) NOT NULL,
    details TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved_hidden', 'resolved_deleted', 'dismissed')),
    admin_note TEXT,
    reviewed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_report_user_listing UNIQUE (listing_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_listing_reports_status ON listing_reports (status, created_at DESC);

CREATE TABLE IF NOT EXISTS user_hidden_listings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_user_hidden_listing UNIQUE (user_id, listing_id)
);

CREATE INDEX IF NOT EXISTS idx_user_hidden_user ON user_hidden_listings (user_id, created_at DESC);
