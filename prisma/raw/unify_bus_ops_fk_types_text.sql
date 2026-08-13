-- Architectural risk #2 (scoped fix) — unify bus-ops FK column types to
-- TEXT to match the canonical `id` columns of the tables they reference.
--
-- Root cause: Prisma's `String @id @default(uuid())` produces `text` (not
-- `uuid`) unless `@db.Uuid` is opted in. Every canonical id in the tree
-- is TEXT (bus_routes.id, trip_schedules.id, vehicles.id, drivers.id —
-- verified via information_schema). But some raw-SQL DDL authored during
-- this session used `UUID` for FK columns, producing type mismatches
-- that force `::text` casts on every join and prevent real FK
-- constraints from being declared.
--
-- Fixes bus-ops-owned tables only:
--   bus_ops_vehicle_positions.route_id  UUID → TEXT
--   bus_ops_vehicle_positions.trip_id   UUID → TEXT
--   bus_ops_schedule_templates.route_id UUID → TEXT
--
-- Safe: both tables have 0 rows in this env.
--
-- Follow-up (out of scope for this commit): 20+ additional tables
-- across school-bus, dispatch, driver-reports, HOS, leasing, rental,
-- warranties, insurance, etc. share the same mismatch and need the
-- same treatment. Codebase-wide UUID/TEXT unification epic will pick
-- a canonical (recommend TEXT — matches Prisma default, no cast at
-- ORM boundary) and alter every mismatched column.

ALTER TABLE bus_ops_vehicle_positions
  ALTER COLUMN route_id TYPE TEXT USING route_id::text,
  ALTER COLUMN trip_id  TYPE TEXT USING trip_id::text;

ALTER TABLE bus_ops_schedule_templates
  ALTER COLUMN route_id TYPE TEXT USING route_id::text;
