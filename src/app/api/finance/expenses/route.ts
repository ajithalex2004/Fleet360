export const dynamic = 'force-dynamic';

/**
 * Expense Management API — /api/finance/expenses
 * Handles operational expenses with approval workflow: DRAFT→SUBMITTED→APPROVED/REJECTED→PAID
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls, type TxClient } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
// Tables come from migrations (the last: 20261005090000_finance_tenant_tables).
// A request runs no DDL: the runtime role may not create tables, and the
// failed statement aborted the request's transaction, so every query after
// it failed too.

type ExpRow = Record<string, unknown>;

// expense_no is unique across all tenants, but RLS only shows this tenant's
// rows, so a count-based number alone collides with another tenant's (it used
// to count outside the tenant context, saw no rows, and every expense after
// the first was EXP-yyyymm-0001: a unique violation). The sequence counts the
// tenant's own expenses; the random suffix keeps it unique platform-wide, the
// same scheme invoice numbers use.
async function nextExpenseNo(tx: TxClient, tenantId: string): Promise<string> {
  const [row] = await tx.$queryRawUnsafe<{ count: string }[]>(
    `SELECT COUNT(*)::text as count FROM finance_expenses WHERE tenant_id = $1`, tenantId,
  );
  const seq = (parseInt(row?.count ?? '0') + 1).toString().padStart(4, '0');
  const ym = new Date().toISOString().slice(0, 7).replace('-', '');
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, '0');
  return `EXP-${ym}-${seq}-${rnd}`;
}

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
      const sp = req.nextUrl.searchParams;
      const status    = sp.get('status');
      const category  = sp.get('category');
      const centre    = sp.get('costCentre');
      const from      = sp.get('from');
      const to        = sp.get('to');
      const page      = Math.max(1, parseInt(sp.get('page')  ?? '1'));
      const limit     = Math.min(100, parseInt(sp.get('limit') ?? '50'));
      const offset    = (page - 1) * limit;

      let where = `WHERE tenant_id = $1 AND deleted_at IS NULL`;
      const params: unknown[] = [tenantId];
      let pi = 2;
      if (status)   { where += ` AND status = $${pi++}`;          params.push(status); }
      if (category) { where += ` AND category = $${pi++}`;        params.push(category); }
      if (centre)   { where += ` AND cost_centre = $${pi++}`;     params.push(centre); }
      if (from)     { where += ` AND expense_date >= $${pi++}::date`;   params.push(from); }
      if (to)       { where += ` AND expense_date <= $${pi++}::date`;   params.push(to); }

      const [rows, summary] = await Promise.all([
        tx.$queryRawUnsafe<ExpRow[]>(
          `SELECT * FROM finance_expenses ${where} ORDER BY expense_date DESC, created_at DESC LIMIT $${pi} OFFSET $${pi+1}`,
          ...params, limit, offset
        ).catch(() => []),
        tx.$queryRawUnsafe<{ status: string; count: string; total: string }[]>(
          `SELECT status, COUNT(*)::text as count, COALESCE(SUM(total_amount),0)::text as total
             FROM finance_expenses WHERE tenant_id = $1 AND deleted_at IS NULL GROUP BY status`,
          tenantId,
        ).catch(() => []),
        tx.$queryRawUnsafe<{ category: string; total: string }[]>(
          `SELECT category, COALESCE(SUM(total_amount),0)::text as total
             FROM finance_expenses WHERE tenant_id = $1 AND deleted_at IS NULL AND status IN ('APPROVED','PAID')
             GROUP BY category ORDER BY total DESC`,
          tenantId,
        ).catch(() => []),
      ]);

      return NextResponse.json({ data: rows, summary, page, limit });
  });
}

export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
      const expenseNo = await nextExpenseNo(tx, tenantId);

      const vatAmt   = parseFloat(body.vatAmount ?? '0');
      const amount   = parseFloat(body.amount ?? '0');
      const total    = amount + vatAmt;

      const [row] = await tx.$queryRawUnsafe<ExpRow[]>(
        `INSERT INTO finance_expenses
           (expense_no, category, sub_category, description, amount, currency,
            vat_amount, total_amount, expense_date, payment_method, reference_no,
            vehicle_id, driver_id, cost_centre, receipt_url, submitted_by, notes, tenant_id)
         VALUES ($1,$2,$3,$4,$5::numeric,$6,$7::numeric,$8::numeric,$9::date,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         RETURNING *`,
        expenseNo, body.category, body.subCategory ?? null, body.description,
        amount, body.currency ?? 'AED', vatAmt, total,
        body.expenseDate, body.paymentMethod ?? null, body.referenceNo ?? null,
        body.vehicleId ?? null, body.driverId ?? null, body.costCentre ?? null,
        body.receiptUrl ?? null, body.submittedBy ?? null, body.notes ?? null, tenantId,
      ).catch(() => []);

      if (!row) return NextResponse.json({ error: 'Failed to create expense' }, { status: 500 });
      return NextResponse.json(row, { status: 201 });
  });
}

