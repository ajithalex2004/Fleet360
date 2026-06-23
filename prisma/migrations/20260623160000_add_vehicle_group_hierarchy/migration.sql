-- Phase C — three-level vehicle org hierarchy.
--
-- One table `vehicle_groups` with a self-referencing parent_id, plus an
-- enum that locks the tiers to Region → Department → Unit. A trigger
-- enforces that DEPARTMENT's parent is a REGION and UNIT's parent is a
-- DEPARTMENT — so the integrity rule lives at the schema level, not
-- application-layer hope.
--
-- Vehicles attach to UNITs (the leaf level) via vehicles.vehicle_group_id.
-- Region- and department-level roll-ups happen via parent_id traversal.

-- ── Enum ────────────────────────────────────────────────────────────────
CREATE TYPE "VehicleGroupLevel" AS ENUM ('REGION', 'DEPARTMENT', 'UNIT');

-- ── Table ───────────────────────────────────────────────────────────────
CREATE TABLE "vehicle_groups" (
  "id"          TEXT PRIMARY KEY,
  "created_at"  TIMESTAMPTZ(6) DEFAULT NOW(),
  "updated_at"  TIMESTAMPTZ(6),
  "deleted_at"  TIMESTAMPTZ(6),
  "tenant_id"   TEXT NOT NULL,
  "level"       "VehicleGroupLevel" NOT NULL,
  "parent_id"   TEXT,
  "code"        TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "is_active"   BOOLEAN DEFAULT TRUE,

  CONSTRAINT "fk_vehicle_groups_tenant"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT,
  CONSTRAINT "fk_vehicle_groups_parent"
    FOREIGN KEY ("parent_id") REFERENCES "vehicle_groups"("id") ON DELETE RESTRICT,

  -- Region rows must have no parent; non-region rows must have one.
  -- The trigger below additionally enforces "parent's level matches
  -- this row's expected parent level" — a richer rule than CHECK can
  -- express because it crosses rows.
  CONSTRAINT "chk_vehicle_groups_region_no_parent" CHECK (
    (level = 'REGION' AND parent_id IS NULL)
    OR (level <> 'REGION' AND parent_id IS NOT NULL)
  )
);

CREATE INDEX "idx_vehicle_groups_tenant_id" ON "vehicle_groups"("tenant_id");
CREATE INDEX "idx_vehicle_groups_parent_id" ON "vehicle_groups"("parent_id");
CREATE INDEX "idx_vehicle_groups_level" ON "vehicle_groups"("level");

-- Tenant-scoped unique (level, code) among live rows. A soft-deleted
-- "DXB" region doesn't block creating a new one with the same code.
CREATE UNIQUE INDEX "uniq_vehicle_groups_tenant_level_code"
  ON "vehicle_groups"("tenant_id", "level", "code")
  WHERE "deleted_at" IS NULL;

-- ── Parent-level trigger ────────────────────────────────────────────────
-- Enforce the three-tier shape: DEPARTMENT parent must be REGION, UNIT
-- parent must be DEPARTMENT. Region's no-parent rule is already in the
-- CHECK above. Runs BEFORE INSERT or UPDATE; raises a clear EXCEPTION
-- on violation so the application surfaces a useful error.
CREATE OR REPLACE FUNCTION fn_vehicle_groups_validate_parent_level()
RETURNS TRIGGER AS $$
DECLARE
  parent_level "VehicleGroupLevel";
BEGIN
  IF NEW.parent_id IS NULL THEN
    -- The chk_vehicle_groups_region_no_parent CHECK already ensures
    -- this branch is only reached for REGION rows; nothing to validate
    -- on the parent here.
    RETURN NEW;
  END IF;

  SELECT level INTO parent_level FROM "vehicle_groups" WHERE id = NEW.parent_id;
  IF parent_level IS NULL THEN
    RAISE EXCEPTION 'vehicle_groups: parent_id % does not exist', NEW.parent_id;
  END IF;

  IF NEW.level = 'DEPARTMENT' AND parent_level <> 'REGION' THEN
    RAISE EXCEPTION 'vehicle_groups: DEPARTMENT parent must be a REGION (got %)', parent_level;
  END IF;
  IF NEW.level = 'UNIT' AND parent_level <> 'DEPARTMENT' THEN
    RAISE EXCEPTION 'vehicle_groups: UNIT parent must be a DEPARTMENT (got %)', parent_level;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_vehicle_groups_validate_parent_level
BEFORE INSERT OR UPDATE OF parent_id, level ON "vehicle_groups"
FOR EACH ROW EXECUTE FUNCTION fn_vehicle_groups_validate_parent_level();

-- ── vehicles.vehicle_group_id ──────────────────────────────────────────
-- Nullable: existing rows stay un-grouped until an operator assigns them.
-- ON DELETE SET NULL so removing a group doesn't cascade-delete the
-- vehicle (and ON DELETE RESTRICT on vehicle_groups.parent_id already
-- guarantees you can't drop a group that still has children).
ALTER TABLE "vehicles" ADD COLUMN "vehicle_group_id" TEXT;
ALTER TABLE "vehicles" ADD CONSTRAINT "fk_vehicles_vehicle_group"
  FOREIGN KEY ("vehicle_group_id") REFERENCES "vehicle_groups"("id")
  ON DELETE SET NULL;
CREATE INDEX "idx_vehicles_vehicle_group_id" ON "vehicles"("vehicle_group_id");
