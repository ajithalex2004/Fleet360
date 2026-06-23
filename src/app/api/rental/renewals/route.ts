/**
 * RAC Renewals API — /api/rental/renewals
 * Manages rental agreement renewal requests with approval workflow
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  recordOperationalChange,
  requireOperationalContext,
} from '@/lib/cross-module-governance';
import { triggerServiceWorkflow } from '@/lib/runtime-workflows';

const INIT = `
  CREATE TABLE IF NOT EXISTS rental_renewals (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW(),
    deleted_at        TIMESTAMPTZ,
    renewal_no        TEXT UNIQUE NOT NULL,
    agreement_id      TEXT,
    agreement_no      TEXT,
    customer_name     TEXT,
    vehicle_name      TEXT,
    vehicle_no        TEXT,
    original_end_date DATE,
    new_end_date      DATE,
    extension_days    INT,
    daily_rate        NUMERIC(10,2),
    renewal_amount    NUMERIC(12,2),
    vat_amount        NUMERIC(12,2),
    total_amount      NUMERIC(12,2),
    deposit_top_up    NUMERIC(12,2) DEFAULT 0,
    tenant_id         TEXT,
    status            TEXT DEFAULT 'PENDING',
    approved_by       TEXT,
    approved_at       TIMESTAMPTZ,
    notes             TEXT
  );
`;

type Row = Record<string, unknown>;

const MIGRATE = `
  ALTER TABLE rental_renewals ADD COLUMN IF NOT EXISTS tenant_id TEXT;
  CREATE INDEX IF NOT EXISTS idx_rental_renewals_tenant_id ON rental_renewals(tenant_id);
`;

async function nextNo(): Promise<string> {
  const [r] = await prisma
    .$queryRawUnsafe<{ count: string }[]>(
      `SELECT COUNT(*)::text as count FROM rental_renewals`,
    )
    .catch(() => [{ count: '0' }]);
  const seq = (parseInt(r?.count ?? '0') + 1).toString().padStart(4, '0');
  const ym = new Date().toISOString().slice(0, 7).replace('-', '');
  return `RRN-${ym}-${seq}`;
}

/* ─── GET ─── */
export async function GET(req: NextRequest) {
  await prisma.$executeRawUnsafe(INIT).catch(() => {});
  await prisma.$executeRawUnsafe(MIGRATE).catch(() => {});
  const ctx = requireOperationalContext(req, 'rac', { requestedTenantId: req.nextUrl.searchParams.get('tenantId') });
  if (ctx instanceof NextResponse) return ctx;

  const sp = req.nextUrl.searchParams;
  const status = sp.get('status');
  const search = sp.get('search');
  const page = Math.max(1, parseInt(sp.get('page') ?? '1'));
  const limit = Math.min(100, parseInt(sp.get('limit') ?? '50'));
  const offset = (page - 1) * limit;

  let where = `WHERE deleted_at IS NULL AND tenant_id::text = $1`;
  const params: unknown[] = [ctx.tenantId];
  let pi = 2;

  if (status && status !== 'ALL') {
    where += ` AND status=$${pi++}`;
    params.push(status);
  }
  if (search) {
    where += ` AND (customer_name ILIKE $${pi} OR renewal_no ILIKE $${pi} OR agreement_no ILIKE $${pi} OR vehicle_no ILIKE $${pi})`;
    params.push(`%${search}%`);
    pi++;
  }

  const [rows, summary] = await Promise.all([
    prisma
      .$queryRawUnsafe<Row[]>(
        `SELECT * FROM rental_renewals ${where} ORDER BY created_at DESC LIMIT $${pi} OFFSET $${pi + 1}`,
        ...params,
        limit,
        offset,
      )
      .catch(() => []),
    prisma
      .$queryRawUnsafe<{ status: string; count: string; total: string }[]>(
        `SELECT
           status,
           COUNT(*)::text as count,
           COALESCE(SUM(total_amount),0)::text as total
         FROM rental_renewals
         WHERE deleted_at IS NULL
         GROUP BY status`,
      )
      .catch(() => []),
  ]);

  // Build summary object
  const counts: Record<string, number> = {};
  const totals: Record<string, number> = {};
  for (const s of summary) {
    counts[s.status] = parseInt(s.count);
    totals[s.status] = parseFloat(s.total);
  }

  // Month extensions
  const thisMonthRows = await prisma
    .$queryRawUnsafe<{ cnt: string; avg_days: string }[]>(
      `SELECT COUNT(*)::text as cnt, COALESCE(AVG(extension_days),0)::text as avg_days
       FROM rental_renewals
       WHERE deleted_at IS NULL
         AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW())`,
    )
    .catch(() => [{ cnt: '0', avg_days: '0' }]);

  const kpis = {
    pendingCount: counts['PENDING'] ?? 0,
    approvedTotal: totals['APPROVED'] ?? 0,
    thisMonthExtensions: parseInt(thisMonthRows[0]?.cnt ?? '0'),
    avgExtensionDays: parseFloat(parseFloat(thisMonthRows[0]?.avg_days ?? '0').toFixed(1)),
  };

  return NextResponse.json({ data: rows, counts, kpis, page, limit });
}

