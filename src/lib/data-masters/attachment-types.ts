/**
 * Attachment Type Master (Phase A of the ticket-form data-masters work).
 *
 * Replaces the in-memory mock at /maintenance/data-masters/attachment-types
 * with a real tenant-scoped table. Each row classifies a kind of attachment
 * (Invoice, Estimate, Vehicle Photo, …) and optionally:
 *
 *   • applies_to        — restrict the type to certain ticket types so the
 *                         dropdown only offers relevant options. Empty array
 *                         (or NULL) means "applies to every ticket type".
 *   • required          — the attachment-type widget on the form will warn
 *                         when a ticket of an applicable type is submitted
 *                         without one of these.
 *   • allowed_mime      — MIME whitelist; empty array means accept anything.
 *   • max_file_size_mb  — soft cap surfaced in the UI; the upload endpoint
 *                         enforces a hard cap separately.
 *
 * Lazy-init pattern matches workflow-db.ts and the maintenance-types lib.
 */

import { prisma } from '@/lib/prisma';

let _ensured = false;

export async function ensureAttachmentTypesTable(): Promise<void> {
  if (_ensured) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS attachment_types (
      id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id           TEXT         NOT NULL,
      code                TEXT         NOT NULL,
      name                TEXT         NOT NULL,
      description         TEXT,
      applies_to          TEXT[]       NOT NULL DEFAULT '{}',
      required            BOOLEAN      NOT NULL DEFAULT FALSE,
      max_file_size_mb    INTEGER,
      allowed_mime_types  TEXT[]       NOT NULL DEFAULT '{}',
      is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
      sort_order          INTEGER      NOT NULL DEFAULT 0,
      created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      deleted_at          TIMESTAMPTZ,
      UNIQUE (tenant_id, code)
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_attachment_types_tenant
     ON attachment_types (tenant_id) WHERE deleted_at IS NULL`,
  );
  _ensured = true;
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface AttachmentTypeMaster {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string | null;
  appliesTo: string[];
  required: boolean;
  maxFileSizeMb: number | null;
  allowedMimeTypes: string[];
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string; tenant_id: string; code: string; name: string;
  description: string | null;
  applies_to: string[];
  required: boolean;
  max_file_size_mb: number | null;
  allowed_mime_types: string[];
  is_active: boolean;
  sort_order: number;
  created_at: string; updated_at: string;
}

const SELECT = `id::text, tenant_id, code, name, description,
  applies_to, required, max_file_size_mb, allowed_mime_types,
  is_active, sort_order,
  created_at::text, updated_at::text`;

function rowToApi(r: Row): AttachmentTypeMaster {
  return {
    id: r.id, tenantId: r.tenant_id, code: r.code, name: r.name,
    description: r.description,
    appliesTo: r.applies_to ?? [],
    required: r.required,
    maxFileSizeMb: r.max_file_size_mb,
    allowedMimeTypes: r.allowed_mime_types ?? [],
    isActive: r.is_active,
    sortOrder: r.sort_order,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

// ── Seed ───────────────────────────────────────────────────────────────────
// Seeds the existing AttachmentType enum values on first read for a tenant
// so day-one behaviour matches the previous mock. Idempotent — admin edits
// are preserved (ON CONFLICT DO NOTHING).

const SEED: Array<Omit<AttachmentTypeMaster, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>> = [
  { code: 'INVOICE',           name: 'Invoice',           description: 'Vendor or garage invoice',                     appliesTo: ['MAINTENANCE','TOWING'],  required: false, maxFileSizeMb: 10, allowedMimeTypes: ['application/pdf','image/*'], isActive: true, sortOrder: 10 },
  { code: 'QUOTATION',         name: 'Quotation',         description: 'Quotation from garage or supplier',            appliesTo: ['MAINTENANCE'],           required: false, maxFileSizeMb: 10, allowedMimeTypes: ['application/pdf','image/*'], isActive: true, sortOrder: 20 },
  { code: 'ESTIMATE',          name: 'Estimate',          description: 'Cost estimate before approval',                appliesTo: ['MAINTENANCE'],           required: false, maxFileSizeMb: 10, allowedMimeTypes: ['application/pdf','image/*'], isActive: true, sortOrder: 30 },
  { code: 'APPROVED_ESTIMATE', name: 'Approved Estimate', description: 'Estimate signed off by approver',              appliesTo: ['MAINTENANCE'],           required: false, maxFileSizeMb: 10, allowedMimeTypes: ['application/pdf','image/*'], isActive: true, sortOrder: 40 },
  { code: 'WORK_ORDER',        name: 'Work Order',        description: 'Workshop work order',                          appliesTo: ['MAINTENANCE'],           required: false, maxFileSizeMb: 10, allowedMimeTypes: ['application/pdf','image/*'], isActive: true, sortOrder: 50 },
  { code: 'REPORT',            name: 'Report',            description: 'Inspection or service report',                 appliesTo: [],                        required: false, maxFileSizeMb: 10, allowedMimeTypes: ['application/pdf','image/*'], isActive: true, sortOrder: 60 },
  { code: 'IMAGE',             name: 'Photo',             description: 'Vehicle photo or damage image',                appliesTo: [],                        required: false, maxFileSizeMb: 10, allowedMimeTypes: ['image/*'],                   isActive: true, sortOrder: 70 },
  { code: 'OTHER',             name: 'Other',             description: 'Any document not covered by another category', appliesTo: [],                        required: false, maxFileSizeMb: 10, allowedMimeTypes: [],                            isActive: true, sortOrder: 999 },
];

const _seededTenants = new Set<string>();

export async function ensureSeededForTenant(tenantId: string): Promise<void> {
  if (_seededTenants.has(tenantId)) return;
  await ensureAttachmentTypesTable();
  for (const s of SEED) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO attachment_types
         (tenant_id, code, name, description, applies_to, required,
          max_file_size_mb, allowed_mime_types, is_active, sort_order)
       VALUES ($1,$2,$3,$4,$5::text[],$6,$7,$8::text[],$9,$10)
       ON CONFLICT (tenant_id, code) DO NOTHING`,
      tenantId, s.code, s.name, s.description, s.appliesTo, s.required,
      s.maxFileSizeMb, s.allowedMimeTypes, s.isActive, s.sortOrder,
    );
  }
  _seededTenants.add(tenantId);
}

