/**
 * Maintenance Type Master (Phase A of the ticket-form data-masters work).
 *
 * A tenant-scoped catalogue of maintenance sub-categories — the third level
 * below Service Configuration's L1 Category and L2 Service Type. Used as a
 * dropdown source on the maintenance ticket creation form so users pick
 * "Engine Repair" / "Brake Service" / "Oil Change" instead of typing free
 * text. Each row carries a default priority and (optionally) a default
 * assignee + estimated hours so the form auto-fills sensible values.
 *
 * Lazy-init pattern matches workflow-db.ts and service-config/schema.ts —
 * the table is created on first access, no Prisma migration needed.
 */

import { prisma } from '@/lib/prisma';

let _ensured = false;

export async function ensureMaintenanceTypesTable(): Promise<void> {
  if (_ensured) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS maintenance_types (
      id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id         TEXT         NOT NULL,
      code              TEXT         NOT NULL,
      name              TEXT         NOT NULL,
      description       TEXT,
      default_priority  TEXT         NOT NULL DEFAULT 'Medium',
      estimated_hours   INTEGER,
      default_assignee  TEXT,
      is_active         BOOLEAN      NOT NULL DEFAULT TRUE,
      sort_order        INTEGER      NOT NULL DEFAULT 0,
      created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      deleted_at        TIMESTAMPTZ,
      UNIQUE (tenant_id, code)
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_maintenance_types_tenant
     ON maintenance_types (tenant_id) WHERE deleted_at IS NULL`,
  );
  _ensured = true;
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface MaintenanceType {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string | null;
  defaultPriority: 'Low' | 'Medium' | 'High';
  estimatedHours: number | null;
  defaultAssignee: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string; tenant_id: string; code: string; name: string;
  description: string | null;
  default_priority: string;
  estimated_hours: number | null;
  default_assignee: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string; updated_at: string;
}

const SELECT = `id::text, tenant_id, code, name, description,
  default_priority, estimated_hours, default_assignee,
  is_active, sort_order,
  created_at::text, updated_at::text`;

function rowToApi(r: Row): MaintenanceType {
  return {
    id: r.id, tenantId: r.tenant_id, code: r.code, name: r.name,
    description: r.description,
    defaultPriority: (r.default_priority as MaintenanceType['defaultPriority']) ?? 'Medium',
    estimatedHours: r.estimated_hours,
    defaultAssignee: r.default_assignee,
    isActive: r.is_active,
    sortOrder: r.sort_order,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

// ── Seed ───────────────────────────────────────────────────────────────────
// Aligned with the legacy maintenance module (src/types/maintenance.ts
// MaintenanceType enum). The 4 entries describe the *nature* of the
// work, not the subsystem — PREVENTIVE / CORRECTIVE / EMERGENCY /
// INSPECTION. The Maintenance Jobs Master (maintenance_jobs table)
// carries the specific work items and references back to a row here via
// maintenance_type_id.
//
// First-touch seed runs once per process per tenant (in-memory cache via
// `_seededTenants`). Idempotent — re-running only inserts missing codes;
// admin edits are preserved via ON CONFLICT DO NOTHING.

const SEED: Array<Omit<MaintenanceType, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>> = [
  { code: 'PREVENTIVE', name: 'Preventive',  description: 'Scheduled servicing to prevent breakdowns — oil change, filter replacement, tyre rotation, inspections.', defaultPriority: 'Low',    estimatedHours: 2, defaultAssignee: null, isActive: true, sortOrder: 10 },
  { code: 'CORRECTIVE', name: 'Corrective',  description: 'Repairs to fix something that is broken — engine, transmission, electrical, body, suspension.',          defaultPriority: 'Medium', estimatedHours: 6, defaultAssignee: null, isActive: true, sortOrder: 20 },
  { code: 'EMERGENCY',  name: 'Emergency',   description: 'Roadside / urgent — breakdown assistance, towing, accident recovery, fuel / lockout service.',           defaultPriority: 'High',   estimatedHours: 3, defaultAssignee: null, isActive: true, sortOrder: 30 },
  { code: 'INSPECTION', name: 'Inspection',  description: 'Compliance and audit checks — annual, safety, emissions, pre-purchase, diagnostic.',                     defaultPriority: 'Low',    estimatedHours: 2, defaultAssignee: null, isActive: true, sortOrder: 40 },
];

/** Codes from the previous generation of this seed (work-category model:
 *  ENGINE / BRAKES / etc.). Soft-deleted on first read so existing dev
 *  tenants converge on the new work-nature taxonomy. */
const LEGACY_OBSOLETE_CODES = [
  'ENGINE', 'BRAKES', 'ELECTRICAL', 'AC', 'BODY',
  'SUSPENSION', 'TIRES', 'OIL_CHANGE', 'DIAGNOSTIC', 'OTHER',
];

const _seededTenants = new Set<string>();

export async function ensureSeededForTenant(tenantId: string): Promise<void> {
  if (_seededTenants.has(tenantId)) return;
  await ensureMaintenanceTypesTable();

  // One-time soft-delete of the old work-category seed so the dropdown
  // doesn't show two parallel taxonomies for tenants that were seeded
  // before this realignment. Soft delete preserves history on any
  // tickets that already referenced the old codes.
  await prisma.$executeRawUnsafe(
    `UPDATE maintenance_types
        SET deleted_at = NOW(), updated_at = NOW(), is_active = FALSE
      WHERE tenant_id = $1
        AND deleted_at IS NULL
        AND code = ANY($2::text[])`,
    tenantId, LEGACY_OBSOLETE_CODES,
  );

  for (const s of SEED) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO maintenance_types
         (tenant_id, code, name, description, default_priority,
          estimated_hours, default_assignee, is_active, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (tenant_id, code) DO NOTHING`,
      tenantId, s.code, s.name, s.description, s.defaultPriority,
      s.estimatedHours, s.defaultAssignee, s.isActive, s.sortOrder,
    );
  }
  _seededTenants.add(tenantId);
}

