-- Replay restoration for tables and columns omitted when 20260911120000 was rolled back
-- on fresh database bootstrap due to the finance_security_deposits ordering gap.
-- On real environments (staging/production), these tables already exist so every statement
-- here is a safe no-op. On fresh database replay, this restores the canonical tables,
-- columns, indexes, RLS policies, and fleet360_app grants.

-- 1. lease_vehicle_returns extensions
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "contract_id" TEXT;
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "allocation_occurrence_id" TEXT;
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "vehicle_id" TEXT;
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "handover_id" TEXT;
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "delivery_mileage" INTEGER;
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "damage_items" JSONB;
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "linked_at" TIMESTAMPTZ(6);
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "processing_status" TEXT DEFAULT 'PENDING';
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "processing_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "last_processing_error" TEXT;
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "mileage_assessment" TEXT;
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "mileage_reading_id" TEXT;
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "mileage_overage_id" TEXT;
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "overage_invoice_id" TEXT;
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "charge_approval_status" TEXT DEFAULT 'PENDING';
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "estimated_damage_cost" DECIMAL;
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "approved_damage_cost" DECIMAL;
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "damage_invoice_id" TEXT;
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "charge_approved_by" TEXT;
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "deposit_id" TEXT;
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "deposit_reconciliation" TEXT DEFAULT 'PENDING';
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "deposit_confirmed_by" TEXT;
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "financial_settlement_status" TEXT DEFAULT 'OPEN';
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "vehicle_clearance_status" TEXT DEFAULT 'PENDING';
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "cleared_by" TEXT;
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "cleared_at" TIMESTAMPTZ(6);
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMPTZ(6);
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "cancelled_by" TEXT;
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "legacy_import" BOOLEAN NOT NULL DEFAULT false;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_lease_vehicle_returns_contract' AND conrelid = 'lease_vehicle_returns'::regclass
  ) THEN
    ALTER TABLE "lease_vehicle_returns"
      ADD CONSTRAINT "fk_lease_vehicle_returns_contract" FOREIGN KEY ("contract_id")
      REFERENCES "lease_contracts_v2"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_lease_vehicle_returns_contract_id" ON "lease_vehicle_returns"("contract_id");
CREATE INDEX IF NOT EXISTS "idx_lease_vehicle_returns_occurrence_id" ON "lease_vehicle_returns"("allocation_occurrence_id");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_lease_vehicle_returns_occurrence_open"
  ON "lease_vehicle_returns" ("allocation_occurrence_id")
  WHERE "allocation_occurrence_id" IS NOT NULL AND "cancelled_at" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_lease_vehicle_returns_handover"
  ON "lease_vehicle_returns" ("handover_id")
  WHERE "handover_id" IS NOT NULL;

-- 2. lease_allocation_occurrences
CREATE TABLE IF NOT EXISTS "lease_allocation_occurrences" (
  "id"                  TEXT NOT NULL,
  "created_at"          TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMPTZ(6),
  "tenant_id"           TEXT NOT NULL,
  "contract_id"         TEXT NOT NULL,
  "contract_vehicle_id" TEXT NOT NULL,
  "vehicle_id"          TEXT NOT NULL,
  "sequence_no"         INTEGER NOT NULL,
  "started_at"          TIMESTAMPTZ(6),
  "ended_at"            TIMESTAMPTZ(6),
  "end_reason"          TEXT,
  "status"              TEXT NOT NULL DEFAULT 'ACTIVE',

  CONSTRAINT "lease_allocation_occurrences_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_lease_allocation_occurrences_contract' AND conrelid = 'lease_allocation_occurrences'::regclass
  ) THEN
    ALTER TABLE "lease_allocation_occurrences"
      ADD CONSTRAINT "fk_lease_allocation_occurrences_contract" FOREIGN KEY ("contract_id")
      REFERENCES "lease_contracts_v2"("id") ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_lease_allocation_occurrences_tenant_id" ON "lease_allocation_occurrences"("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_lease_allocation_occurrences_contract_vehicle_id" ON "lease_allocation_occurrences"("contract_vehicle_id");
CREATE INDEX IF NOT EXISTS "idx_lease_allocation_occurrences_vehicle_id" ON "lease_allocation_occurrences"("vehicle_id");

ALTER TABLE "lease_allocation_occurrences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lease_allocation_occurrences" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "lease_allocation_occurrences";
CREATE POLICY tenant_isolation ON "lease_allocation_occurrences"
USING (
  current_setting('app.tenant_id', true) = '*'
  OR tenant_id = current_setting('app.tenant_id', true)
);

