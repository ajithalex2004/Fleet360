-- CreateTable: lease_vehicle_returns
-- Backs the leasing "Vehicle Returns" page (src/app/leasing/returns), which
-- previously had no table or API at all and rendered a hardcoded mock list.
CREATE TABLE IF NOT EXISTS "lease_vehicle_returns" (
    "id"              TEXT NOT NULL,
    "created_at"      TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMPTZ(6),
    "deleted_at"      TIMESTAMPTZ(6),
    "tenant_id"       TEXT NOT NULL,
    "contract_number" TEXT NOT NULL,
    "return_date"     TIMESTAMPTZ(6) NOT NULL,
    "mileage"         INTEGER NOT NULL,
    "condition"       TEXT NOT NULL DEFAULT 'Good',
    "damages"         TEXT,
    "final_cost"      DECIMAL NOT NULL DEFAULT 0,
    "inspector"       TEXT NOT NULL,

    CONSTRAINT "lease_vehicle_returns_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_lease_vehicle_returns_tenant' AND conrelid = 'lease_vehicle_returns'::regclass
  ) THEN
    ALTER TABLE "lease_vehicle_returns"
      ADD CONSTRAINT "fk_lease_vehicle_returns_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_lease_vehicle_returns_tenant_id" ON "lease_vehicle_returns"("tenant_id");

-- Row-level tenant isolation — same shape as every other tenant-scoped
-- table (see prisma/migrations/20260803000000_rls_tenant_isolation_all_tables).
-- A USING-only ALL-commands policy is applied as WITH CHECK too by Postgres,
-- so this also blocks cross-tenant INSERT/UPDATE, not just reads.
ALTER TABLE "lease_vehicle_returns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lease_vehicle_returns" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "lease_vehicle_returns";
CREATE POLICY tenant_isolation ON "lease_vehicle_returns"
USING (
  tenant_id IS NULL
  OR current_setting('app.tenant_id', true) = '*'
  OR tenant_id::text = current_setting('app.tenant_id', true)
);