// ── CRUD ───────────────────────────────────────────────────────────────────

export async function listMaintenanceTypes(
  tenantId: string,
  opts: { activeOnly?: boolean } = {},
): Promise<MaintenanceType[]> {
  await ensureSeededForTenant(tenantId);
  const where = ['tenant_id = $1', 'deleted_at IS NULL'];
  if (opts.activeOnly) where.push('is_active = TRUE');
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT ${SELECT}
       FROM maintenance_types
      WHERE ${where.join(' AND ')}
      ORDER BY sort_order, name`,
    tenantId,
  );
  return rows.map(rowToApi);
}

export async function getMaintenanceType(tenantId: string, id: string): Promise<MaintenanceType | null> {
  await ensureMaintenanceTypesTable();
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT ${SELECT} FROM maintenance_types
      WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL
      LIMIT 1`,
    id, tenantId,
  );
  return rows[0] ? rowToApi(rows[0]) : null;
}

export async function createMaintenanceType(tenantId: string, data: {
  code: string; name: string; description?: string | null;
  defaultPriority?: 'Low' | 'Medium' | 'High';
  estimatedHours?: number | null;
  defaultAssignee?: string | null;
  isActive?: boolean;
  sortOrder?: number;
}): Promise<MaintenanceType> {
  await ensureMaintenanceTypesTable();
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `INSERT INTO maintenance_types
       (tenant_id, code, name, description, default_priority,
        estimated_hours, default_assignee, is_active, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${SELECT}`,
    tenantId, data.code.toUpperCase().trim(), data.name.trim(),
    data.description ?? null,
    data.defaultPriority ?? 'Medium',
    data.estimatedHours ?? null,
    data.defaultAssignee ?? null,
    data.isActive ?? true,
    data.sortOrder ?? 100,
  );
  if (!rows[0]) throw new Error('createMaintenanceType returned no row');
  return rowToApi(rows[0]);
}

export async function updateMaintenanceType(
  tenantId: string,
  id: string,
  patch: Partial<{
    code: string; name: string; description: string | null;
    defaultPriority: 'Low' | 'Medium' | 'High';
    estimatedHours: number | null;
    defaultAssignee: string | null;
    isActive: boolean;
    sortOrder: number;
  }>,
): Promise<MaintenanceType | null> {
  await ensureMaintenanceTypesTable();
  const sets: string[] = [];
  const args: unknown[] = [];
  let p = 1;
  const setIf = (col: string, value: unknown) => {
    if (value === undefined) return;
    sets.push(`${col} = $${p}`); args.push(value); p++;
  };
  if (patch.code !== undefined)            setIf('code',             patch.code.toUpperCase().trim());
  if (patch.name !== undefined)            setIf('name',             patch.name.trim());
  if ('description' in patch)              setIf('description',      patch.description ?? null);
  if (patch.defaultPriority !== undefined) setIf('default_priority', patch.defaultPriority);
  if ('estimatedHours' in patch)           setIf('estimated_hours',  patch.estimatedHours ?? null);
  if ('defaultAssignee' in patch)          setIf('default_assignee', patch.defaultAssignee ?? null);
  if (patch.isActive !== undefined)        setIf('is_active',        patch.isActive);
  if (patch.sortOrder !== undefined)       setIf('sort_order',       patch.sortOrder);
  if (sets.length === 0) return getMaintenanceType(tenantId, id);
  sets.push(`updated_at = NOW()`);
  args.push(id, tenantId);
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `UPDATE maintenance_types SET ${sets.join(', ')}
      WHERE id = $${p}::uuid AND tenant_id = $${p + 1} AND deleted_at IS NULL
      RETURNING ${SELECT}`,
    ...args,
  );
  return rows[0] ? rowToApi(rows[0]) : null;
}

/** Soft delete — preserves historical references on tickets. */
export async function deleteMaintenanceType(tenantId: string, id: string): Promise<boolean> {
  await ensureMaintenanceTypesTable();
  const result = await prisma.$executeRawUnsafe(
    `UPDATE maintenance_types
        SET deleted_at = NOW(), updated_at = NOW(), is_active = FALSE
      WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL`,
    id, tenantId,
  );
  return Number(result) > 0;
}
