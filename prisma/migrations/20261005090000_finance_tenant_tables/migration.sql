-- Finance tables owned by a tenant, created by migration instead of at
-- request time.
--
-- Twelve finance routes ran CREATE TABLE / ALTER TABLE at the start of every
-- request, inside the request's tenant transaction. The runtime role
-- (fleet360_app) may not create tables, so that first statement failed and
-- aborted the transaction: every later query of the request failed too.
-- Five of those tables never existed in production (fixed assets and their
-- depreciation schedule, the finance audit log, budget submissions and
-- comments), so those pages never worked there. The routes no longer run
-- DDL; this migration creates what they need.
--
--   1. Missing tables are created with tenant_id from the start: the fixed
--      asset register and depreciation schedule, the finance audit log,
--      budget submissions and comments (schema finance), corporate tax
--      returns and adjustments, accounting periods and fiscal years (schema
--      public, where production has them). Document numbers are unique per
--      tenant.
--   2. finance_budgets, which had no tenant column, gets one (production has
--      no rows). vat_returns gets one where it is missing (production has it).
--   3. Payment reminder schedules become per tenant: the five platform
--      defaults move to finance.finance_reminder_schedule_template and every
--      tenant gets its own copy (new tenants get one on first use,
--      src/lib/finance/reminder-schedules.ts). Names are unique per tenant.
--   4. Accounting periods and fiscal years are unique per tenant: a global
--      (fiscal_year[, period_number]) key let only one tenant open a year.
--   5. finance_expenses gets branch_id and vat_amount (the route added them
--      at request time).
--   6. Row level security in the project's standard form on every table
--      above, with the runtime role's privileges.
--
-- Idempotent, and written for both a fresh database and production, whose
-- tables differ (production has some of them, with tenant_id already).

SELECT set_config('app.tenant_id', '*', false);

-- A finance table lives in public or finance depending on the environment:
-- every block below looks it up in both.
--
-- Written in the one form the Neon SQL Editor is known to run whole (as the
-- chart of accounts migration did): plain DO blocks, no helper function and
-- no named quote tags. The editor split this migration apart in both of
-- those other forms.

