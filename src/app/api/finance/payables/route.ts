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
import type { Prisma } from '@prisma/client';
import { payableTotals } from '@/lib/finance/payable-totals';
type Row = Record<string, unknown>;


async function nextPayableNumber(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
  const [row] = await tx.$queryRawUnsafe<{ count: string }[]>(
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

      const sp     = req.nextUrl.searchParams;
      const status  = sp.get('status');
      const paymentStatus = sp.get('paymentStatus');
      const module  = sp.get('module');
      const vendor  = sp.get('vendor');
      const search  = sp.get('search')?.trim();
      const from    = sp.get('from');
      const to      = sp.get('to');
      const overdue = sp.get('overdue');
      const page    = Math.max(1,   parseInt(sp.get('page')  ?? '1'));
      const limit   = Math.min(100, parseInt(sp.get('limit') ?? '50'));
      const offset  = (page - 1) * limit;

      let where = `WHERE deleted_at IS NULL`;
      const params: unknown[] = [];
      let pi = 1;

      where += ` AND tenant_id = $${pi++}`;          params.push(tenantId);
      if (status)           { where += ` AND status = $${pi++}`;             params.push(status); }
      if (paymentStatus)    { where += ` AND payment_status = $${pi++}`;     params.push(paymentStatus); }
      if (module)           { where += ` AND module = $${pi++}`;             params.push(module); }
      if (vendor)           { where += ` AND vendor_name ILIKE $${pi++}`;    params.push(`%${vendor}%`); }
      if (search) {
        where += ` AND (payable_number ILIKE $${pi} OR vendor_name ILIKE $${pi} OR description ILIKE $${pi})`;
        params.push(`%${search}%`); pi++;
      }
      if (from)             { where += ` AND issue_date >= $${pi++}::date`;        params.push(from); }
      if (to)               { where += ` AND issue_date <= $${pi++}::date`;        params.push(to); }
      if (overdue === 'true') {
        where += ` AND due_date < CURRENT_DATE AND payment_status NOT IN ('PAID','VOID')`;
      }

      const [rows, summary, statusSummary] = await Promise.all([
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
            WHERE deleted_at IS NULL AND tenant_id = $1
            GROUP BY payment_status`,
          tenantId,
        ).catch(() => []),

        tx.$queryRawUnsafe<{ status: string; count: string; total: string; overdue: string }[]>(
          `SELECT status,
                  COUNT(*)::text                      AS count,
                  COALESCE(SUM(total_amount),0)::text AS total,
                  COUNT(*) FILTER (WHERE due_date < CURRENT_DATE AND payment_status NOT IN ('PAID','VOID'))::text AS overdue
             FROM finance_payables
            WHERE deleted_at IS NULL AND tenant_id = $1
            GROUP BY status`,
          tenantId,
        ).catch(() => []),
      ]);

      return NextResponse.json({ data: rows, summary, statusSummary, page, limit });
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

      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
      if (!String(body.vendorName ?? '').trim()) {
        return NextResponse.json({ error: 'Vendor name is required' }, { status: 400 });
      }
      const payableNumber = await nextPayableNumber(tx, tenantId);

      // Lines set the amounts (VAT 5% unless given); without lines, the subtotal given.
      const fromLines  = payableTotals(body.lineItems, body.vatAmount);
      const lineItems  = fromLines?.lineItems ?? [];
      const subtotal   = fromLines?.subtotal ?? (parseFloat(body.subtotal ?? '0') || 0);
      const vatAmount  = fromLines?.vatAmount ?? (parseFloat(body.vatAmount ?? '0') || Math.round(subtotal * 0.05 * 100) / 100);
      const total      = fromLines?.total ?? Math.round((subtotal + vatAmount) * 100) / 100;
      if (!(total > 0)) {
        return NextResponse.json({ error: 'Add at least one line with an amount' }, { status: 400 });
      }

      const [row] = await tx.$queryRawUnsafe<Row[]>(
        `INSERT INTO finance_payables
           (payable_number, vendor_id, vendor_name, vendor_email, vendor_phone,
            module, source_type, source_id, description, line_items,
            subtotal, vat_amount, total_amount, currency,
            issue_date, due_date,
            cost_centre, profit_centre,
            prepared_by, notes, tenant_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::numeric,$12::numeric,$13::numeric,$14,$15::date,$16::date,$17,$18,$19,$20,$21)
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

