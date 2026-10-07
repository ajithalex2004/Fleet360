/**
 * Every module that checks its schema at request time (provisionSchemaOnce),
 * with the tables and columns it needs. The readiness and health checks, and
 * Admin > Schema status, report anything here that is missing from the
 * database (architecture audit A9): a missing table shows up at deploy time,
 * not as a later request failing with "relation does not exist".
 *
 * Add a module here when it starts using provisionSchemaOnce;
 * tests/unit/schema-readiness.test.ts fails if one is left out.
 */
import { findMissingObjects, type SchemaSpec } from '@/lib/db/schema-init';
import { runOutsideRlsScope } from '@/lib/rls-scope';
import { AGENTS_SCHEMA } from '@/lib/agents/schema';
import { BLE_HW_SCHEMA } from '@/lib/assets/ble-hw-schema';
import { ASSETS_SCHEMA } from '@/lib/assets/schema';
import { SPM_SCHEMA } from '@/lib/assets/spm-schema';
import { DISPATCH_SCHEMA } from '@/lib/dispatch/schema';
import { HOS_SCHEMA } from '@/lib/fleet/hos-schema';
import { FLEET_SCHEMA } from '@/lib/fleet/schema';
import { GEOFENCE_SCHEMA } from '@/lib/logistics/geofence-schema';
import { ROUTE_OPTIMIZER_SCHEMA } from '@/lib/logistics/route-optimizer-schema';

export const REQUIRED_SCHEMAS: Readonly<Record<string, SchemaSpec>> = {
  agents: AGENTS_SCHEMA,
  'ble-hw': BLE_HW_SCHEMA,
  assets: ASSETS_SCHEMA,
  spm: SPM_SCHEMA,
  dispatch: DISPATCH_SCHEMA,
  hos: HOS_SCHEMA,
  fleet: FLEET_SCHEMA,
  geofence: GEOFENCE_SCHEMA,
  'route-optimizer': ROUTE_OPTIMIZER_SCHEMA,
};

export interface SchemaReport {
  status: 'ok' | 'incomplete' | 'unknown';
  /** Module → missing tables / table.column. Only modules with something missing. */
  missing: Record<string, string[]>;
  missingCount: number;
  checkedAt: string;
  error?: string;
}

let cached: { report: SchemaReport; at: number } | null = null;
const CACHE_MS = 30_000;

/** Check every module's schema (cached briefly: health and readiness are polled). */
export async function schemaReport(opts: { fresh?: boolean } = {}): Promise<SchemaReport> {
  if (!opts.fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.report;
  const checkedAt = new Date().toISOString();
  let report: SchemaReport;
  try {
    const entries = await runOutsideRlsScope(() => Promise.all(
      Object.entries(REQUIRED_SCHEMAS).map(async ([name, spec]) => [name, await findMissingObjects(spec)] as const),
    ));
    const missing = Object.fromEntries(entries.filter(([, m]) => m.length > 0));
    const missingCount = Object.values(missing).reduce((n, m) => n + m.length, 0);
    report = { status: missingCount ? 'incomplete' : 'ok', missing, missingCount, checkedAt };
  } catch (e) {
    // The database could not be asked; that is the db check's to report.
    report = { status: 'unknown', missing: {}, missingCount: 0, checkedAt, error: e instanceof Error ? e.message : String(e) };
  }
  cached = { report, at: Date.now() };
  return report;
}