-- ── 1. missing tables ────────────────────────────────────────────────────
DO $$
BEGIN
  IF COALESCE(to_regclass('public.' || 'finance_fixed_assets'), to_regclass('finance.' || 'finance_fixed_assets')) IS NULL THEN
    CREATE TABLE finance.finance_fixed_assets (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id           TEXT NOT NULL,
      created_at          TIMESTAMPTZ DEFAULT NOW(),
      updated_at          TIMESTAMPTZ DEFAULT NOW(),
      deleted_at          TIMESTAMPTZ,
      asset_no            TEXT NOT NULL,
      asset_name          TEXT NOT NULL,
      asset_category      TEXT NOT NULL,
      coa_account_code    TEXT,
      description         TEXT,
      vehicle_id          TEXT,
      registration_no     TEXT,
      acquisition_date    DATE NOT NULL,
      acquisition_cost    NUMERIC(15,2) NOT NULL,
      residual_value      NUMERIC(15,2) DEFAULT 0,
      useful_life_months  INTEGER NOT NULL,
      depreciation_method TEXT DEFAULT 'STRAIGHT_LINE',
      depreciation_rate   NUMERIC(5,4),
      status              TEXT DEFAULT 'ACTIVE',
      disposal_date       DATE,
      disposal_proceeds   NUMERIC(15,2),
      disposal_method     TEXT,
      accumulated_depreciation NUMERIC(15,2) DEFAULT 0,
      net_book_value      NUMERIC(15,2),
      last_depreciation_date DATE,
      supplier            TEXT,
      purchase_invoice_no TEXT,
      location            TEXT,
      notes               TEXT,
      CONSTRAINT finance_fixed_assets_tenant_asset_no_key UNIQUE (tenant_id, asset_no)
    );
  END IF;

  IF COALESCE(to_regclass('public.' || 'finance_depreciation_schedule'), to_regclass('finance.' || 'finance_depreciation_schedule')) IS NULL THEN
    CREATE TABLE finance.finance_depreciation_schedule (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id       TEXT NOT NULL,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      asset_id        TEXT NOT NULL,
      period_year     INTEGER NOT NULL,
      period_month    INTEGER NOT NULL,
      opening_nbv     NUMERIC(15,2),
      depreciation    NUMERIC(15,2),
      closing_nbv     NUMERIC(15,2),
      is_posted       BOOLEAN DEFAULT FALSE,
      je_id           TEXT,
      posted_at       TIMESTAMPTZ
    );
    CREATE INDEX finance_depreciation_schedule_asset_idx
      ON finance.finance_depreciation_schedule (tenant_id, asset_id, period_year, period_month);
  END IF;

  IF COALESCE(to_regclass('public.' || 'finance_audit_log'), to_regclass('finance.' || 'finance_audit_log')) IS NULL THEN
    CREATE TABLE finance.finance_audit_log (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id       TEXT NOT NULL,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      module          TEXT NOT NULL,
      action          TEXT NOT NULL,
      entity_type     TEXT NOT NULL,
      entity_id       TEXT NOT NULL,
      entity_ref      TEXT,
      performed_by    TEXT NOT NULL,
      ip_address      TEXT,
      old_values      JSONB,
      new_values      JSONB,
      description     TEXT NOT NULL,
      amount          NUMERIC(15,2),
      metadata        JSONB
    );
    CREATE INDEX finance_audit_log_module_idx ON finance.finance_audit_log (tenant_id, module, created_at DESC);
    CREATE INDEX finance_audit_log_entity_idx ON finance.finance_audit_log (tenant_id, entity_type, entity_id);
  END IF;

  IF COALESCE(to_regclass('public.' || 'finance_budget_submissions'), to_regclass('finance.' || 'finance_budget_submissions')) IS NULL THEN
    CREATE TABLE finance.finance_budget_submissions (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id       TEXT NOT NULL,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW(),
      deleted_at      TIMESTAMPTZ,
      submission_no   TEXT NOT NULL,
      fiscal_year     INTEGER NOT NULL,
      department      TEXT NOT NULL,
      department_head TEXT NOT NULL,
      total_requested NUMERIC(15,2) NOT NULL,
      total_approved  NUMERIC(15,2),
      status          TEXT DEFAULT 'DRAFT',
      submitted_at    TIMESTAMPTZ,
      fm_reviewed_at  TIMESTAMPTZ,
      fm_reviewed_by  TEXT,
      fm_notes        TEXT,
      cfo_approved_at TIMESTAMPTZ,
      cfo_approved_by TEXT,
      cfo_notes       TEXT,
      rejection_reason TEXT,
      notes           TEXT,
      line_items      JSONB DEFAULT '[]',
      CONSTRAINT finance_budget_submissions_tenant_no_key UNIQUE (tenant_id, submission_no)
    );
  END IF;

  IF COALESCE(to_regclass('public.' || 'finance_budget_comments'), to_regclass('finance.' || 'finance_budget_comments')) IS NULL THEN
    CREATE TABLE finance.finance_budget_comments (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id     TEXT NOT NULL,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      submission_id TEXT NOT NULL,
      author        TEXT NOT NULL,
      role          TEXT NOT NULL,
      comment       TEXT NOT NULL,
      action        TEXT
    );
    CREATE INDEX finance_budget_comments_submission_idx
      ON finance.finance_budget_comments (tenant_id, submission_id);
  END IF;

  IF COALESCE(to_regclass('public.' || 'finance_ct_returns'), to_regclass('finance.' || 'finance_ct_returns')) IS NULL THEN
    CREATE TABLE public.finance_ct_returns (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id       TEXT NOT NULL,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW(),
      deleted_at      TIMESTAMPTZ,
      tax_year        INTEGER NOT NULL,
      period_from     DATE NOT NULL,
      period_to       DATE NOT NULL,
      status          TEXT DEFAULT 'DRAFT',
      revenue         NUMERIC(15,2) DEFAULT 0,
      exempt_income   NUMERIC(15,2) DEFAULT 0,
      allowable_deductions NUMERIC(15,2) DEFAULT 0,
      taxable_income  NUMERIC(15,2) DEFAULT 0,
      threshold       NUMERIC(15,2) DEFAULT 375000,
      taxable_above_threshold NUMERIC(15,2) DEFAULT 0,
      ct_rate         NUMERIC(5,4)  DEFAULT 0.09,
      ct_liability    NUMERIC(15,2) DEFAULT 0,
      withholding_tax NUMERIC(15,2) DEFAULT 0,
      tax_paid        NUMERIC(15,2) DEFAULT 0,
      balance_due     NUMERIC(15,2) DEFAULT 0,
      is_sbr_eligible BOOLEAN DEFAULT FALSE,
      sbr_threshold   NUMERIC(15,2) DEFAULT 3000000,
      filing_deadline DATE,
      filed_at        TIMESTAMPTZ,
      notes           TEXT
    );
  END IF;

  IF COALESCE(to_regclass('public.' || 'finance_ct_adjustments'), to_regclass('finance.' || 'finance_ct_adjustments')) IS NULL THEN
    CREATE TABLE public.finance_ct_adjustments (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id       TEXT NOT NULL,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      return_id       TEXT NOT NULL,
      adj_type        TEXT NOT NULL,
      description     TEXT NOT NULL,
      amount          NUMERIC(15,2) NOT NULL,
      reference       TEXT,
      notes           TEXT
    );
  END IF;

  IF COALESCE(to_regclass('public.' || 'finance_periods'), to_regclass('finance.' || 'finance_periods')) IS NULL THEN
    CREATE TABLE public.finance_periods (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id       TEXT NOT NULL,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW(),
      fiscal_year     INTEGER NOT NULL,
      period_number   INTEGER NOT NULL,
      period_name     TEXT NOT NULL,
      period_from     DATE NOT NULL,
      period_to       DATE NOT NULL,
      status          TEXT DEFAULT 'OPEN',
      locked_at       TIMESTAMPTZ,
      locked_by       TEXT,
      unlock_reason   TEXT,
      notes           TEXT
    );
  END IF;

  IF COALESCE(to_regclass('public.' || 'finance_fiscal_years'), to_regclass('finance.' || 'finance_fiscal_years')) IS NULL THEN
    CREATE TABLE public.finance_fiscal_years (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id       TEXT NOT NULL,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW(),
      fiscal_year     INTEGER NOT NULL,
      year_start      DATE NOT NULL,
      year_end        DATE NOT NULL,
      status          TEXT DEFAULT 'OPEN',
      closed_at       TIMESTAMPTZ,
      closing_je_id   TEXT,
      retained_earnings_opening NUMERIC(15,2) DEFAULT 0,
      notes           TEXT
    );
  END IF;