-- 3. lease_return_adjustments
CREATE TABLE IF NOT EXISTS "lease_return_adjustments" (
  "id"                      TEXT NOT NULL,
  "created_at"              TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  "tenant_id"               TEXT NOT NULL,
  "return_id"               TEXT NOT NULL,
  "adjustment_type"         TEXT NOT NULL,
  "amount_delta"            DECIMAL,
  "reason"                  TEXT,
  "reverses_application_id" TEXT,
  "created_by"              TEXT,

  CONSTRAINT "lease_return_adjustments_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_lease_return_adjustments_return' AND conrelid = 'lease_return_adjustments'::regclass
  ) THEN
    ALTER TABLE "lease_return_adjustments"
      ADD CONSTRAINT "fk_lease_return_adjustments_return" FOREIGN KEY ("return_id")
      REFERENCES "lease_vehicle_returns"("id") ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_lease_return_adjustments_tenant_id" ON "lease_return_adjustments"("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_lease_return_adjustments_return_id" ON "lease_return_adjustments"("return_id");

ALTER TABLE "lease_return_adjustments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lease_return_adjustments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "lease_return_adjustments";
CREATE POLICY tenant_isolation ON "lease_return_adjustments"
USING (
  current_setting('app.tenant_id', true) = '*'
  OR tenant_id = current_setting('app.tenant_id', true)
);

-- 4. lease_contract_closures
CREATE TABLE IF NOT EXISTS "lease_contract_closures" (
  "id"                      TEXT NOT NULL,
  "created_at"              TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  "updated_at"              TIMESTAMPTZ(6),
  "tenant_id"               TEXT NOT NULL,
  "contract_id"             TEXT NOT NULL,
  "closure_reason"          TEXT NOT NULL,
  "early_termination_id"    TEXT,
  "deposit_id"               TEXT,
  "refund_requested_amount" DECIMAL,
  "status"                  TEXT NOT NULL DEFAULT 'FINAL',
  "closed_at"               TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closed_by"               TEXT,

  CONSTRAINT "lease_contract_closures_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_lease_contract_closures_contract" UNIQUE ("contract_id")
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_lease_contract_closures_contract' AND conrelid = 'lease_contract_closures'::regclass
  ) THEN
    ALTER TABLE "lease_contract_closures"
      ADD CONSTRAINT "fk_lease_contract_closures_contract" FOREIGN KEY ("contract_id")
      REFERENCES "lease_contracts_v2"("id") ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_lease_contract_closures_tenant_id" ON "lease_contract_closures"("tenant_id");

ALTER TABLE "lease_contract_closures" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lease_contract_closures" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "lease_contract_closures";
CREATE POLICY tenant_isolation ON "lease_contract_closures"
USING (
  current_setting('app.tenant_id', true) = '*'
  OR tenant_id = current_setting('app.tenant_id', true)
);

-- 5. leasing_handovers extensions
ALTER TABLE "leasing_handovers" ADD COLUMN IF NOT EXISTS "no_damage_confirmed" BOOLEAN;
ALTER TABLE "leasing_handovers" ADD COLUMN IF NOT EXISTS "occurrence_id" TEXT;

-- 6. lease_deposit_applications
CREATE TABLE IF NOT EXISTS "lease_deposit_applications" (
  "id"             TEXT NOT NULL,
  "created_at"     TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  "tenant_id"      TEXT NOT NULL,
  "deposit_id"     TEXT NOT NULL,
  "return_id"      TEXT NOT NULL,
  "invoice_id"     TEXT,
  "applied_amount" NUMERIC(14,2) NOT NULL,
  "application_type" TEXT NOT NULL,
  "applied_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "applied_by"     TEXT,
  "reversed_at"    TIMESTAMPTZ(6),
  "reversed_by"    TEXT,
  "reversal_reason" TEXT,

  CONSTRAINT "lease_deposit_applications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_lease_deposit_applications_tenant_id" ON "lease_deposit_applications"("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_lease_deposit_applications_deposit_id" ON "lease_deposit_applications"("deposit_id");
CREATE INDEX IF NOT EXISTS "idx_lease_deposit_applications_invoice_id" ON "lease_deposit_applications"("invoice_id");

ALTER TABLE "lease_deposit_applications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lease_deposit_applications" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "lease_deposit_applications";
CREATE POLICY tenant_isolation ON "lease_deposit_applications"
USING (
  current_setting('app.tenant_id', true) = '*'
  OR tenant_id = current_setting('app.tenant_id', true)
);

-- 7. Grant access to fleet360_app
GRANT SELECT, INSERT, UPDATE, DELETE ON "lease_allocation_occurrences" TO fleet360_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "lease_return_adjustments" TO fleet360_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "lease_contract_closures" TO fleet360_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "lease_deposit_applications" TO fleet360_app;

-- 8. Protect migration history ledger against runtime role writes
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = '_prisma_migrations'
  ) THEN
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON public._prisma_migrations FROM fleet360_app';
  END IF;
END $$;

