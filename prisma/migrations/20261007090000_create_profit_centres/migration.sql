-- Profit centres where the table was never created.
--
-- Migration 20260810000006 created finance.finance_profit_centres and
-- seeded seven standard entries, but production has no such table (in any
-- schema), so the profit centre screen and the profit centre P&L never
-- worked there, and 20261006090000_profit_centres_per_tenant found nothing
-- to convert: its template stayed empty.
--
--   1. Creates the table in its per-tenant form where it is missing:
--      codes unique per tenant.
--   2. Fills the template with the seven standard profit centres and gives
--      every tenant its copy (new tenants get one on first use,
--      src/lib/finance/profit-centres.ts).
--   3. Adds the profit_centre column the P&L reads to journal lines and
--      expenses where it is missing.
--   4. Row level security in the project's standard form.
--
-- Idempotent, and a no-op wherever 20261006090000 already converted an
-- existing table. Written in the one form the Neon SQL Editor runs whole:
-- plain DO blocks, no helper function and no named quote tags.

SELECT set_config('app.tenant_id', '*', false);

-- ── 1. table ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF COALESCE(to_regclass('public.' || 'finance_profit_centres'), to_regclass('finance.' || 'finance_profit_centres')) IS NULL THEN
    CREATE TABLE finance.finance_profit_centres (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      code        TEXT        NOT NULL,
      name        TEXT        NOT NULL,
      description TEXT,
      parent_code TEXT,
      module      TEXT,
      is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
      budget      NUMERIC(15,2),
      tenant_id   TEXT
    );
    CREATE UNIQUE INDEX finance_profit_centres_tenant_code_key ON finance.finance_profit_centres (tenant_id, code);
    CREATE INDEX idx_profit_centres_code ON finance.finance_profit_centres (code);
    CREATE INDEX idx_profit_centres_tenant ON finance.finance_profit_centres (tenant_id);
  END IF;
END $$;

-- ── 2. standard profit centres ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS finance.finance_profit_centre_template (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  parent_code TEXT,
  module      TEXT
);

GRANT SELECT ON finance.finance_profit_centre_template TO fleet360_app;

INSERT INTO finance.finance_profit_centre_template (code, name, module, description) VALUES
  ('PC-RENTAL',      'Rent-A-Car',            'RENTAL',      'Revenue and costs for the Rent-A-Car business unit'),
  ('PC-LEASING',     'Vehicle Leasing',       'LEASING',     'Revenue and costs for the Leasing business unit'),
  ('PC-LOGISTICS',   'Freight & Logistics',   'LOGISTICS',   'Revenue and costs for the Logistics & Freight business unit'),
  ('PC-BUS',         'Bus Operations',        'BUS',         'Revenue and costs for Bus / Public Transport operations'),
  ('PC-MAINTENANCE', 'Fleet Maintenance',     'MAINTENANCE', 'Costs for workshop and fleet maintenance services'),
  ('PC-ADMIN',       'Group Administration',  'GENERAL',     'Central administration and overhead costs'),
  ('PC-TECH',        'Technology & Platform', 'GENERAL',     'IT infrastructure, software, and platform costs')
ON CONFLICT (code) DO NOTHING;

DO $$
DECLARE
  rel regclass := COALESCE(to_regclass('public.' || 'finance_profit_centres'), to_regclass('finance.' || 'finance_profit_centres'));
BEGIN
  -- Only tenants with no profit centres yet: a tenant that removed or
  -- renamed standard entries keeps its own set.
  EXECUTE format(
    'INSERT INTO %s (tenant_id, code, name, description, parent_code, module)
     SELECT t.id::text, p.code, p.name, p.description, p.parent_code, p.module
       FROM finance.finance_profit_centre_template p CROSS JOIN public.tenants t
      WHERE NOT EXISTS (SELECT 1 FROM %s x WHERE x.tenant_id = t.id::text)
     ON CONFLICT (tenant_id, code) DO NOTHING', rel, rel);
END $$;

-- ── 3. profit_centre on journal lines and expenses ───────────────────────
DO $$
DECLARE
  tname text;
  rel regclass;
BEGIN
  FOREACH tname IN ARRAY ARRAY['finance_journal_lines', 'finance_expenses'] LOOP
    rel := COALESCE(to_regclass('public.' || tname), to_regclass('finance.' || tname));
    IF rel IS NULL THEN
      RAISE NOTICE 'create profit centres: % does not exist here, skipped', tname;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE %s ADD COLUMN IF NOT EXISTS profit_centre TEXT', rel);
  END LOOP;
END $$;

-- ── 4. row level security ────────────────────────────────────────────────
DO $$
DECLARE
  rel regclass := COALESCE(to_regclass('public.' || 'finance_profit_centres'), to_regclass('finance.' || 'finance_profit_centres'));
  pol record;
BEGIN
  FOR pol IN SELECT p.polname FROM pg_policy p WHERE p.polrelid = rel LOOP
    EXECUTE format('DROP POLICY %I ON %s', pol.polname, rel);
  END LOOP;

  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO fleet360_app', rel);
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', rel);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', rel);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s FOR ALL '
    'USING (current_setting(''app.tenant_id'', true) = ''*'' OR tenant_id = current_setting(''app.tenant_id'', true)) '
    'WITH CHECK (current_setting(''app.tenant_id'', true) = ''*'' OR tenant_id = current_setting(''app.tenant_id'', true))',
    rel
  );
END $$;
