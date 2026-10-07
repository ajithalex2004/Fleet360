/**
 * Lazy schema for geofencing (Gap #5).
 *
 * Adds a per-stop geofence radius so operators can widen/tighten the
 * arrival zone for a specific site (a sprawling port needs a bigger radius
 * than a single loading dock). Default 200m if unset.
 *
 * logistics_shipment_stops already has latitude/longitude (populated by the
 * route-optimizer geocoding work) — that's the geofence centre.
 */

import { prisma } from '@/lib/prisma';
import { provisionSchemaOnce, type SchemaSpec } from '@/lib/db/schema-init';

// Runs no DDL where the column exists; see provisionSchemaOnce.
/** Tables/columns this module needs; checked by the schema readiness report. */
export const GEOFENCE_SCHEMA: SchemaSpec = {
    tables: [],
    columns: [['logistics_shipment_stops', 'geofence_radius_m']],
  };

export function ensureGeofenceSchema(): Promise<void> {
  return provisionSchemaOnce('geofence', GEOFENCE_SCHEMA, run);
}

async function run(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `ALTER TABLE logistics_shipment_stops ADD COLUMN IF NOT EXISTS geofence_radius_m INTEGER`,
  );
}
