/**
 * Maintenance Jobs Master.
 *
 * Tenant-scoped catalogue of specific maintenance work items, each linked
 * to a parent Maintenance Type (PREVENTIVE / CORRECTIVE / EMERGENCY /
 * INSPECTION). Replaces the hardcoded MAINTENANCE_JOBS_DATABASE constant
 * that previously lived in /maintenance/create — now data, editable per
 * tenant via the admin UI without a code release.
 *
 *   Maintenance Type   ──many──▶   Maintenance Job
 *   PREVENTIVE                     Oil Change
 *                                  Oil Filter Replacement
 *                                  Tire Rotation
 *                                  …
 *
 * Same lazy-init pattern as maintenance-types.ts: table is created on
 * first access, idempotent first-touch seed of 94 jobs imported verbatim
 * from the legacy MAINTENANCE_JOBS_DATABASE so /maintenance/create can
 * later be migrated to read from this table without UX regression.
 */

import { prisma } from '@/lib/prisma';
import {
  ensureMaintenanceTypesTable,
  ensureSeededForTenant as ensureMaintenanceTypesSeededForTenant,
} from './maintenance-types';

let _ensured = false;

export async function ensureMaintenanceJobsTable(): Promise<void> {
  if (_ensured) return;
  // Make sure the parent table exists first so the FK lookup below has
  // something to JOIN against on the very first call.
  await ensureMaintenanceTypesTable();
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS maintenance_jobs (
      id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id             TEXT         NOT NULL,
      maintenance_type_id   UUID         NOT NULL,
      code                  TEXT         NOT NULL,
      name                  TEXT         NOT NULL,
      description           TEXT,
      estimated_hours       NUMERIC,
      is_active             BOOLEAN      NOT NULL DEFAULT TRUE,
      sort_order            INTEGER      NOT NULL DEFAULT 0,
      created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      deleted_at            TIMESTAMPTZ,
      UNIQUE (tenant_id, maintenance_type_id, code)
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_maintenance_jobs_tenant
     ON maintenance_jobs (tenant_id) WHERE deleted_at IS NULL`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_maintenance_jobs_type
     ON maintenance_jobs (maintenance_type_id) WHERE deleted_at IS NULL`,
  );
  _ensured = true;
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface MaintenanceJob {
  id: string;
  tenantId: string;
  maintenanceTypeId: string;
  code: string;
  name: string;
  description: string | null;
  estimatedHours: number | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  /** Joined fields — present when listMaintenanceJobs is called without
   *  a typeId filter so the admin UI can group by type without a second
   *  fetch. */
  maintenanceTypeCode?: string;
  maintenanceTypeName?: string;
}

interface Row {
  id: string; tenant_id: string;
  maintenance_type_id: string;
  code: string; name: string;
  description: string | null;
  estimated_hours: number | null;
  is_active: boolean;
  sort_order: number;
  created_at: string; updated_at: string;
  // Optional join fields
  type_code?: string;
  type_name?: string;
}

const SELECT = `mj.id::text, mj.tenant_id,
  mj.maintenance_type_id::text AS maintenance_type_id,
  mj.code, mj.name, mj.description, mj.estimated_hours,
  mj.is_active, mj.sort_order,
  mj.created_at::text, mj.updated_at::text,
  mt.code AS type_code, mt.name AS type_name`;

function rowToApi(r: Row): MaintenanceJob {
  return {
    id: r.id, tenantId: r.tenant_id,
    maintenanceTypeId: r.maintenance_type_id,
    code: r.code, name: r.name,
    description: r.description,
    estimatedHours: r.estimated_hours != null ? Number(r.estimated_hours) : null,
    isActive: r.is_active,
    sortOrder: r.sort_order,
    createdAt: r.created_at, updatedAt: r.updated_at,
    maintenanceTypeCode: r.type_code,
    maintenanceTypeName: r.type_name,
  };
}

// ── Seed ───────────────────────────────────────────────────────────────────
// Verbatim port of MAINTENANCE_JOBS_DATABASE from src/app/maintenance/
// create/page.tsx. The legacy hardcoded constant is preserved here so the
// /maintenance/create page can be migrated to read from this table
// without UX regression. Codes are auto-derived from names so the
// existing string values stored in MaintenanceRequest.maintenanceJobs[]
// remain searchable.
//
// Some names appear under multiple types (e.g. "Battery Replacement" is
// in both CORRECTIVE and EMERGENCY). The (tenant_id, type_id, code)
// unique constraint accommodates this — they're distinct rows because
// they may carry different estimated_hours per workflow.

interface SeedJob { name: string; estimatedHours?: number; sortOrder: number }

const SEED_BY_TYPE: Record<string, SeedJob[]> = {
  PREVENTIVE: [
    { name: 'Oil Change',                      estimatedHours: 0.5, sortOrder: 10  },
    { name: 'Oil Filter Replacement',          estimatedHours: 0.5, sortOrder: 20  },
    { name: 'Air Filter Replacement',          estimatedHours: 0.3, sortOrder: 30  },
    { name: 'Cabin Filter Replacement',        estimatedHours: 0.3, sortOrder: 40  },
    { name: 'Fuel Filter Replacement',         estimatedHours: 0.5, sortOrder: 50  },
    { name: 'Tire Rotation',                   estimatedHours: 0.5, sortOrder: 60  },
    { name: 'Tire Pressure Check',             estimatedHours: 0.2, sortOrder: 70  },
    { name: 'Brake Inspection',                estimatedHours: 0.5, sortOrder: 80  },
    { name: 'Brake Pad Replacement',           estimatedHours: 1.5, sortOrder: 90  },
    { name: 'Brake Fluid Change',              estimatedHours: 0.5, sortOrder: 100 },
    { name: 'Coolant Flush',                   estimatedHours: 1,   sortOrder: 110 },
    { name: 'Transmission Fluid Change',       estimatedHours: 1,   sortOrder: 120 },
    { name: 'Power Steering Fluid Check',      estimatedHours: 0.3, sortOrder: 130 },
    { name: 'Battery Check',                   estimatedHours: 0.3, sortOrder: 140 },
    { name: 'Spark Plug Replacement',          estimatedHours: 1,   sortOrder: 150 },
    { name: 'Timing Belt Replacement',         estimatedHours: 4,   sortOrder: 160 },
    { name: 'Serpentine Belt Replacement',     estimatedHours: 1,   sortOrder: 170 },
    { name: 'Wiper Blade Replacement',         estimatedHours: 0.2, sortOrder: 180 },
    { name: 'Headlight Alignment',             estimatedHours: 0.5, sortOrder: 190 },
    { name: 'Wheel Alignment',                 estimatedHours: 1,   sortOrder: 200 },
    { name: 'Wheel Balancing',                 estimatedHours: 1,   sortOrder: 210 },
  ],
  CORRECTIVE: [
    { name: 'Engine Repair',                   estimatedHours: 8,   sortOrder: 10  },
    { name: 'Engine Overhaul',                 estimatedHours: 24,  sortOrder: 20  },
    { name: 'Cylinder Head Repair',            estimatedHours: 12,  sortOrder: 30  },
    { name: 'Piston Replacement',              estimatedHours: 16,  sortOrder: 40  },
    { name: 'Valve Adjustment',                estimatedHours: 4,   sortOrder: 50  },
    { name: 'Timing Chain Replacement',        estimatedHours: 6,   sortOrder: 60  },
    { name: 'Transmission Repair',             estimatedHours: 8,   sortOrder: 70  },
    { name: 'Transmission Rebuild',            estimatedHours: 24,  sortOrder: 80  },
    { name: 'Clutch Replacement',              estimatedHours: 6,   sortOrder: 90  },
    { name: 'Gearbox Repair',                  estimatedHours: 8,   sortOrder: 100 },
    { name: 'Differential Repair',             estimatedHours: 6,   sortOrder: 110 },
    { name: 'Suspension Repair',               estimatedHours: 4,   sortOrder: 120 },
    { name: 'Shock Absorber Replacement',      estimatedHours: 2,   sortOrder: 130 },
    { name: 'Strut Replacement',               estimatedHours: 3,   sortOrder: 140 },
    { name: 'Control Arm Replacement',         estimatedHours: 3,   sortOrder: 150 },
    { name: 'Ball Joint Replacement',          estimatedHours: 2,   sortOrder: 160 },
    { name: 'Tie Rod Replacement',             estimatedHours: 2,   sortOrder: 170 },
    { name: 'Brake System Repair',             estimatedHours: 4,   sortOrder: 180 },
    { name: 'Brake Caliper Replacement',       estimatedHours: 2,   sortOrder: 190 },
    { name: 'Brake Rotor Replacement',         estimatedHours: 2,   sortOrder: 200 },
    { name: 'ABS System Repair',               estimatedHours: 4,   sortOrder: 210 },
    { name: 'Electrical System Repair',        estimatedHours: 4,   sortOrder: 220 },
    { name: 'Alternator Replacement',          estimatedHours: 2,   sortOrder: 230 },
    { name: 'Starter Motor Replacement',       estimatedHours: 2,   sortOrder: 240 },
    { name: 'Battery Replacement',             estimatedHours: 0.5, sortOrder: 250 },
    { name: 'Wiring Harness Repair',           estimatedHours: 6,   sortOrder: 260 },
    { name: 'Fuel Pump Replacement',           estimatedHours: 3,   sortOrder: 270 },
    { name: 'Fuel Injector Cleaning',          estimatedHours: 2,   sortOrder: 280 },
    { name: 'Radiator Repair',                 estimatedHours: 3,   sortOrder: 290 },
    { name: 'Water Pump Replacement',          estimatedHours: 3,   sortOrder: 300 },
    { name: 'Thermostat Replacement',          estimatedHours: 1,   sortOrder: 310 },
    { name: 'AC Compressor Replacement',       estimatedHours: 4,   sortOrder: 320 },
    { name: 'AC Condenser Replacement',        estimatedHours: 2,   sortOrder: 330 },
    { name: 'Heater Core Replacement',         estimatedHours: 6,   sortOrder: 340 },
    { name: 'Exhaust System Repair',           estimatedHours: 3,   sortOrder: 350 },
    { name: 'Muffler Replacement',             estimatedHours: 1,   sortOrder: 360 },
    { name: 'Catalytic Converter Replacement', estimatedHours: 3,   sortOrder: 370 },
    { name: 'Body Work',                       estimatedHours: 8,   sortOrder: 380 },
    { name: 'Dent Removal',                    estimatedHours: 2,   sortOrder: 390 },
    { name: 'Paint Touch-up',                  estimatedHours: 2,   sortOrder: 400 },
    { name: 'Bumper Replacement',              estimatedHours: 2,   sortOrder: 410 },
    { name: 'Windshield Replacement',          estimatedHours: 2,   sortOrder: 420 },
    { name: 'Door Panel Replacement',          estimatedHours: 3,   sortOrder: 430 },
    { name: 'Upholstery Repair',               estimatedHours: 4,   sortOrder: 440 },
  ],
  EMERGENCY: [
    { name: 'Breakdown Assistance',            estimatedHours: 1,   sortOrder: 10  },
    { name: 'Towing Service',                  estimatedHours: 1,   sortOrder: 20  },
    { name: 'Flat Tire Repair',                estimatedHours: 0.5, sortOrder: 30  },
    { name: 'Tire Replacement',                estimatedHours: 1,   sortOrder: 40  },
    { name: 'Battery Jump Start',              estimatedHours: 0.3, sortOrder: 50  },
    { name: 'Battery Replacement',             estimatedHours: 0.5, sortOrder: 60  },
    { name: 'Fuel Delivery',                   estimatedHours: 0.5, sortOrder: 70  },
    { name: 'Lockout Service',                 estimatedHours: 0.5, sortOrder: 80  },
    { name: 'Accident Recovery',               estimatedHours: 2,   sortOrder: 90  },
    { name: 'Engine Overheating',              estimatedHours: 2,   sortOrder: 100 },
    { name: 'Coolant Leak Repair',             estimatedHours: 2,   sortOrder: 110 },
    { name: 'Oil Leak Repair',                 estimatedHours: 2,   sortOrder: 120 },
    { name: 'Brake Failure Repair',            estimatedHours: 3,   sortOrder: 130 },
    { name: 'Steering Failure Repair',         estimatedHours: 3,   sortOrder: 140 },
    { name: 'Electrical Failure Repair',       estimatedHours: 3,   sortOrder: 150 },
  ],
  INSPECTION: [
    { name: 'Annual Inspection',               estimatedHours: 1,   sortOrder: 10  },
    { name: 'Pre-Purchase Inspection',         estimatedHours: 2,   sortOrder: 20  },
    { name: 'Safety Inspection',               estimatedHours: 1,   sortOrder: 30  },
    { name: 'Emissions Test',                  estimatedHours: 0.5, sortOrder: 40  },
    { name: 'Brake System Inspection',         estimatedHours: 0.5, sortOrder: 50  },
    { name: 'Suspension Inspection',           estimatedHours: 0.5, sortOrder: 60  },
    { name: 'Tire Inspection',                 estimatedHours: 0.3, sortOrder: 70  },
    { name: 'Exhaust System Inspection',       estimatedHours: 0.5, sortOrder: 80  },
    { name: 'Electrical System Inspection',    estimatedHours: 1,   sortOrder: 90  },
    { name: 'Engine Diagnostic',               estimatedHours: 1,   sortOrder: 100 },
    { name: 'Transmission Diagnostic',         estimatedHours: 1,   sortOrder: 110 },
    { name: 'AC System Inspection',            estimatedHours: 0.5, sortOrder: 120 },
    { name: 'Fluid Level Check',               estimatedHours: 0.3, sortOrder: 130 },
    { name: 'Belt and Hose Inspection',        estimatedHours: 0.3, sortOrder: 140 },
  ],
};

/** Auto-derive a stable code from a job name. "Oil Change" → "OIL_CHANGE". */
function nameToCode(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')   // non-alphanumeric → underscore
    .replace(/^_+|_+$/g, '')       // trim leading / trailing underscores
    .replace(/__+/g, '_');         // collapse runs
}

const _seededTenants = new Set<string>();

/**
 * Seed the catalogue for a tenant. Idempotent — only inserts rows whose
 * (tenant, type, code) tuple isn't already present. Admin edits and
 * deletes are preserved across re-seeds.
 *
 * Called transparently from listMaintenanceJobs on first read for a
 * tenant — admins don't need to trigger anything.
 */
export async function ensureSeededForTenant(tenantId: string): Promise<void> {
  if (_seededTenants.has(tenantId)) return;
  await ensureMaintenanceJobsTable();
  await ensureMaintenanceTypesSeededForTenant(tenantId);

  // Resolve maintenance_type rows for this tenant so we can FK-link.
  const typeRows = await prisma.$queryRawUnsafe<Array<{ id: string; code: string }>>(
    `SELECT id::text AS id, code
       FROM maintenance_types
      WHERE tenant_id = $1 AND deleted_at IS NULL`,
    tenantId,
  );
  if (typeRows.length === 0) {
    // Maintenance types not seeded yet — bail silently. The next call
    // will retry once the parent table is populated.
    return;
  }
  const idByCode = new Map(typeRows.map(t => [t.code, t.id]));

  for (const [typeCode, jobs] of Object.entries(SEED_BY_TYPE)) {
    const typeId = idByCode.get(typeCode);
    if (!typeId) continue; // Type was renamed or removed by admin
    for (const j of jobs) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO maintenance_jobs
           (tenant_id, maintenance_type_id, code, name, description,
            estimated_hours, is_active, sort_order)
         VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (tenant_id, maintenance_type_id, code) DO NOTHING`,
        tenantId, typeId, nameToCode(j.name), j.name, null,
        j.estimatedHours ?? null, true, j.sortOrder,
      );
    }
  }
  _seededTenants.add(tenantId);
}

// ── CRUD ───────────────────────────────────────────────────────────────────

export async function listMaintenanceJobs(
  tenantId: string,
  opts: {
    activeOnly?: boolean;
    /** Filter to a single parent type — used by the ticket form to show
     *  only the jobs that apply once the user has picked a type. */
    maintenanceTypeId?: string;
  } = {},
): Promise<MaintenanceJob[]> {
  await ensureSeededForTenant(tenantId);
  const where = ['mj.tenant_id = $1', 'mj.deleted_at IS NULL'];
  const args: unknown[] = [tenantId];
  if (opts.activeOnly) where.push('mj.is_active = TRUE');
  if (opts.maintenanceTypeId) {
    args.push(opts.maintenanceTypeId);
    where.push(`mj.maintenance_type_id = $${args.length}::uuid`);
  }
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT ${SELECT}
       FROM maintenance_jobs mj
       LEFT JOIN maintenance_types mt ON mt.id = mj.maintenance_type_id
      WHERE ${where.join(' AND ')}
      ORDER BY mt.sort_order NULLS LAST, mt.name, mj.sort_order, mj.name`,
    ...args,
  );
  return rows.map(rowToApi);
}

export async function getMaintenanceJob(tenantId: string, id: string): Promise<MaintenanceJob | null> {
  await ensureMaintenanceJobsTable();
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT ${SELECT}
       FROM maintenance_jobs mj
       LEFT JOIN maintenance_types mt ON mt.id = mj.maintenance_type_id
      WHERE mj.id = $1::uuid AND mj.tenant_id = $2 AND mj.deleted_at IS NULL
      LIMIT 1`,
    id, tenantId,
  );
  return rows[0] ? rowToApi(rows[0]) : null;
}

export async function createMaintenanceJob(tenantId: string, data: {
  maintenanceTypeId: string;
  code: string; name: string;
  description?: string | null;
  estimatedHours?: number | null;
  isActive?: boolean;
  sortOrder?: number;
}): Promise<MaintenanceJob> {
  await ensureMaintenanceJobsTable();
  // Validate the FK — soft FK at the DB level, app enforces.
  const parent = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id::text FROM maintenance_types
      WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL`,
    data.maintenanceTypeId, tenantId,
  );
  if (!parent[0]) throw new Error('Parent maintenance type not found.');

  await prisma.$executeRawUnsafe(
    `INSERT INTO maintenance_jobs
       (tenant_id, maintenance_type_id, code, name, description,
        estimated_hours, is_active, sort_order)
     VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8)`,
    tenantId, data.maintenanceTypeId,
    data.code.toUpperCase().trim(), data.name.trim(),
    data.description ?? null,
    data.estimatedHours ?? null,
    data.isActive ?? true,
    data.sortOrder ?? 100,
  );
  // Re-read to get the joined fields for the response.
  const row = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT ${SELECT}
       FROM maintenance_jobs mj
       LEFT JOIN maintenance_types mt ON mt.id = mj.maintenance_type_id
      WHERE mj.tenant_id = $1
        AND mj.maintenance_type_id = $2::uuid
        AND mj.code = $3
      ORDER BY mj.created_at DESC LIMIT 1`,
    tenantId, data.maintenanceTypeId, data.code.toUpperCase().trim(),
  );
  if (!row[0]) throw new Error('createMaintenanceJob returned no row');
  return rowToApi(row[0]);
}

export async function updateMaintenanceJob(
  tenantId: string,
  id: string,
  patch: Partial<{
    maintenanceTypeId: string;
    code: string; name: string;
    description: string | null;
    estimatedHours: number | null;
    isActive: boolean;
    sortOrder: number;
  }>,
): Promise<MaintenanceJob | null> {
  await ensureMaintenanceJobsTable();
  const sets: string[] = [];
  const args: unknown[] = [];
  let p = 1;
  const setIf = (col: string, value: unknown, cast = '') => {
    if (value === undefined) return;
    sets.push(`${col} = $${p}${cast}`); args.push(value); p++;
  };
  if (patch.maintenanceTypeId !== undefined) setIf('maintenance_type_id', patch.maintenanceTypeId, '::uuid');
  if (patch.code !== undefined)              setIf('code',                patch.code.toUpperCase().trim());
  if (patch.name !== undefined)              setIf('name',                patch.name.trim());
  if ('description' in patch)                setIf('description',         patch.description ?? null);
  if ('estimatedHours' in patch)             setIf('estimated_hours',     patch.estimatedHours ?? null);
  if (patch.isActive !== undefined)          setIf('is_active',           patch.isActive);
  if (patch.sortOrder !== undefined)         setIf('sort_order',          patch.sortOrder);
  if (sets.length === 0) return getMaintenanceJob(tenantId, id);
  sets.push(`updated_at = NOW()`);
  args.push(id, tenantId);
  await prisma.$executeRawUnsafe(
    `UPDATE maintenance_jobs SET ${sets.join(', ')}
      WHERE id = $${p}::uuid AND tenant_id = $${p + 1} AND deleted_at IS NULL`,
    ...args,
  );
  return getMaintenanceJob(tenantId, id);
}

/** Soft delete — historical references on tickets are preserved. */
export async function deleteMaintenanceJob(tenantId: string, id: string): Promise<boolean> {
  await ensureMaintenanceJobsTable();
  const result = await prisma.$executeRawUnsafe(
    `UPDATE maintenance_jobs
        SET deleted_at = NOW(), updated_at = NOW(), is_active = FALSE
      WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL`,
    id, tenantId,
  );
  return Number(result) > 0;
}
