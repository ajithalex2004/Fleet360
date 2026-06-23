import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminPermission, resolveTenantBoundary } from '@/lib/admin-policy';
import { recordAdminChange } from '@/lib/admin-change-history';

// ---------------------------------------------------------------------------
// UAE Emirates
// ---------------------------------------------------------------------------
export const UAE_EMIRATES = [
  'ABU_DHABI', 'DUBAI', 'SHARJAH', 'AJMAN',
  'UMM_AL_QUWAIN', 'RAS_AL_KHAIMAH', 'FUJAIRAH',
];

export const EMIRATE_LABELS: Record<string, string> = {
  ABU_DHABI:      'Abu Dhabi',
  DUBAI:          'Dubai',
  SHARJAH:        'Sharjah',
  AJMAN:          'Ajman',
  UMM_AL_QUWAIN: 'Umm Al Quwain',
  RAS_AL_KHAIMAH: 'Ras Al Khaimah',
  FUJAIRAH:       'Fujairah',
};

export const LICENSE_AUTHORITIES: Record<string, string[]> = {
  ABU_DHABI:      ['ADDED', 'ADCCI', 'ADGM', 'twofour54'],
  DUBAI:          ['DED Dubai', 'DIFC', 'JAFZA', 'DAFZA', 'DMCC'],
  SHARJAH:        ['Sharjah DED', 'SHAMS', 'SAIF Zone'],
  AJMAN:          ['Ajman DED', 'Ajman Free Zone'],
  UMM_AL_QUWAIN: ['UAQ DED', 'UAQ Free Trade Zone'],
  RAS_AL_KHAIMAH: ['RAKEZ', 'RAK DED'],
  FUJAIRAH:       ['Fujairah DED', 'FFZA'],
};

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
async function ensureTable() {
  // Core table — must succeed
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS tenant_branches (
      id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id                TEXT NOT NULL,
      branch_name              TEXT NOT NULL,
      emirate                  TEXT NOT NULL DEFAULT 'DUBAI',
      trade_license_no         TEXT,
      trade_license_authority  TEXT,
      trade_license_expiry     DATE,
      billing_address          TEXT,
      billing_city             TEXT,
      billing_po_box           TEXT,
      contact_name             TEXT,
      contact_email            TEXT,
      contact_phone            TEXT,
      cost_center_code         TEXT,
      is_default               BOOLEAN NOT NULL DEFAULT FALSE,
      is_active                BOOLEAN NOT NULL DEFAULT TRUE,
      notes                    TEXT,
      created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at               TIMESTAMPTZ
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_tenant_branches_tenant ON tenant_branches(tenant_id) WHERE deleted_at IS NULL
  `).catch(() => {});

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_tenant_branches_emirate ON tenant_branches(emirate) WHERE deleted_at IS NULL
  `).catch(() => {});

  // Add trn column to tenants if it doesn't exist yet
  await prisma.$executeRawUnsafe(`
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trn TEXT
  `).catch(() => {});

  // Add branch_id to finance_invoices if missing
  await prisma.$executeRawUnsafe(`
    ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES tenant_branches(id) ON DELETE SET NULL
  `).catch(() => {});
  await prisma.$executeRawUnsafe(`
    ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS branch_name TEXT
  `).catch(() => {});
  await prisma.$executeRawUnsafe(`
    ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS branch_trade_license TEXT
  `).catch(() => {});
  await prisma.$executeRawUnsafe(`
    ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS branch_address TEXT
  `).catch(() => {});
  await prisma.$executeRawUnsafe(`
    ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS tenant_id TEXT
  `).catch(() => {});
  await prisma.$executeRawUnsafe(`
    ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS module_source TEXT
  `).catch(() => {});

  // Add branch_id to vehicles if missing
  await prisma.$executeRawUnsafe(`
    ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES tenant_branches(id) ON DELETE SET NULL
  `).catch(() => {});

  // Add branch_id to trip_logs if missing
  await prisma.$executeRawUnsafe(`
    ALTER TABLE trip_logs ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES tenant_branches(id) ON DELETE SET NULL
  `).catch(() => {});
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;

function serializeRow(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Date)     { out[k] = v.toISOString(); continue; }
    if (typeof v === 'bigint') { out[k] = Number(v);       continue; }
    if (Buffer.isBuffer(v))    {
      const hex = (v as Buffer).toString('hex');
      out[k] = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
      continue;
    }
    out[k] = v;
  }
  // Format date fields
  for (const df of ['trade_license_expiry', 'created_at', 'updated_at', 'deleted_at']) {
    if (out[df] && typeof out[df] === 'string') {
      out[df] = (out[df] as string).split('T')[0] !== out[df]
        ? out[df]
        : out[df];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// GET /api/tenant-branches
// ?tenantId=X  — filter by tenant (required for non-admin)
// ?emirate=DUBAI — filter by emirate
// ?includeInactive=true — include inactive branches
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  await ensureTable();
  const auth = await requireAdminPermission(req, 'view', 'branches');
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const requestedTenantId = searchParams.get('tenantId') ?? '';
  const tenantBoundary = resolveTenantBoundary(auth.ctx, requestedTenantId);
  if (tenantBoundary instanceof NextResponse) return tenantBoundary;
  const tenantId        = auth.ctx.isSuperAdmin && !requestedTenantId ? '' : tenantBoundary;
  const emirate         = searchParams.get('emirate') ?? '';
  const includeInactive = searchParams.get('includeInactive') === 'true';

  const conditions: string[] = ['b.deleted_at IS NULL'];
  const values: unknown[] = [];

  if (tenantId) {
    values.push(tenantId);
    conditions.push(`b.tenant_id = $${values.length}`);
  }
  if (emirate) {
    values.push(emirate);
    conditions.push(`b.emirate = $${values.length}`);
  }
  if (!includeInactive) {
    conditions.push(`b.is_active = TRUE`);
  }

  const where = conditions.join(' AND ');

  type BranchRow = Row & {
    invoice_count?: bigint;
    vehicle_count?: bigint;
  };

  // Try full query with LATERAL counts first; fall back to simple query if
  // branch_id / deleted_at columns don't yet exist on finance_invoices or vehicles.
  let rows: BranchRow[] = [];
  try {
    rows = await prisma.$queryRawUnsafe<BranchRow[]>(
      `SELECT
         b.*,
         t.name                      AS tenant_name,
         t.code                      AS tenant_code,
         COALESCE(t.trn, '')         AS tenant_trn,
         COALESCE(ic.cnt, 0)         AS invoice_count,
         COALESCE(vc.cnt, 0)         AS vehicle_count
       FROM tenant_branches b
       LEFT JOIN tenants t ON t.id::text = b.tenant_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS cnt FROM finance_invoices
         WHERE branch_id::text = b.id::text AND deleted_at IS NULL
       ) ic ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS cnt FROM vehicles
         WHERE branch_id::text = b.id::text AND deleted_at IS NULL
       ) vc ON TRUE
       WHERE ${where}
       ORDER BY b.is_default DESC, b.branch_name ASC`,
      ...values
    );
  } catch (err) {
    console.warn('[tenant-branches GET] full query failed, trying simple query:', err);
    // Fallback: simple query without count joins
    try {
      rows = await prisma.$queryRawUnsafe<BranchRow[]>(
        `SELECT
           b.*,
           t.name              AS tenant_name,
           t.code              AS tenant_code,
           COALESCE(t.trn, '') AS tenant_trn,
           0                   AS invoice_count,
           0                   AS vehicle_count
         FROM tenant_branches b
         LEFT JOIN tenants t ON t.id::text = b.tenant_id
         WHERE ${where}
         ORDER BY b.is_default DESC, b.branch_name ASC`,
        ...values
      );
    } catch (err2) {
      console.error('[tenant-branches GET] simple query also failed:', err2);
      rows = [];
    }
  }

  return NextResponse.json({
    data:  rows.map(r => ({
      ...serializeRow(r),
      invoice_count: Number(r.invoice_count ?? 0),
      vehicle_count: Number(r.vehicle_count ?? 0),
    })),
    total: rows.length,
  });
}

// ---------------------------------------------------------------------------
// POST /api/tenant-branches — create branch
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  await ensureTable();
  const auth = await requireAdminPermission(req, 'create', 'branches');
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json();
    const {
      tenantId, branchName, emirate = 'DUBAI',
      tradeLicenseNo,    tradeLicenseAuthority, tradeLicenseExpiry,
      billingAddress,    billingCity,           billingPoBox,
      contactName,       contactEmail,          contactPhone,
      costCenterCode,    isDefault = false,     notes,
    } = body;

    // Normalise: treat empty strings as NULL so Postgres date/text casts don't blow up
    const nullify = (v: unknown) => (v === '' || v === undefined ? null : v);

    if (!tenantId)   return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
    if (!branchName) return NextResponse.json({ error: 'branchName is required' }, { status: 400 });
    const tenantBoundary = resolveTenantBoundary(auth.ctx, tenantId);
    if (tenantBoundary instanceof NextResponse) return tenantBoundary;

    // If marking as default, clear existing default for this tenant
    if (isDefault) {
      await prisma.$executeRawUnsafe(
        `UPDATE tenant_branches SET is_default = FALSE WHERE tenant_id = $1 AND deleted_at IS NULL`,
        tenantBoundary
      ).catch(() => {});
    }

    // Use CASE to avoid casting NULL/empty-string as ::date
    type InsRow = { id: string };
    const [row] = await prisma.$queryRawUnsafe<InsRow[]>(
      `INSERT INTO tenant_branches
         (tenant_id, branch_name, emirate, trade_license_no, trade_license_authority,
          trade_license_expiry, billing_address, billing_city, billing_po_box,
          contact_name, contact_email, contact_phone,
          cost_center_code, is_default, notes)
       VALUES ($1,$2,$3,$4,$5,
               CASE WHEN $6::text IS NULL OR $6::text = '' THEN NULL ELSE $6::date END,
               $7,$8,$9,
               $10,$11,$12,
               $13,$14,$15)
       RETURNING id`,
      tenantBoundary, branchName, nullify(emirate) ?? 'DUBAI',
      nullify(tradeLicenseNo), nullify(tradeLicenseAuthority),
      nullify(tradeLicenseExpiry),
      nullify(billingAddress), nullify(billingCity), nullify(billingPoBox),
      nullify(contactName), nullify(contactEmail), nullify(contactPhone),
      nullify(costCenterCode), isDefault, nullify(notes)
    );

    await recordAdminChange({
      req,
      ctx: auth.ctx,
      tenantId: tenantBoundary,
      entityType: 'Branch',
      entityId: row.id, entityName: branchName,
      action: 'CREATE',
      after: { tenantId: tenantBoundary, branchName, emirate, tradeLicenseNo, tradeLicenseAuthority, tradeLicenseExpiry, billingAddress, billingCity, billingPoBox, contactName, contactEmail, contactPhone, costCenterCode, isDefault, notes },
      summary: `Branch "${branchName}" created in ${nullify(emirate) ?? 'DUBAI'}.`,
    });

    return NextResponse.json({ success: true, id: row.id }, { status: 201 });
  } catch (err) {
    console.error('[tenant-branches POST]', err);
    return NextResponse.json({ error: 'Failed to create branch', detail: String(err) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/tenant-branches — update branch
// Body: { id, ...fields }
// ---------------------------------------------------------------------------
export async function PATCH(req: NextRequest) {
  await ensureTable();
  const auth = await requireAdminPermission(req, 'edit', 'branches');
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json();
    const { id, tenantId, ...fields } = body;

    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    const beforeRows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT * FROM tenant_branches WHERE id = $1::uuid AND deleted_at IS NULL LIMIT 1`,
      id,
    );
    const before = beforeRows[0] ? serializeRow(beforeRows[0]) : null;
    if (!before) return NextResponse.json({ error: 'Branch not found' }, { status: 404 });
    const tenantBoundary = resolveTenantBoundary(auth.ctx, String(before.tenant_id));
    if (tenantBoundary instanceof NextResponse) return tenantBoundary;
    if (tenantId && tenantId !== tenantBoundary) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const fieldMap: Record<string, string> = {
      branchName:            'branch_name',
      emirate:               'emirate',
      tradeLicenseNo:        'trade_license_no',
      tradeLicenseAuthority: 'trade_license_authority',
      tradeLicenseExpiry:    'trade_license_expiry',
      billingAddress:        'billing_address',
      billingCity:           'billing_city',
      billingPoBox:          'billing_po_box',
      contactName:           'contact_name',
      contactEmail:          'contact_email',
      contactPhone:          'contact_phone',
      costCenterCode:        'cost_center_code',
      isDefault:             'is_default',
      isActive:              'is_active',
      notes:                 'notes',
    };

    const setClauses: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [];

    const nullify = (v: unknown) => (v === '' || v === undefined ? null : v);

    for (const [jsKey, dbCol] of Object.entries(fieldMap)) {
      if (fields[jsKey] !== undefined) {
        const val = nullify(fields[jsKey]);
        values.push(val);
        if (dbCol === 'trade_license_expiry') {
          setClauses.push(`${dbCol} = CASE WHEN $${values.length}::text IS NULL THEN NULL ELSE $${values.length}::date END`);
        } else {
          setClauses.push(`${dbCol} = $${values.length}`);
        }
      }
    }

    if (setClauses.length === 1) {
      return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
    }

    // If marking as default, clear others for this tenant
    if (fields.isDefault === true) {
      await prisma.$executeRawUnsafe(
        `UPDATE tenant_branches SET is_default = FALSE WHERE tenant_id = $1 AND id != $2::uuid AND deleted_at IS NULL`,
        tenantBoundary, id
      ).catch(() => {});
    }

    values.push(id);
    const [updated] = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `UPDATE tenant_branches SET ${setClauses.join(', ')} WHERE id = $${values.length}::uuid AND deleted_at IS NULL RETURNING id`,
      ...values
    );

    if (!updated) return NextResponse.json({ error: 'Branch not found' }, { status: 404 });
    const [afterRow] = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT * FROM tenant_branches WHERE id = $1::uuid LIMIT 1`,
      updated.id,
    );
    await recordAdminChange({
      req,
      ctx: auth.ctx,
      tenantId: tenantBoundary,
      entityType: 'Branch',
      entityId: updated.id,
      entityName: String(afterRow?.branch_name ?? before.branch_name ?? updated.id),
      action: 'UPDATE',
      before,
      after: afterRow ? serializeRow(afterRow) : { id: updated.id },
      summary: `Updated branch ${String(afterRow?.branch_name ?? before.branch_name ?? updated.id)}.`,
    });

    return NextResponse.json({ success: true, id: updated.id });
  } catch (err) {
    console.error('[tenant-branches PATCH]', err);
    return NextResponse.json({ error: 'Failed to update branch', detail: String(err) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/tenant-branches  — soft delete
// Body: { id }
// ---------------------------------------------------------------------------
export async function DELETE(req: NextRequest) {
  await ensureTable();
  const auth = await requireAdminPermission(req, 'delete', 'branches');
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    const beforeRows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT * FROM tenant_branches WHERE id = $1::uuid AND deleted_at IS NULL LIMIT 1`,
      id,
    );
    const before = beforeRows[0] ? serializeRow(beforeRows[0]) : null;
    if (!before) return NextResponse.json({ error: 'Branch not found or already deleted' }, { status: 404 });
    const tenantBoundary = resolveTenantBoundary(auth.ctx, String(before.tenant_id));
    if (tenantBoundary instanceof NextResponse) return tenantBoundary;

    // Use RETURNING to confirm the row was actually found and updated
    const deleted = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `UPDATE tenant_branches
       SET deleted_at = NOW(), updated_at = NOW(), is_active = FALSE
       WHERE id = $1::uuid AND deleted_at IS NULL
       RETURNING id`,
      id
    );

    if (!deleted || deleted.length === 0) {
      return NextResponse.json({ error: 'Branch not found or already deleted' }, { status: 404 });
    }

    await recordAdminChange({
      req,
      ctx: auth.ctx,
      tenantId: tenantBoundary,
      entityType: 'Branch',
      entityId: id,
      entityName: String(before.branch_name ?? id),
      action: 'DELETE',
      before,
      after: { ...before, deleted_at: new Date().toISOString(), is_active: false },
      summary: `Deleted branch ${String(before.branch_name ?? id)}.`,
    });

    return NextResponse.json({ success: true, id });
  } catch (err) {
    console.error('[tenant-branches DELETE]', err);
    return NextResponse.json({ error: 'Failed to delete branch', detail: String(err) }, { status: 500 });
  }
}
