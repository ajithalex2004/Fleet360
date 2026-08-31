export const dynamic = 'force-dynamic';

/**
 * AP Payables API — /api/finance/payables
 *
 * Accounts Payable sub-ledger: vendor invoices and payable obligations.
 * Lifecycle: DRAFT → SUBMITTED → APPROVED → POSTED
 * Payment status is managed automatically by the DB trigger on finance_payment_allocations.
 *
 * Tables are owned by migration 20260810000006_finance_ap_debit_notes_payment_alloc_profit_centres.
 * All queries are tenant-scoped via x-tenant-id header.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
type Row = Record<string, unknown>;

function getTenant(req: NextRequest): string | null {
  return req.headers.get('x-tenant-id');
}

async function nextPayableNumber(tenantId: string): Promise<string> {
  const [row] = await prisma.$queryRawUnsafe<{ count: string }[]>(
    `SELECT COUNT(*)::text AS count FROM finance_payables WHERE tenant_id = $1`,
    tenantId,
  ).catch(() => [{ count: '0' }]);
  const ym  = new Date().toISOString().slice(0, 7).replace('-', '');
  const seq = (parseInt(row?.count ?? '0') + 1).toString().padStart(5, '0');
  return `AP-${ym}-${seq}`;
}

// ── GET /api/finance/payables ─────────────────────────────────────────────────

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const tenantId = getTenant(req);
      if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

      const sp     = req.nextUrl.searchParams;
      const status  = sp.get('status');
      const paymentStatus = sp.get('paymentStatus');
      const module  = sp.get('module');
      const vendor  = sp.get('vendor');
      const from    = sp.get('from');
      const to      = sp.get('to');
      const overdue = sp.get('overdue');
      const page    = Math.max(1,   parseInt(sp.get('page')  ?? '1'));
      const limit   = Math.min(100, parseInt(sp.get('limit') ?? '50'));
      const offset  = (page - 1) * limit;

      let where = `WHERE deleted_at IS NULL`;
      const params: unknown[] = [];
      let pi = 1;

      if (tenantId !== '*') { where += ` AND tenant_id = $${pi++}`;          params.push(tenantId); }
      if (status)           { where += ` AND status = $${pi++}`;             params.push(status); }
      if (paymentStatus)    { where += ` AND payment_status = $${pi++}`;     params.push(paymentStatus); }
      if (module)           { where += ` AND module = $${pi++}`;             params.push(module); }
      if (vendor)           { where += ` AND vendor_name ILIKE $${pi++}`;    params.push(`%${vendor}%`); }
      if (from)             { where += ` AND issue_date >= $${pi++}`;        params.push(from); }
      if (to)               { where += ` AND issue_date <= $${pi++}`;        params.push(to); }
      if (overdue === 'true') {
        where += ` AND due_date < CURRENT_DATE AND payment_status NOT IN ('PAID','VOID')`;
      }

      const [rows, summary] = await Promise.all([
        tx.$queryRawUnsafe<Row[]>(
          `SELECT * FROM finance_payables ${where}
           ORDER BY created_at DESC LIMIT $${pi} OFFSET $${pi + 1}`,
          ...params, limit, offset,
        ).catch(() => []),

        tx.$queryRawUnsafe<{ payment_status: string; count: string; total: string }[]>(
          `SELECT payment_status,
                  COUNT(*)::text                      AS count,
                  COALESCE(SUM(total_amount),0)::text AS total
             FROM finance_payables
            WHERE deleted_at IS NULL
              ${tenantId !== '*' ? `AND tenant_id = '${tenantId}'` : ''}
            GROUP BY payment_status`,
        ).catch(() => []),
      ]);

      return NextResponse.json({ data: rows, summary, page, limit });
  });
}


// ── POST /api/finance/payables ────────────────────────────────────────────────

export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const tenantId = getTenant(req);
      if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
      const payableNumber = await nextPayableNumber(tenantId);

      const lineItems  = body.lineItems ?? [];
      const subtotal   = parseFloat(body.subtotal  ?? '0') ||
        lineItems.reduce((s: number, l: { amount?: number }) => s + (l.amount ?? 0), 0);
      const vatAmount  = parseFloat(body.vatAmount  ?? '0') || Math.round(subtotal * 0.05 * 100) / 100;
      const total      = subtotal + vatAmount;

      const [row] = await tx.$queryRawUnsafe<Row[]>(
        `INSERT INTO finance_payables
           (payable_number, vendor_id, vendor_name, vendor_email, vendor_phone,
            module, source_type, source_id, description, line_items,
            subtotal, vat_amount, total_amount, currency,
            issue_date, due_date,
            cost_centre, profit_centre,
            prepared_by, notes, tenant_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
         RETURNING *`,
        payableNumber,
        body.vendorId      ?? null,
        body.vendorName,
        body.vendorEmail   ?? null,
        body.vendorPhone   ?? null,
        body.module        ?? null,
        body.sourceType    ?? null,
        body.sourceId      ?? null,
        body.description   ?? null,
        JSON.stringify(lineItems),
        subtotal, vatAmount, total,
        body.currency      ?? 'AED',
        body.issueDate     ?? new Date().toISOString().slice(0, 10),
        body.dueDate       ?? null,
        body.costCentre    ?? null,
        body.profitCentre  ?? null,
        body.preparedBy    ?? req.headers.get('x-user-id') ?? null,
        body.notes         ?? null,
        tenantId,
      ).catch(() => []);

      if (!row) return NextResponse.json({ error: 'Failed to create payable' }, { status: 500 });
      return NextResponse.json(row, { status: 201 });
  });
}

