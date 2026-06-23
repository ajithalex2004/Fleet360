/**
 * Credit Note individual operations - status lifecycle
 * DRAFT -> ISSUED -> APPLIED | REFUNDED | VOIDED
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOperationalContext } from '@/lib/cross-module-governance';
import { prisma } from '@/lib/prisma';
import { ensureFinanceStatementTables } from '@/lib/finance/customer-statement';
import { triggerServiceWorkflow } from '@/lib/runtime-workflows';

type CnRow = Record<string, unknown>;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await ensureFinanceStatementTables();
  const { id } = await params;
  const sp = req.nextUrl.searchParams;
  const ctx = requireOperationalContext(req, 'finance', { requestedTenantId: sp.get('tenantId') });
  if (ctx instanceof NextResponse) return ctx;

  const [row] = await prisma.$queryRawUnsafe<CnRow[]>(
    `SELECT * FROM finance_credit_notes WHERE id = $1 AND tenant_id::text = $2 AND deleted_at IS NULL`,
    id,
    ctx.tenantId,
  ).catch(() => []);

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await ensureFinanceStatementTables();
  const { id } = await params;
  const ctx = requireOperationalContext(req, 'finance', { write: true });
  if (ctx instanceof NextResponse) return ctx;

  const body = await req.json();
  const { action } = body;
  const now = new Date().toISOString();
  const [before] = await prisma.$queryRawUnsafe<CnRow[]>(
    `SELECT * FROM finance_credit_notes WHERE id = $1 AND tenant_id::text = $2 AND deleted_at IS NULL`,
    id,
    ctx.tenantId,
  ).catch(() => []);
  if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let sql = '';
  let sqlParams: unknown[] = [];

  switch (action) {
    case 'issue':
      sql = `UPDATE finance_credit_notes SET status='ISSUED', issued_by=$3, updated_at=$4 WHERE id=$1 AND tenant_id::text=$2 RETURNING *`;
      sqlParams = [id, ctx.tenantId, body.issuedBy ?? 'Finance', now];
      break;
    case 'apply':
      sql = `UPDATE finance_credit_notes SET status='APPLIED', applied_amount=$3, updated_at=$4, notes=COALESCE($5,notes) WHERE id=$1 AND tenant_id::text=$2 RETURNING *`;
      sqlParams = [id, ctx.tenantId, body.appliedAmount, now, body.notes ?? null];
      break;
    case 'refund':
      sql = `UPDATE finance_credit_notes SET status='REFUNDED', refunded_at=$3, refund_method=$4, updated_at=$5, notes=COALESCE($6,notes) WHERE id=$1 AND tenant_id::text=$2 RETURNING *`;
      sqlParams = [id, ctx.tenantId, now, body.refundMethod ?? 'Bank Transfer', now, body.notes ?? null];
      break;
    case 'void':
      sql = `UPDATE finance_credit_notes SET status='VOIDED', updated_at=$3, notes=COALESCE($4,notes) WHERE id=$1 AND tenant_id::text=$2 RETURNING *`;
      sqlParams = [id, ctx.tenantId, now, body.notes ?? null];
      break;
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }

  const [row] = await prisma.$queryRawUnsafe<CnRow[]>(sql, ...sqlParams).catch(() => []);
  if (!row) return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  const workflow = await triggerServiceWorkflow({
    req,
    ctx,
    serviceTypeKey: 'FINANCE_BILLING_EXCEPTION',
    referenceType: 'CreditNote',
    referenceId: id,
    referenceNumber: String(row.cn_number ?? id),
    contextData: {
      action,
      previousStatus: before.status ?? null,
      status: row.status ?? null,
      totalAmount: row.total_amount ?? null,
      module: row.module ?? null,
      branch: row.branch ?? null,
      originalInvoiceNo: row.original_invoice_no ?? null,
    },
    force: action !== 'apply',
  });
  return NextResponse.json({ ...row, workflow });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await ensureFinanceStatementTables();
  const { id } = await params;
  const ctx = requireOperationalContext(req, 'finance', { write: true });
  if (ctx instanceof NextResponse) return ctx;

  await prisma.$executeRawUnsafe(
    `UPDATE finance_credit_notes SET deleted_at = NOW() WHERE id = $1 AND tenant_id::text = $2`,
    id,
    ctx.tenantId,
  ).catch(() => {});

  return NextResponse.json({ ok: true });
}