/* ─── POST ─── */
export async function POST(req: NextRequest) {
  await prisma.$executeRawUnsafe(INIT).catch(() => {});
  await prisma.$executeRawUnsafe(MIGRATE).catch(() => {});
  const ctx = requireOperationalContext(req, 'rac', { write: true });
  if (ctx instanceof NextResponse) return ctx;

  const body = await req.json();
  const renewalNo = await nextNo();

  // Calculate extension days
  const origEnd = body.originalEndDate ? new Date(body.originalEndDate) : null;
  const newEnd = body.newEndDate ? new Date(body.newEndDate) : null;
  const extensionDays =
    origEnd && newEnd
      ? Math.max(1, Math.ceil((newEnd.getTime() - origEnd.getTime()) / 86400000))
      : (body.extensionDays ?? 0);

  const dailyRate = parseFloat(body.dailyRate ?? '0');
  const renewalAmount = +(extensionDays * dailyRate).toFixed(2);
  const vatAmount = +(renewalAmount * 0.05).toFixed(2);
  const totalAmount = +(renewalAmount + vatAmount).toFixed(2);
  const depositTopUp = parseFloat(body.depositTopUp ?? '0');

  const [row] = await prisma
    .$queryRawUnsafe<Row[]>(
      `INSERT INTO rental_renewals
         (renewal_no, agreement_id, agreement_no, customer_name, vehicle_name, vehicle_no,
          original_end_date, new_end_date, extension_days, daily_rate,
          renewal_amount, vat_amount, total_amount, deposit_top_up, tenant_id, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      renewalNo,
      body.agreementId ?? null,
      body.agreementNo ?? null,
      body.customerName ?? null,
      body.vehicleName ?? null,
      body.vehicleNo ?? null,
      body.originalEndDate ?? null,
      body.newEndDate ?? null,
      extensionDays,
      dailyRate,
      renewalAmount,
      vatAmount,
      totalAmount,
      depositTopUp,
      ctx.tenantId,
      body.status ?? 'PENDING',
      body.notes ?? null,
    )
    .catch(() => []);

  if (!row) return NextResponse.json({ error: 'Failed to create renewal' }, { status: 500 });
  await recordOperationalChange({
    req,
    ctx,
    entityType: 'RentalRenewal',
    entityId: String(row.id ?? renewalNo),
    action: 'CREATE',
    after: row,
    summary: `Created RAC renewal ${String(row.renewal_no ?? renewalNo)}.`,
  });
  const workflow = await triggerServiceWorkflow({
    req,
    ctx,
    serviceTypeKey: 'RAC_RESERVATIONS',
    referenceType: 'RentalRenewal',
    referenceId: String(row.id ?? renewalNo),
    referenceNumber: String(row.renewal_no ?? renewalNo),
    contextData: {
      agreementId: body.agreementId ?? null,
      agreementNo: body.agreementNo ?? null,
      customerName: body.customerName ?? null,
      vehicleNo: body.vehicleNo ?? null,
      totalAmount,
      status: body.status ?? 'PENDING',
    },
  });
  return NextResponse.json({ ...row, workflow }, { status: 201 });
}

/* ─── PATCH ─── */
export async function PATCH(req: NextRequest) {
  await prisma.$executeRawUnsafe(INIT).catch(() => {});
  await prisma.$executeRawUnsafe(MIGRATE).catch(() => {});
  const ctx = requireOperationalContext(req, 'rac', { write: true });
  if (ctx instanceof NextResponse) return ctx;

  const body = await req.json();
  const { id, status, approvedBy, notes, ...rest } = body;

  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const [before] = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT * FROM rental_renewals WHERE id = $1 AND tenant_id::text = $2 AND deleted_at IS NULL LIMIT 1`,
    id,
    ctx.tenantId,
  ).catch(() => []);
  if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const sets: string[] = [];
  const params: unknown[] = [];
  let pi = 1;

  if (status) {
    sets.push(`status=$${pi++}`);
    params.push(status);

    if (status === 'APPROVED' || status === 'REJECTED') {
      sets.push(`approved_by=$${pi++}`, `approved_at=NOW()`);
      params.push(approvedBy ?? 'SYSTEM');
    }
  }

  if (notes !== undefined) {
    sets.push(`notes=$${pi++}`);
    params.push(notes);
  }

  // Allow updating other fields pre-approval
  const fieldMap: Record<string, string> = {
    agreementNo: 'agreement_no',
    customerName: 'customer_name',
    vehicleName: 'vehicle_name',
    vehicleNo: 'vehicle_no',
    originalEndDate: 'original_end_date',
    newEndDate: 'new_end_date',
    extensionDays: 'extension_days',
    dailyRate: 'daily_rate',
    renewalAmount: 'renewal_amount',
    vatAmount: 'vat_amount',
    totalAmount: 'total_amount',
    depositTopUp: 'deposit_top_up',
  };
  for (const [k, col] of Object.entries(fieldMap)) {
    if (k in rest) {
      sets.push(`${col}=$${pi++}`);
      params.push(rest[k]);
    }
  }

  if (!sets.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

  sets.push(`updated_at=NOW()`);
  params.push(id);

  const [row] = await prisma
    .$queryRawUnsafe<Row[]>(
      `UPDATE rental_renewals SET ${sets.join(',')} WHERE id=$${pi} AND tenant_id::text = $${pi + 1} RETURNING *`,
      ...params,
      ctx.tenantId,
    )
    .catch(() => []);

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await recordOperationalChange({
    req,
    ctx,
    entityType: 'RentalRenewal',
    entityId: String(id),
    action: status && status !== before.status ? 'STATUS_CHANGE' : 'UPDATE',
    before,
    after: row,
    summary: `Updated RAC renewal ${String(row.renewal_no ?? id)}.`,
  });
  const workflow = await triggerServiceWorkflow({
    req,
    ctx,
    serviceTypeKey: 'RAC_RESERVATIONS',
    referenceType: 'RentalRenewal',
    referenceId: String(id),
    referenceNumber: String(row.renewal_no ?? id),
    contextData: {
      agreementId: row.agreement_id ?? null,
      agreementNo: row.agreement_no ?? null,
      previousStatus: before.status ?? null,
      status: row.status ?? null,
      totalAmount: row.total_amount ?? null,
    },
    force: status === 'APPROVED' || status === 'REJECTED',
  });
  return NextResponse.json({ ...row, workflow });
}
