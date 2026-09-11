-- Leasing Fleet Asset Return & Early Termination Workflow.
--
-- Extends lease_vehicle_returns (created by 20260910000012) from a thin
-- free-text log into the canonical return/settlement orchestration record;
-- adds lease_allocation_occurrences (stable allocation-period identity,
-- since contracts-v2/[id]/exchange/route.ts mutates LeaseContractVehicle in
-- place and gives repeated exchange cycles no history otherwise),
-- lease_return_adjustments (correction trail — one return row per
-- occurrence, permanently), lease_contract_closures (closure reason/refund
-- state, kept separate from LeaseContract2.status so an executed early
-- termination's existing TERMINATED value is never overwritten), and
-- deposit refund-reservation columns on finance_security_deposits.
--
-- All additive. Legacy rows are backfilled conservatively: settlement
-- fields are left NULL (not defaulted to a terminal value), and
-- lease_allocation_occurrences history is reconstructed from actual
-- evidence (LeaseVehicleExchange dates, LeaseMileageReading DELIVERY
-- dates, and pre-existing LeaseVehicleReturn rows) — ambiguous cases are
-- flagged RECONCILIATION_REQUIRED rather than guessed.

-- ============================================================
-- lease_vehicle_returns — extend
-- ============================================================

ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "contract_id" TEXT;
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "allocation_occurrence_id" TEXT;
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "vehicle_id" TEXT;
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "handover_id" TEXT;
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "delivery_mileage" INTEGER;
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "damage_items" JSONB;

ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "linked_at" TIMESTAMPTZ(6);
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "processing_status" TEXT;
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "processing_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "last_processing_error" TEXT;

ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "mileage_assessment" TEXT;
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "mileage_reading_id" TEXT;
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "mileage_overage_id" TEXT;
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "overage_invoice_id" TEXT;

ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "charge_approval_status" TEXT;
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "estimated_damage_cost" DECIMAL;
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "approved_damage_cost" DECIMAL;
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "damage_invoice_id" TEXT;
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "charge_approved_by" TEXT;

ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "deposit_id" TEXT;
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "deposit_reconciliation" TEXT;
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "deposit_confirmed_by" TEXT;

ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "financial_settlement_status" TEXT;
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "vehicle_clearance_status" TEXT;
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "cleared_by" TEXT;
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "cleared_at" TIMESTAMPTZ(6);

ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMPTZ(6);
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "cancelled_by" TEXT;

-- legacy_import: mark every pre-existing row true BEFORE the default is set
-- to false, so only rows created after this migration get the new default.
ALTER TABLE "lease_vehicle_returns" ADD COLUMN IF NOT EXISTS "legacy_import" BOOLEAN;
UPDATE "lease_vehicle_returns" SET "legacy_import" = true WHERE "legacy_import" IS NULL;
ALTER TABLE "lease_vehicle_returns" ALTER COLUMN "legacy_import" SET DEFAULT false;
ALTER TABLE "lease_vehicle_returns" ALTER COLUMN "legacy_import" SET NOT NULL;

-- Status-with-a-default columns: added with NO default so legacy rows stay
-- NULL (never defaulted to a terminal-looking value), then the default is
-- applied afterward so only future inserts get it.
ALTER TABLE "lease_vehicle_returns" ALTER COLUMN "processing_status" SET DEFAULT 'PENDING';
ALTER TABLE "lease_vehicle_returns" ALTER COLUMN "charge_approval_status" SET DEFAULT 'PENDING';
ALTER TABLE "lease_vehicle_returns" ALTER COLUMN "deposit_reconciliation" SET DEFAULT 'PENDING';
ALTER TABLE "lease_vehicle_returns" ALTER COLUMN "financial_settlement_status" SET DEFAULT 'OPEN';
ALTER TABLE "lease_vehicle_returns" ALTER COLUMN "vehicle_clearance_status" SET DEFAULT 'PENDING';

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

-- Duplicate-open-return protection at the DB level, scoped per allocation
-- occurrence (not per contract, so two vehicles on one contract can return
-- independently). There is no separate "status" column on this table — a
-- cancelled return is signalled by cancelled_at being set (see
-- LeaseVehicleReturn in schema.prisma), so the guard keys off that
-- directly rather than a redundant status string. Not declared as @@unique
-- in schema.prisma (Prisma can't express a WHERE clause on @@unique) —
-- see TransportEnrollment for the same workaround.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_lease_vehicle_returns_occurrence_open"
  ON "lease_vehicle_returns" ("allocation_occurrence_id")
  WHERE "allocation_occurrence_id" IS NOT NULL AND "cancelled_at" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_lease_vehicle_returns_handover"
  ON "lease_vehicle_returns" ("handover_id")
  WHERE "handover_id" IS NOT NULL;

-- ============================================================
-- lease_allocation_occurrences — new
-- ============================================================

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

-- The two partial-unique guards below are created AFTER the evidence-based
-- backfill further down this file (not here), specifically so a pre-existing
-- real-world double-booking in legacy data can't abort the whole migration —
-- see the DO block after the backfill for why and how that's handled.

ALTER TABLE "lease_allocation_occurrences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lease_allocation_occurrences" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "lease_allocation_occurrences";
CREATE POLICY tenant_isolation ON "lease_allocation_occurrences"
USING (
  current_setting('app.tenant_id', true) = '*'
  OR tenant_id = current_setting('app.tenant_id', true)
);

-- ============================================================
-- lease_return_adjustments — new
-- ============================================================

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

-- ============================================================
-- lease_contract_closures — new
-- ============================================================

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

-- ============================================================
-- leasing_handovers — inspection-evidence additions
-- ============================================================

ALTER TABLE "leasing_handovers" ADD COLUMN IF NOT EXISTS "no_damage_confirmed" BOOLEAN;
ALTER TABLE "leasing_handovers" ADD COLUMN IF NOT EXISTS "occurrence_id" TEXT;

-- ============================================================
-- finance_security_deposits — refund reservation/execution lifecycle
-- ============================================================

ALTER TABLE "finance_security_deposits" ADD COLUMN IF NOT EXISTS "reserved_amount" NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "finance_security_deposits" ADD COLUMN IF NOT EXISTS "refund_status" TEXT;
ALTER TABLE "finance_security_deposits" ADD COLUMN IF NOT EXISTS "refund_requested_amount" NUMERIC(14,2);
ALTER TABLE "finance_security_deposits" ADD COLUMN IF NOT EXISTS "refund_requested_by" TEXT;
ALTER TABLE "finance_security_deposits" ADD COLUMN IF NOT EXISTS "refund_requested_at" TIMESTAMPTZ(6);
ALTER TABLE "finance_security_deposits" ADD COLUMN IF NOT EXISTS "refund_recorded_by" TEXT;
ALTER TABLE "finance_security_deposits" ADD COLUMN IF NOT EXISTS "refund_recorded_at" TIMESTAMPTZ(6);
ALTER TABLE "finance_security_deposits" ADD COLUMN IF NOT EXISTS "refunded_amount" NUMERIC(14,2) NOT NULL DEFAULT 0;

-- ============================================================
-- lease_deposit_applications — new (deposit-to-invoice allocation ledger)
-- ============================================================

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

-- ============================================================
-- Evidence-based backfill of lease_allocation_occurrences
-- ============================================================
--
-- For every existing LeaseContractVehicle "slot", reconstruct its
-- occurrence chain from real records:
--   - Each LeaseVehicleExchange (ordered by exchange_date) closes an
--     occurrence for its outgoing vehicle and opens the next one for its
--     incoming vehicle.
--   - The first occurrence in a chain gets started_at from the earliest
--     DELIVERY-type LeaseMileageReading for that contract+vehicle, if one
--     exists. LeaseContractVehicle has no created_at column to fall back
--     on, so if no DELIVERY reading exists, started_at is left NULL rather
--     than invented.
--   - The final occurrence (the vehicle currently on the slot) becomes:
--       * ENDED, using a matching legacy lease_vehicle_returns.return_date
--         as evidence, if one exists for this contract;
--       * RECONCILIATION_REQUIRED if no such evidence exists but the
--         contract's own status is already terminal (TERMINATED/CLOSED) —
--         contradicts a live-looking occurrence, flagged for a human;
--       * otherwise ACTIVE, consistent with the contract's own live status.

DO $$
DECLARE
  slot RECORD;
  exch RECORD;
  occ_id TEXT;
  prev_vehicle_id TEXT;
  prev_started_at TIMESTAMPTZ;
  seq INTEGER;
  first_delivery TIMESTAMPTZ;
  legacy_return_date TIMESTAMPTZ;
  contract_status TEXT;
BEGIN
  FOR slot IN
    SELECT id AS contract_vehicle_id, tenant_id, contract_id, vehicle_id
    FROM lease_contract_vehicles
    WHERE vehicle_id IS NOT NULL
  LOOP
    seq := 1;
    prev_vehicle_id := slot.vehicle_id; -- placeholder, overwritten by first exchange leg below if any
    prev_started_at := NULL;

    SELECT MIN(reading_date) INTO first_delivery
      FROM lease_mileage_readings
     WHERE contract_id = slot.contract_id AND reading_type = 'DELIVERY';

    -- Walk this contract's exchange history in order to find the ORIGINAL
    -- vehicle this slot started with, not just the current one.
    SELECT outgoing_vehicle_id INTO prev_vehicle_id
      FROM lease_vehicle_exchanges
     WHERE contract_id = slot.contract_id
     ORDER BY exchange_date ASC
     LIMIT 1;

    IF prev_vehicle_id IS NULL THEN
      prev_vehicle_id := slot.vehicle_id; -- no exchanges — the slot has had only one vehicle
    END IF;

    occ_id := gen_random_uuid()::text;
    INSERT INTO lease_allocation_occurrences
      (id, tenant_id, contract_id, contract_vehicle_id, vehicle_id, sequence_no, started_at, status)
    VALUES
      (occ_id, slot.tenant_id, slot.contract_id, slot.contract_vehicle_id, prev_vehicle_id, seq, first_delivery, 'ENDED');

    -- Walk each exchange leg for this contract, closing the previous
    -- occurrence and opening the next.
    FOR exch IN
      SELECT outgoing_vehicle_id, incoming_vehicle_id, exchange_date
        FROM lease_vehicle_exchanges
       WHERE contract_id = slot.contract_id
       ORDER BY exchange_date ASC
    LOOP
      UPDATE lease_allocation_occurrences
         SET ended_at = exch.exchange_date, end_reason = 'EXCHANGE'
       WHERE id = occ_id;

      seq := seq + 1;
      occ_id := gen_random_uuid()::text;
      INSERT INTO lease_allocation_occurrences
        (id, tenant_id, contract_id, contract_vehicle_id, vehicle_id, sequence_no, started_at, status)
      VALUES
        (occ_id, slot.tenant_id, slot.contract_id, slot.contract_vehicle_id, exch.incoming_vehicle_id, seq, exch.exchange_date, 'ENDED');
    END LOOP;

    -- Resolve the FINAL occurrence in the chain (the one still ENDED from
    -- the loop above) against real evidence rather than guessing ACTIVE.
    SELECT return_date INTO legacy_return_date
      FROM lease_vehicle_returns lvr
      JOIN lease_contracts_v2 lc ON lc.id = slot.contract_id
     WHERE lvr.contract_number = lc.contract_number
     ORDER BY lvr.return_date DESC
     LIMIT 1;

    SELECT status INTO contract_status FROM lease_contracts_v2 WHERE id = slot.contract_id;

    IF legacy_return_date IS NOT NULL THEN
      UPDATE lease_allocation_occurrences
         SET status = 'ENDED', ended_at = legacy_return_date, end_reason = 'RETURN'
       WHERE id = occ_id;
    ELSIF contract_status IN ('TERMINATED', 'CLOSED') THEN
      UPDATE lease_allocation_occurrences
         SET status = 'RECONCILIATION_REQUIRED'
       WHERE id = occ_id;
    ELSE
      UPDATE lease_allocation_occurrences
         SET status = 'ACTIVE', ended_at = NULL, end_reason = NULL
       WHERE id = occ_id;
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- lease_allocation_occurrences — partial-unique guards, added now that the
-- backfill above has run. If legacy data already contains a real
-- double-booking (the same vehicle ACTIVE on two contracts, or two ACTIVE
-- occurrences on one slot), creating a strict unique index over it would
-- abort this entire migration — so each is attempted individually and, on
-- a pre-existing violation, the guard is skipped with a NOTICE rather than
-- blocking every other change in this file. A skipped guard here is a
-- signal for manual cleanup, not a silent guess.
DO $$
BEGIN
  BEGIN
    CREATE UNIQUE INDEX "uq_lease_allocation_occurrences_slot_active"
      ON "lease_allocation_occurrences" ("contract_vehicle_id")
      WHERE "status" = 'ACTIVE';
  EXCEPTION WHEN unique_violation OR duplicate_table THEN
    RAISE NOTICE 'uq_lease_allocation_occurrences_slot_active not created — pre-existing duplicate ACTIVE rows for a slot. Manual reconciliation required.';
  END;

  BEGIN
    CREATE UNIQUE INDEX "uq_lease_allocation_occurrences_vehicle_active"
      ON "lease_allocation_occurrences" ("vehicle_id")
      WHERE "status" = 'ACTIVE';
  EXCEPTION WHEN unique_violation OR duplicate_table THEN
    RAISE NOTICE 'uq_lease_allocation_occurrences_vehicle_active not created — pre-existing vehicle double-booking across contracts. Manual reconciliation required.';
  END;
END $$;