// ── CRUD ───────────────────────────────────────────────────────────────────

export async function listAttachmentTypes(
  tenantId: string,
  opts: { activeOnly?: boolean; appliesTo?: string } = {},
): Promise<AttachmentTypeMaster[]> {
  await ensureSeededForTenant(tenantId);
  const where = ['tenant_id = $1', 'deleted_at IS NULL'];
  const args: unknown[] = [tenantId];
  if (opts.activeOnly) where.push('is_active = TRUE');
  // applies_to filter: row matches when its applies_to is empty (universal)
  // OR contains the requested ticket type. Keeps the query DB-side cheap.
  if (opts.appliesTo) {
    args.push(opts.appliesTo);
    where.push(`(cardinality(applies_to) = 0 OR $${args.length} = ANY(applies_to))`);
  }
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT ${SELECT}
       FROM attachment_types
      WHERE ${where.join(' AND ')}
      ORDER BY sort_order, name`,
    ...args,
  );
  return rows.map(rowToApi);
}

export async function getAttachmentType(tenantId: string, id: string): Promise<AttachmentTypeMaster | null> {
  await ensureAttachmentTypesTable();
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT ${SELECT} FROM attachment_types
      WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL
      LIMIT 1`,
    id, tenantId,
  );
  return rows[0] ? rowToApi(rows[0]) : null;
}

export async function createAttachmentType(tenantId: string, data: {
  code: string; name: string; description?: string | null;
  appliesTo?: string[];
  required?: boolean;
  maxFileSizeMb?: number | null;
  allowedMimeTypes?: string[];
  isActive?: boolean;
  sortOrder?: number;
}): Promise<AttachmentTypeMaster> {
  await ensureAttachmentTypesTable();
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `INSERT INTO attachment_types
       (tenant_id, code, name, description, applies_to, required,
        max_file_size_mb, allowed_mime_types, is_active, sort_order)
     VALUES ($1, $2, $3, $4, $5::text[], $6, $7, $8::text[], $9, $10)
     RETURNING ${SELECT}`,
    tenantId, data.code.toUpperCase().trim(), data.name.trim(),
    data.description ?? null,
    data.appliesTo ?? [],
    data.required ?? false,
    data.maxFileSizeMb ?? null,
    data.allowedMimeTypes ?? [],
    data.isActive ?? true,
    data.sortOrder ?? 100,
  );
  if (!rows[0]) throw new Error('createAttachmentType returned no row');
  return rowToApi(rows[0]);
}

export async function updateAttachmentType(
  tenantId: string,
  id: string,
  patch: Partial<{
    code: string; name: string; description: string | null;
    appliesTo: string[];
    required: boolean;
    maxFileSizeMb: number | null;
    allowedMimeTypes: string[];
    isActive: boolean;
    sortOrder: number;
  }>,
): Promise<AttachmentTypeMaster | null> {
  await ensureAttachmentTypesTable();
  const sets: string[] = [];
  const args: unknown[] = [];
  let p = 1;
  const setIf = (col: string, value: unknown, cast = '') => {
    if (value === undefined) return;
    sets.push(`${col} = $${p}${cast}`); args.push(value); p++;
  };
  if (patch.code !== undefined)             setIf('code',                patch.code.toUpperCase().trim());
  if (patch.name !== undefined)             setIf('name',                patch.name.trim());
  if ('description' in patch)               setIf('description',         patch.description ?? null);
  if (patch.appliesTo !== undefined)        setIf('applies_to',          patch.appliesTo, '::text[]');
  if (patch.required !== undefined)         setIf('required',            patch.required);
  if ('maxFileSizeMb' in patch)             setIf('max_file_size_mb',    patch.maxFileSizeMb ?? null);
  if (patch.allowedMimeTypes !== undefined) setIf('allowed_mime_types',  patch.allowedMimeTypes, '::text[]');
  if (patch.isActive !== undefined)         setIf('is_active',           patch.isActive);
  if (patch.sortOrder !== undefined)        setIf('sort_order',          patch.sortOrder);
  if (sets.length === 0) return getAttachmentType(tenantId, id);
  sets.push(`updated_at = NOW()`);
  args.push(id, tenantId);
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `UPDATE attachment_types SET ${sets.join(', ')}
      WHERE id = $${p}::uuid AND tenant_id = $${p + 1} AND deleted_at IS NULL
      RETURNING ${SELECT}`,
    ...args,
  );
  return rows[0] ? rowToApi(rows[0]) : null;
}

/** Soft delete — preserves historical references on tickets. */
export async function deleteAttachmentType(tenantId: string, id: string): Promise<boolean> {
  await ensureAttachmentTypesTable();
  const result = await prisma.$executeRawUnsafe(
    `UPDATE attachment_types
        SET deleted_at = NOW(), updated_at = NOW(), is_active = FALSE
      WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL`,
    id, tenantId,
  );
  return Number(result) > 0;
}
