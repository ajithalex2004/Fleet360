export const dynamic = 'force-dynamic';

/**
 * Expense individual operations — approval workflow
 * DRAFT → SUBMITTED → APPROVED / REJECTED → PAID
 * A DRAFT or REJECTED expense can be edited (action 'update'; a rejected one
 * returns to DRAFT) or deleted; later stages are locked.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { approvalGate, withApprovalStart } from '@/lib/workflow/approvals';
type ExpRow = Record<string, unknown>;

const EDITABLE = ['DRAFT', 'REJECTED'];

// Status an action may start from.
const FROM: Record<string, string[]> = {
  update:    EDITABLE,
  submit:    EDITABLE,
  approve:   ['SUBMITTED'],
  reject:    ['SUBMITTED'],
  mark_paid: ['APPROVED'],
};

export async function GET(_: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: _.headers, nextUrl: _.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const [row] = await tx.$queryRawUnsafe<ExpRow[]>(
        `SELECT * FROM finance_expenses WHERE id::text=$1 AND deleted_at IS NULL AND tenant_id=$2`, params.id, tenantId
      ).catch(() => [] as ExpRow[]);
      if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json(row);
  });
}


export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const body = stripTenantOwnershipFields(await req.json());
  const { action } = body;
  // A company's expense approval workflow (Admin > Workflows) decides
  // submitted expenses: approve / reject go to the level that is waiting.
  if (action === 'approve' || action === 'reject') {
    const gated = await approvalGate({
      headers: req.headers, tenantId, referenceType: 'finance_expense', referenceId: params.id,
      action: action === 'approve' ? 'APPROVE' : 'REJECT',
      comments: action === 'reject' ? String(body.rejectionReason ?? '') : String(body.notes ?? ''),
    });
    if (gated) return gated;
  }

  const response = await withTenantRls(prisma, tenantId, async (tx) => {
      const now = new Date().toISOString();

      const [current] = await tx.$queryRawUnsafe<{ status: string }[]>(
        `SELECT status FROM finance_expenses WHERE id::text=$1 AND deleted_at IS NULL AND tenant_id=$2`,
        params.id, tenantId,
      );
      if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      if (FROM[action] && !FROM[action].includes(current.status)) {
        return NextResponse.json(
          { error: `Cannot ${action.replace('_', ' ')} an expense that is ${current.status}` },
          { status: 409 },
        );
      }

      let sql = '';
      let sqlParams: unknown[] = [];

      switch (action) {
        case 'update': {
          if (!body.category || !body.description || !body.expenseDate) {
            return NextResponse.json({ error: 'category, description and expenseDate are required' }, { status: 400 });
          }
          const amount = parseFloat(body.amount);
          const vat    = parseFloat(body.vatAmount ?? '0') || 0;
          if (!Number.isFinite(amount) || amount <= 0) {
            return NextResponse.json({ error: 'amount must be greater than 0' }, { status: 400 });
          }
          sql = `UPDATE finance_expenses SET
                   status='DRAFT', category=$2, sub_category=$3, description=$4,
                   amount=$5::numeric, vat_amount=$6::numeric, total_amount=$7::numeric,
                   expense_date=$8::date, payment_method=$9, reference_no=$10,
                   vehicle_id=$11, driver_id=$12, cost_centre=$13, receipt_url=$14, notes=$15,
                   updated_at=NOW()
                 WHERE id::text=$1 AND deleted_at IS NULL RETURNING *`;
          sqlParams = [
            params.id, body.category, body.subCategory || null, body.description,
            amount, vat, Math.round((amount + vat) * 100) / 100,
            body.expenseDate, body.paymentMethod || null, body.referenceNo || null,
            body.vehicleId || null, body.driverId || null, body.costCentre || null,
            body.receiptUrl || null, body.notes || null,
          ];
          break;
        }
        case 'submit':
          sql = `UPDATE finance_expenses SET status='SUBMITTED', submitted_by=$2, submitted_at=$3::timestamptz, updated_at=$4::timestamptz WHERE id::text=$1 AND deleted_at IS NULL RETURNING *`;
          sqlParams = [params.id, body.submittedBy ?? 'System', now, now];
          break;
        case 'approve':
          sql = `UPDATE finance_expenses SET status='APPROVED', approved_by=$2, approved_at=$3::timestamptz, updated_at=$4::timestamptz WHERE id::text=$1 AND deleted_at IS NULL RETURNING *`;
          sqlParams = [params.id, body.approvedBy ?? 'Finance Manager', now, now];
          break;
        case 'reject':
          sql = `UPDATE finance_expenses SET status='REJECTED', rejected_by=$2, rejected_at=$3::timestamptz, rejection_reason=$4, updated_at=$5::timestamptz WHERE id::text=$1 AND deleted_at IS NULL RETURNING *`;
          sqlParams = [params.id, body.rejectedBy ?? 'Finance Manager', now, body.rejectionReason ?? '', now];
          break;
        case 'mark_paid':
          sql = `UPDATE finance_expenses SET status='PAID', paid_at=$2::timestamptz, updated_at=$3::timestamptz, notes=COALESCE($4,notes) WHERE id::text=$1 AND deleted_at IS NULL RETURNING *`;
          sqlParams = [params.id, now, now, body.notes ?? null];
          break;
        default:
          return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
      }

      // Each statement above targets `WHERE id::text=$1`: narrow it to the tenant.

      sqlParams.push(tenantId);

      sql = sql.replace('WHERE id::text=$1', () => `WHERE id::text=$1 AND tenant_id=$${sqlParams.length}`);

      const [row] = await tx.$queryRawUnsafe<ExpRow[]>(sql, ...sqlParams).catch(() => [] as ExpRow[]);
      if (!row) return NextResponse.json({ error: 'Update failed' }, { status: 500 });
      return NextResponse.json(row);
  });
  return action === 'submit'
    ? withApprovalStart(response, { headers: req.headers, tenantId, referenceType: 'finance_expense', referenceId: params.id })
    : response;
}


export async function DELETE(_: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: _.headers, nextUrl: _.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const [current] = await tx.$queryRawUnsafe<{ status: string }[]>(
      `SELECT status FROM finance_expenses WHERE id::text=$1 AND deleted_at IS NULL AND tenant_id=$2`,
      params.id, tenantId,
    );
    if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!EDITABLE.includes(current.status)) {
      return NextResponse.json(
        { error: `A ${current.status} expense cannot be deleted` },
        { status: 409 },
      );
    }
    await tx.$executeRawUnsafe(
      `UPDATE finance_expenses SET deleted_at=NOW() WHERE id::text=$1 AND tenant_id=$2`, params.id, tenantId,
    );
    return NextResponse.json({ ok: true });
  });
}

