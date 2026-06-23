/**
 * Expense individual operations — approval workflow
 * DRAFT → SUBMITTED → APPROVED / REJECTED → PAID
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureOperationalTenantColumn, recordOperationalChange, requireOperationalContext } from '@/lib/cross-module-governance';
import { triggerServiceWorkflow } from '@/lib/runtime-workflows';

type ExpRow = Record<string, unknown>;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  await ensureOperationalTenantColumn('finance_expenses').catch(() => {});
  const ctx = requireOperationalContext(req, 'finance', { requestedTenantId: req.nextUrl.searchParams.get('tenantId') });
  if (ctx instanceof NextResponse) return ctx;
  const [row] = await prisma.$queryRawUnsafe<ExpRow[]>(
    `SELECT * FROM finance_expenses WHERE id = $1 AND tenant_id::text = $2 AND deleted_at IS NULL`, params.id, ctx.tenantId
  ).catch(() => [] as ExpRow[]);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  await ensureOperationalTenantColumn('finance_expenses').catch(() => {});
  const ctx = requireOperationalContext(req, 'finance', { write: true });
  if (ctx instanceof NextResponse) return ctx;
  const body = await req.json();
  const { action } = body;
  const now = new Date().toISOString();
  const [current] = await prisma.$queryRawUnsafe<ExpRow[]>(
    `SELECT * FROM finance_expenses WHERE id = $1 AND tenant_id::text = $2 AND deleted_at IS NULL`,
    params.id,
    ctx.tenantId,
  ).catch(() => [] as ExpRow[]);
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let sql = '';
  let sqlParams: unknown[] = [];

  switch (action) {
    case 'submit':
      sql = `UPDATE finance_expenses SET status='SUBMITTED', submitted_by=$2, submitted_at=$3, updated_at=$4 WHERE id=$1 AND tenant_id::text = $5 AND deleted_at IS NULL RETURNING *`;
      sqlParams = [params.id, body.submittedBy ?? 'System', now, now, ctx.tenantId];
      break;
    case 'approve':
      sql = `UPDATE finance_expenses SET status='APPROVED', approved_by=$2, approved_at=$3, updated_at=$4 WHERE id=$1 AND tenant_id::text = $5 AND deleted_at IS NULL RETURNING *`;
      sqlParams = [params.id, body.approvedBy ?? 'Finance Manager', now, now, ctx.tenantId];
      break;
    case 'reject':
      sql = `UPDATE finance_expenses SET status='REJECTED', rejected_by=$2, rejected_at=$3, rejection_reason=$4, updated_at=$5 WHERE id=$1 AND tenant_id::text = $6 AND deleted_at IS NULL RETURNING *`;
      sqlParams = [params.id, body.rejectedBy ?? 'Finance Manager', now, body.rejectionReason ?? '', now, ctx.tenantId];
      break;
    case 'mark_paid':
      sql = `UPDATE finance_expenses SET status='PAID', paid_at=$2, updated_at=$3, notes=COALESCE($4,notes) WHERE id=$1 AND tenant_id::text = $5 AND deleted_at IS NULL RETURNING *`;
      sqlParams = [params.id, now, now, body.notes ?? null, ctx.tenantId];
      break;
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }

  const [row] = await prisma.$queryRawUnsafe<ExpRow[]>(sql, ...sqlParams).catch(() => [] as ExpRow[]);
  if (!row) return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  await recordOperationalChange({
    req,
    ctx,
    entityType: 'FinanceExpense',
    entityId: params.id,
    action: action === 'submit' || action === 'approve' || action === 'reject' || action === 'mark_paid' ? 'STATUS_CHANGE' : 'UPDATE',
    before: current,
    after: row,
    summary: `Updated expense ${String(row.expense_no ?? params.id)} via ${action}.`,
  });
  const workflow = await triggerServiceWorkflow({
    req,
    ctx,
    serviceTypeKey: 'FINANCE_EXPENSE_EXCEPTION',
    referenceType: 'FinanceExpense',
    referenceId: params.id,
    referenceNumber: String(row.expense_no ?? params.id),
    contextData: {
      action,
      previousStatus: current.status ?? null,
      status: row.status ?? null,
      amount: row.amount ?? null,
      totalAmount: row.total_amount ?? null,
      category: row.category ?? null,
      costCentre: row.cost_centre ?? null,
      rejectionReason: row.rejection_reason ?? null,
    },
    force: action === 'submit' || action === 'reject' || action === 'mark_paid',
  });
  return NextResponse.json({ ...row, workflow });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  await ensureOperationalTenantColumn('finance_expenses').catch(() => {});
  const ctx = requireOperationalContext(req, 'finance', { write: true });
  if (ctx instanceof NextResponse) return ctx;
  const [before] = await prisma.$queryRawUnsafe<ExpRow[]>(
    `SELECT * FROM finance_expenses WHERE id = $1 AND tenant_id::text = $2 AND deleted_at IS NULL`,
    params.id,
    ctx.tenantId,
  ).catch(() => [] as ExpRow[]);
  if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await prisma.$executeRawUnsafe(
    `UPDATE finance_expenses SET deleted_at=NOW(), updated_at=NOW() WHERE id=$1 AND tenant_id::text = $2`,
    params.id,
    ctx.tenantId,
  ).catch(() => {});
  await recordOperationalChange({
    req,
    ctx,
    entityType: 'FinanceExpense',
    entityId: params.id,
    action: 'DELETE',
    before,
    after: null,
    summary: `Deleted expense ${String(before.expense_no ?? params.id)}.`,
  });
  const workflow = await triggerServiceWorkflow({
    req,
    ctx,
    serviceTypeKey: 'FINANCE_EXPENSE_EXCEPTION',
    referenceType: 'FinanceExpense',
    referenceId: params.id,
    referenceNumber: String(before.expense_no ?? params.id),
    contextData: {
      action: 'delete',
      previousStatus: before.status ?? null,
      amount: before.amount ?? null,
      totalAmount: before.total_amount ?? null,
      category: before.category ?? null,
    },
    force: true,
  });
  return NextResponse.json({ ok: true, workflow });
}
