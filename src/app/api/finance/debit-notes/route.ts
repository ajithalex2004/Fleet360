/**
 * Debit Notes API — /api/finance/debit-notes
 *
 * Symmetric to credit notes.
 * AP-side: raised against a payable (vendor overcharged → we reduce our AP balance).
 * AR-side: raised against an invoice (customer underpaid → we increase the receivable).
 * Lifecycle: DRAFT → ISSUED → APPLIED | VOIDED
 *
 * Tables owned by migration 20260810000006_finance_ap_debit_notes_payment_alloc_profit_centres.
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

async function nextDnNumber(tenantId: string): Promise<string> {
  const [row] = await prisma.$queryRawUnsafe<{ count: string }[]>(
    `SELECT COUNT(*)::text AS count FROM finance_debit_notes WHERE tenant_id = $1`,
    tenantId,
  ).catch(() => [{ count: '0' }]);
  const ym  = new Date().toISOString().slice(0, 7).replace('-', '');
  const seq = (parseInt(row?.count ?? '0') + 1).toString().padStart(4, '0');
  return `DN-${ym}-${seq}`;
}

// ── GET /api/finance/debit-notes ──────────────────────────────────────────────

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
      const module  = sp.get('module');
      const from    = sp.get('from');
      const to      = sp.get('to');
      const page    = Math.max(1,   parseInt(sp.get('page')  ?? '1'));
      const limit   = Math.min(100, parseInt(sp.get('limit') ?? '50'));
      const offset  = (page - 1) * limit;

      let where = `WHERE deleted_at IS NULL`;
      const params: unknown[] = [];
      let pi = 1;

      if (tenantId !== '*') { where += ` AND tenant_id = $${pi++}`; params.push(tenantId); }
      if (status)           { where += ` AND status = $${pi++}`;    params.push(status); }
      if (module)           { where += ` AND module = $${pi++}`;    params.push(module); }
      if (from)             { where += ` AND issue_date >= $${pi++}`; params.push(from); }
      if (to)               { where += ` AND issue_date <= $${pi++}`; params.push(to); }

      const [rows, counts] = await Promise.all([
        tx.$queryRawUnsafe<Row[]>(
          `SELECT * FROM finance_debit_notes ${where}
           ORDER BY created_at DESC LIMIT $${pi} OFFSET $${pi + 1}`,
          ...params, limit, offset,
        ).catch(() => []),

        tx.$queryRawUnsafe<{ status: string; count: string; total: string }[]>(
          `SELECT status,
                  COUNT(*)::text                      AS count,
                  COALESCE(SUM(total_amount),0)::text AS total
             FROM finance_debit_notes
            WHERE deleted_at IS NULL
              ${tenantId !== '*' ? `AND tenant_id = '${tenantId}'` : ''}
            GROUP BY status`,
        ).catch(() => []),
      ]);

      return NextResponse.json({ data: rows, counts, page, limit });
  });
}


// ── POST /api/finance/debit-notes ─────────────────────────────────────────────

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
      const dnNumber = await nextDnNumber(tenantId);

      // Require exactly one source reference
      if (!body.originalPayableId && !body.originalInvoiceId) {
        return NextResponse.json(
          { error: 'Provide either originalPayableId (AP-side) or originalInvoiceId (AR-side)' },
          { status: 400 },
        );
      }

      const lineItems = body.lineItems ?? [];
      const subtotal  = parseFloat(body.subtotal ?? '0') ||
        lineItems.reduce((s: number, l: { amount?: number }) => s + (l.amount ?? 0), 0);
      const vatAmount = parseFloat(body.vatAmount ?? '0') || Math.round(subtotal * 0.05 * 100) / 100;
      const total     = subtotal + vatAmount;

      const [row] = await tx.$queryRawUnsafe<Row[]>(
        `INSERT INTO finance_debit_notes
           (dn_number, original_payable_id, original_payable_no,
            original_invoice_id, original_invoice_no,
            vendor_name, vendor_email, module,
            reason_code, reason_detail, line_items,
            subtotal, vat_amount, total_amount, currency, issue_date,
            issued_by, notes, tenant_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19)
         RETURNING *`,
        dnNumber,
        body.originalPayableId  ?? null,
        body.originalPayableNo  ?? null,
        body.originalInvoiceId  ?? null,
        body.originalInvoiceNo  ?? null,
        body.vendorName,
        body.vendorEmail        ?? null,
        body.module             ?? null,
        body.reasonCode,
        body.reasonDetail       ?? null,
        JSON.stringify(lineItems),
        subtotal, vatAmount, total,
        body.currency           ?? 'AED',
        body.issueDate          ?? new Date().toISOString().slice(0, 10),
        body.issuedBy           ?? req.headers.get('x-user-id') ?? null,
        body.notes              ?? null,
        tenantId,
      ).catch(() => []);

      if (!row) return NextResponse.json({ error: 'Failed to create debit note' }, { status: 500 });
      return NextResponse.json(row, { status: 201 });
  });
}

