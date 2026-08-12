-- ============================================================
-- Multi-tenant data isolation: add tenant_id to every leasing-domain table.
-- Fleet360 — 2026-06-27 (Layer 2.5 type-debt cleanup)
--
-- Why this migration exists:
--   The Layer 2.5 multi-tenant migration added tenant_id to the fleet
--   and dispatch domains (see 20260623140000 and 20260625120000), but the
--   leasing module was deferred per docs/KNOWN_GAPS.md TENANT-001. Without
--   tenant_id on leasing tables, every Leasing route would return data from
--   every tenant in the database — a critical cross-tenant leak as soon as
--   a second enterprise customer lands.
--
--   This migration closes that gap by adding tenant_id (TEXT NOT NULL) to
--   every table that:
--     (a) is owned by the leasing module, AND
--     (b) is queried directly from a src/app/api/leasing/** route handler.
--
--   Migration shape (per table) — same pattern as the fleet migration:
--     1) ADD COLUMN tenant_id TEXT                  (nullable initially)
--     2) UPDATE backfill from oldest active tenant  (idempotent; no-op on
--                                                  fresh DB / empty table)
--     3) ALTER ... SET NOT NULL                     (loud failure if any
--                                                  row remained NULL)
--     4) ADD FK to tenants(id) ON DELETE RESTRICT   (RESTRICT — never
--                                                  cascade-delete tenant
--                                                  data; operators must
--                                                  retire records first)
--     5) CREATE INDEX on tenant_id                  (every query filters
--                                                  by it, so index is
--                                                  required, not optional)
--     6) ENABLE RLS + tenant_isolation policy       (final gate, matches
--                                                  fleet + dispatch pattern)
--
--   Each UPDATE uses an inline subquery (rather than caching the default
--   tenant via set_config / current_setting) because Prisma's migration
--   runner sends each statement as a separate execute call — session-local
--   settings don't survive between statements. The subquery makes each
--   UPDATE fully self-contained.
--
--   If no active tenant exists when backfill rows are present, the SET NOT
--   NULL step on the first affected table will raise — operators must
--   provision a tenant first, then re-run.
--
-- Tables in this migration:
--   ROOT (parent entities; routes query directly):
--     lessees, lease_quotations, lease_contracts_v2, lease_receipts,
--     lease_invoices, lease_branches, lease_inquiries,
--     lease_inquiry_activities
--
--   CHILD (queried directly by routes; cannot be scoped via parent
--   relation filter because routes use flat findMany without an include
--   to a tenant-scoped parent):
--     lease_payments_v2, lease_vehicle_exchanges, lease_insurance_policies,
--     lease_insurance_claims, lease_mileage_readings, lease_mileage_overages,
--     lease_traffic_fines, lease_fuel_logs, lease_documents,
--     lease_direct_debits, lease_credit_assessments, lease_renewals,
--     lease_early_terminations, lease_pre_billing_statements,
--     lease_dunning_activities, lease_alerts, lease_approval_steps,
--     lease_driver_allocations, lease_remarketing, lease_telematics
--
-- Tables INTENTIONALLY not in this migration (no direct route access;
-- scoped via parent FK with Prisma's nested filter):
--   lease_quotation_items      — only read via LeaseQuotation.include
--   lease_quotation_vehicles   — only read via LeaseQuotation.include
--   lease_contract_vehicles    — only read via LeaseContract2.include
--   lease_invoice_lines        — only read via LeaseInvoice.include
--
-- ============================================================


-- ── Pre-flight: data exists but no active tenant ─────────────────────────────
DO $$
DECLARE
  has_default_tenant BOOLEAN;
  has_any_data BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM tenants
    WHERE COALESCE(is_active, TRUE) = TRUE
  ) INTO has_default_tenant;

  SELECT EXISTS (
    SELECT 1 FROM lessees UNION ALL
    SELECT 1 FROM lease_quotations UNION ALL
    SELECT 1 FROM lease_contracts_v2 UNION ALL
    SELECT 1 FROM lease_receipts UNION ALL
    SELECT 1 FROM lease_invoices UNION ALL
    SELECT 1 FROM lease_branches UNION ALL
    SELECT 1 FROM lease_inquiries UNION ALL
    SELECT 1 FROM lease_inquiry_activities UNION ALL
    SELECT 1 FROM lease_payments_v2 UNION ALL
    SELECT 1 FROM lease_vehicle_exchanges UNION ALL
    SELECT 1 FROM lease_insurance_policies UNION ALL
    SELECT 1 FROM lease_insurance_claims UNION ALL
    SELECT 1 FROM lease_mileage_readings UNION ALL
    SELECT 1 FROM lease_mileage_overages UNION ALL
    SELECT 1 FROM lease_traffic_fines UNION ALL
    SELECT 1 FROM lease_fuel_logs UNION ALL
    SELECT 1 FROM lease_documents UNION ALL
    SELECT 1 FROM lease_direct_debits UNION ALL
    SELECT 1 FROM lease_credit_assessments UNION ALL
    SELECT 1 FROM lease_renewals UNION ALL
    SELECT 1 FROM lease_early_terminations UNION ALL
    SELECT 1 FROM lease_pre_billing_statements UNION ALL
    SELECT 1 FROM lease_dunning_activities UNION ALL
    SELECT 1 FROM lease_alerts UNION ALL
    SELECT 1 FROM lease_approval_steps UNION ALL
    SELECT 1 FROM lease_driver_allocations UNION ALL
    SELECT 1 FROM lease_remarketing UNION ALL
    SELECT 1 FROM lease_telematics
  ) INTO has_any_data;

  IF NOT has_default_tenant AND has_any_data THEN
    RAISE EXCEPTION
      'add_tenant_id_to_leasing_tables: leasing data exists but no active tenant found. Provision a tenant first, then re-run.';
  END IF;
END $$;



-- ── 0.5) Cleanse orphaned tenant_ids from prior partial runs ─────────────────
--
-- If this migration was partially applied before (column added + backfilled
-- but FK failed), the tenant_id column may already hold a value that no
-- longer exists in the tenants table. Re-running the UPDATE WHERE tenant_id
-- IS NULL would silently skip those rows, then ADD CONSTRAINT FK would fail
-- with 23503. This block resets any orphaned value back to NULL so the
-- backfill in each per-table section picks it up correctly.
--
-- Uses a single dynamic SQL loop so adding a new table in future only
-- requires updating the array, not duplicating the NULL-out pattern.

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'lessees', 'lease_quotations', 'lease_contracts_v2', 'lease_receipts',
    'lease_invoices', 'lease_branches', 'lease_inquiries',
    'lease_inquiry_activities', 'lease_payments_v2',
    'lease_vehicle_exchanges', 'lease_insurance_policies',
    'lease_insurance_claims', 'lease_mileage_readings',
    'lease_mileage_overages', 'lease_traffic_fines', 'lease_fuel_logs',
    'lease_documents', 'lease_direct_debits', 'lease_credit_assessments',
    'lease_renewals', 'lease_early_terminations',
    'lease_pre_billing_statements', 'lease_dunning_activities',
    'lease_alerts', 'lease_approval_steps', 'lease_driver_allocations',
    'lease_remarketing', 'lease_telematics'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      -- Check column exists before trying to update it
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = t AND column_name = 'tenant_id'
      ) THEN
        -- Temporarily allow NULLs so we can reset orphaned values
        BEGIN
          EXECUTE format(
            'UPDATE %I SET tenant_id = NULL WHERE tenant_id IS NOT NULL AND tenant_id NOT IN (SELECT id FROM tenants)',
            t
          );
        EXCEPTION WHEN OTHERS THEN
          -- Column is already NOT NULL — drop constraint, reset, re-apply below
          EXECUTE format('ALTER TABLE %I ALTER COLUMN tenant_id DROP NOT NULL', t);
          EXECUTE format(
            'UPDATE %I SET tenant_id = NULL WHERE tenant_id IS NOT NULL AND tenant_id NOT IN (SELECT id FROM tenants)',
            t
          );
        END;
      END IF;
    END IF;
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────────────────
-- ROOT MODELS
-- ────────────────────────────────────────────────────────────────────────

-- lessees ──────────────────────────────────────────────────────────────────
ALTER TABLE "lessees" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
UPDATE "lessees" SET "tenant_id" = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "lessees" ALTER COLUMN "tenant_id" SET NOT NULL;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lessees_tenant' AND conrelid = 'lessees'::regclass) THEN ALTER TABLE "lessees" ADD CONSTRAINT "fk_lessees_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT; END IF; END $$;
CREATE INDEX IF NOT EXISTS "idx_lessees_tenant_id" ON "lessees"("tenant_id");

-- lease_quotations ─────────────────────────────────────────────────────────
ALTER TABLE "lease_quotations" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
UPDATE "lease_quotations" SET "tenant_id" = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "lease_quotations" ALTER COLUMN "tenant_id" SET NOT NULL;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lease_quotations_tenant' AND conrelid = 'lease_quotations'::regclass) THEN ALTER TABLE "lease_quotations" ADD CONSTRAINT "fk_lease_quotations_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT; END IF; END $$;
CREATE INDEX IF NOT EXISTS "idx_lease_quotations_tenant_id" ON "lease_quotations"("tenant_id");

-- lease_contracts_v2 ───────────────────────────────────────────────────────
ALTER TABLE "lease_contracts_v2" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
UPDATE "lease_contracts_v2" SET "tenant_id" = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "lease_contracts_v2" ALTER COLUMN "tenant_id" SET NOT NULL;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lease_contracts_v2_tenant' AND conrelid = 'lease_contracts_v2'::regclass) THEN ALTER TABLE "lease_contracts_v2" ADD CONSTRAINT "fk_lease_contracts_v2_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT; END IF; END $$;
CREATE INDEX IF NOT EXISTS "idx_lease_contracts_v2_tenant_id" ON "lease_contracts_v2"("tenant_id");

-- lease_receipts ───────────────────────────────────────────────────────────
ALTER TABLE "lease_receipts" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
UPDATE "lease_receipts" SET "tenant_id" = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "lease_receipts" ALTER COLUMN "tenant_id" SET NOT NULL;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lease_receipts_tenant' AND conrelid = 'lease_receipts'::regclass) THEN ALTER TABLE "lease_receipts" ADD CONSTRAINT "fk_lease_receipts_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT; END IF; END $$;
CREATE INDEX IF NOT EXISTS "idx_lease_receipts_tenant_id" ON "lease_receipts"("tenant_id");

-- lease_invoices ───────────────────────────────────────────────────────────
ALTER TABLE "lease_invoices" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
UPDATE "lease_invoices" SET "tenant_id" = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "lease_invoices" ALTER COLUMN "tenant_id" SET NOT NULL;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lease_invoices_tenant' AND conrelid = 'lease_invoices'::regclass) THEN ALTER TABLE "lease_invoices" ADD CONSTRAINT "fk_lease_invoices_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT; END IF; END $$;
CREATE INDEX IF NOT EXISTS "idx_lease_invoices_tenant_id" ON "lease_invoices"("tenant_id");

-- lease_branches ───────────────────────────────────────────────────────────
ALTER TABLE "lease_branches" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
UPDATE "lease_branches" SET "tenant_id" = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "lease_branches" ALTER COLUMN "tenant_id" SET NOT NULL;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lease_branches_tenant' AND conrelid = 'lease_branches'::regclass) THEN ALTER TABLE "lease_branches" ADD CONSTRAINT "fk_lease_branches_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT; END IF; END $$;
CREATE INDEX IF NOT EXISTS "idx_lease_branches_tenant_id" ON "lease_branches"("tenant_id");

-- lease_inquiries ──────────────────────────────────────────────────────────
ALTER TABLE "lease_inquiries" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
UPDATE "lease_inquiries" SET "tenant_id" = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "lease_inquiries" ALTER COLUMN "tenant_id" SET NOT NULL;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lease_inquiries_tenant' AND conrelid = 'lease_inquiries'::regclass) THEN ALTER TABLE "lease_inquiries" ADD CONSTRAINT "fk_lease_inquiries_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT; END IF; END $$;
CREATE INDEX IF NOT EXISTS "idx_lease_inquiries_tenant_id" ON "lease_inquiries"("tenant_id");

-- lease_inquiry_activities ─────────────────────────────────────────────────
ALTER TABLE "lease_inquiry_activities" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
UPDATE "lease_inquiry_activities" SET "tenant_id" = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "lease_inquiry_activities" ALTER COLUMN "tenant_id" SET NOT NULL;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lease_inquiry_activities_tenant' AND conrelid = 'lease_inquiry_activities'::regclass) THEN ALTER TABLE "lease_inquiry_activities" ADD CONSTRAINT "fk_lease_inquiry_activities_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT; END IF; END $$;
CREATE INDEX IF NOT EXISTS "idx_lease_inquiry_activities_tenant_id" ON "lease_inquiry_activities"("tenant_id");


-- ────────────────────────────────────────────────────────────────────────
-- CHILD MODELS (directly-queried)
-- ────────────────────────────────────────────────────────────────────────

-- lease_payments_v2 ────────────────────────────────────────────────────────
ALTER TABLE "lease_payments_v2" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
UPDATE "lease_payments_v2" SET "tenant_id" = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "lease_payments_v2" ALTER COLUMN "tenant_id" SET NOT NULL;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lease_payments_v2_tenant' AND conrelid = 'lease_payments_v2'::regclass) THEN ALTER TABLE "lease_payments_v2" ADD CONSTRAINT "fk_lease_payments_v2_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT; END IF; END $$;
CREATE INDEX IF NOT EXISTS "idx_lease_payments_v2_tenant_id" ON "lease_payments_v2"("tenant_id");

-- lease_vehicle_exchanges ──────────────────────────────────────────────────
ALTER TABLE "lease_vehicle_exchanges" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
UPDATE "lease_vehicle_exchanges" SET "tenant_id" = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "lease_vehicle_exchanges" ALTER COLUMN "tenant_id" SET NOT NULL;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lease_vehicle_exchanges_tenant' AND conrelid = 'lease_vehicle_exchanges'::regclass) THEN ALTER TABLE "lease_vehicle_exchanges" ADD CONSTRAINT "fk_lease_vehicle_exchanges_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT; END IF; END $$;
CREATE INDEX IF NOT EXISTS "idx_lease_vehicle_exchanges_tenant_id" ON "lease_vehicle_exchanges"("tenant_id");

-- lease_insurance_policies ─────────────────────────────────────────────────
ALTER TABLE "lease_insurance_policies" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
UPDATE "lease_insurance_policies" SET "tenant_id" = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "lease_insurance_policies" ALTER COLUMN "tenant_id" SET NOT NULL;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lease_insurance_policies_tenant' AND conrelid = 'lease_insurance_policies'::regclass) THEN ALTER TABLE "lease_insurance_policies" ADD CONSTRAINT "fk_lease_insurance_policies_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT; END IF; END $$;
CREATE INDEX IF NOT EXISTS "idx_lease_insurance_policies_tenant_id" ON "lease_insurance_policies"("tenant_id");

-- lease_insurance_claims ───────────────────────────────────────────────────
ALTER TABLE "lease_insurance_claims" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
UPDATE "lease_insurance_claims" SET "tenant_id" = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "lease_insurance_claims" ALTER COLUMN "tenant_id" SET NOT NULL;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lease_insurance_claims_tenant' AND conrelid = 'lease_insurance_claims'::regclass) THEN ALTER TABLE "lease_insurance_claims" ADD CONSTRAINT "fk_lease_insurance_claims_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT; END IF; END $$;
CREATE INDEX IF NOT EXISTS "idx_lease_insurance_claims_tenant_id" ON "lease_insurance_claims"("tenant_id");

-- lease_mileage_readings ───────────────────────────────────────────────────
ALTER TABLE "lease_mileage_readings" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
UPDATE "lease_mileage_readings" SET "tenant_id" = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "lease_mileage_readings" ALTER COLUMN "tenant_id" SET NOT NULL;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lease_mileage_readings_tenant' AND conrelid = 'lease_mileage_readings'::regclass) THEN ALTER TABLE "lease_mileage_readings" ADD CONSTRAINT "fk_lease_mileage_readings_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT; END IF; END $$;
CREATE INDEX IF NOT EXISTS "idx_lease_mileage_readings_tenant_id" ON "lease_mileage_readings"("tenant_id");

-- lease_mileage_overages ───────────────────────────────────────────────────
ALTER TABLE "lease_mileage_overages" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
UPDATE "lease_mileage_overages" SET "tenant_id" = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "lease_mileage_overages" ALTER COLUMN "tenant_id" SET NOT NULL;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lease_mileage_overages_tenant' AND conrelid = 'lease_mileage_overages'::regclass) THEN ALTER TABLE "lease_mileage_overages" ADD CONSTRAINT "fk_lease_mileage_overages_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT; END IF; END $$;
CREATE INDEX IF NOT EXISTS "idx_lease_mileage_overages_tenant_id" ON "lease_mileage_overages"("tenant_id");

-- lease_traffic_fines ──────────────────────────────────────────────────────
ALTER TABLE "lease_traffic_fines" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
UPDATE "lease_traffic_fines" SET "tenant_id" = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "lease_traffic_fines" ALTER COLUMN "tenant_id" SET NOT NULL;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lease_traffic_fines_tenant' AND conrelid = 'lease_traffic_fines'::regclass) THEN ALTER TABLE "lease_traffic_fines" ADD CONSTRAINT "fk_lease_traffic_fines_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT; END IF; END $$;
CREATE INDEX IF NOT EXISTS "idx_lease_traffic_fines_tenant_id" ON "lease_traffic_fines"("tenant_id");

-- lease_fuel_logs ──────────────────────────────────────────────────────────
ALTER TABLE "lease_fuel_logs" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
UPDATE "lease_fuel_logs" SET "tenant_id" = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "lease_fuel_logs" ALTER COLUMN "tenant_id" SET NOT NULL;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lease_fuel_logs_tenant' AND conrelid = 'lease_fuel_logs'::regclass) THEN ALTER TABLE "lease_fuel_logs" ADD CONSTRAINT "fk_lease_fuel_logs_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT; END IF; END $$;
CREATE INDEX IF NOT EXISTS "idx_lease_fuel_logs_tenant_id" ON "lease_fuel_logs"("tenant_id");

-- lease_documents ──────────────────────────────────────────────────────────
ALTER TABLE "lease_documents" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
UPDATE "lease_documents" SET "tenant_id" = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "lease_documents" ALTER COLUMN "tenant_id" SET NOT NULL;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lease_documents_tenant' AND conrelid = 'lease_documents'::regclass) THEN ALTER TABLE "lease_documents" ADD CONSTRAINT "fk_lease_documents_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT; END IF; END $$;
CREATE INDEX IF NOT EXISTS "idx_lease_documents_tenant_id" ON "lease_documents"("tenant_id");

-- lease_direct_debits ──────────────────────────────────────────────────────
ALTER TABLE "lease_direct_debits" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
UPDATE "lease_direct_debits" SET "tenant_id" = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "lease_direct_debits" ALTER COLUMN "tenant_id" SET NOT NULL;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lease_direct_debits_tenant' AND conrelid = 'lease_direct_debits'::regclass) THEN ALTER TABLE "lease_direct_debits" ADD CONSTRAINT "fk_lease_direct_debits_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT; END IF; END $$;
CREATE INDEX IF NOT EXISTS "idx_lease_direct_debits_tenant_id" ON "lease_direct_debits"("tenant_id");

-- lease_credit_assessments ─────────────────────────────────────────────────
ALTER TABLE "lease_credit_assessments" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
UPDATE "lease_credit_assessments" SET "tenant_id" = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "lease_credit_assessments" ALTER COLUMN "tenant_id" SET NOT NULL;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lease_credit_assessments_tenant' AND conrelid = 'lease_credit_assessments'::regclass) THEN ALTER TABLE "lease_credit_assessments" ADD CONSTRAINT "fk_lease_credit_assessments_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT; END IF; END $$;
CREATE INDEX IF NOT EXISTS "idx_lease_credit_assessments_tenant_id" ON "lease_credit_assessments"("tenant_id");

-- lease_renewals ───────────────────────────────────────────────────────────
ALTER TABLE "lease_renewals" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
UPDATE "lease_renewals" SET "tenant_id" = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "lease_renewals" ALTER COLUMN "tenant_id" SET NOT NULL;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lease_renewals_tenant' AND conrelid = 'lease_renewals'::regclass) THEN ALTER TABLE "lease_renewals" ADD CONSTRAINT "fk_lease_renewals_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT; END IF; END $$;
CREATE INDEX IF NOT EXISTS "idx_lease_renewals_tenant_id" ON "lease_renewals"("tenant_id");

-- lease_early_terminations ─────────────────────────────────────────────────
ALTER TABLE "lease_early_terminations" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
UPDATE "lease_early_terminations" SET "tenant_id" = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "lease_early_terminations" ALTER COLUMN "tenant_id" SET NOT NULL;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lease_early_terminations_tenant' AND conrelid = 'lease_early_terminations'::regclass) THEN ALTER TABLE "lease_early_terminations" ADD CONSTRAINT "fk_lease_early_terminations_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT; END IF; END $$;
CREATE INDEX IF NOT EXISTS "idx_lease_early_terminations_tenant_id" ON "lease_early_terminations"("tenant_id");

-- lease_pre_billing_statements ─────────────────────────────────────────────
ALTER TABLE "lease_pre_billing_statements" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
UPDATE "lease_pre_billing_statements" SET "tenant_id" = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "lease_pre_billing_statements" ALTER COLUMN "tenant_id" SET NOT NULL;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lease_pre_billing_statements_tenant' AND conrelid = 'lease_pre_billing_statements'::regclass) THEN ALTER TABLE "lease_pre_billing_statements" ADD CONSTRAINT "fk_lease_pre_billing_statements_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT; END IF; END $$;
CREATE INDEX IF NOT EXISTS "idx_lease_pre_billing_statements_tenant_id" ON "lease_pre_billing_statements"("tenant_id");

-- lease_dunning_activities ─────────────────────────────────────────────────
ALTER TABLE "lease_dunning_activities" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
UPDATE "lease_dunning_activities" SET "tenant_id" = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "lease_dunning_activities" ALTER COLUMN "tenant_id" SET NOT NULL;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lease_dunning_activities_tenant' AND conrelid = 'lease_dunning_activities'::regclass) THEN ALTER TABLE "lease_dunning_activities" ADD CONSTRAINT "fk_lease_dunning_activities_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT; END IF; END $$;
CREATE INDEX IF NOT EXISTS "idx_lease_dunning_activities_tenant_id" ON "lease_dunning_activities"("tenant_id");

-- lease_alerts ─────────────────────────────────────────────────────────────
ALTER TABLE "lease_alerts" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
UPDATE "lease_alerts" SET "tenant_id" = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "lease_alerts" ALTER COLUMN "tenant_id" SET NOT NULL;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lease_alerts_tenant' AND conrelid = 'lease_alerts'::regclass) THEN ALTER TABLE "lease_alerts" ADD CONSTRAINT "fk_lease_alerts_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT; END IF; END $$;
CREATE INDEX IF NOT EXISTS "idx_lease_alerts_tenant_id" ON "lease_alerts"("tenant_id");

-- lease_approval_steps ─────────────────────────────────────────────────────
ALTER TABLE "lease_approval_steps" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
UPDATE "lease_approval_steps" SET "tenant_id" = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "lease_approval_steps" ALTER COLUMN "tenant_id" SET NOT NULL;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lease_approval_steps_tenant' AND conrelid = 'lease_approval_steps'::regclass) THEN ALTER TABLE "lease_approval_steps" ADD CONSTRAINT "fk_lease_approval_steps_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT; END IF; END $$;
CREATE INDEX IF NOT EXISTS "idx_lease_approval_steps_tenant_id" ON "lease_approval_steps"("tenant_id");

-- lease_driver_allocations ─────────────────────────────────────────────────
ALTER TABLE "lease_driver_allocations" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
UPDATE "lease_driver_allocations" SET "tenant_id" = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "lease_driver_allocations" ALTER COLUMN "tenant_id" SET NOT NULL;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lease_driver_allocations_tenant' AND conrelid = 'lease_driver_allocations'::regclass) THEN ALTER TABLE "lease_driver_allocations" ADD CONSTRAINT "fk_lease_driver_allocations_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT; END IF; END $$;
CREATE INDEX IF NOT EXISTS "idx_lease_driver_allocations_tenant_id" ON "lease_driver_allocations"("tenant_id");

-- lease_remarketing ────────────────────────────────────────────────────────
ALTER TABLE "lease_remarketing" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
UPDATE "lease_remarketing" SET "tenant_id" = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "lease_remarketing" ALTER COLUMN "tenant_id" SET NOT NULL;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lease_remarketing_tenant' AND conrelid = 'lease_remarketing'::regclass) THEN ALTER TABLE "lease_remarketing" ADD CONSTRAINT "fk_lease_remarketing_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT; END IF; END $$;
CREATE INDEX IF NOT EXISTS "idx_lease_remarketing_tenant_id" ON "lease_remarketing"("tenant_id");

-- lease_telematics ─────────────────────────────────────────────────────────
ALTER TABLE "lease_telematics" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
UPDATE "lease_telematics" SET "tenant_id" = (SELECT id FROM tenants WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY created_at ASC NULLS LAST LIMIT 1) WHERE "tenant_id" IS NULL;
ALTER TABLE "lease_telematics" ALTER COLUMN "tenant_id" SET NOT NULL;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lease_telematics_tenant' AND conrelid = 'lease_telematics'::regclass) THEN ALTER TABLE "lease_telematics" ADD CONSTRAINT "fk_lease_telematics_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT; END IF; END $$;
CREATE INDEX IF NOT EXISTS "idx_lease_telematics_tenant_id" ON "lease_telematics"("tenant_id");


-- ────────────────────────────────────────────────────────────────────────
-- RLS (row-level security) — the final gate.
-- Same policy shape as the legacy tenant_isolation.sql and the dispatch
-- migration: rows where tenant_id IS NULL (legacy, unbackfilled) are visible
-- to operators, OR where tenant_id matches the session context. The Next.js
-- side does NOT currently SET app.tenant_id per query, so the primary
-- guarantee remains the Prisma-side `where: { tenantId }` clause added by
-- this same change. RLS is belt-and-braces.
-- ────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'lessees',
    'lease_quotations',
    'lease_contracts_v2',
    'lease_receipts',
    'lease_invoices',
    'lease_branches',
    'lease_inquiries',
    'lease_inquiry_activities',
    'lease_payments_v2',
    'lease_vehicle_exchanges',
    'lease_insurance_policies',
    'lease_insurance_claims',
    'lease_mileage_readings',
    'lease_mileage_overages',
    'lease_traffic_fines',
    'lease_fuel_logs',
    'lease_documents',
    'lease_direct_debits',
    'lease_credit_assessments',
    'lease_renewals',
    'lease_early_terminations',
    'lease_pre_billing_statements',
    'lease_dunning_activities',
    'lease_alerts',
    'lease_approval_steps',
    'lease_driver_allocations',
    'lease_remarketing',
    'lease_telematics'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
      IF NOT EXISTS (
        SELECT 1 FROM pg_policy
        WHERE polname = 'tenant_isolation' AND polrelid = ('public.' || t)::regclass
      ) THEN
        EXECUTE format(
          'CREATE POLICY tenant_isolation ON %I USING (tenant_id IS NULL OR tenant_id = current_setting(''app.tenant_id'', true))',
          t
        );
      END IF;
    END IF;
  END LOOP;
END $$;
