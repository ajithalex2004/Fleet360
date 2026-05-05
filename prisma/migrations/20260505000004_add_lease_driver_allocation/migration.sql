-- Lease driver allocation history.
-- Each row represents a period during which a Driver was assigned to a
-- LeaseContract2 (and optionally a specific LeaseContractVehicle). When the
-- driver is replaced or released, releasedAt is stamped and a new row is
-- created for the next driver.
CREATE TABLE IF NOT EXISTS "lease_driver_allocations" (
  "id"                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at"          TIMESTAMPTZ  DEFAULT NOW(),
  "updated_at"          TIMESTAMPTZ,
  "driver_id"           UUID         NOT NULL,
  "contract_id"         UUID         NOT NULL,
  "contract_vehicle_id" UUID,
  "allocated_at"        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "released_at"         TIMESTAMPTZ,
  "release_reason"      TEXT,
  "allocated_by"        TEXT,
  "released_by"         TEXT,
  "notes"               TEXT,
  "status"              TEXT         DEFAULT 'ACTIVE'  -- ACTIVE|RELEASED
);

CREATE INDEX IF NOT EXISTS "idx_lease_driver_allocations_driver_id"
  ON "lease_driver_allocations" ("driver_id");
CREATE INDEX IF NOT EXISTS "idx_lease_driver_allocations_contract_id"
  ON "lease_driver_allocations" ("contract_id");
CREATE INDEX IF NOT EXISTS "idx_lease_driver_allocations_contract_vehicle_id"
  ON "lease_driver_allocations" ("contract_vehicle_id");
CREATE INDEX IF NOT EXISTS "idx_lease_driver_allocations_status"
  ON "lease_driver_allocations" ("status");

-- One ACTIVE allocation per (contract, vehicle) at a time.
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_lease_driver_alloc_active"
  ON "lease_driver_allocations" ("contract_id", "contract_vehicle_id")
  WHERE "status" = 'ACTIVE';
