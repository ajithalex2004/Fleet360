-- Task 7 — Move bus-ops incidents into the cross-module operations
-- schema and add a moduleSource discriminator so incidents from every
-- module (bus-ops today; school-bus, fleet, leasing later) can share
-- the same table.
--
-- Steps:
--   1. ALTER TABLE public.trip_incidents SET SCHEMA operations
--   2. RENAME to `incidents` (drops the trip_ prefix — it's cross-module now)
--   3. ADD COLUMN module_source TEXT NOT NULL DEFAULT 'BUS_OPS'
--      (existing rows all get BUS_OPS via the default)
--
-- The pre-existing public.incidents table (24 columns, 0 rows) is a
-- separate design that was never wired up — left untouched so it
-- doesn't collide with the new operations.incidents. If it turns out
-- to be truly dead, drop it in a follow-up cleanup PR.
--
-- Consumers updated in the same commit:
--   - src/app/api/incidents/route.ts       raw SQL: trip_incidents → operations.incidents
--   - src/app/api/incidents/[id]/route.ts  raw SQL: trip_incidents → operations.incidents
--   - src/app/api/bus-ops/driver-performance/recompute/route.ts
--                                         raw SQL: FROM trip_incidents → FROM operations.incidents
--
-- Prisma model TripIncident: @@map("trip_incidents") @@schema("public")
-- becomes @@map("incidents") @@schema("operations"); model NAME kept as
-- TripIncident so `prisma.tripIncident.*` callers keep working. Mechanical
-- rename to `Incident` (with the discriminator) is a follow-up.

ALTER TABLE public.trip_incidents SET SCHEMA operations;
ALTER TABLE operations.trip_incidents RENAME TO incidents;
ALTER TABLE operations.incidents ADD COLUMN IF NOT EXISTS module_source TEXT NOT NULL DEFAULT 'BUS_OPS';
CREATE INDEX IF NOT EXISTS idx_operations_incidents_module_source ON operations.incidents (module_source);
CREATE INDEX IF NOT EXISTS idx_operations_incidents_tenant ON operations.incidents (tenant_id);
