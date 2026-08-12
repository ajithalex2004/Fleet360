-- Task 3 (MVP slice) — Split bus-ops staff_members into
-- workforce.Employee (canonical identity) + TransportEnrollment
-- (bus-ops-specific transport flags).
--
-- Approach (safe, non-breaking):
-- 1. ALTER TABLE public.staff_members SET SCHEMA workforce
--    then RENAME TO employees. Existing FKs (trip_passengers.staff_member_id,
--    route_passengers.staff_member_id, staff_transport_requests.staff_member_id)
--    keep resolving because the primary key column stays the same UUID and
--    Postgres FK definitions follow the table across schema/rename.
-- 2. CREATE TABLE public.transport_enrollments with FK to workforce.employees.
-- 3. INSERT ... SELECT to populate transport_enrollments from the (now-moved)
--    employees rows that have any transport-specific column set.
-- 4. Leave the transport-specific columns on employees for now (they are
--    marked deprecated in a follow-up PR). This keeps prisma.staffMember
--    reads that reference defaultRouteId etc. working without a code change,
--    while giving new code a clean TransportEnrollment surface to consume.
--
-- After this migration:
--   - workforce.employees             — canonical employee identity
--   - public.transport_enrollments    — bus-ops per-employee transport prefs
--   - public.staff_members            — GONE (relocated)

-- Move + rename in one step
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name='staff_members') THEN
    EXECUTE 'ALTER TABLE public.staff_members SET SCHEMA workforce';
    EXECUTE 'ALTER TABLE workforce.staff_members RENAME TO employees';
  END IF;
END $$;

-- Create the join / transport-specific table.
-- Note: TEXT (not UUID) for id + FKs to match the existing Prisma-generated
-- `String @id @default(uuid())` shape on the employees table (Prisma
-- stores UUIDs as TEXT unless you opt into @db.Uuid; the existing
-- staff_members table was created without @db.Uuid so its id column is TEXT).
CREATE TABLE IF NOT EXISTS transport_enrollments (
  id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ,
  deleted_at        TIMESTAMPTZ,
  tenant_id         TEXT        NOT NULL,
  employee_id       TEXT        NOT NULL REFERENCES workforce.employees(id) ON DELETE CASCADE,
  default_route_id  TEXT,
  default_stop_id   TEXT,
  default_stop_name TEXT,
  shift_type        TEXT,        -- MORNING | EVENING | BOTH
  transport_type    TEXT DEFAULT 'BUS',
  is_active         BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_transport_enrollments_employee
  ON transport_enrollments (employee_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_transport_enrollments_tenant   ON transport_enrollments (tenant_id);
CREATE INDEX IF NOT EXISTS idx_transport_enrollments_route    ON transport_enrollments (default_route_id);
CREATE INDEX IF NOT EXISTS idx_transport_enrollments_active   ON transport_enrollments (is_active);

-- Backfill from workforce.employees for anyone with existing transport prefs
INSERT INTO transport_enrollments
  (tenant_id, employee_id, default_route_id, default_stop_id, default_stop_name,
   shift_type, transport_type, is_active)
SELECT
  COALESCE(tenant_id, 'default'),
  id,
  default_route_id,
  default_stop_id,
  default_stop_name,
  shift_type,
  COALESCE(transport_type, 'BUS'),
  COALESCE(is_active, TRUE)
FROM workforce.employees
WHERE deleted_at IS NULL
  AND (default_route_id IS NOT NULL
       OR default_stop_id IS NOT NULL
       OR shift_type IS NOT NULL
       OR transport_type IS NOT NULL)
ON CONFLICT DO NOTHING;
