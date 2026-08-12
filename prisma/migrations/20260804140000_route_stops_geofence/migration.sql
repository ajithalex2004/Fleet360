-- Migration: 20260804140000_route_stops_geofence
--
-- Add geofence_radius_m to route_stops. The Prisma schema declares this
-- column (RouteStop.geofenceRadiusM @map("geofence_radius_m")) but the
-- actual DB column was never created. /api/bus-ops/routes 500s with
-- "column does not exist" because the generated client selects it.
--
-- Nullable so existing rows don't need a default. The geofence evaluator
-- treats NULL as 100m (see prisma/schema.prisma line 1303 comment).
--
-- Applied directly via docs/apply_route_stops_migration.py — prisma migrate
-- deploy is blocked by the pre-existing failed migration
-- 20260625120000_add_tenant_id_to_dispatch_tables.

ALTER TABLE route_stops
  ADD COLUMN IF NOT EXISTS geofence_radius_m INTEGER;