END $$;

-- ── 2 and 6. tenant column (text) and row level security ─────────────────
-- Existing policies are dropped first: a column a policy uses cannot change
-- type, and a leftover permissive policy would OR-widen the new one.
DO $$
DECLARE
  tname text;
  rel  regclass;
  pol  record;
  col_type text;
  names text[] := ARRAY[
    'finance_fixed_assets', 'finance_depreciation_schedule', 'finance_audit_log',
    'finance_budget_submissions', 'finance_budget_comments',
    'finance_ct_returns', 'finance_ct_adjustments', 'finance_periods', 'finance_fiscal_years',
    'finance_budgets', 'vat_returns', 'finance_reminder_schedules', 'finance_reminder_log'
  ];
BEGIN
  FOREACH tname IN ARRAY names LOOP
    rel := COALESCE(to_regclass('public.' || tname), to_regclass('finance.' || tname));
    IF rel IS NULL THEN
      RAISE NOTICE 'finance tenant tables: % does not exist here, skipped', tname;
      CONTINUE;
    END IF;

    FOR pol IN SELECT p.polname FROM pg_policy p WHERE p.polrelid = rel LOOP
      EXECUTE format('DROP POLICY %I ON %s', pol.polname, rel);
    END LOOP;

    SELECT format_type(a.atttypid, a.atttypmod) INTO col_type
      FROM pg_attribute a WHERE a.attrelid = rel AND a.attname = 'tenant_id' AND NOT a.attisdropped;
    IF col_type IS NULL THEN
      EXECUTE format('ALTER TABLE %s ADD COLUMN tenant_id TEXT', rel);
    ELSIF col_type <> 'text' THEN
      EXECUTE format('ALTER TABLE %s ALTER COLUMN tenant_id TYPE TEXT USING tenant_id::text', rel);
    END IF;

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %s (tenant_id)', tname || '_tenant_id_idx', rel);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO fleet360_app', rel);
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', rel);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', rel);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %s FOR ALL '
      'USING (current_setting(''app.tenant_id'', true) = ''*'' OR tenant_id = current_setting(''app.tenant_id'', true)) '
      'WITH CHECK (current_setting(''app.tenant_id'', true) = ''*'' OR tenant_id = current_setting(''app.tenant_id'', true))',
      rel
    );
  END LOOP;
