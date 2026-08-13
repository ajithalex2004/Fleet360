-- Phase C: Quality Inspection + Job Cards + Warranty Management
-- 2026-08-11

-- ============================================================
-- 1a. Extend MaintenanceStatus enum
-- ============================================================
ALTER TYPE "public"."MaintenanceStatus" ADD VALUE IF NOT EXISTS 'REPAIR_COMPLETED';
ALTER TYPE "public"."MaintenanceStatus" ADD VALUE IF NOT EXISTS 'QUALITY_INSPECTION';
ALTER TYPE "public"."MaintenanceStatus" ADD VALUE IF NOT EXISTS 'INSPECTION_FAILED';
ALTER TYPE "public"."MaintenanceStatus" ADD VALUE IF NOT EXISTS 'READY_FOR_SERVICE';

-- ============================================================
-- 1b. Extend WorkOrderStatus enum (SUBMIT_INVOICE used in UI)
-- ============================================================
ALTER TYPE "public"."WorkOrderStatus" ADD VALUE IF NOT EXISTS 'SUBMIT_INVOICE';

-- ============================================================
-- 1c. quality_inspections
-- ============================================================
CREATE TABLE IF NOT EXISTS "public"."quality_inspections" (
  "id"             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "tenant_id"      TEXT        NOT NULL DEFAULT '',
  "request_id"     TEXT        NOT NULL,
  "inspector_id"   TEXT,
  "inspector_name" TEXT,
  "overall_result" TEXT        NOT NULL DEFAULT 'PENDING',
  "notes"          TEXT,
  "inspected_at"   TIMESTAMPTZ,
  "checklist"      JSONB       NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT "fk_qi_request"
    FOREIGN KEY ("request_id")
    REFERENCES "public"."maintenance_requests"("id")
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_qi_request_id"
  ON "public"."quality_inspections"("request_id");
CREATE INDEX IF NOT EXISTS "idx_qi_tenant_id"
  ON "public"."quality_inspections"("tenant_id");

-- ============================================================
-- 1d. job_cards
-- ============================================================
CREATE TABLE IF NOT EXISTS "public"."job_cards" (
  "id"               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "work_order_id"    TEXT    NOT NULL,
  "title"            TEXT    NOT NULL,
  "description"      TEXT,
  "technician_id"    TEXT,
  "technician_name"  TEXT,
  "status"           TEXT    NOT NULL DEFAULT 'PENDING',
  "estimated_hours"  DECIMAL,
  "actual_hours"     DECIMAL,
  CONSTRAINT "fk_jc_work_order"
    FOREIGN KEY ("work_order_id")
    REFERENCES "public"."WorkOrder"("id")
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_job_cards_work_order_id"
  ON "public"."job_cards"("work_order_id");

-- ============================================================
-- 1e. job_tasks
-- ============================================================
CREATE TABLE IF NOT EXISTS "public"."job_tasks" (
  "id"           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "job_card_id"  UUID    NOT NULL,
  "description"  TEXT    NOT NULL,
  "completed"    BOOLEAN NOT NULL DEFAULT FALSE,
  "completed_at" TIMESTAMPTZ,
  "completed_by" TEXT,
  CONSTRAINT "fk_jt_job_card"
    FOREIGN KEY ("job_card_id")
    REFERENCES "public"."job_cards"("id")
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_job_tasks_job_card_id"
  ON "public"."job_tasks"("job_card_id");

-- ============================================================
-- 1f. vehicle_warranties
-- ============================================================
CREATE TABLE IF NOT EXISTS "public"."vehicle_warranties" (
  "id"                   UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),
  "tenant_id"            TEXT    NOT NULL DEFAULT '',
  "vehicle_id"           TEXT    NOT NULL,
  "warranty_type"        TEXT    NOT NULL,
  "provider"             TEXT,
  "start_date"           DATE    NOT NULL,
  "expiry_date"          DATE    NOT NULL,
  "coverage_description" TEXT,
  "max_claim_amount"     DECIMAL,
  "is_active"            BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS "idx_vw_vehicle_id"
  ON "public"."vehicle_warranties"("vehicle_id");
CREATE INDEX IF NOT EXISTS "idx_vw_tenant_id"
  ON "public"."vehicle_warranties"("tenant_id");

-- ============================================================
-- 1g. warranty_claims
-- ============================================================
CREATE TABLE IF NOT EXISTS "public"."warranty_claims" (
  "id"               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "tenant_id"        TEXT    NOT NULL DEFAULT '',
  "warranty_id"      UUID    NOT NULL,
  "request_id"       TEXT,
  "claim_date"       DATE,
  "claimed_amount"   DECIMAL,
  "approved_amount"  DECIMAL,
  "status"           TEXT    NOT NULL DEFAULT 'PENDING',
  "description"      TEXT,
  "reference_number" TEXT,
  CONSTRAINT "fk_wc_warranty"
    FOREIGN KEY ("warranty_id")
    REFERENCES "public"."vehicle_warranties"("id")
    ON DELETE RESTRICT,
  CONSTRAINT "fk_wc_request"
    FOREIGN KEY ("request_id")
    REFERENCES "public"."maintenance_requests"("id")
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "idx_wc_warranty_id"
  ON "public"."warranty_claims"("warranty_id");
CREATE INDEX IF NOT EXISTS "idx_wc_tenant_id"
  ON "public"."warranty_claims"("tenant_id");
