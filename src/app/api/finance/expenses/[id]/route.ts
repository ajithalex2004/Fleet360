/**
 * Expense individual operations — approval workflow
 * DRAFT → SUBMITTED → APPROVED / REJECTED → PAID
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type ExpRow = Record<string, unknown>;

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const [row] = await prisma.$queryRawUnsafe<ExpRow[]>(
    `SELECT * FROM finance_expenses WHERE id = $1 AND deleted_at IS NULL`, params.id
  ).catch(() => [] as ExpRow[]);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const { action } = body;
  const now = new Date().toISOString();

  let sql = '';
  let sqlParams: unknown[] = [];

  switch (action) {
    case 'submit':
      sql = `UPDATE finance_expenses SET status='SUBMITTED', submitted_by=$2, submitted_at=$3, updated_at=$4 WHERE id=$1 AND deleted_at IS NULL RETURNING *`;
      sqlParams = [params.id, body.submittedBy ?? 'System', now, now];
      break;
    case 'approve':
      sql = `UPDATE finance_expenses SET status='APPROVED', approved_by=$2, approved_at=$3, updated_at=$4 WHERE id=$1 AND deleted_at IS NULL RETURNING *`;
      sqlParams = [params.id, body.approvedBy ?? 'Finance Manager', now, now];
      break;
    case 'reject':
      sql = `UPDATE finance_expenses SET status='REJECTED', rejected_by=$2, rejected_at=$3, rejection_reason=$4, updated_at=$5 WHERE id=$1 AND deleted_at IS NULL RETURNING *`;
      sqlParams = [params.id, body.rejectedBy ?? 'Finance Manager', now, body.rejectionReason ?? '', now];
      break;
    case 'mark_paid':
      sql = `UPDATE finance_expenses SET status='PAID', paid_at=$2, updated_at=$3, notes=COALESCE($4,notes) WHERE id=$1 AND deleted_at IS NULL RETURNING *`;
      sqlParams = [params.id, now, now, body.notes ?? null];
      break;
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }

  const [row] = await prisma.$queryRawUnsafe<ExpRow[]>(sql, ...sqlParams).catch(() => [] as ExpRow[]);
  if (!row) return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  return NextResponse.json(row);
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  await prisma.$executeRawUnsafe(
    `UPDATE finance_expenses SET deleted_at=NOW() WHERE id=$1`, params.id
  ).catch(() => {});
  return NextResponse.json({ ok: true });
}
