/**
 * AR Aging Report API — /api/finance/ar-aging
 * Standard buckets: Current / 1-30 / 31-60 / 61-90 / 91-120 / 120+
 * Source: finance_invoices (payment_status != PAID/CANCELLED/DRAFT)
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

async function bootstrap() {
  // finance_invoices must exist — created by invoices route. Ensure branch col exists.
  await prisma.$executeRawUnsafe(`
    ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS branch TEXT DEFAULT 'Dubai'
  `).catch(() => {});
  await prisma.$executeRawUnsafe(`
    ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS vehicle_no TEXT
  `).catch(() => {});
  await prisma.$executeRawUnsafe(`
    ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS contract_type TEXT
  `).catch(() => {});
}

export async function GET(req: NextRequest) {
  await bootstrap();

  const p             = req.nextUrl.searchParams;
  const branch        = p.get('branch');
  const module_filter = p.get('module');
  const contract_type = p.get('contract_type');
  const search        = p.get('search');
  const as_of_date    = p.get('as_of_date') ?? new Date().toISOString().split('T')[0];

  let where = `WHERE deleted_at IS NULL AND payment_status NOT IN ('PAID','CANCELLED','DRAFT')`;
  const params: unknown[] = [as_of_date];
  let idx = 2;

  if (branch)        { where += ` AND branch = $${idx++}`;        params.push(branch); }
  if (module_filter) { where += ` AND module = $${idx++}`;        params.push(module_filter); }
  if (contract_type) { where += ` AND contract_type = $${idx++}`; params.push(contract_type); }
  if (search) {
    where += ` AND (client_name ILIKE $${idx} OR invoice_number ILIKE $${idx})`;
    params.push(`%${search}%`); idx++;
  }

  // ── Detail rows with computed age ───────────────────────────────────────────
  const rows = await prisma.$queryRawUnsafe(`
    SELECT
      id,
      invoice_number,
      client_name,
      branch,
      module,
      contract_type,
      vehicle_no,
      issue_date,
      due_date,
      total_amount,
      paid_amount,
      (total_amount - paid_amount)               AS outstanding,
      GREATEST(0, ($1::date - COALESCE(due_date, issue_date)))::int AS age_days,
      CASE
        WHEN GREATEST(0, ($1::date - COALESCE(due_date, issue_date))) = 0    THEN 'CURRENT'
        WHEN GREATEST(0, ($1::date - COALESCE(due_date, issue_date))) <= 30  THEN '1-30'
        WHEN GREATEST(0, ($1::date - COALESCE(due_date, issue_date))) <= 60  THEN '31-60'
        WHEN GREATEST(0, ($1::date - COALESCE(due_date, issue_date))) <= 90  THEN '61-90'
        WHEN GREATEST(0, ($1::date - COALESCE(due_date, issue_date))) <= 120 THEN '91-120'
        ELSE '120+'
      END AS bucket,
      payment_status
    FROM finance_invoices
    ${where}
    ORDER BY age_days DESC
  `, ...params) as Record<string, unknown>[];

  // ── Bucket summary ────────────────────────────────────────────────────────
  const buckets = await prisma.$queryRawUnsafe(`
    SELECT
      bucket,
      COUNT(*)                         AS invoice_count,
      SUM(outstanding)                 AS total_outstanding,
      COUNT(DISTINCT client_name)      AS customer_count
    FROM (
      SELECT
        client_name,
        (total_amount - paid_amount) AS outstanding,
        CASE
          WHEN GREATEST(0, ($1::date - COALESCE(due_date, issue_date))) = 0    THEN 'CURRENT'
          WHEN GREATEST(0, ($1::date - COALESCE(due_date, issue_date))) <= 30  THEN '1-30'
          WHEN GREATEST(0, ($1::date - COALESCE(due_date, issue_date))) <= 60  THEN '31-60'
          WHEN GREATEST(0, ($1::date - COALESCE(due_date, issue_date))) <= 90  THEN '61-90'
          WHEN GREATEST(0, ($1::date - COALESCE(due_date, issue_date))) <= 120 THEN '91-120'
          ELSE '120+'
        END AS bucket
      FROM finance_invoices
      ${where}
    ) sub
    GROUP BY bucket
    ORDER BY CASE bucket
      WHEN 'CURRENT' THEN 1 WHEN '1-30'   THEN 2 WHEN '31-60'  THEN 3
      WHEN '61-90'   THEN 4 WHEN '91-120' THEN 5 WHEN '120+'   THEN 6
    END
  `, ...params) as Record<string, unknown>[];

  // ── Customer rollup ───────────────────────────────────────────────────────
  const by_customer = await prisma.$queryRawUnsafe(`
    SELECT
      client_name,
      COUNT(*)                            AS invoice_count,
      SUM(total_amount - paid_amount)     AS total_outstanding,
      MAX(GREATEST(0, ($1::date - COALESCE(due_date, issue_date)))) AS max_age_days,
      MIN(COALESCE(due_date, issue_date)) AS oldest_due
    FROM finance_invoices
    ${where}
    GROUP BY client_name
    ORDER BY total_outstanding DESC
    LIMIT 50
  `, ...params) as Record<string, unknown>[];

  const numFmt = (v: unknown) => v != null ? Number(v) : null;

  return NextResponse.json({
    as_of_date,
    buckets: buckets.map(b => ({
      bucket:            b.bucket,
      invoice_count:     Number(b.invoice_count),
      total_outstanding: numFmt(b.total_outstanding),
      customer_count:    Number(b.customer_count),
    })),
    by_customer: by_customer.map(c => ({
      client_name:       c.client_name,
      invoice_count:     Number(c.invoice_count),
      total_outstanding: numFmt(c.total_outstanding),
      max_age_days:      Number(c.max_age_days),
      oldest_due:        c.oldest_due,
    })),
    invoices: rows.map(r => ({
      id:             r.id instanceof Buffer ? r.id.toString('hex') : String(r.id ?? ''),
      invoice_number: r.invoice_number,
      client_name:    r.client_name,
      branch:         r.branch ?? 'Dubai',
      module:         r.module,
      contract_type:  r.contract_type,
      vehicle_no:     r.vehicle_no,
      issue_date:     r.issue_date,
      due_date:       r.due_date,
      total_amount:   numFmt(r.total_amount),
      paid_amount:    numFmt(r.paid_amount),
      outstanding:    numFmt(r.outstanding),
      age_days:       Number(r.age_days),
      bucket:         r.bucket,
      payment_status: r.payment_status,
    })),
  });
}
