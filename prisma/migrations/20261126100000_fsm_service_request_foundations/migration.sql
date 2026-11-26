-- Field Service Management: foundations for the revamped Service Request.
--
--  1. customer_sites — a customer's entities / sites (address, map pin, the
--     site's contact person and mobile). Requests are raised against a site.
--  2. asset_registry gains customer / site tags plus serial number and tag ID,
--     so equipment installed at a customer site can be picked on a request.
--  3. service_tickets gains the request's customer, site, asset, channel,
--     "service needed at" time and entitlement / billing type.
--  4. service_request_counters — the tenant-wide yearly sequence behind
--     request numbers FSM-SR-<customer code>-YYXXXX.
--
-- Additive only: new tables and nullable columns. Existing rows and requests
-- are untouched.

-- ── 1. Customer sites ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_sites (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT          NOT NULL,
  customer_id     TEXT          NOT NULL,
  name            TEXT          NOT NULL,
  code            TEXT,
  address         TEXT,
  city            TEXT,
  latitude        NUMERIC(10,7),
  longitude       NUMERIC(10,7),
  contact_person  TEXT,
  contact_mobile  TEXT,
  contact_email   TEXT,
  is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_customer_sites_tenant_customer
  ON customer_sites (tenant_id, customer_id) WHERE deleted_at IS NULL;

DROP POLICY IF EXISTS tenant_isolation ON public.customer_sites;
CREATE POLICY tenant_isolation ON public.customer_sites FOR ALL
  USING ((current_setting('app.tenant_id', true) = '*') OR (tenant_id = current_setting('app.tenant_id', true)))
  WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR (tenant_id = current_setting('app.tenant_id', true)));
ALTER TABLE public.customer_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_sites FORCE ROW LEVEL SECURITY;

-- ── 2. Customer equipment in the asset register ───────────────────────────
-- Guarded: the asset register is created by the Assets module migrations.
DO $$
BEGIN
  IF to_regclass('public.asset_registry') IS NOT NULL THEN
    ALTER TABLE asset_registry ADD COLUMN IF NOT EXISTS customer_id      TEXT;
    ALTER TABLE asset_registry ADD COLUMN IF NOT EXISTS customer_site_id UUID;
    ALTER TABLE asset_registry ADD COLUMN IF NOT EXISTS serial_number    TEXT;
    ALTER TABLE asset_registry ADD COLUMN IF NOT EXISTS tag_id           TEXT;
    CREATE INDEX IF NOT EXISTS idx_asset_registry_customer_site
      ON asset_registry (tenant_id, customer_id, customer_site_id) WHERE customer_id IS NOT NULL;
  END IF;
END $$;

-- ── 3. Service request fields ─────────────────────────────────────────────
ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS customer_id       TEXT;
ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS customer_site_id  UUID;
ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS asset_id          UUID;
ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS request_channel   TEXT;
ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS service_needed_at TIMESTAMPTZ;
ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS entitlement_type  TEXT;
CREATE INDEX IF NOT EXISTS idx_service_tickets_customer
  ON service_tickets (tenant_id, customer_id) WHERE customer_id IS NOT NULL;

-- ── 4. Request number sequence ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS service_request_counters (
  tenant_id  TEXT     NOT NULL,
  year       INTEGER  NOT NULL,
  last_seq   INTEGER  NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, year)
);

DROP POLICY IF EXISTS tenant_isolation ON public.service_request_counters;
CREATE POLICY tenant_isolation ON public.service_request_counters FOR ALL
  USING ((current_setting('app.tenant_id', true) = '*') OR (tenant_id = current_setting('app.tenant_id', true)))
  WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR (tenant_id = current_setting('app.tenant_id', true)));
ALTER TABLE public.service_request_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_request_counters FORCE ROW LEVEL SECURITY;

-- Runtime role grants (same pattern as 20261124120000_service_departments).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_sites TO fleet360_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_request_counters TO fleet360_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_api_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_sites TO fleet360_api_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_request_counters TO fleet360_api_role;
  END IF;
END $$;
