/**
 * AR Aging Report API - /api/finance/ar-aging
 * Standard buckets: Current / 1-30 / 31-60 / 61-90 / 91-120 / 120+
 * Source: finance_invoices net of payments and issued/applied credit notes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOperationalContext } from '@/lib/cross-module-governance';
import { ensureFinanceStatementTables } from '@/lib/finance/customer-statement';
import { prisma } from '@/lib/prisma';

async function bootstrap() {
  await ensureFinanceStatementTables();
  await prisma.$executeRawUnsafe(`
    ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS vehicle_no TEXT
  `).catch(() => {});
  await prisma.$executeRawUnsafe(`
    ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS contract_type TEXT
  `).catch(() => {});
}

export async function GET(req: NextRequest) {
  await bootstrap();

  const p = req.nextUrl.searchParams;
  const ctx = requireOperationalContext(req, 'finance', { requestedTenantId: p.get('tenantId') });
  if (ctx instanceof NextResponse) return ctx;

  const branch = p.get('branch');
  const moduleFilter = p.get('module');
  const contractType = p.get('contract_type');
  const search = p.get('search');
  const asOfDate = p.get('as_of_date') ?? new Date().toISOString().split('T')[0];

  const params: unknown[] = [ctx.tenantId, asOfDate];
  let idx = 3;
  let filters = `
    i.deleted_at IS NULL
    AND i.tenant_id::text = $1
    AND i.payment_status NOT IN ('PAID', 'CANCELLED', 'DRAFT')
  `;

  if (branch) {
    filters += ` AND i.branch = $${idx++}`;
    params.push(branch);
  }
  if (moduleFilter) {
    filters += ` AND COALESCE(i.module_source, i.module) = $${idx++}`;
    params.push(moduleFilter);
  }
  if (contractType) {
    filters += ` AND i.contract_type = $${idx++}`;
    params.push(contractType);
  }
  if (search) {
    filters += ` AND (i.client_name ILIKE $${idx} OR i.invoice_number ILIKE $${idx})`;
    params.push(`%${search}%`);
    idx++;
  }

  const baseSql = `
    WITH credit_note_net AS (
      SELECT
        COALESCE(original_invoice_id, original_invoice_no) AS invoice_match_key,
        SUM(total_amount)::numeric AS credit_note_amount
      FROM finance_credit_notes
      WHERE deleted_at IS NULL
        AND tenant_id::text = $1
        AND status NOT IN ('DRAFT', 'VOIDED')
      GROUP BY COALESCE(original_invoice_id, original_invoice_no)
    ),
    invoice_aging AS (
      SELECT
        i.id,
        i.invoice_number,
        i.client_name,
        COALESCE(i.branch, 'Unassigned') AS branch,
        COALESCE(i.module_source, i.module) AS module_key,
        i.contract_type,
        i.vehicle_no,
        i.issue_date,
        i.due_date,
        i.total_amount,
        i.paid_amount,
        COALESCE(cn.credit_note_amount, 0)::numeric AS credit_note_amount,
        GREATEST(0, (i.total_amount - i.paid_amount - COALESCE(cn.credit_note_amount, 0)))::numeric AS outstanding,
        GREATEST(0, ($2::date - COALESCE(i.due_date, i.issue_date)))::int AS age_days,
        CASE
          WHEN GREATEST(0, ($2::date - COALESCE(i.due_date, i.issue_date))) = 0    THEN 'CURRENT'
          WHEN GREATEST(0, ($2::date - COALESCE(i.due_date, i.issue_date))) <= 30  THEN '1-30'
          WHEN GREATEST(0, ($2::date - COALESCE(i.due_date, i.issue_date))) <= 60  THEN '31-60'
          WHEN GREATEST(0, ($2::date - COALESCE(i.due_date, i.issue_date))) <= 90  THEN '61-90'
          WHEN GREATEST(0, ($2::date - COALESCE(i.due_date, i.issue_date))) <= 120 THEN '91-120'
          ELSE '120+'
        END AS bucket,
        i.payment_status
      FROM finance_invoices i
      LEFT JOIN credit_note_net cn
        ON cn.invoice_match_key = i.id::text
        OR cn.invoice_match_key = i.invoice_number
      WHERE ${filters}
    )
  `;

  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
    ${baseSql}
    SELECT
      id,
      invoice_number,
      client_name,
      branch,
      module_key AS module,
      contract_type,
      vehicle_no,
      issue_date,
      due_date,
      total_amount,
      paid_amount,
      credit_note_amount,
      outstanding,
      age_days,
      bucket,
      payment_status
    FROM invoice_aging
    WHERE outstanding > 0
    ORDER BY age_days DESC, due_date ASC NULLS LAST
  `, ...params);

  const buckets = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
    ${baseSql}
    SELECT
      bucket,
      COUNT(*) AS invoice_count,
      SUM(outstanding) AS total_outstanding,
      COUNT(DISTINCT client_name) AS customer_count,
      SUM(credit_note_amount) AS total_credit_notes
    FROM invoice_aging
    WHERE outstanding > 0
    GROUP BY bucket
    ORDER BY CASE bucket
      WHEN 'CURRENT' THEN 1 WHEN '1-30' THEN 2 WHEN '31-60' THEN 3
      WHEN '61-90' THEN 4 WHEN '91-120' THEN 5 WHEN '120+' THEN 6
    END
  `, ...params);

  const byCustomer = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
    ${baseSql}
    SELECT
      client_name,
      COUNT(*) AS invoice_count,
      SUM(total_amount) AS gross_receivable,
      SUM(paid_amount) AS total_paid,
      SUM(credit_note_amount) AS total_credit_notes,
      SUM(outstanding) AS total_outstanding,
      MAX(age_days) AS max_age_days,
      MIN(COALESCE(due_date, issue_date)) AS oldest_due
    FROM invoice_aging
    WHERE outstanding > 0
    GROUP BY client_name
    ORDER BY total_outstanding DESC
    LIMIT 50
  `, ...params);

  const numFmt = (v: unknown) => v != null ? Number(v) : null;

  return NextResponse.json({
    as_of_date: asOfDate,
    buckets: buckets.map((b) => ({
      bucket: b.bucket,
      invoice_count: Number(b.invoice_count),
      total_outstanding: numFmt(b.total_outstanding),
      total_credit_notes: numFmt(b.total_credit_notes),
      customer_count: Number(b.customer_count),
    })),
    by_customer: byCustomer.map((c) => ({
      client_name: c.client_name,
      invoice_count: Number(c.invoice_count),
      gross_receivable: numFmt(c.gross_receivable),
      total_paid: numFmt(c.total_paid),
      total_credit_notes: numFmt(c.total_credit_notes),
      total_outstanding: numFmt(c.total_outstanding),
      max_age_days: Number(c.max_age_days),
      oldest_due: c.oldest_due,
    })),
    invoices: rows.map((r) => ({
      id: r.id instanceof Buffer ? r.id.toString('hex') : String(r.id ?? ''),
      invoice_number: r.invoice_number,
      client_name: r.client_name,
      branch: r.branch ?? 'Unassigned',
      module: r.module,
      contract_type: r.contract_type,
      vehicle_no: r.vehicle_no,
      issue_date: r.issue_date,
      due_date: r.due_date,
      total_amount: numFmt(r.total_amount),
      paid_amount: numFmt(r.paid_amount),
      credit_note_amount: numFmt(r.credit_note_amount),
      outstanding: numFmt(r.outstanding),
      age_days: Number(r.age_days),
      bucket: r.bucket,
      payment_status: r.payment_status,
    })),
  });
}
