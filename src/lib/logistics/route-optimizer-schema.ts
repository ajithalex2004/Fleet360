/**
 * Lazy schema for the Route Optimizer (Gap #4, Phase 0).
 *
 * Mirrors the shipper-portal/schema.ts pattern: idempotent CREATE TABLEs +
 * ALTERs gated behind a once-per-process promise. Every route-optimizer
 * module (geocoder, distance-matrix, the future solver) calls
 * ensureRouteOptimizerSchema() before its first DB query.
 *
 * What lands:
 *   - logistics_route_plans   — every optimizer run is persisted for audit
 *   - logistics_geocode_cache — Mapbox geocode results cached by address
 *   - ALTERs across vehicles, drivers, logistics_shipment_stops,
 *     logistics_assignments to add the columns the solver depends on
 *
 * Why a separate file (not appended to domain.ts's ensureLogisticsDomainTables):
 *   - Keeps the optimizer's footprint reviewable in isolation
 *   - Lets Phase 1 work proceed even if domain.ts is mid-refactor
 *   - Avoids growing the already-8400-line domain.ts
 */

import { prisma } from '@/lib/prisma';

let ensurePromise: Promise<void> | null = null;

export function ensureRouteOptimizerSchema(): Promise<void> {
  if (!ensurePromise) ensurePromise = run().catch(err => { ensurePromise = null; throw err; });
  return ensurePromise;
}

async function run(): Promise<void> {
  // ── New tables ──────────────────────────────────────────────────────────

  // Every optimize() call writes a row here. Status flows DRAFT → COMMITTED →
  // (optional) DISCARDED. Full inputs and full result are stored as JSONB so
  // we can replay or compare runs without rebuilding the data.
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS logistics_route_plans (
      id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at          TIMESTAMPTZ,
      tenant_id           TEXT NOT NULL,
      created_by          TEXT,
      status              TEXT NOT NULL DEFAULT 'DRAFT',
      algorithm           TEXT NOT NULL,
      config              JSONB,
      input_snapshot      JSONB,
      result              JSONB,
      total_distance_km   NUMERIC(12,2),
      total_duration_min  INTEGER,
      shipments_in        INTEGER,
      shipments_assigned  INTEGER,
      vehicles_used       INTEGER,
      estimated_cost      NUMERIC(15,2),
      committed_at        TIMESTAMPTZ
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_route_plans_tenant_status
      ON logistics_route_plans (tenant_id, status, created_at DESC)
      WHERE deleted_at IS NULL
  `);

  // Geocode cache: Mapbox replies are stable for any given address.
  // Tenant-scoped so a tenant editing their address-book doesn't poison
  // another tenant's cache, but the normalised_address column has a unique
  // constraint within tenant so the same warehouse only gets geocoded once.
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS logistics_geocode_cache (
      id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      tenant_id            TEXT NOT NULL,
      normalised_address   TEXT NOT NULL,
      latitude             NUMERIC(10,7) NOT NULL,
      longitude            NUMERIC(10,7) NOT NULL,
      confidence           NUMERIC(3,2),
      source               TEXT NOT NULL DEFAULT 'mapbox',
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      refreshed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_geocode_cache_tenant_addr
      ON logistics_geocode_cache (tenant_id, normalised_address)
  `);

  // ── ALTERs on existing tables ──────────────────────────────────────────

  // Vehicles: payload (freight) capacity is distinct from `capacity` (which
  // is a passenger-seat count and defaults to 30 on the buses model). Adding
  // dedicated freight columns keeps the optimizer from ever overloading a
  // truck. cost_per_km feeds the route-cost display.
  await Promise.all([
    prisma.$executeRawUnsafe(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS payload_capacity_kg  NUMERIC(10,2)`),
    prisma.$executeRawUnsafe(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS payload_capacity_cbm NUMERIC(10,3)`),
    prisma.$executeRawUnsafe(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS depot_latitude       NUMERIC(10,7)`),
    prisma.$executeRawUnsafe(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS depot_longitude      NUMERIC(10,7)`),
    prisma.$executeRawUnsafe(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS cost_per_km          NUMERIC(8,2)`),
  ]);

  // Drivers: HOS budget. Existing shiftType is a category (MORNING/EVENING),
  // not a window. The optimizer needs actual hours.
  await Promise.all([
    prisma.$executeRawUnsafe(`ALTER TABLE drivers ADD COLUMN IF NOT EXISTS max_drive_hours_per_day NUMERIC(4,2) DEFAULT 10`),
    prisma.$executeRawUnsafe(`ALTER TABLE drivers ADD COLUMN IF NOT EXISTS shift_start_local_time  TIME`),
    prisma.$executeRawUnsafe(`ALTER TABLE drivers ADD COLUMN IF NOT EXISTS shift_end_local_time    TIME`),
  ]);

  // Stops: service duration is the time the driver spends at the stop
  // (loading, paperwork, signature). Critical for VRPTW — without it the
  // solver thinks every stop is instantaneous and produces an impossible
  // schedule. Default 15min picked from observed dispatch logs across UAE
  // operators; can be overridden per-stop.
  // logistics_shipment_stops already has latitude/longitude columns
  // (provisioned in domain.ts but never populated).
  await Promise.all([
    prisma.$executeRawUnsafe(`ALTER TABLE logistics_shipment_stops ADD COLUMN IF NOT EXISTS service_duration_minutes INTEGER DEFAULT 15`),
    prisma.$executeRawUnsafe(`ALTER TABLE logistics_shipment_stops ADD COLUMN IF NOT EXISTS geocode_confidence       NUMERIC(3,2)`),
    prisma.$executeRawUnsafe(`ALTER TABLE logistics_shipment_stops ADD COLUMN IF NOT EXISTS geocoded_at              TIMESTAMPTZ`),
  ]);

  // Assignments: when the operator commits a route plan, we tag each
  // assignment with the plan id + position. Lets dispatch group by plan and
  // lets us undo by setting status back when discarding.
  await Promise.all([
    prisma.$executeRawUnsafe(`ALTER TABLE logistics_assignments ADD COLUMN IF NOT EXISTS route_plan_id     TEXT`),
    prisma.$executeRawUnsafe(`ALTER TABLE logistics_assignments ADD COLUMN IF NOT EXISTS sequence_in_route INTEGER`),
  ]);
}