END $$;

-- ── 3. per-tenant payment reminder schedules ─────────────────────────────
CREATE TABLE IF NOT EXISTS finance.finance_reminder_schedule_template (
  name             TEXT     PRIMARY KEY,
  trigger_type     TEXT     NOT NULL,
  trigger_days     INTEGER  NOT NULL,
  channel          TEXT     NOT NULL,
  template_subject TEXT     NOT NULL,
  template_body    TEXT     NOT NULL,
  is_active        BOOLEAN  NOT NULL DEFAULT TRUE,
  module_filter    TEXT,
  branch_filter    TEXT
);

DO $$
DECLARE
  rel regclass := COALESCE(to_regclass('public.' || 'finance_reminder_schedules'), to_regclass('finance.' || 'finance_reminder_schedules'));
  name_attnum smallint;
  r record;
BEGIN
  IF rel IS NULL THEN
    RAISE NOTICE 'finance tenant tables: finance_reminder_schedules does not exist here, skipped';
    RETURN;
  END IF;

  -- The platform defaults (rows without a tenant) become the template.
  EXECUTE format(
    'INSERT INTO finance.finance_reminder_schedule_template
       (name, trigger_type, trigger_days, channel, template_subject, template_body,
        is_active, module_filter, branch_filter)
     SELECT name, trigger_type, trigger_days, channel, template_subject, template_body,
            is_active, module_filter, branch_filter
       FROM %s WHERE tenant_id IS NULL
     ON CONFLICT (name) DO NOTHING', rel);

  -- Names become unique per tenant.
  SELECT attnum INTO name_attnum FROM pg_attribute WHERE attrelid = rel AND attname = 'name';
  FOR r IN SELECT conname FROM pg_constraint
            WHERE conrelid = rel AND contype = 'u' AND conkey = ARRAY[name_attnum] LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', rel, r.conname);
  END LOOP;
  EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS finance_reminder_schedules_tenant_name_key ON %s (tenant_id, name)', rel);

  -- Every tenant gets the defaults as they are today, then the rows without
  -- a tenant go (reminder log rows keep their history: schedule_id is ON
  -- DELETE SET NULL).
  EXECUTE format(
    'INSERT INTO %s
       (tenant_id, name, trigger_type, trigger_days, channel, template_subject, template_body,
        is_active, module_filter, branch_filter)
     SELECT t.id::text, s.name, s.trigger_type, s.trigger_days, s.channel, s.template_subject,
            s.template_body, s.is_active, s.module_filter, s.branch_filter
       FROM %s s CROSS JOIN public.tenants t
      WHERE s.tenant_id IS NULL
     ON CONFLICT (tenant_id, name) DO NOTHING', rel, rel);
  EXECUTE format('DELETE FROM %s WHERE tenant_id IS NULL', rel);
END $$;

GRANT SELECT ON finance.finance_reminder_schedule_template TO fleet360_app;

-- ── 4. accounting periods and fiscal years unique per tenant ─────────────
DO $$
DECLARE
  spec record;
  rel  regclass;
  keycols smallint[];
  r record;
BEGIN
  FOR spec IN SELECT * FROM (VALUES
      ('finance_periods',      ARRAY['fiscal_year', 'period_number'], 'finance_periods_tenant_year_period_key'),
      ('finance_fiscal_years', ARRAY['fiscal_year'],                  'finance_fiscal_years_tenant_year_key')
    ) AS s(tbl, cols, idx) LOOP
    rel := COALESCE(to_regclass('public.' || spec.tbl), to_regclass('finance.' || spec.tbl));
    CONTINUE WHEN rel IS NULL;

    SELECT array_agg(a.attnum ORDER BY a.attnum) INTO keycols
      FROM pg_attribute a WHERE a.attrelid = rel AND a.attname = ANY (spec.cols);

    -- Unique constraints, then free-standing unique indexes, on those
    -- columns without the tenant.
    FOR r IN SELECT conname FROM pg_constraint
              WHERE conrelid = rel AND contype = 'u'
                AND (SELECT array_agg(k ORDER BY k) FROM unnest(conkey) k) = keycols LOOP
      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', rel, r.conname);
    END LOOP;
    FOR r IN SELECT i.indexrelid::regclass AS idx FROM pg_index i
              WHERE i.indrelid = rel AND i.indisunique AND NOT i.indisprimary
                AND (SELECT array_agg(k ORDER BY k) FROM unnest(i.indkey::smallint[]) k) = keycols
                AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid) LOOP
      EXECUTE format('DROP INDEX %s', r.idx);
    END LOOP;

    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON %s (tenant_id, %s)',
                   spec.idx, rel, array_to_string(spec.cols, ', '));
  END LOOP;
