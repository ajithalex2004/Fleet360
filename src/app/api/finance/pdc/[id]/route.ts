/**
 * PDC Register — individual cheque operations
 * Status transitions: HELD → DEPOSITED → CLEARED | BOUNCED
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureOperationalTenantColumn, recordOperationalChange, requireOperationalContext } from '@/lib/cross-module-governance';
import { triggerServiceWorkflow } from '@/lib/runtime-workflows';

type PdcRow = Record<string, unknown>;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  await ensureOperationalTenantColumn('finance_pdc_cheques').catch(() => {});
  const ctx = requireOperationalContext(req, 'finance', { requestedTenantId: req.nextUrl.searchParams.get('tenantId') });
  if (ctx instanceof NextResponse) return ctx;
  const [row] = await prisma.$queryRawUnsafe<PdcRow[]>(
    `SELECT * FROM finance_pdc_cheques WHERE id = $1 AND tenant_id::text = $2 AND deleted_at IS NULL`, params.id, ctx.tenantId
  ).catch(() => [] as PdcRow[]);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  await ensureOperationalTenantColumn('finance_pdc_cheques').catch(() => {});
  const ctx = requireOperationalContext(req, 'finance', { write: true });
  if (ctx instanceof NextResponse) return ctx;
  const body = await req.json();
  const { action, bounceReason, notes } = body;
  const [current] = await prisma.$queryRawUnsafe<PdcRow[]>(
    `SELECT * FROM finance_pdc_cheques WHERE id = $1 AND tenant_id::text = $2 AND deleted_at IS NULL`,
    params.id,
    ctx.tenantId,
  ).catch(() => [] as PdcRow[]);
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const now = new Date().toISOString();
  let sql = '';
  let sqlParams: unknown[] = [params.id];

  if (action === 'deposit') {
    sql = `UPDATE finance_pdc_cheques SET status='DEPOSITED', deposited_at=$2, updated_at=$3, notes=COALESCE($4,notes) WHERE id=$1 AND tenant_id::text = $5 RETURNING *`;
    sqlParams = [params.id, now, now, notes ?? null, ctx.tenantId];
  } else if (action === 'clear') {
    sql = `UPDATE finance_pdc_cheques SET status='CLEARED', cleared_at=$2, updated_at=$3, notes=COALESCE($4,notes) WHERE id=$1 AND tenant_id::text = $5 RETURNING *`;
    sqlParams = [params.id, now, now, notes ?? null, ctx.tenantId];
  } else if (action === 'bounce') {
    sql = `UPDATE finance_pdc_cheques SET status='BOUNCED', bounced_at=$2, bounce_reason=$3, updated_at=$4, notes=COALESCE($5,notes) WHERE id=$1 AND tenant_id::text = $6 RETURNING *`;
    sqlParams = [params.id, now, bounceReason ?? 'Insufficient funds', now, notes ?? null, ctx.tenantId];
  } else if (action === 'cancel') {
    sql = `UPDATE finance_pdc_cheques SET status='CANCELLED', updated_at=$2, notes=COALESCE($3,notes) WHERE id=$1 AND tenant_id::text = $4 RETURNING *`;
    sqlParams = [params.id, now, notes ?? null, ctx.tenantId];
  } else if (action === 'return') {
    sql = `UPDATE finance_pdc_cheques SET status='RETURNED', updated_at=$2, notes=COALESCE($3,notes) WHERE id=$1 AND tenant_id::text = $4 RETURNING *`;
    sqlParams = [params.id, now, notes ?? null, ctx.tenantId];
  } else {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }

  const [row] = await prisma.$queryRawUnsafe<PdcRow[]>(sql, ...sqlParams).catch(() => [] as PdcRow[]);
  if (!row) return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  await recordOperationalChange({
    req,
    ctx,
    entityType: 'FinancePdcCheque',
    entityId: params.id,
    action: 'STATUS_CHANGE',
    before: current,
    after: row,
    summary: `Updated PDC cheque ${row.cheque_number ?? params.id} via ${action}.`,
  });
  const workflow = await triggerServiceWorkflow({
    req,
    ctx,
    serviceTypeKey: row.direction === 'OUTGOING' ? 'FINANCE_BILLING_EXCEPTION' : 'FINANCE_RECEIVABLE_EXCEPTION',
    referenceType: 'PdcCheque',
    referenceId: params.id,
    referenceNumber: String(row.cheque_number ?? params.id),
    contextData: {
      action,
      previousStatus: current.status ?? null,
      status: row.status ?? null,
      direction: row.direction ?? null,
      amount: row.amount ?? null,
      bounceReason: row.bounce_reason ?? null,
      linkedInvoiceId: row.linked_invoice_id ?? null,
    },
    force: action === 'bounce' || action === 'cancel' || action === 'return',
  });
  return NextResponse.json({ ...row, workflow });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  await ensureOperationalTenantColumn('finance_pdc_cheques').catch(() => {});
  const ctx = requireOperationalContext(req, 'finance', { write: true });
  if (ctx instanceof NextResponse) return ctx;
  const [before] = await prisma.$queryRawUnsafe<PdcRow[]>(
    `SELECT * FROM finance_pdc_cheques WHERE id = $1 AND tenant_id::text = $2 AND deleted_at IS NULL`,
    params.id,
    ctx.tenantId,
  ).catch(() => [] as PdcRow[]);
  if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await prisma.$executeRawUnsafe(
    `UPDATE finance_pdc_cheques SET deleted_at=NOW(), updated_at=NOW() WHERE id=$1 AND tenant_id::text = $2`,
    params.id,
    ctx.tenantId,
  ).catch(() => {});
  await recordOperationalChange({
    req,
    ctx,
    entityType: 'FinancePdcCheque',
    entityId: params.id,
    action: 'DELETE',
    before,
    after: null,
    summary: `Deleted PDC cheque ${before.cheque_number ?? params.id}.`,
  });
  const workflow = await triggerServiceWorkflow({
    req,
    ctx,
    serviceTypeKey: before.direction === 'OUTGOING' ? 'FINANCE_BILLING_EXCEPTION' : 'FINANCE_RECEIVABLE_EXCEPTION',
    referenceType: 'PdcCheque',
    referenceId: params.id,
    referenceNumber: String(before.cheque_number ?? params.id),
    contextData: {
      action: 'delete',
      previousStatus: before.status ?? null,
      direction: before.direction ?? null,
      amount: before.amount ?? null,
    },
    force: true,
  });
  return NextResponse.json({ ok: true, workflow });
}
