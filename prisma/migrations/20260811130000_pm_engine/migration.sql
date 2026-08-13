-- Preventive Maintenance Engine
-- Adds three tables: maintenance_plans, pm_triggers, pm_schedule_items
-- and two enums: PMTriggerType, PMItemStatus

-- CreateEnum
CREATE TYPE "public"."PMTriggerType" AS ENUM (
  'ODOMETER',
  'CALENDAR',
  'ENGINE_HOURS',
  'OPERATING_HOURS',
  'COMPONENT_LIFE'
);

-- CreateEnum
CREATE TYPE "public"."PMItemStatus" AS ENUM (
  'UPCOMING',
  'DUE',
  'OVERDUE',
  'COMPLETED',
  'SNOOZED'
);

-- CreateTable: maintenance_plans
CREATE TABLE "public"."maintenance_plans" (
    "id"                  UUID        NOT NULL DEFAULT gen_random_uuid(),
    "created_at"          TIMESTAMPTZ(6)       DEFAULT NOW(),
    "updated_at"          TIMESTAMPTZ(6),
    "deleted_at"          TIMESTAMPTZ(6),
    "tenant_id"           TEXT        NOT NULL,
    "name"                TEXT        NOT NULL,
    "description"         TEXT,
    "maintenance_type"    TEXT,
    "applicability"       JSONB,
    "grace_period_days"   INTEGER,
    "early_window_days"   INTEGER,
    "early_window_km"     INTEGER,
    "is_active"           BOOLEAN     NOT NULL DEFAULT TRUE,
    "notify_days_before"  INTEGER,
    CONSTRAINT "maintenance_plans_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_maintenance_plans_tenant_id"  ON "public"."maintenance_plans"("tenant_id");
CREATE INDEX "idx_maintenance_plans_deleted_at" ON "public"."maintenance_plans"("deleted_at");
CREATE INDEX "idx_maintenance_plans_is_active"  ON "public"."maintenance_plans"("is_active");

-- CreateTable: pm_triggers
CREATE TABLE "public"."pm_triggers" (
    "id"             UUID                    NOT NULL DEFAULT gen_random_uuid(),
    "created_at"     TIMESTAMPTZ(6)                   DEFAULT NOW(),
    "plan_id"        UUID                    NOT NULL,
    "trigger_type"   "public"."PMTriggerType" NOT NULL,
    "interval_value" INTEGER                 NOT NULL,
    "interval_unit"  TEXT                    NOT NULL,
    CONSTRAINT "pm_triggers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_pm_triggers_plan_id" ON "public"."pm_triggers"("plan_id");

ALTER TABLE "public"."pm_triggers"
  ADD CONSTRAINT "fk_pm_triggers_plan"
  FOREIGN KEY ("plan_id") REFERENCES "public"."maintenance_plans"("id")
  ON DELETE CASCADE;

-- CreateTable: pm_schedule_items
CREATE TABLE "public"."pm_schedule_items" (
    "id"                   UUID                   NOT NULL DEFAULT gen_random_uuid(),
    "created_at"           TIMESTAMPTZ(6)                  DEFAULT NOW(),
    "updated_at"           TIMESTAMPTZ(6),
    "tenant_id"            TEXT                   NOT NULL,
    "plan_id"              UUID                   NOT NULL,
    "vehicle_id"           UUID                   NOT NULL,
    "last_service_date"    TIMESTAMPTZ(6),
    "last_odometer_km"     INTEGER,
    "next_due_date_calc"   TIMESTAMPTZ(6),
    "next_due_odometer_km" INTEGER,
    "status"               "public"."PMItemStatus" NOT NULL DEFAULT 'UPCOMING',
    "generated_request_id" UUID,
    CONSTRAINT "pm_schedule_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uniq_pm_schedule_items_plan_vehicle"
  ON "public"."pm_schedule_items"("plan_id", "vehicle_id");
CREATE INDEX "idx_pm_schedule_items_tenant_id"  ON "public"."pm_schedule_items"("tenant_id");
CREATE INDEX "idx_pm_schedule_items_vehicle_id" ON "public"."pm_schedule_items"("vehicle_id");
CREATE INDEX "idx_pm_schedule_items_status"     ON "public"."pm_schedule_items"("status");
CREATE INDEX "idx_pm_schedule_items_plan_id"    ON "public"."pm_schedule_items"("plan_id");

ALTER TABLE "public"."pm_schedule_items"
  ADD CONSTRAINT "fk_pm_schedule_items_plan"
  FOREIGN KEY ("plan_id") REFERENCES "public"."maintenance_plans"("id");
