-- Profit centres belong to a tenant.
--
-- finance_profit_centres had a unique key on code alone, and its seven
-- standard entries (PC-RENTAL, PC-LEASING, ...) were stored without a
-- tenant. Profit centres are listed and created per tenant, so no tenant
-- could create any of the standard codes, and once one tenant created a
-- code of its own no other tenant could use it. The table's only policy
-- was allow_all, so the database did not keep tenants apart either.
--
--   1. The standard entries move to finance.finance_profit_centre_template
--      and every tenant gets its own copy (new tenants get one on first
--      use, src/lib/finance/profit-centres.ts), as reminder schedules do.
--   2. Codes become unique per tenant: (tenant_id, code).
--   3. Row level security in the project's standard form replaces
--      allow_all, with the runtime role's privileges.
--
-- Idempotent. Written in the one form the Neon SQL Editor runs whole:
-- plain DO blocks, no helper function and no named quote tags.

SELECT set_config('app.tenant_id', '*', false);

-- ── 1. template of the standard profit centres ───────────────────────────
CREATE TABLE IF NOT EXISTS finance.finance_profit_centre_template (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  parent_code TEXT,
  module      TEXT
);

GRANT SELECT ON finance.finance_profit_centre_template TO fleet360_app;

DO $$
DECLARE
  rel regclass := COALESCE(to_regclass('public.' || 'finance_profit_centres'), to_regclass('finance.' || 'finance_profit_centres'));
  code_attnum smallint;
  r record;
BEGIN
  IF rel IS NULL THEN
    RAISE NOTICE 'profit centres per tenant: finance_profit_centres does not exist here, skipped';
    RETURN;
  END IF;

  -- The rows without a tenant become the template.
  EXECUTE format(
    'INSERT INTO finance.finance_profit_centre_template (code, name, description, parent_code, module)
     SELECT code, name, description, parent_code, module
       FROM %s WHERE tenant_id IS NULL
     ON CONFLICT (code) DO NOTHING', rel);

  -- ── 2. codes unique per tenant ──
  SELECT attnum INTO code_attnum FROM pg_attribute WHERE attrelid = rel AND attname = 'code';
  FOR r IN SELECT conname FROM pg_constraint
            WHERE conrelid = rel AND contype = 'u' AND conkey = ARRAY[code_attnum] LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', rel, r.conname);
  END LOOP;
  EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS finance_profit_centres_tenant_code_key ON %s (tenant_id, code)', rel);

  -- Every tenant gets the standard profit centres, then the rows without a
  -- tenant go (journal lines and expenses refer to profit centres by code,
  -- not by row, so nothing points at them).
  EXECUTE format(
    'INSERT INTO %s (tenant_id, code, name, description, parent_code, module)
     SELECT t.id::text, p.code, p.name, p.description, p.parent_code, p.module
       FROM finance.finance_profit_centre_template p CROSS JOIN public.tenants t
     ON CONFLICT (tenant_id, code) DO NOTHING', rel);
  EXECUTE format('DELETE FROM %s WHERE tenant_id IS NULL', rel);
END $$;

-- ── 3. row level security ────────────────────────────────────────────────
-- Existing policies are dropped first: allow_all would OR-widen the new one.
DO $$
DECLARE
  rel regclass := COALESCE(to_regclass('public.' || 'finance_profit_centres'), to_regclass('finance.' || 'finance_profit_centres'));
  pol record;
BEGIN
  IF rel IS NULL THEN
    RETURN;
  END IF;

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