END $$;

-- ── 5. expense columns the route used to add at request time ─────────────
-- Checked in the catalog first: ADD COLUMN IF NOT EXISTS still needs the
-- table owner even when the column is there.
DO $$
DECLARE
  rel regclass := COALESCE(to_regclass('public.' || 'finance_expenses'), to_regclass('finance.' || 'finance_expenses'));
BEGIN
  IF rel IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = rel AND attname = 'branch_id' AND NOT attisdropped) THEN
    EXECUTE format('ALTER TABLE %s ADD COLUMN branch_id UUID', rel);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = rel AND attname = 'vat_amount' AND NOT attisdropped) THEN
    EXECUTE format('ALTER TABLE %s ADD COLUMN vat_amount NUMERIC(15,2) DEFAULT 0', rel);
  END IF;
END $$;

-- ── tenant_id NOT NULL where no row lacks one ────────────────────────────
DO $$
DECLARE
  tname text;
  rel  regclass;
  has_null boolean;
BEGIN
  FOREACH tname IN ARRAY ARRAY['finance_budgets', 'finance_reminder_schedules', 'finance_reminder_log', 'vat_returns'] LOOP
    rel := COALESCE(to_regclass('public.' || tname), to_regclass('finance.' || tname));
    CONTINUE WHEN rel IS NULL;
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE tenant_id IS NULL)', rel) INTO has_null;
    IF has_null THEN
      RAISE WARNING 'finance tenant tables: % has rows without a tenant; tenant_id left nullable', tname;
    ELSE
      EXECUTE format('ALTER TABLE %s ALTER COLUMN tenant_id SET NOT NULL', rel);
    END IF;
  END LOOP;
END $$;
