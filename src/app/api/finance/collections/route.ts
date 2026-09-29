export const dynamic = 'force-dynamic';

/**
 * Collections & Dunning API — /api/finance/collections
 * AR Aging buckets, collection cases, dunning workflow
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { nextDocumentNumber } from '@/lib/finance/document-number';
// Tables come from migrations (the last: 20261005090000_finance_tenant_tables).
// A request runs no DDL: the runtime role may not create tables, and the
// failed statement aborted the request's transaction, so every query after
// it failed too.

type CaseRow = Record<string, unknown>;


export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
      const sp     = req.nextUrl.searchParams;
      const status = sp.get('status');
      const page   = Math.max(1, parseInt(sp.get('page')  ?? '1'));
      const limit  = Math.min(100, parseInt(sp.get('limit') ?? '50'));
      const offset = (page - 1) * limit;

      let where = `WHERE tenant_id = $1 AND deleted_at IS NULL`;
      const params: unknown[] = [tenantId];
      let pi = 2;
      if (status) { where += ` AND status = $${pi++}`; params.push(status); }

      // Recalculate days_overdue on every fetch
      await tx.$executeRawUnsafe(
        `UPDATE finance_collection_cases SET days_overdue = GREATEST(0, CURRENT_DATE - due_date), updated_at = NOW()
         WHERE tenant_id = $1 AND deleted_at IS NULL AND status NOT IN ('SETTLED','WRITTEN_OFF','CLOSED')`,
        tenantId,
      ).catch(() => {});

      const [rows, aging] = await Promise.all([
        tx.$queryRawUnsafe<CaseRow[]>(
          `SELECT * FROM finance_collection_cases ${where} ORDER BY days_overdue DESC LIMIT $${pi} OFFSET $${pi+1}`,
          ...params, limit, offset
        ).catch(() => []),
        tx.$queryRawUnsafe<{bucket: string; count: string; total: string}[]>(
          `SELECT
             CASE WHEN days_overdue <= 0   THEN 'CURRENT'
                  WHEN days_overdue <= 30  THEN '1-30'
                  WHEN days_overdue <= 60  THEN '31-60'
                  WHEN days_overdue <= 90  THEN '61-90'
                  ELSE '90+'
             END as bucket,
             COUNT(*)::text as count,
             COALESCE(SUM(outstanding_amount),0)::text as total
           FROM finance_collection_cases
           WHERE tenant_id = $1 AND deleted_at IS NULL AND status NOT IN ('SETTLED','WRITTEN_OFF','CLOSED')
           GROUP BY 1 ORDER BY 1`,
          tenantId,
        ).catch(() => []),
      ]);

      // Pull overdue from finance_invoices to auto-surface new debtors
      const overdueInvoices = await tx.$queryRawUnsafe<{
        id: string; invoice_number: string; client_name: string; client_email: string;
        total_amount: string; paid_amount: string; due_date: string;
      }[]>(
        `SELECT id, invoice_number, client_name, client_email,
                total_amount::text, paid_amount::text, due_date
         FROM finance_invoices
         WHERE tenant_id = $1 AND deleted_at IS NULL
           AND payment_status IN ('SENT','PARTIAL','OVERDUE')
           AND due_date < CURRENT_DATE
           AND id::text NOT IN (SELECT invoice_id::text FROM finance_collection_cases
                                WHERE tenant_id = $1 AND deleted_at IS NULL AND invoice_id IS NOT NULL)
         ORDER BY due_date ASC LIMIT 20`,
        tenantId,
      ).catch(() => []);

      return NextResponse.json({ data: rows, aging, overdueInvoices, page, limit });
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
      const caseNo = await nextDocumentNumber(tx, tenantId, 'COL');

      const outstanding = parseFloat(body.invoiceAmount) - parseFloat(body.paidAmount ?? '0');
      const dueDate     = new Date(body.dueDate);
      const daysOverdue = Math.max(0, Math.floor((Date.now() - dueDate.getTime()) / 86400000));

      const [row] = await tx.$queryRawUnsafe<CaseRow[]>(
        `INSERT INTO finance_collection_cases
           (case_no, invoice_id, invoice_no, client_name, client_email, client_phone,
            invoice_amount, paid_amount, outstanding_amount, due_date, days_overdue, assigned_to, notes, tenant_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7::numeric,$8::numeric,$9::numeric,$10::date,$11,$12,$13,$14)
         RETURNING *`,
        caseNo, body.invoiceId, body.invoiceNo, body.clientName,
        body.clientEmail ?? null, body.clientPhone ?? null,
        body.invoiceAmount, body.paidAmount ?? 0, outstanding,
        body.dueDate, daysOverdue, body.assignedTo ?? null, body.notes ?? null, tenantId,
      ).catch(() => []);

      if (!row) return NextResponse.json({ error: 'Failed to create collection case' }, { status: 500 });
      return NextResponse.json(row, { status: 201 });
  });
}

