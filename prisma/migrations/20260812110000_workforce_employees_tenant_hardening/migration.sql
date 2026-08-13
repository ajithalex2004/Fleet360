-- Migration: 20260812110000_workforce_employees_tenant_hardening
--
-- Hardens tenant ownership on workforce.employees:
--   1. tenant_id NOT NULL   — every employee must belong to a tenant
--   2. (tenant_id, employee_id) partial unique — employee_id scoped per-tenant
--   3. RLS with USING + WITH CHECK  — strict, no wildcard bypass
--
-- ── RUNBOOK — run this before applying the migration ──────────────────────────
--
-- Check for orphan employees (no tenant_id). Resolve each row manually
-- before proceeding — do NOT blanket-assign to a default tenant without
-- confirming which tenant owns the record.
--
--   SELECT id, employee_id, name, created_at
--   FROM   workforce.employees
--   WHERE  tenant_id IS NULL
--   ORDER BY created_at;
--
-- Once the result set is empty, run this migration.
-- ─────────────────────────────────────────────────────────────────────────────

-- All hardening below runs only when the workforce.employees table exists.
-- On production it does (created via runtime-DDL as part of the schema
-- domain-split); on shadow-DB replay it doesn't, so the whole migration
-- is a no-op there. Prevents P1014 "underlying table does not exist"
-- errors on `prisma migrate diff` in CI.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'workforce' AND table_name = 'employees'
  ) THEN
    RAISE NOTICE 'workforce.employees missing — skipping tenant hardening (shadow DB)';
    RETURN;
  END IF;

  -- ── 1. Enforce NOT NULL ─────────────────────────────────────────────────────
  -- Fails fast if any orphan rows remain — the operator must resolve them first.
  ALTER TABLE workforce.employees
    ALTER COLUMN tenant_id SET NOT NULL;

  -- ── 2. Swap global unique → tenant-scoped partial unique ────────────────────
  -- The old constraint allowed only one EMP-001 across all tenants.
  -- The new index allows EMP-001 per tenant while still permitting NULL employee_id.
  ALTER TABLE workforce.employees
    DROP CONSTRAINT IF EXISTS "StaffMember_employee_id_key";

  -- Legacy name from the original staff_members table (pre-Task-3 rename).
  DROP INDEX IF EXISTS "staff_members_employee_id_key";

  CREATE UNIQUE INDEX IF NOT EXISTS uniq_employees_tenant_employee_id
    ON workforce.employees (tenant_id, employee_id)
    WHERE employee_id IS NOT NULL;

  -- ── 3. Row-Level Security ───────────────────────────────────────────────────
  -- Strict policy: no tenant_id IS NULL branch (column is now NOT NULL),
  -- no wildcard '*' bypass in the normal isolation policy.
  -- WITH CHECK protects INSERT and UPDATE, not just SELECT.
  ALTER TABLE workforce.employees ENABLE  ROW LEVEL SECURITY;
  ALTER TABLE workforce.employees FORCE   ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS tenant_isolation ON workforce.employees;

  CREATE POLICY tenant_isolation ON workforce.employees
    USING (
      tenant_id = current_setting('app.tenant_id', true)
    )
    WITH CHECK (
      tenant_id = current_setting('app.tenant_id', true)
    );
END $$;
